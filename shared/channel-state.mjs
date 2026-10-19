// COYOTE 2.0: intensityMax is the host's current effective cap, including
// comfort protection and automatic increases. Never reconstruct it from defaults.
export function channelLimits(device, channel, limits = {}) {
  const value =
    device?.slotState?.[channel === 0 ? "channelA" : "channelB"]?.intensityMax;
  const remote = Number.isFinite(value)
    ? Math.max(0, Math.min(200, value))
    : null;
  const override = limits[`${device?.id}:${channel}`];
  const local = Number.isFinite(override)
    ? Math.max(0, Math.min(200, override))
    : null;
  return {
    remote,
    local,
    effective: remote === null ? 0 : Math.min(remote, local ?? 200),
  };
}
