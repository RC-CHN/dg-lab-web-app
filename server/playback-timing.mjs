import { ApiError } from "./dg-api.mjs";

export class PlaybackTiming {
  constructor(config = {}, now = Date.now(), random = Math.random) {
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw new ApiError("定时设置无效");
    const { delay = 0, stopAfter = 0, interval = null } = config;
    if (
      ![delay, stopAfter].every(
        (v) => Number.isInteger(v) && v >= 0 && v <= 86400,
      )
    )
      throw new ApiError("定时时间需为 0–86400 秒");
    if (
      interval !== null &&
      (!interval ||
        ![interval.work, interval.rest].every(
          (range) =>
            Array.isArray(range) &&
            range.length === 2 &&
            range.every((v) => Number.isInteger(v) && v >= 1 && v <= 3600) &&
            range[0] <= range[1],
        ))
    )
      throw new ApiError("间隔范围需为 1–3600 秒，最小值不能大于最大值");
    this.config = { delay, stopAfter, interval };
    this.random = random;
    this.startAt = now + delay * 1000;
    this.stopAt = stopAfter ? this.startAt + stopAfter * 1000 : null;
    this.phase = delay ? "delay" : "playing";
    this.until = delay
      ? this.startAt
      : interval
        ? now + this.pick("work")
        : null;
    this.lastAt = now;
  }
  pick(key) {
    const [min, max] = this.config.interval[key];
    return (min + Math.floor(this.random() * (max - min + 1))) * 1000;
  }
  tick(now = Date.now()) {
    let activeMs =
      this.phase === "playing"
        ? Math.max(
            0,
            Math.min(now, this.until ?? now, this.stopAt ?? now) - this.lastAt,
          )
        : 0;
    this.lastAt = now;
    if (this.stopAt !== null && now >= this.stopAt) this.phase = "finished";
    else if (this.until !== null && now >= this.until) {
      this.phase = this.phase === "playing" ? "rest" : "playing";
      this.until = this.config.interval
        ? now + this.pick(this.phase === "playing" ? "work" : "rest")
        : null;
      // A suspended server never replays missed intervals in a burst.
    }
    return {
      phase: this.phase,
      activeMs,
      until: this.until,
      stopAt: this.stopAt,
    };
  }
}
