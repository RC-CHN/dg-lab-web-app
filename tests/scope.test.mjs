import test from "node:test";
import assert from "node:assert/strict";
import { ScopeHistory } from "../server/scope.mjs";
import { DemoRoom } from "../server/demo.mjs";

const pulse = (c, frame, p = 1, d = 200) => ({
  t: 0,
  s: 0,
  c,
  p,
  ver: 2,
  v: [frame],
  d,
});
test("scope samples sent frames, temporary overlay wins then underlying queue resumes", (t) => {
  const scope = new ScopeHistory(() => {});
  t.after(() => scope.clear());
  scope.capture(
    [pulse(0, [1, 9, 5], 1, 1000), pulse(1, [5, 95, 10], 1, 1000)],
    1000,
  );
  scope.capture([pulse(0, [1, 9, 20], 2, 200)], 1050);
  assert.deepEqual(scope.snapshot(1100)[0].frames, [
    [1, 9, 20],
    [5, 95, 10],
  ]);
  scope.sample(1100);
  assert.deepEqual(
    scope.snapshot(1100)[0].samples.at(-1),
    [1100, 1, 9, 20, 5, 95, 10],
  );
  assert.deepEqual(scope.snapshot(1300)[0].frames, [
    [1, 9, 5],
    [5, 95, 10],
  ]);
  assert.deepEqual(scope.snapshot(2100)[0].frames, [
    [0, 0, 0],
    [0, 0, 0],
  ]);
  for (let at = 2200; at < 14000; at += 100) scope.sample(at);
  assert(scope.snapshot(14000)[0].samples.length <= 82);
  assert(scope.snapshot(14000)[0].samples.every((s) => s[0] >= 5800));
});
test("scope never invents waveforms from intensity/fire or records failed sends", async (t) => {
  const room = new DemoRoom();
  await room.attach(0);
  t.after(() => room.leave());
  room.control(0, 0, "set", 25);
  room.fire(0, 0, { active: true, value: 1, epoch: 0 });
  assert.deepEqual(room.publicState().scope, []);
  room.batch([pulse(0, [1, 9, 10])]);
  assert.deepEqual(room.publicState().scope[0].frames[0], [1, 9, 10]);
  room.send = () => {
    throw Error("wire down");
  };
  assert.throws(() => room.batch([pulse(0, [1, 9, 20])]));
  assert.deepEqual(room.publicState().scope[0].frames[0], [1, 9, 10]);
});
test("prepared DJ and manual tempo need no client lease, while actual device loss stops them", async (t) => {
  const room = new DemoRoom();
  await room.attach(0);
  t.after(() => room.leave());
  const r = room.lab.start(0, 0, {
    mode: "tempo",
    waves: [[[1, 9, 20]]],
    bpm: 120,
    switchEvery: 4,
    duration: 30,
  });
  assert.equal(r.autonomous, true);
  room.lab.run.expires = 0;
  room.lab.tick(room.lab.run);
  assert.equal(room.lab.publicState().runId, r.runId);
  assert(room.lab.run.last[0][2] > 0);
  room.devices[0].slotState.hasDevice = false;
  room.lab.tick(room.lab.run);
  assert.equal(room.lab.run, null);
  assert.throws(
    () =>
      room.play(
        0,
        0,
        [{ name: "offline", frames: [[1, 9, 20]], seconds: 10 }],
        { loop: true },
      ),
    /离线/,
  );
});
