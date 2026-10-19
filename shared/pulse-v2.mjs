// Faithful V2 conversion of the APK's built-in Dungeonlab+pulse format.
// Sources: modules 68239 (parser), 74102 (V2 generator), 63022 (lookup tables).
export function generateV2(content, frequencies, durations) {
  const fail = () => {
    throw Error("波形格式无效，请导入 Dungeonlab+pulse 波形");
  };
  if (
    typeof content !== "string" ||
    content.length > 100000 ||
    !content.startsWith("Dungeonlab+pulse:")
  )
    fail();
  const parts = content.slice("Dungeonlab+pulse:".length).split("=");
  if (parts.length > 2 || parts.some((p) => !p)) fail();
  const [rest, speed, balance] =
    parts.length === 1 ? [0, 1, 8] : parts[0].split(",").map(Number);
  const body = parts.at(-1);
  // APK module 68239 accepts speed 1/2/4; its V2 generator 74102 emits
  // one point per tick regardless of speed (V3 alone groups points by speed).
  if (
    !Number.isInteger(rest) ||
    rest < 0 ||
    rest > 100 ||
    ![1, 2, 4].includes(speed) ||
    !Number.isInteger(balance) ||
    balance < 1 ||
    balance > 16
  )
    fail();
  const frames = [];
  const sections = body.split("+section+");
  if (sections.length > 100) fail();
  for (const section of sections) {
    const [settings, pointsText] = section.split("/");
    if (!settings || !pointsText) fail();
    const [f1Index, f2Index, durationIndex, mode, enabled] = settings
      .split(",")
      .slice(0, 5)
      .map(Number);
    if (
      ![f1Index, f2Index, durationIndex, mode, enabled].every(
        Number.isInteger,
      ) ||
      f1Index < 0 ||
      f1Index > 83 ||
      f2Index < 0 ||
      f2Index > 83 ||
      durationIndex < 0 ||
      durationIndex > 99 ||
      mode < 1 ||
      mode > 4 ||
      ![0, 1].includes(enabled)
    )
      fail();
    if (!enabled) continue;
    const points = pointsText
      .split(",")
      .map((x) => parseInt(x.split("-")[0], 10));
    if (
      !points.length ||
      points.length > 1000 ||
      points.some((x) => !Number.isFinite(x) || x < 0 || x > 100)
    )
      fail();
    const f1 = frequencies[f1Index],
      f2 = frequencies[f2Index],
      n = points.length,
      repeats = Math.ceil(durations[durationIndex] / n);
    if (n === 1 && [2, 3].includes(mode)) fail();
    for (let repeat = 1; repeat <= repeats; repeat++)
      for (let j = 0; j < n; j++) {
        const c = (1 / n) * (j + 1);
        let h = f1;
        if (mode === 2)
          h = f1 + ((f2 - f1) * (repeat + (n * c - 1) / (n - 1) - 1)) / repeats;
        if (mode === 3) h = f1 + ((f2 - f1) * (n * c - 1)) / (n - 1);
        if (mode === 4)
          h =
            repeats > 1 ? f1 + ((f2 - f1) * (repeat - 1)) / (repeats - 1) : f1;
        h = Math.floor(h);
        const x = Math.max(1, Math.floor(Math.sqrt(h / 1000) * balance));
        frames.push([x, h - x, Math.floor(Math.floor(points[j]) / 5)]);
        if (frames.length > 60000) fail();
      }
  }
  for (let j = 0; j < rest; j++) frames.push([0, 0, 0]);
  if (!frames.length) fail();
  return frames;
}

export function makeCustomPulse({
  frequency = 30,
  amplitude = 50,
  shape = "sine",
  seconds = 2,
}) {
  if (
    !Number.isFinite(frequency) ||
    frequency < 1 ||
    frequency > 100 ||
    !Number.isFinite(amplitude) ||
    amplitude < 0 ||
    amplitude > 100 ||
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > 30 ||
    !["sine", "flat", "pulse", "ramp"].includes(shape)
  )
    throw Error("自定义波形参数无效");
  const h = Math.max(10, Math.min(1000, Math.round(1000 / frequency)));
  const x = Math.max(1, Math.floor(Math.sqrt(h / 1000) * 5));
  const count = Math.round(seconds * 10);
  return Array.from({ length: count }, (_, i) => {
    const phase = i / count;
    const scale =
      shape === "flat"
        ? 1
        : shape === "pulse"
          ? phase < 0.5
            ? 1
            : 0
          : shape === "ramp"
            ? phase
            : (1 - Math.cos(phase * Math.PI * 2)) / 2;
    return [x, h - x, Math.round((amplitude / 5) * scale)];
  });
}
