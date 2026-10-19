import test from "node:test";
import assert from "node:assert/strict";
import { channelView } from "../src/scope-display.mjs";

test("paused queue display stays frozen across segment changes, then resumes or clears on a new run", () => {
  const frame = { paused: true, serverTime: 1200, trace: { samples: [[1200, 1, 9, 20, 1, 9, 5]] },
    job: { runStartedAt: 1000, startedAt: 1000, elapsedMs: 200 } };
  const frozen = channelView(null, frame);
  const next = { ...frame, serverTime: 2300, job: { ...frame.job, startedAt: 2000, elapsedMs: 300 } };
  assert.equal(channelView(frozen, next), frozen);
  const resumed = channelView(frozen, { ...next, paused: false });
  assert.equal(resumed.serverTime, 2300);
  assert.equal(resumed.age, 300);
  assert.notEqual(channelView(frozen, { ...next, job: { ...next.job, runStartedAt: 2100 } }), frozen);
  assert.equal(channelView(frozen, { ...next, job: undefined }).job, undefined);
});
