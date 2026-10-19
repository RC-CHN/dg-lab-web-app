import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { DemoRoom } from "../server/demo.mjs";
import { createApp } from "../server/index.mjs";
import {
  ZERO,
  sumContributions,
  frameValid,
  transformTrack,
  echoTracks,
  curveFrames,
  randomFrames,
  blend,
  estimateBpm,
  audioEnvelope,
} from "../shared/lab.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wave = [
  [1, 9, 20],
  [5, 95, 5],
  [0, 0, 0],
  [1, 9, 10],
];
test("multiplayer vectors add independently per channel, without averaging or shared normalization", () => {
  assert.deepEqual(
    sumContributions(
      [
        { amplitudeA: 20, amplitudeB: 80 },
        { amplitudeA: 30, amplitudeB: 40 },
      ],
      70,
      90,
    ),
    { rawA: 50, rawB: 120, amplitudeA: 50, amplitudeB: 90, capA: 70, capB: 90 },
  );
  assert.equal(
    sumContributions([{ amplitudeA: 100, amplitudeB: 0 }], 0).amplitudeA,
    0,
  );
  assert.equal(sumContributions([]).amplitudeB, 0);
});
async function roomFixture(t) {
  const room = new DemoRoom();
  await room.attach(0);
  t.after(() => room.leave());
  return room;
}
function renew(room, r) {
  let seq = 0;
  const timer = setInterval(() => {
    if (room.lab.run?.runId === r.runId)
      room.lab.update({ runId: r.runId, epoch: r.epoch, seq: ++seq });
  }, 200);
  return () => clearInterval(timer);
}

test("recorded tracks reverse/resample, echo delay/decay, draw interpolates bounded frames", () => {
  assert.deepEqual(
    transformTrack(wave, { reverse: true }),
    [...wave].reverse(),
  );
  assert.equal(transformTrack(wave, { speed: 0.5 }).length, 8);
  const [a, b] = echoTracks([[1, 9, 20]], {
    delay: 0.2,
    decay: 0.5,
    repeats: 2,
  });
  assert.equal(a[0][2], 20);
  assert.equal(b[2][2], 10);
  assert.equal(a[4][2], 5);
  assert.deepEqual(b[0], ZERO);
  const drawn = curveFrames([0, 100], [100, 10], 2);
  assert.equal(drawn.length, 20);
  assert.equal(drawn.at(-1)[2], 20);
  assert(drawn.every(frameValid));
  assert.throws(() => echoTracks(wave, { delay: -1 }));
  assert.throws(() => curveFrames([0, 101], [10, 100]));
});
test("seeded procedural wave is reproducible; mix and audio transforms stay bounded", () => {
  assert.deepEqual(
    randomFrames({ seed: "abc" }),
    randomFrames({ seed: "abc" }),
  );
  assert.notDeepEqual(
    randomFrames({ seed: "abc" }),
    randomFrames({ seed: "xyz" }),
  );
  assert(randomFrames({ density: 0 }).every((f) => f[2] === 0));
  for (let mix = 0; mix <= 1; mix += 0.01)
    assert(frameValid(blend(wave[0], wave[1], mix)));
  assert.equal(audioEnvelope(new Float32Array(100), 4), 0);
  assert.equal(audioEnvelope(new Float32Array(100).fill(1), 8), 1);
  assert.equal(estimateBpm([0, 500, 1000, 1500]), 120);
});
test("live-input lab preserves base intensity and stops on expired client lease", async (t) => {
  const room = await roomFixture(t);
  const r = room.lab.start(0, 0, {
    mode: "stream",
    autonomous: true,
    duration: 30,
  });
  assert.equal(room.devices[0].props.intensityA, 12);
  assert.equal(room.devices[0].props.intensityB, 8);
  await sleep(1400);
  assert.equal(room.lab.run, null);
  assert.match(room.lab.publicState().reason, /续期/);
  assert.throws(
    () => room.lab.update({ runId: r.runId, epoch: 0, seq: 1 }),
    /已结束/,
  );
});
test("run identity and sequence reject old updates, stops and duplicate sequence", async (t) => {
  const room = await roomFixture(t);
  const old = room.lab.start(0, 0, { mode: "stream" });
  const next = room.lab.start(0, 0, { mode: "stream" });
  assert.throws(
    () =>
      room.lab.update({
        runId: old.runId,
        epoch: 0,
        seq: 1,
        frames: [wave[0], wave[0]],
      }),
    /已结束/,
  );
  assert.throws(() => room.lab.check(old.runId, 0));
  room.lab.update({
    runId: next.runId,
    epoch: 0,
    seq: 1,
    frames: [wave[0], wave[0]],
  });
  assert.throws(
    () => room.lab.update({ runId: next.runId, epoch: 0, seq: 1 }),
    /过期/,
  );
  room.stopAll();
  assert.equal(room.lab.run, null);
  assert.throws(() => room.lab.start(0, 0, { mode: "stream" }), /状态已更新/);
});
test("stop cancels local timers even when transport throws, or no devices remain", async (t) => {
  const room = await roomFixture(t);
  room.lab.start(0, 0, { mode: "stream" });
  room.send = () => {
    throw Error("wire down");
  };
  room.stopAll();
  assert.equal(room.lab.run, null);
  assert.equal(room.controlEpoch, 1);
  room.devices = [];
  room.stopAll();
  assert.equal(room.controlEpoch, 2);
});
test("interactive scene waits in silence; choice revision prevents duplicate jumps", async (t) => {
  const room = await roomFixture(t);
  const r = room.lab.start(0, 0, {
    mode: "scene",
    nodes: [
      {
        title: "Next?",
        frames: wave,
        seconds: 1,
        choices: [
          { label: "Again", to: 0 },
          { label: "End", to: -1 },
        ],
      },
    ],
    duration: 30,
  });
  const cleanup = renew(room, r);
  t.after(cleanup);
  await sleep(1150);
  const s = room.lab.publicState();
  assert(s.waiting);
  assert(s.frames.every((f) => f[2] === 0));
  room.lab.choose({
    runId: r.runId,
    epoch: 0,
    node: 0,
    revision: s.waiting.revision,
    choice: 0,
  });
  assert.throws(
    () =>
      room.lab.choose({
        runId: r.runId,
        epoch: 0,
        node: 0,
        revision: s.waiting.revision,
        choice: 0,
      }),
    /变更/,
  );
  room.lab.stop();
  assert.equal(room.lab.run, null);
});
test("DJ mix is frame-bounded and changes target on the next beat", async (t) => {
  const room = await roomFixture(t);
  const r = room.lab.start(0, 0, {
    mode: "mix",
    left: [[1, 9, 20]],
    right: [[5, 95, 0]],
    mix: 0,
    bpm: 120,
    quantize: true,
  });
  room.lab.update({ runId: r.runId, epoch: 0, seq: 1, mix: 100 });
  assert.equal(room.lab.run.mix, 0);
  await sleep(650);
  assert.equal(room.lab.run.mix, 100);
  assert(room.lab.run.last.every(frameValid));
});

async function httpFixture(t, options = {}) {
  const app = createApp({
      apiFactory: () => ({
        token: null,
        cookies: new Map(),
        leave: async () => {},
      }),
      ...options,
    }),
    server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/`,
    connections = [];
  t.after(async () => {
    await app.locals.dispose();
    connections.forEach((a) => a.abort());
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const client = async () => {
    const res = await fetch(base + "state"),
      s = await res.json(),
      cookie = res.headers.get("set-cookie").split(";")[0];
    return {
      cookie,
      csrf: s.csrf,
      async get() {
        return (
          await fetch(base + "state", { headers: { Cookie: cookie } })
        ).json();
      },
      async post(path, body = {}) {
        const r = await fetch(base + path, {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/json",
            "X-Panel-CSRF": s.csrf,
          },
          body: JSON.stringify(body),
        });
        return { status: r.status, data: await r.json() };
      },
      async events() {
        const c = new AbortController();
        connections.push(c);
        c.response = await fetch(base + "events", {
          headers: { Cookie: cookie },
          signal: c.signal,
        });
        return c;
      },
    };
  };
  const owner = await client();
  await owner.post("demo", { enabled: true });
  await owner.post("device/attach", { id: 0 });
  const ownerSSE = await owner.events();
  t.after(() => owner.post("demo", { enabled: false }).catch(() => {}));
  return { client, owner, ownerSSE };
}
test("multiple independent invitations mix A/B, enforce caps, isolate sequences and revoke only one contributor", async (t) => {
  const { owner, client } = await httpFixture(t),
    guests = [await client(), await client()];
  for (const guest of guests) await guest.events();
  const invites = [];
  for (let n = 0; n < 7; n++) {
    const result = await owner.post("coop/create", {
      id: 0,
      role: "vector",
      name: `Player ${n + 1}`,
    });
    assert.equal(result.status, 200);
    invites.push(result.data);
  }
  assert.equal(
    (await owner.post("coop/create", { id: 0, role: "vector" })).status,
    409,
  );
  for (let n = 0; n < guests.length; n++)
    assert.equal(
      (await guests[n].post("coop/join", { token: invites[n].token })).status,
      200,
    );
  const start = await owner.post("lab/start", {
    id: 0,
    epoch: 0,
    revision: 0,
    config: { mode: "coop", coopMode: "vector", capA: 73, capB: 62 },
  });
  assert.equal(start.status, 200);
  const identity = { runId: start.data.runId, epoch: 0 };
  assert.equal(
    (
      await owner.post("lab/update", {
        ...identity,
        seq: 1,
        input: { amplitudeA: 20, amplitudeB: 10 },
      })
    ).status,
    200,
  );
  for (const [n, input] of [
    { amplitudeA: 30, amplitudeB: 5 },
    { amplitudeA: 40, amplitudeB: 70 },
  ].entries())
    assert.equal(
      (await guests[n].post("coop/input", { ...identity, seq: 1, input }))
        .status,
      200,
    );
  await sleep(130);
  let state = await owner.get();
  assert.equal(state.lab.vector.rawA, 90);
  assert.equal(state.lab.vector.rawB, 85);
  assert.equal(state.lab.vector.amplitudeA, 70);
  assert.equal(state.lab.vector.amplitudeB, 60);
  assert.deepEqual(
    state.lab.frames.map((f) => f[2]),
    [14, 12],
  );
  assert.equal(state.devices[0].props.intensityA, 12);
  assert.equal(state.devices[0].props.intensityB, 8);
  const guestState = await guests[0].get();
  assert.equal(guestState.guest.lab.vector.participants.length, 3);
  for (const invite of invites)
    assert(!JSON.stringify(guestState).includes(invite.token));
  for (const input of [
    { capA: 100 },
    { period: 100 },
    { amplitudeA: -1 },
    { amplitudeB: 101 },
    { amplitudeA: "50" },
    { owner: {} },
  ])
    assert.notEqual(
      (await guests[0].post("coop/input", { ...identity, seq: 2, input }))
        .status,
      200,
    );
  assert.equal(
    (
      await guests[0].post("coop/input", {
        ...identity,
        seq: 1,
        input: { amplitudeA: 100 },
      })
    ).status,
    409,
  );
  assert.equal(
    (await guests[0].post("coop/revoke", { id: invites[1].id })).status,
    403,
  );
  // Removing an unclaimed link must not interrupt the active group.
  await owner.post("coop/revoke", { id: invites[6].id });
  assert.equal((await owner.get()).lab.runId, identity.runId);
  await owner.post("coop/revoke", { id: invites[0].id });
  await sleep(130);
  state = await owner.get();
  assert.equal(state.lab.runId, identity.runId);
  assert.equal(state.lab.vector.rawA, 60);
  assert.equal(state.lab.vector.rawB, 80);
  assert.equal(state.lab.vector.participants.length, 2);
  assert.equal(
    (
      await guests[0].post("coop/input", {
        ...identity,
        seq: 2,
        input: { amplitudeA: 100 },
      })
    ).status,
    410,
  );
  assert.equal(
    (
      await owner.post("lab/update", {
        ...identity,
        seq: 2,
        input: { capA: 0, capB: 25 },
      })
    ).status,
    200,
  );
  await sleep(130);
  assert.deepEqual(
    (await owner.get()).lab.frames.map((f) => f[2]),
    [0, 5],
  );
  assert.equal((await guests[1].post("coop/stop", identity)).status, 200);
  assert.equal((await owner.get()).lab.running, false);
  assert.equal(
    (
      await guests[1].post("coop/input", {
        ...identity,
        seq: 3,
        input: { amplitudeB: 99 },
      })
    ).status,
    409,
  );
});
test("multiplayer drops stale or disconnected contributions while the remaining players continue", async (t) => {
  const { owner, client } = await httpFixture(t),
    guests = [await client(), await client()],
    streams = [];
  for (const guest of guests) {
    streams.push(await guest.events());
    const invite = (await owner.post("coop/create", { id: 0, role: "vector" }))
      .data;
    await guest.post("coop/join", { token: invite.token });
  }
  const r = (
    await owner.post("lab/start", {
      id: 0,
      epoch: 0,
      revision: 0,
      config: { mode: "coop", coopMode: "vector" },
    })
  ).data;
  const identity = { runId: r.runId, epoch: 0 };
  await guests[0].post("coop/input", {
    ...identity,
    seq: 1,
    input: { amplitudeA: 50, amplitudeB: 0 },
  });
  let seq = 1;
  const heartbeat = async () => {
    await owner.post("lab/update", { ...identity, seq: ++seq });
    await guests[1].post("coop/input", {
      ...identity,
      seq,
      input: { amplitudeA: 0, amplitudeB: 40 },
    });
  };
  await heartbeat();
  const timer = setInterval(() => heartbeat().catch(() => {}), 200);
  t.after(() => clearInterval(timer));
  await sleep(1750);
  let state = await owner.get();
  assert.equal(state.lab.runId, r.runId);
  assert.deepEqual(
    state.lab.frames.map((f) => f[2]),
    [0, 8],
  );
  // A still-open SSE stream and heartbeat cannot preserve an expired input.
  await guests[0].post("coop/heartbeat");
  await sleep(130);
  assert.equal((await owner.get()).lab.vector.amplitudeA, 0);
  await guests[0].post("coop/input", {
    ...identity,
    seq: 2,
    input: { amplitudeA: 25, amplitudeB: 0 },
  });
  await sleep(130);
  assert.equal((await owner.get()).lab.vector.amplitudeA, 25);
  streams[0].abort();
  await sleep(150);
  state = await owner.get();
  assert.equal(state.lab.runId, r.runId);
  assert.equal(state.lab.vector.amplitudeA, 0);
  assert.equal(
    (
      await guests[0].post("coop/input", {
        ...identity,
        seq: 3,
        input: { amplitudeA: 80 },
      })
    ).status,
    403,
  );
  clearInterval(timer);
  streams[1].abort();
  await sleep(150);
  assert.equal((await owner.get()).lab.running, false);
});
test("guest roles are scoped, do not expose owner secrets, invite is single-use and revocable", async (t) => {
  const { client, owner } = await httpFixture(t),
    guest = await client(),
    other = await client();
  await guest.events();
  const invite = (
    await owner.post("coop/create", { id: 0, role: "amplitude", minutes: 1 })
  ).data;
  assert.equal(
    (await guest.post("coop/join", { token: invite.token })).status,
    200,
  );
  assert.equal(
    (await other.post("coop/join", { token: invite.token })).status,
    409,
  );
  const gs = await guest.get();
  assert.notEqual(gs.csrf, owner.csrf);
  assert.equal(gs.user, null);
  assert.deepEqual(gs.devices, []);
  assert(!JSON.stringify(gs).includes(invite.token));
  assert(!JSON.stringify(gs).includes("demo-coyote-2"));
  for (const path of [
    "control",
    "fire",
    "touch",
    "device/attach",
    "lab/start",
    "room/join",
    "login",
    "demo",
  ])
    assert.equal(
      (await guest.post(path, { id: 0, channel: 0, action: "set", value: 100 }))
        .status,
      403,
      path,
    );
  const r = (
    await owner.post("lab/start", {
      id: 0,
      epoch: 0,
      revision: 0,
      config: { mode: "coop", coopMode: "split" },
    })
  ).data;
  assert(r.runId, JSON.stringify(r));
  assert.equal(
    (
      await guest.post("coop/input", {
        runId: r.runId,
        epoch: 0,
        seq: 1,
        input: { amplitude: 40 },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await guest.post("coop/input", {
        runId: r.runId,
        epoch: 0,
        seq: 2,
        input: { period: 100 },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await guest.post("coop/input", {
        runId: r.runId,
        epoch: 0,
        seq: 1,
        input: { amplitude: 40 },
        channel: 0,
      })
    ).status,
    403,
  );
  await owner.post("coop/revoke");
  assert.equal(
    (
      await guest.post("coop/input", {
        runId: r.runId,
        epoch: 0,
        seq: 1,
        input: { amplitude: 40 },
      })
    ).status,
    410,
  );
  assert.equal((await owner.get()).lab.running, false);
});
test("owner SSE disconnect stops collaboration while guest remains online", async (t) => {
  const { client, owner, ownerSSE } = await httpFixture(t),
    guest = await client();
  await guest.events();
  const invite = (
    await owner.post("coop/create", { id: 0, role: "channelB", minutes: 1 })
  ).data;
  await guest.post("coop/join", { token: invite.token });
  const start = await owner.post("lab/start", {
    id: 0,
    epoch: 0,
    revision: 0,
    config: { mode: "coop", coopMode: "channels", swapSeconds: 10 },
  });
  assert.equal(start.status, 200);
  ownerSSE.abort();
  await sleep(50);
  assert.equal((await owner.get()).lab.running, false);
  assert.equal((await guest.get()).guest.ownerOnline, false);
});
test("guest heartbeat loss stops cooperative playback even if both SSE connections remain open", async (t) => {
  const { client, owner } = await httpFixture(t),
    guest = await client();
  await guest.events();
  const invite = (
    await owner.post("coop/create", { id: 0, role: "amplitude", minutes: 1 })
  ).data;
  await guest.post("coop/join", { token: invite.token });
  const r = (
    await owner.post("lab/start", {
      id: 0,
      epoch: 0,
      revision: 0,
      config: { mode: "coop", coopMode: "split" },
    })
  ).data;
  let seq = 0;
  const timer = setInterval(
    () =>
      owner
        .post("lab/update", { runId: r.runId, epoch: 0, seq: ++seq })
        .catch(() => {}),
    200,
  );
  t.after(() => clearInterval(timer));
  await sleep(1750);
  assert.equal((await owner.get()).lab.running, false);
});

test("stopped or expired experiments reject replayed start requests", async (t) => {
  const { owner } = await httpFixture(t);
  const request = { id: 0, epoch: 0, revision: 0, config: { mode: "stream" } };
  const first = await owner.post("lab/start", request);
  assert.equal(first.status, 200);
  const stopped = await owner.post("lab/stop", {
    runId: first.data.runId,
    epoch: 0,
  });
  assert.equal(stopped.status, 200);
  assert(stopped.data.revision > first.data.revision);
  assert.equal((await owner.post("lab/start", request)).status, 409);
  assert.equal(
    (await owner.post("lab/start", { id: 0, epoch: 0, config: request.config }))
      .status,
    409,
  );
  const nextRequest = { ...request, revision: stopped.data.revision };
  assert.equal((await owner.post("lab/start", nextRequest)).status, 200);
  await sleep(1400);
  assert.equal((await owner.get()).lab.running, false);
  assert.equal((await owner.post("lab/start", nextRequest)).status, 409);
  assert.equal((await owner.get()).lab.running, false);
});

test("guest sequence prevents late amplitude updates; old stops cannot affect a new experiment", async (t) => {
  const { client, owner } = await httpFixture(t),
    guest = await client();
  await guest.events();
  const invite = (
    await owner.post("coop/create", { id: 0, role: "amplitude", minutes: 1 })
  ).data;
  await guest.post("coop/join", { token: invite.token });
  const r = (
    await owner.post("lab/start", {
      id: 0,
      epoch: 0,
      revision: 0,
      config: { mode: "coop", coopMode: "split" },
    })
  ).data;
  assert(r.runId);
  const identity = { runId: r.runId, epoch: r.epoch };
  assert.equal(
    (
      await guest.post("coop/input", {
        ...identity,
        seq: 3,
        input: { amplitude: 0 },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await guest.post("coop/input", {
        ...identity,
        seq: 2,
        input: { amplitude: 100 },
      })
    ).status,
    409,
  );
  await sleep(150);
  assert((await owner.get()).lab.frames.every((f) => f[2] === 0));
  assert.equal(
    (
      await guest.post("coop/input", {
        ...identity,
        seq: 4,
        input: { amplitude: 50 },
      })
    ).status,
    200,
  );
  assert.equal((await guest.post("coop/stop", identity)).status, 200);
  const revision = (await owner.get()).lab.revision;
  const next = (
    await owner.post("lab/start", {
      id: 0,
      epoch: 0,
      revision,
      config: { mode: "tracks", tracks: [wave, wave], loop: true },
    })
  ).data;
  assert(next.runId);
  assert.equal((await guest.post("coop/stop", identity)).status, 409);
  assert.equal(
    (await guest.post("coop/stop", { runId: next.runId, epoch: 0 })).status,
    403,
  );
  assert.equal((await guest.post("coop/stop", {})).status, 409);
  assert.equal((await owner.get()).lab.runId, next.runId);
});

test("prepared loops survive all browser connections closing and recover progress; global stop still wins", async (t) => {
  const { owner, ownerSSE } = await httpFixture(t, { offlineGraceMs: 80 });
  const first = await owner.post("lab/start", {
    id: 0,
    epoch: 0,
    revision: 0,
    config: {
      mode: "tracks",
      source: "draw",
      tracks: [wave, wave],
      loop: true,
      duration: 30,
    },
  });
  assert.equal(first.status, 200);
  ownerSSE.abort();
  await sleep(1450);
  const current = await owner.get();
  assert.equal(current.lab.runId, first.data.runId);
  assert.equal(current.lab.autonomous, true);
  assert(current.lab.tick >= 12);
  assert(current.scope[0].samples.length >= 10);
  assert.equal(current.devices[0].props.intensityA, 12);
  await owner.events();
  assert.equal((await owner.get()).lab.runId, first.data.runId);
  await owner.post("stop");
  const stopped = await owner.get();
  assert.equal(stopped.lab.running, false);
  assert.equal(stopped.devices[0].props.intensityA, 0);
  assert.equal(
    (
      await owner.post("lab/update", {
        runId: first.data.runId,
        epoch: 0,
        seq: 99,
      })
    ).status,
    409,
  );
});
test("queue continues without a page and finite playback completion releases an idle room", async (t) => {
  const { owner, ownerSSE } = await httpFixture(t, { offlineGraceMs: 80 });
  assert.equal(
    (
      await owner.post("player/start", {
        id: 0,
        channel: 0,
        queue: [{ name: "Background", frames: wave, seconds: 2 }],
        loop: false,
      })
    ).status,
    200,
  );
  ownerSSE.abort();
  await sleep(350);
  let s = await owner.get();
  assert.equal(s.players.length, 1);
  assert.equal(s.players[0].autonomous, true);
  assert(s.scope[0].samples.length >= 3);
  await sleep(1950);
  s = await owner.get();
  assert.equal(s.players.length, 0);
  assert.equal(s.room, null);
});
