import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { encode, decode } from "@msgpack/msgpack";
import { Room, mergeState } from "../server/room.mjs";
import { presets } from "../server/index.mjs";
import { touchFrame, axisValue, defaultAxes } from "../shared/touch-v2.mjs";
import { generateV2, makeCustomPulse } from "../shared/pulse-v2.mjs";
import { readFile } from "node:fs/promises";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(t) {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(server, "listening");
  const packets = [],
    calls = [];
  let peer;
  const wrap = (d) =>
    encode({ t: 1, d: encode(d), md: { u: "fixture-owner" } });
  server.on("connection", (ws) => {
    peer = ws;
    ws.on("message", (data) => {
      if (data.length === 2 && data[0] === 0 && data[1] === 1) {
        ws.send(data);
        return;
      }
      const message = decode(data);
      packets.push(message);
      if (message.k === 1) {
        calls.push(message.m);
        const d =
          message.m === "get_devices"
            ? {
                devices: [
                  { id: 0, slotId: "fixture-slot", type: "COYOTE_020" },
                ],
              }
            : message.m === "connect"
              ? {
                  props: { intensityA: 12, intensityB: 8 },
                  slotState: {
                    channelA: { intensityMax: 80, isMuted: false },
                    channelB: { intensityMax: 100, isMuted: false },
                  },
                }
              : {};
        ws.send(wrap({ k: 2, id: message.id, d }));
      }
    });
  });
  let leaves = 0;
  const api = {
    join: async () => ({
      roomId: "fixture-room",
      preferredWsUrl: `ws://127.0.0.1:${server.address().port}/api/remote/ws`,
      connectToken: "fixture-token",
    }),
    leave: async () => {
      leaves++;
    },
  };
  const room = new Room(api, { allowLocal: true });
  t.after(async () => {
    await room.leave();
    for (const c of server.clients) c.terminate();
    await new Promise((r) => server.close(r));
  });
  await room.join("TEST1234");
  return {
    room,
    packets,
    calls,
    get leaves() {
      return leaves;
    },
    event(ev, d) {
      peer.send(wrap({ k: 3, e: [{ ev, s: 0, d }], a: [] }));
    },
    patch(d) {
      peer.send(wrap({ k: 3, e: [{ ev: 2, s: 0, d }], a: [] }));
    },
  };
}
test("join discovers devices without acquiring control; connect uses numeric slot ID", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.calls, ["get_devices"]);
  assert.equal(f.room.devices[0].connected, false);
  assert.throws(() => f.room.control(0, 0, "set", 20), /接管/);
  await f.room.attach(0);
  assert.equal(f.packets.find((p) => p.m === "connect").s, 0);
  assert.equal(f.room.devices[0].props.intensityA, 12);
  const publicText = JSON.stringify(f.room.publicState());
  assert(!publicText.includes("fixture-token"));
});
test("rapid steps and absolute settings are capped by panel and remote limit", async (t) => {
  const { room, packets } = await fixture(t);
  await room.attach(0);
  room.setLimit(0, 0, 20);
  for (let i = 0; i < 6; i++) room.control(0, 0, "add", 5);
  room.control(0, 0, "set", 200);
  await wait(20);
  const tasks = packets.flatMap((p) => p.a || []);
  assert.equal(tasks[0].v, 17);
  assert(tasks.every((t) => t.v <= 20));
  assert.equal(tasks.at(-1).v, 20);
  room.setLimit(0, 0, 200);
  assert.equal(room.limit(0, 0), 80);
  assert.throws(() => room.control(0, 0, "set", -1));
  assert.throws(() => room.control(0, 2, "set", 1));
});
test("touch overlays a running waveform, changes no base intensity, expires after lost pointer", async (t) => {
  const { room, packets } = await fixture(t);
  await room.attach(0);
  room.play(0, 0, [{ name: "fixture", frames: [[1, 9, 10]], seconds: 5 }]);
  const epoch = room.controlEpoch;
  room.touch(0, 0, { active: true, x: 0.5, y: 0.5, epoch });
  await wait(40);
  assert.equal(room.players.size, 1);
  assert.equal(room.touchTimers.size, 1);
  const touch = packets.flatMap((p) => p.a || []).filter((p) => p.p === 2);
  assert.deepEqual(touch[0].v, [[1, 9, 20]]);
  assert(touch.every((p) => p.t === 0));
  await wait(720);
  assert.equal(room.touchTimers.size, 0);
  assert.equal(room.players.size, 1);
  assert.equal(room.devices[0].props.intensityA, 12);
});
test("fire renews the same temporary increment, releases without muting or modifying pulses", async (t) => {
  const f = await fixture(t),
    { room, packets } = f;
  await room.attach(0);
  room.setLimit(0, 0, 20);
  room.fire(0, 0, { active: true, value: 30, epoch: 0 });
  f.patch({ intensityA: 20 });
  await wait(20);
  room.fire(0, 0, { active: true, value: 30, epoch: 0 });
  room.fire(0, 0, { active: false, epoch: 0 });
  await wait(20);
  const tasks = packets.flatMap((p) => p.a || []);
  assert.deepEqual(
    tasks.map((t) => t.v),
    [8, 8, 0],
  );
  assert(tasks.every((t) => t.t === 4));
  assert.equal(room.fireTimers.size, 0);
  room.fire(0, 0, { active: true, value: 1, epoch: 0 });
  await wait(650);
  assert.equal(room.fireTimers.size, 0);
});
test("emergency stop cancels all overlays and rejects delayed held requests", async (t) => {
  const { room, packets } = await fixture(t);
  await room.attach(0);
  room.touch(0, 0, { active: true, x: 0.5, y: 0.5, epoch: 0 });
  room.fire(0, 1, { active: true, value: 2, epoch: 0 });
  room.stopAll();
  await wait(30);
  assert.equal(room.touchTimers.size, 0);
  assert.equal(room.fireTimers.size, 0);
  assert.equal(room.players.size, 0);
  assert.throws(
    () => room.touch(0, 0, { active: true, x: 0.5, y: 0.5, epoch: 0 }),
    /状态已更新/,
  );
  assert.throws(
    () => room.fire(0, 0, { active: true, value: 1, epoch: 0 }),
    /状态已更新/,
  );
  const last = packets.at(-1).a;
  for (const c of [0, 1]) {
    assert(last.some((t) => t.c === c && t.t === 7 && t.v === 0));
    assert(last.some((t) => t.c === c && t.t === 5 && t.v === true));
    for (const p of [1, 2])
      assert(
        last.some(
          (t) => t.c === c && t.p === p && t.t === 0 && t.v[0][2] === 0,
        ),
      );
  }
});
test("deep patches preserve other channel settings and ignore prototype keys", () => {
  const state = {
    channelA: { intensityMax: 100, isMuted: false },
    channelB: { intensityMax: 50 },
  };
  mergeState(
    state,
    JSON.parse('{"channelA":{"isMuted":true},"__proto__":{"polluted":true}}'),
  );
  assert.deepEqual(state, {
    channelA: { intensityMax: 100, isMuted: true },
    channelB: { intensityMax: 50 },
  });
  assert.equal({}.polluted, undefined);
});
test("24 extracted presets, known official frames, malformed imports, custom bounds", async () => {
  assert.equal(presets.length, 24);
  assert.deepEqual(presets.find((p) => p.name === "挤压").frames, [
    [1, 9, 0],
    [1, 9, 20],
  ]);
  assert(
    presets.every((p) =>
      p.frames.every(
        (f) =>
          f.length === 3 &&
          f[0] >= 0 &&
          f[0] <= 16 &&
          f[1] >= 0 &&
          f[1] <= 999 &&
          f[2] >= 0 &&
          f[2] <= 20,
      ),
    ),
  );
  const tables = JSON.parse(
    await readFile(new URL("../shared/presets.json", import.meta.url)),
  );
  assert.throws(() =>
    generateV2("garbage", tables.frequencies, tables.durations),
  );
  assert.throws(() => makeCustomPulse({ frequency: 101 }));
  assert.equal(
    makeCustomPulse({ frequency: 1, shape: "flat", amplitude: 100 }).at(-1)[2],
    20,
  );
});
test("official touch axes, swap, period encoding, and gradient loop", () => {
  assert.deepEqual(touchFrame({ x: 0.5, y: 0.5 }), [1, 9, 20]);
  assert.deepEqual(touchFrame({ x: 0.5, y: 0 }), [5, 95, 20]);
  assert.equal(touchFrame({ x: 0, y: 0.5 })[2], 0);
  assert.deepEqual(touchFrame({ x: 0, y: 0.5, swapAxes: true }), [5, 95, 20]);
  assert.equal(axisValue(0.165, defaultAxes.intensity, 0, 100), 50);
  const gradient = {};
  assert.equal(touchFrame({ x: 0, y: 0.5, mode: "gradient" }, gradient)[2], 20);
  assert.equal(touchFrame({ x: 0, y: 0.5, mode: "gradient" }, gradient)[2], 18);
  assert.throws(() => touchFrame({ x: 2, y: 0.5 }));
  assert.throws(() =>
    axisValue(
      0.5,
      [
        { position: 0, value: 0 },
        { position: 0, value: 100 },
      ],
      0,
      100,
    ),
  );
});

test("remote feedback patches keep timestamps, comfort fields and phrases, and device loss cancels background queue", async (t) => {
  const f = await fixture(t);
  await f.room.attach(0);
  const initial = f.room.devices[0].propsUpdatedAt;
  await wait(10);
  f.patch({ intensityA: 17 });
  f.event(3, {
    hasDevice: true,
    channelA: {
      warmUpScale: 0.6,
      comfortLimit: { overheatPercent: 42, autoIncrScope: 3 },
    },
  });
  f.event(4, { type: 0, action: 1, opts: { feel: 6 } });
  await wait(30);
  const device = f.room.publicState().devices[0];
  assert.equal(device.props.intensityA, 17);
  assert(device.propsUpdatedAt > initial);
  assert.equal(device.slotState.channelA.comfortLimit.overheatPercent, 42);
  assert.equal(device.slotState.channelB.intensityMax, 100);
  assert.equal(device.feedback.feel, 6);
  assert.match(f.room.logs.at(-1).message, /轻一点/);
  f.room.play(
    0,
    0,
    [{ name: "background", frames: [[1, 9, 10]], seconds: 30 }],
    { loop: true },
  );
  f.event(3, { hasDevice: false });
  await wait(30);
  assert.equal(f.room.players.size, 0);
  assert.deepEqual(f.room.publicState().scope, []);
});
