// Retain each paused channel independently, including its history and progress.
// Resuming shows the current server timeline; it does not rewind device playback.
export function channelView(previous, { paused, trace, job, serverTime }) {
  const run = job?.runId ?? job?.runStartedAt ?? job?.startedAt ?? null;
  if (paused && previous?.paused && previous.run === run) return previous;
  return {
    paused, trace, job, serverTime, run,
    age: job?.elapsedMs ?? Math.max(0, serverTime - (job?.startedAt ?? serverTime)),
  };
}
