import { randomUUID } from "node:crypto";
import { ApiError } from "./dg-api.mjs";
import {
  ZERO,
  validateFrames,
  frameValid,
  blend,
  frameOf,
  number,
  clamp,
} from "../shared/lab.mjs";

export class LabEngine {
  constructor(room) {
    this.room = room;
    this.run = null;
    this.lastReason = "";
    this.revision = 0;
  }
  publicState() {
    const r = this.run;
    if (!r)
      return {
        running: false,
        reason: this.lastReason,
        revision: this.revision,
      };
    return {
      running: true,
      revision: this.revision,
      runId: r.runId,
      epoch: r.epoch,
      deviceId: r.id,
      channels: r.channels,
      mode: r.mode,
      source: r.source,
      autonomous: r.autonomous,
      sequence: r.seq,
      loop: r.loop,
      label: r.label,
      tick: r.tick,
      startedAt: r.startedAt,
      frames: r.last,
      duration: r.duration,
      node: r.node,
      waiting: r.waiting
        ? {
            node: r.node,
            title: r.nodes[r.node].title,
            choices: r.nodes[r.node].choices,
            revision: r.revision,
          }
        : null,
      mix: r.mix,
      bpm: r.bpm,
      swap:
        r.mode === "coop" && r.swapSeconds
          ? Math.floor(r.tick / (r.swapSeconds * 10)) % 2
          : 0,
    };
  }
  start(id, epoch, config, revision = this.revision) {
    if (!Number.isSafeInteger(revision) || revision !== this.revision)
      throw new ApiError("实验状态已更新，请重新开始", 409);
    if (epoch !== this.room.controlEpoch)
      throw new ApiError("控制状态已更新，请重新开始", 409);
    const device = this.room.device(id);
    if (device.slotState?.hasDevice === false)
      throw new ApiError("设备已离线", 409);
    const { mode = "tracks" } = config;
    if (!["tracks", "mix", "tempo", "stream", "coop", "scene"].includes(mode))
      throw new ApiError("实验室模式无效");
    const channels = config.channels ?? [0, 1];
    if (
      !Array.isArray(channels) ||
      !channels.length ||
      channels.length > 2 ||
      new Set(channels).size !== channels.length ||
      channels.some((c) => c !== 0 && c !== 1)
    )
      throw new ApiError("输出通道无效");
    const r = {
      id: device.id,
      slotId: device.slotId,
      runId: randomUUID(),
      epoch,
      mode,
      source: String(config.source || "").slice(0, 20),
      autonomous: ["tracks", "mix", "tempo", "scene"].includes(mode),
      label: String(config.label || "实验室").slice(0, 40),
      channels,
      tick: 0,
      startedAt: Date.now(),
      expires: Date.now() + 1200,
      seq: -1,
      last: [[...ZERO], [...ZERO]],
      stream: [[...ZERO], [...ZERO]],
      timer: null,
      duration: number(config.duration ?? 60, 1, 1800, "运行时长"),
      loop: !!config.loop,
    };
    if (mode === "tracks") {
      if (!Array.isArray(config.tracks) || config.tracks.length !== 2)
        throw new ApiError("需要 A/B 双轨数据");
      r.tracks = config.tracks.map((f) => validateFrames(f));
      r.length = Math.max(...r.tracks.map((t) => t.length));
    }
    if (mode === "mix") {
      r.left = validateFrames(config.left);
      r.right = validateFrames(config.right);
      r.mix = number(config.mix ?? 0, 0, 100);
      r.targetMix = r.mix;
      r.bpm = number(config.bpm ?? 100, 30, 200);
      r.quantize = !!config.quantize;
      r.alternate = !!config.alternate;
      r.beat = -1;
      r.phase = 0;
    }
    if (mode === "tempo") {
      if (
        !Array.isArray(config.waves) ||
        !config.waves.length ||
        config.waves.length > 30
      )
        throw new ApiError("请选择 1–30 个节拍波形");
      r.waves = config.waves.map((f) => validateFrames(f));
      r.bpm = number(config.bpm ?? 100, 30, 200);
      r.switchEvery = number(config.switchEvery ?? 4, 1, 16);
      r.phase = 0;
    }
    if (mode === "coop") {
      r.coopMode = config.coopMode === "channels" ? "channels" : "split";
      r.swapSeconds = number(config.swapSeconds ?? 0, 0, 120);
      r.inputs = {
        owner: { amplitude: 50, period: 40, bpm: 80 },
        guest: { amplitude: 0, period: 40 },
      };
    }
    if (mode === "scene") {
      if (
        !Array.isArray(config.nodes) ||
        !config.nodes.length ||
        config.nodes.length > 16
      )
        throw new ApiError("场景需要 1–16 个节点");
      r.nodes = config.nodes.map((n) => ({
        title: String(n.title || "下一段").slice(0, 60),
        frames: validateFrames(n.frames),
        seconds: number(n.seconds, 1, 120),
        choices: (Array.isArray(n.choices) ? n.choices : [])
          .map((c) => {
            if (
              !Number.isInteger(c.to) ||
              c.to < -1 ||
              c.to >= config.nodes.length
            )
              throw new ApiError("场景跳转无效");
            return { label: String(c.label || "继续").slice(0, 40), to: c.to };
          })
          .slice(0, 4),
      }));
      r.node = 0;
      r.nodeTick = 0;
      r.waiting = false;
      r.revision = 0;
    }
    this.stop(true, "切换实验");
    this.room.prepareLab(device.id);
    this.revision++;
    this.run = r;
    this.lastReason = "";
    r.timer = setInterval(() => this.tick(r), 100);
    this.tick(r);
    this.room.log(`实验室 · ${r.label}`);
    return this.publicState();
  }
  check(runId, epoch) {
    const r = this.run;
    if (
      !r ||
      r.runId !== runId ||
      r.epoch !== epoch ||
      epoch !== this.room.controlEpoch
    )
      throw new ApiError("这次实验已结束，请重新开始", 409);
    return r;
  }
  update({ runId, epoch, seq, ...patch }) {
    const r = this.check(runId, epoch);
    if (!Number.isSafeInteger(seq) || seq <= r.seq)
      throw new ApiError("已忽略过期的控制更新", 409);
    if (r.mode === "stream" && patch.frames !== undefined) {
      if (
        !Array.isArray(patch.frames) ||
        patch.frames.length !== 2 ||
        !patch.frames.every(frameValid)
      )
        throw new ApiError("实时波形无效");
      r.stream = patch.frames;
    }
    if (r.mode === "mix") {
      if (patch.mix !== undefined) r.targetMix = number(patch.mix, 0, 100);
      if (patch.bpm !== undefined) r.bpm = number(patch.bpm, 30, 200);
    }
    if (r.mode === "tempo" && patch.bpm !== undefined)
      r.bpm = number(patch.bpm, 30, 200);
    if (r.mode === "coop" && patch.input) this.coopInput("owner", patch.input);
    r.seq = seq;
    r.expires = Date.now() + 1200;
    return { ok: true };
  }
  coopInput(role, input) {
    const r = this.run;
    if (!r || r.mode !== "coop") throw new ApiError("协作尚未开始", 409);
    const fields =
      r.coopMode === "split"
        ? role === "owner"
          ? ["period", "bpm"]
          : ["amplitude"]
        : ["period", "amplitude"];
    if (Object.keys(input).some((k) => !fields.includes(k)))
      throw new ApiError("该协作角色无权修改这些参数", 403);
    const values = {};
    for (const key of fields)
      if (input[key] !== undefined)
        values[key] = number(
          input[key],
          key === "amplitude" ? 0 : key === "bpm" ? 30 : 10,
          key === "bpm" ? 200 : 100,
        );
    Object.assign(r.inputs[role], values);
    return { ok: true };
  }
  choose({ runId, epoch, node, revision, choice }) {
    const r = this.check(runId, epoch);
    if (
      r.mode !== "scene" ||
      !r.waiting ||
      r.node !== node ||
      r.revision !== revision ||
      !Number.isInteger(choice) ||
      !r.nodes[r.node].choices[choice]
    )
      throw new ApiError("当前选项已变更", 409);
    const next = r.nodes[r.node].choices[choice].to;
    if (next === -1) {
      this.stop(true, "场景结束");
      return { ok: true };
    }
    r.node = next;
    r.nodeTick = 0;
    r.waiting = false;
    r.revision++;
    this.room.changed();
    return { ok: true };
  }
  tick(r) {
    if (this.run !== r) return;
    try {
      if (r.guard && !r.guard()) {
        this.stop(true, "协作者未续期，实验已停止");
        return;
      }
      const d = this.room.device(r.id);
      if (
        this.room.status !== "connected" ||
        d.slotId !== r.slotId ||
        d.slotState?.hasDevice === false ||
        this.room.controlEpoch !== r.epoch
      ) {
        this.stop(false, "设备连接已改变");
        return;
      }
      if (!r.autonomous && Date.now() > r.expires) {
        this.stop(true, "页面未续期，实验已停止");
        return;
      }
      if (Date.now() - r.startedAt >= r.duration * 1000) {
        this.stop(true, "实验计时结束");
        return;
      }
      let pair = [[...ZERO], [...ZERO]];
      if (r.mode === "tracks") {
        if (r.tick >= r.length && !r.loop) {
          this.stop(true, "播放完成");
          return;
        }
        pair = r.tracks.map((t) => [...(t[r.tick % r.length] || ZERO)]);
      } else if (r.mode === "stream") pair = r.stream;
      else if (r.mode === "tempo") {
        const wave =
          r.waves[Math.floor(r.phase / r.switchEvery) % r.waves.length];
        const f = wave[r.tick % wave.length];
        const out = f[2]
          ? frameOf(f[0] + f[1], f[2] * 5 * Math.exp(-(r.phase % 1) * 5))
          : [...ZERO];
        pair = [out, out];
        r.phase += r.bpm / 600;
      } else if (r.mode === "mix") {
        const beat = Math.floor(r.phase);
        if (!r.quantize || beat !== r.beat) r.mix = r.targetMix;
        const fraction = (r.phase % 4) / 4,
          k = r.alternate ? beat % 2 : r.mix / 100;
        const frame = blend(
          r.left[Math.floor(fraction * r.left.length)],
          r.right[Math.floor(fraction * r.right.length)],
          k,
        );
        pair = [frame, frame];
        r.beat = beat;
        r.phase += r.bpm / 600;
      } else if (r.mode === "coop") {
        if (r.coopMode === "split") {
          const v = r.inputs.owner,
            envelope =
              (1 - Math.cos((((r.tick / 10) * v.bpm) / 60) * Math.PI * 2)) / 2;
          const f = frameOf(v.period, r.inputs.guest.amplitude * envelope);
          pair = [f, f];
        } else {
          pair = ["owner", "guest"].map((role) =>
            frameOf(r.inputs[role].period, r.inputs[role].amplitude),
          );
          if (r.swapSeconds && Math.floor(r.tick / (r.swapSeconds * 10)) % 2)
            pair.reverse();
        }
      } else if (r.mode === "scene") {
        const node = r.nodes[r.node];
        if (!r.waiting && r.nodeTick >= Math.round(node.seconds * 10)) {
          if (!node.choices.length) {
            this.stop(true, "场景结束");
            return;
          }
          r.waiting = true;
          r.revision++;
          this.room.changed();
        }
        if (!r.waiting) {
          const f = node.frames[r.nodeTick++ % node.frames.length];
          pair = [f, f];
        }
      }
      r.last = pair;
      this.room.batch(
        r.channels.map((c) => ({
          t: 0,
          s: r.id,
          c,
          p: 1,
          ver: 2,
          v: [pair[c]],
          d: 200,
          im: true,
        })),
      );
      r.tick++;
    } catch {
      this.stop(false, "设备输出中断");
    }
  }
  stop(send = true, reason = "已停止") {
    const r = this.run;
    if (!r) return;
    this.run = null;
    this.revision++;
    clearInterval(r.timer);
    this.lastReason = reason;
    if (send && this.room.status === "connected")
      try {
        this.room.batch(
          r.channels.map((c) => ({
            t: 0,
            s: r.id,
            c,
            p: 1,
            ver: 2,
            v: [[...ZERO]],
            d: 100,
            im: true,
          })),
        );
      } catch {}
    this.room.changed();
  }
}
