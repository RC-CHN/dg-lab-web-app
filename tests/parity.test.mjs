import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { channelLimits } from "../shared/channel-state.mjs";
import { generateV2 } from "../shared/pulse-v2.mjs";
import { DemoRoom } from "../server/demo.mjs";
import { PlaybackTiming } from "../server/playback-timing.mjs";

test("host cap above 100, changing cap, optional override, unknown cap and boost share one bound", async (t) => {
  const room = new DemoRoom();
  t.after(() => room.leave());
  await room.attach(0);
  const device = room.device(0),
    cs = device.slotState.channelA;
  cs.intensityMax = 160;
  assert.deepEqual(channelLimits(device, 0), {
    remote: 160,
    local: null,
    effective: 160,
  });
  room.control(0, 0, "set", 145);
  assert.equal(device.props.intensityA, 145);
  room.setLimit(0, 0, 120);
  room.control(0, 0, "set", 150);
  assert.equal(device.props.intensityA, 120);
  room.setLimit(0, 0, null);
  assert.equal(room.limit(0, 0), 160);
  assert.equal(room.limits["0:0"], undefined);
  cs.intensityMax = 70;
  room.control(0, 0, "set", 120);
  assert.equal(device.props.intensityA, 70);
  room.control(0, 0, "boost", 10, 1000);
  assert.equal(device.props.intensityA, 70);
  delete cs.intensityMax;
  assert.equal(room.limit(0, 0), 0);
  assert.equal(channelLimits(device, 0).remote, null);
  assert.throws(() => room.setLimit(0, 0, "100"));
});

test("pulse import matches 36 original APK generator vectors, plus old header defaults", async () => {
  const tables = JSON.parse(
    await readFile(new URL("../shared/presets.json", import.meta.url)),
  );
  const oracle = JSON.parse(
    await readFile(new URL("./fixtures/v2-golden.json", import.meta.url)),
  );
  for (const { content, frames } of oracle.cases)
    assert.deepEqual(
      generateV2(content, tables.frequencies, tables.durations),
      frames,
      content,
    );
  const body = "10,70,12,2,1/0-0,25-0,50-0,100-1,75-0";
  assert.deepEqual(
    generateV2(
      `Dungeonlab+pulse:${body}`,
      tables.frequencies,
      tables.durations,
    ),
    generateV2(
      `Dungeonlab+pulse:0,1,8=${body}`,
      tables.frequencies,
      tables.durations,
    ),
  );
  assert.throws(() =>
    generateV2(
      `Dungeonlab+pulse:0,3,8=${body}`,
      tables.frequencies,
      tables.durations,
    ),
  );
});

test("timing delays output, rests without advancing waveform time, and stops on a deadline", () => {
  const timer = new PlaybackTiming(
    { delay: 2, stopAfter: 6, interval: { work: [2, 2], rest: [1, 1] } },
    1000,
    () => 0,
  );
  assert.equal(timer.tick(2500).phase, "delay");
  assert.equal(timer.tick(3000).phase, "playing");
  assert.equal(timer.tick(4000).activeMs, 1000);
  assert.equal(timer.tick(5000).phase, "rest");
  assert.equal(timer.tick(5500).activeMs, 0);
  assert.equal(timer.tick(6000).phase, "playing");
  assert.equal(timer.tick(9000).phase, "finished");
  const random = new PlaybackTiming(
    { interval: { work: [2, 4], rest: [1, 3] } },
    0,
    () => 0.99,
  );
  assert.equal(random.until, 4000);
  assert.equal(random.tick(4000).until, 7000);
  // A long server suspension cannot emit catch-up intervals.
  assert.equal(random.tick(3600000).phase, "playing");
  assert.throws(
    () => new PlaybackTiming({ interval: { work: [5, 1], rest: [1, 1] } }),
  );
  assert.throws(() => new PlaybackTiming({ stopAfter: -1 }));
});

test("delayed background queue is silent, stop removes its timer, invalid timing leaves current playback intact", async (t) => {
  const room = new DemoRoom(),
    sent = [];
  t.after(() => room.leave());
  await room.attach(0);
  const send = room.send.bind(room);
  room.send = (packet) => {
    sent.push(packet);
    send(packet);
  };
  const queue = [{ name: "test", frames: [[1, 9, 20]], seconds: 5 }];
  room.play(0, 0, queue, { loop: true, timing: { delay: 1, stopAfter: 1 } });
  assert.equal(room.publicState().players[0].phase, "delay");
  assert(room.hasBackgroundPlayback());
  assert(
    sent
      .flatMap((p) => p.a || [])
      .filter((a) => a.t === 0)
      .every((a) => a.v[0][2] === 0),
  );
  assert.throws(() => room.play(0, 0, queue, { timing: { delay: -1 } }));
  assert.equal(room.players.size, 1);
  await new Promise((r) => setTimeout(r, 1150));
  assert.equal(room.publicState().players[0].phase, "playing");
  assert(
    sent.flatMap((p) => p.a || []).some((a) => a.t === 0 && a.v[0][2] === 20),
  );
  await new Promise((r) => setTimeout(r, 1050));
  assert.equal(room.players.size, 0);
  room.play(0, 0, queue, { timing: { delay: 1 } });
  room.stopAll();
  const afterStop = sent.length;
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(sent.length, afterStop);
});
