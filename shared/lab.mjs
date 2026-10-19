export const ZERO = Object.freeze([0, 0, 0]);
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export function number(value, min, max, label = "参数") {
  if (!Number.isFinite(value) || value < min || value > max)
    throw Error(`${label}应在 ${min}–${max} 之间`);
  return value;
}
export function frameValid(f) {
  return (
    Array.isArray(f) &&
    f.length === 3 &&
    f.every(Number.isInteger) &&
    f[0] >= 0 &&
    f[0] <= 16 &&
    f[1] >= 0 &&
    f[1] <= 999 &&
    f[2] >= 0 &&
    f[2] <= 20
  );
}
export function validateFrames(frames, max = 6000) {
  if (
    !Array.isArray(frames) ||
    !frames.length ||
    frames.length > max ||
    !frames.every(frameValid)
  )
    throw Error("波形帧无效或超过 10 分钟");
  return frames;
}
export function frameOf(period, percent) {
  const h = Math.round(clamp(period, 10, 1000)),
    x = Math.max(1, Math.floor(16 * Math.sqrt(h / 1000)));
  return [x, h - x, Math.round(clamp(percent, 0, 100) / 5)];
}
export function blend(a, b, amount) {
  const k = clamp(amount, 0, 1),
    az = a[2] * (1 - k),
    bz = b[2] * k;
  if (az + bz === 0) return [...ZERO];
  return frameOf(
    ((a[0] + a[1]) * az + (b[0] + b[1]) * bz) / (az + bz),
    (az + bz) * 5,
  );
}
export function transformTrack(frames, { speed = 1, reverse = false } = {}) {
  validateFrames(frames);
  number(speed, 0.25, 4, "速度");
  const source = reverse ? [...frames].reverse() : frames;
  const length = Math.max(1, Math.min(6000, Math.ceil(source.length / speed)));
  return Array.from({ length }, (_, i) => [
    ...source[Math.min(source.length - 1, Math.floor(i * speed))],
  ]);
}
export function echoTracks(
  frames,
  {
    delay = 0.6,
    decay = 0.6,
    repeats = 3,
    invert = false,
    pingPong = true,
  } = {},
) {
  validateFrames(frames);
  number(delay, 0.1, 5, "回声延迟");
  number(decay, 0, 1, "衰减");
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 8)
    throw Error("回声次数应为 1–8");
  const shift = Math.round(delay * 10),
    length = Math.min(6000, frames.length + shift * repeats);
  const tracks = [0, 1].map(() => Array.from({ length }, () => [...ZERO]));
  for (let r = 0; r <= repeats; r++)
    for (let i = 0; i < frames.length && i + shift * r < length; i++) {
      const f = frames[i],
        channel = r === 0 ? 0 : pingPong ? r % 2 : 1;
      const percent =
        (invert && r % 2 && f[2] > 0 ? 20 - f[2] : f[2]) * 5 * decay ** r;
      const out = percent ? frameOf(f[0] + f[1], percent) : [...ZERO];
      // Overlapping echoes use the stronger component, never add amplitudes.
      if (out[2] >= tracks[channel][i + shift * r][2])
        tracks[channel][i + shift * r] = out;
    }
  return tracks;
}
export function curveFrames(amplitude, period, seconds = 4) {
  number(seconds, 1, 60, "周期时长");
  for (const [values, min, max] of [
    [amplitude, 0, 100],
    [period, 10, 100],
  ]) {
    if (
      !Array.isArray(values) ||
      values.length < 2 ||
      values.length > 256 ||
      values.some((v) => !Number.isFinite(v) || v < min || v > max)
    )
      throw Error("曲线数据无效");
  }
  const lerp = (a, t) => {
    const p = t * (a.length - 1),
      i = Math.floor(p);
    return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (p - i);
  };
  const n = Math.round(seconds * 10);
  return Array.from({ length: n }, (_, i) =>
    frameOf(lerp(period, i / (n - 1)), lerp(amplitude, i / (n - 1))),
  );
}
export function randomFrames({
  seed = "dglab",
  seconds = 60,
  density = 60,
  smoothness = 50,
  chaos = 50,
} = {}) {
  number(seconds, 1, 600);
  for (const v of [density, smoothness, chaos]) number(v, 0, 100);
  let hash = 2166136261;
  for (const char of String(seed).slice(0, 100))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const rand = () => {
    hash += 0x6d2b79f5;
    let n = hash;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  let z = 0,
    period = 50,
    nextZ = 0,
    nextPeriod = 50;
  return Array.from({ length: Math.round(seconds * 10) }, (_, i) => {
    if (i % 5 === 0) {
      const gate = rand() * 100 < density;
      nextZ = gate ? (1 - chaos / 100) * 65 + chaos * rand() : 0;
      nextPeriod =
        10 +
        90 * ((1 - chaos / 100) * (((i / 5) % 4) / 3) + (chaos / 100) * rand());
    }
    const k = 1 - smoothness / 105;
    z += (nextZ - z) * k;
    period += (nextPeriod - period) * k;
    return frameOf(period, z);
  });
}
export function estimateBpm(taps) {
  const intervals = taps
    .slice(1)
    .map((t, i) => t - taps[i])
    .filter((n) => n >= 250 && n <= 2000)
    .slice(-7)
    .sort((a, b) => a - b);
  return intervals.length
    ? Math.round(60000 / intervals[Math.floor(intervals.length / 2)])
    : null;
}
export function audioEnvelope(samples, gain = 2) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return clamp(Math.sqrt(sum / Math.max(1, samples.length)) * gain, 0, 1);
}
