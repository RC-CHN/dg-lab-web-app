import { EventEmitter } from "node:events";
import { encode, decode } from "@msgpack/msgpack";
import { ApiError } from "./dg-api.mjs";
import { LabEngine } from "./lab.mjs";
import { touchFrame } from "../shared/touch-v2.mjs";
import { ScopeHistory } from "./scope.mjs";
import { feedbackPhrases } from "../shared/feedback.mjs";
import { channelLimits } from "../shared/channel-state.mjs";
import { PlaybackTiming } from "./playback-timing.mjs";

export function mergeState(target, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    return target;
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (
        !target[key] ||
        typeof target[key] !== "object" ||
        Array.isArray(target[key])
      )
        target[key] = {};
      mergeState(target[key], value);
    } else target[key] = value;
  }
  return target;
}

export class Room extends EventEmitter {
  constructor(api, { WebSocketClass = WebSocket, allowLocal = false } = {}) {
    super();
    this.api = api;
    this.WebSocketClass = WebSocketClass;
    this.allowLocal = allowLocal;
    this.status = "idle";
    this.devices = [];
    this.pending = new Map();
    this.sequence = 0;
    this.players = new Map();
    this.logs = [];
    this.limits = {};
    this.streams = {};
    this.info = null;
    this.peer = null;
    this.lastFrame = 0;
    this.stopping = false;
    this.touchTimers = new Map();
    this.fireTimers = new Map();
    this.commandTargets = new Map();
    this.controlEpoch = 0;
    this.lab = new LabEngine(this);
    this.generation = 0;
    this.scope = new ScopeHistory(() => this.changed());
  }
  publicState() {
    return {
      serverTime: Date.now(),
      scope: this.scope.snapshot(),
      lab: this.lab.publicState(),
      controlEpoch: this.controlEpoch,
      status: this.status,
      room: this.info,
      devices: this.devices,
      peer: this.peer,
      limits: this.limits,
      players: [...this.players.values()].map((p) => ({
        deviceId: p.deviceId,
        channel: p.channel,
        label: p.label,
        startedAt: p.startedAt,
        runStartedAt: p.runStartedAt,
        duration: p.duration,
        index: p.index,
        queueLength: p.queue.length,
        loop: p.loop,
        autonomous: true,
        phase: p.timing.phase,
        phaseUntil: p.timing.until,
        stopAt: p.timing.stopAt,
        elapsedMs: p.elapsedMs,
      })),
      logs: this.logs.slice(-60),
      lastFrame: this.lastFrame,
    };
  }
  changed() {
    this.emit("change", this.publicState());
  }
  log(message, kind = "info") {
    this.logs.push({ time: Date.now(), message, kind });
    this.logs = this.logs.slice(-100);
    this.changed();
  }
  send(packet) {
    if (this.ws?.readyState !== 1 || this.status !== "connected")
      throw new ApiError("房间未连接", 409);
    this.ws.send(encode(packet));
  }
  rpc(method, data, slot) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ApiError(`设备未响应：${method}`, 504));
      }, 7000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ k: 1, id, m: method, d: data ?? null, s: slot ?? null });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async join(code, password) {
    if (this.status === "connecting")
      throw new ApiError("正在连接，请稍候", 409);
    if (this.info) {
      const leaving = this.leave(),
        generation = this.generation;
      await leaving;
      if (generation !== this.generation)
        throw new ApiError("房间连接已取消", 409);
    }
    this.status = "connecting";
    this.changed();
    const generation = this.generation;
    const credentials = this.api.credentials?.();
    const current = () => {
      if (generation !== this.generation)
        throw new ApiError("房间连接已取消", 409);
    };
    let joined;
    try {
      joined = await this.api.join(code, password);
      current();
      this.info = {
        id: joined.roomId,
        code,
        region: joined.preferredWsRegion || joined.roomRegion,
        limitMode: joined.limitMode,
        memberMaxConnMinutes: joined.memberMaxConnMinutes,
      };
      this.peer = { nickname: joined.owner?.nickname || "房主" };
      let url = joined.preferredWsUrl;
      if (!url) {
        const servers = await this.api.request("/remote/ws-servers/online");
        current();
        url = servers?.[0]?.wsUrl;
      }
      await this.connectTransport(url, joined.connectToken);
      current();
      await this.refresh();
      current();
      this.log("已加入房间，选择设备后可接管控制");
    } catch (error) {
      if (generation !== this.generation) {
        if (joined?.roomId)
          await this.api.leave(joined.roomId, credentials).catch(() => {});
        throw error;
      }
      this.closeTransport();
      if (joined?.roomId)
        await this.api.leave(joined.roomId, credentials).catch(() => {});
      this.info = null;
      this.devices = [];
      this.status = "idle";
      this.changed();
      throw error;
    }
    return this.publicState();
  }
  connectTransport(url, token) {
    const target = new URL(url);
    if (
      !this.allowLocal &&
      (target.protocol !== "wss:" ||
        !(
          target.hostname.endsWith(".dungeon-lab.cn") ||
          target.hostname === "dungeon-lab.cn"
        ))
    )
      throw new ApiError("官方返回的节点地址不受支持", 502);
    target.searchParams.set("token", token);
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new this.WebSocketClass(target.toString()));
      ws.binaryType = "arraybuffer";
      let ready = false;
      const timer = setTimeout(() => {
        reject(new ApiError("房间连接超时，请重新加入", 504));
        ws.close();
      }, 8000);
      ws.addEventListener("open", () => ws.send(new Uint8Array([0, 1])));
      ws.addEventListener("message", (event) => {
        if (this.ws !== ws) return;
        this.lastFrame = Date.now();
        if (!ready) {
          ready = true;
          clearTimeout(timer);
          this.status = "connected";
          this.heartbeat = setInterval(() => {
            if (Date.now() - this.lastFrame > 11000) {
              this.log("心跳超时，已停止面板播放", "error");
              ws.close();
              return;
            }
            if (ws.readyState === 1) ws.send(new Uint8Array([0, 1]));
          }, 3000);
          resolve();
          this.changed();
        }
        this.receive(event.data);
      });
      ws.addEventListener("error", () => {
        if (!ready) {
          clearTimeout(timer);
          reject(new ApiError("无法连接房间节点", 502));
        }
      });
      ws.addEventListener("close", (event) => {
        clearTimeout(timer);
        if (!ready)
          reject(
            new ApiError(
              `房间鉴权失败（${event.code}），请重新加入获取新令牌`,
              409,
            ),
          );
        if (this.ws !== ws) return;
        this.cancelPlayers();
        clearInterval(this.heartbeat);
        this.ws = null;
        this.failPending();
        this.devices.forEach((d) => {
          d.connected = false;
        });
        this.status = this.stopping ? "idle" : "disconnected";
        if (!this.stopping)
          this.log(`房间连接断开（${event.code}），播放不会自动恢复`, "error");
        this.changed();
      });
    });
  }
  receive(data) {
    try {
      const bytes = new Uint8Array(data);
      if (bytes.length === 2 && bytes[0] === 0 && bytes[1] === 1) return;
      const outer = decode(bytes);
      if (outer.t === 2) {
        const event = outer.d;
        if (event.e === 5 && event.y === 1) {
          this.log("房主关闭了房间", "error");
          this.ws?.close();
        }
        if (event.e === 4 && this.info) {
          this.info.limitMode = event.p?.lm ?? this.info.limitMode;
        }
        this.changed();
        return;
      }
      if (outer.t !== 1 || !outer.d) return;
      const message = decode(outer.d);
      if (message.k === 1 && ["ping", "get_devices"].includes(message.m))
        this.send({
          k: 2,
          id: message.id,
          d: message.m === "ping" ? {} : { devices: [] },
        });
      else if (message.k === 2) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          message.e
            ? pending.reject(new ApiError(String(message.e)))
            : pending.resolve(message.d);
        }
      } else if (message.k === 3) {
        for (const event of message.e || []) {
          if (event.ev === 1) {
            this.refresh().catch(() => {});
            continue;
          }
          const device = this.devices.find((d) => d.id === event.s);
          if (!device) continue;
          if (event.ev === 2) {
            mergeState(device.props, event.d);
            device.propsUpdatedAt = Date.now();
            for (const c of [0, 1]) {
              const key = `${device.id}:${c}`,
                field = c === 0 ? "intensityA" : "intensityB",
                pending = this.commandTargets.get(key);
              if (
                pending &&
                (event.d?.[field] === pending.value ||
                  Date.now() - pending.at > 1200)
              )
                this.commandTargets.delete(key);
            }
          }
          if (event.ev === 3) {
            mergeState(device.slotState, event.d);
            device.slotUpdatedAt = Date.now();
          }
          if (
            device.slotState.hasDevice === false ||
            device.props.connectState === "disconnected"
          ) {
            if (this.lab.run?.id === device.id)
              this.lab.stop(false, "设备离线");
            for (const c of [0, 1]) this.stopPlayer(device.id, c, false);
            this.scope.remove(device.id);
          }
          if (event.ev === 4 && event.d?.type === 0) {
            device.feedback = {
              time: Date.now(),
              action: event.d.action,
              feel: event.d.opts?.feel,
            };
            this.log(
              `收到设备端快捷反馈${Number.isInteger(device.feedback.feel) ? ` · ${feedbackPhrases[device.feedback.feel] || device.feedback.feel}` : ""}`,
              "peer",
            );
          }
        }
        this.changed();
      }
    } catch {
      this.log("收到无法识别的房间消息", "error");
    }
  }
  async refresh() {
    const generation = this.generation;
    const result = await this.rpc("get_devices");
    if (generation !== this.generation)
      throw new ApiError("房间连接已改变", 409);
    if (!Array.isArray(result?.devices))
      throw new ApiError("设备列表格式无效", 502);
    const old = new Map(this.devices.map((d) => [d.id, d]));
    const ids = new Set(result.devices.map((d) => d.id));
    for (const p of this.players.values())
      if (
        !ids.has(p.deviceId) ||
        !result.devices.some(
          (d) =>
            d.id === p.deviceId &&
            d.slotId === p.slotId &&
            d.type === "COYOTE_020",
        )
      ) {
        this.stopPlayer(p.deviceId, p.channel, false);
        this.scope.remove(p.deviceId);
      }
    this.devices = result.devices.map((d) => {
      const previous = old.get(d.id);
      const same = previous?.slotId === d.slotId && previous?.type === d.type;
      return {
        ...d,
        connected: (same && previous.connected) || false,
        props: same ? previous.props : {},
        slotState: same ? previous.slotState : {},
        propsUpdatedAt: same ? previous.propsUpdatedAt : null,
        slotUpdatedAt: same ? previous.slotUpdatedAt : null,
        feedback: same ? previous.feedback : null,
      };
    });
    if (
      this.lab.run &&
      !this.devices.some(
        (d) =>
          d.connected &&
          d.id === this.lab.run.id &&
          d.slotId === this.lab.run.slotId,
      )
    )
      this.lab.stop(false, "设备列表已改变");
    this.changed();
    return this.devices;
  }
  device(id, requireConnected = true) {
    const device = this.devices.find((d) => d.id === Number(id));
    if (!device || (requireConnected && !device.connected))
      throw new ApiError("请先接管设备", 409);
    if (device.type !== "COYOTE_020")
      throw new ApiError("此面板当前仅开放已核对协议的 2.0 主机控制", 409);
    return device;
  }
  async attach(id) {
    const device = this.device(id, false);
    const generation = this.generation;
    const info = await this.rpc("connect", undefined, device.id);
    if (generation !== this.generation || !this.devices.includes(device))
      throw new ApiError("设备连接已改变", 409);
    device.props = info.props || {};
    device.slotState = info.slotState || {};
    device.connected = true;
    device.propsUpdatedAt = device.slotUpdatedAt = Date.now();
    this.log(`已接管 ${device.name || "2.0 主机"}，状态同步已开启`);
    return device;
  }
  async detach(id) {
    const device = this.device(id);
    this.stopDevice(device.id);
    await this.rpc("disconnect", undefined, device.id);
    device.connected = false;
    this.log("已释放设备控制");
  }
  channelState(device, channel) {
    return device.slotState?.[channel === 0 ? "channelA" : "channelB"] || {};
  }
  channel(channel) {
    if (channel !== 0 && channel !== 1) throw new ApiError("通道无效");
    return channel;
  }
  limit(id, channel) {
    this.channel(channel);
    return channelLimits(this.device(id), channel, this.limits).effective;
  }
  setLimit(id, channel, value) {
    this.device(id);
    this.channel(channel);
    if (
      value !== null &&
      (!Number.isInteger(value) || value < 0 || value > 200)
    )
      throw new ApiError("面板上限必须在 0–200 之间");
    if (value === null) delete this.limits[`${id}:${channel}`];
    else this.limits[`${id}:${channel}`] = value;
    this.changed();
  }
  batch(actions = [], events = []) {
    this.send({ k: 3, e: events, a: actions });
    this.scope.capture(actions);
  }
  hasBackgroundPlayback() {
    return this.players.size > 0 || !!this.lab.run?.autonomous;
  }
  control(id, channel, action, value, duration = 1000) {
    const device = this.device(id);
    this.channel(channel);
    const key = `${id}:${channel}`,
      pending = this.commandTargets.get(key);
    const current =
      pending && Date.now() - pending.at < 1200
        ? pending.value
        : device.props[channel === 0 ? "intensityA" : "intensityB"];
    const cap = this.limit(id, channel);
    const base = { s: device.id, c: channel, p: 1 };
    let task;
    if (action === "mute") {
      if (typeof value !== "boolean") throw new ApiError("暂停参数无效");
      task = { ...base, t: 5, v: value };
    } else if (["set", "add", "boost"].includes(action)) {
      if (!Number.isInteger(value) || Math.abs(value) > 200)
        throw new ApiError("强度必须为 -200–200 内的整数");
      if (action === "set" && value < 0) throw new ApiError("强度不能为负数");
      if (action === "set") task = { ...base, t: 7, v: Math.min(cap, value) };
      else {
        if (!Number.isFinite(current))
          throw new ApiError("正在等待设备强度状态", 409);
        // Send an absolute capped target for a UI +/- step, so rapid clicks cannot
        // exceed the panel cap while waiting for the peer's next state patch.
        if (action === "add")
          task = {
            ...base,
            t: 7,
            v: Math.max(0, Math.min(cap, current + value)),
          };
        else {
          if (
            value < 0 ||
            !Number.isInteger(duration) ||
            duration < 1000 ||
            duration > 30000
          )
            throw new ApiError("临时增强为非负整数，持续 1–30 秒");
          task = {
            ...base,
            t: 4,
            v: Math.min(value, Math.max(0, cap - current)),
            d: duration,
            im: true,
          };
        }
      }
    } else throw new ApiError("不支持的操作");
    this.batch([task]);
    if (task.t === 7)
      this.commandTargets.set(key, { value: task.v, at: Date.now() });
    this.log(
      `${channel === 0 ? "A" : "B"} 通道 · ${action === "mute" ? (value ? "暂停" : "恢复") : action === "boost" ? `临时 +${task.v} / ${duration / 1000}s` : `设为 ${task.v}`}`,
    );
    return { sent: true, task: { t: task.t, v: task.v }, confirmed: false };
  }
  stopPlayer(id, channel, sendSilence = true) {
    const key = `${id}:${channel}`,
      player = this.players.get(key);
    if (player) clearInterval(player.timer);
    this.players.delete(key);
    if (sendSilence && this.status === "connected")
      this.batch([
        {
          t: 0,
          s: Number(id),
          c: channel,
          ver: 2,
          v: [[0, 0, 0]],
          d: 200,
          im: true,
          p: 1,
        },
      ]);
    this.changed();
  }
  cancelPlayers() {
    this.lab.stop(false, "连接或控制已停止");
    for (const p of this.players.values()) clearInterval(p.timer);
    this.players.clear();
    for (const t of this.touchTimers.values()) clearInterval(t.timer);
    this.touchTimers.clear();
    for (const t of this.fireTimers.values()) clearTimeout(t.timer);
    this.fireTimers.clear();
    this.commandTargets.clear();
  }
  play(id, channel, queue, { loop = false, scale = 100, timing = {} } = {}) {
    const device = this.device(id);
    this.channel(channel);
    if (
      device.slotState?.hasDevice === false ||
      device.props.connectState === "disconnected"
    )
      throw new ApiError("设备已离线", 409);
    if (
      !queue.length ||
      queue.length > 30 ||
      !Number.isFinite(scale) ||
      scale < 0 ||
      scale > 100
    )
      throw new ApiError("播放参数无效");
    for (const item of queue) {
      if (
        !Array.isArray(item.frames) ||
        !item.frames.length ||
        item.frames.length > 60000 ||
        !Number.isInteger(item.seconds) ||
        item.seconds < 1 ||
        item.seconds > 600
      )
        throw new ApiError("波形或播放时长无效");
      for (const frame of item.frames)
        if (
          !Array.isArray(frame) ||
          frame.length !== 3 ||
          !frame.every(Number.isInteger) ||
          frame[0] < 0 ||
          frame[0] > 16 ||
          frame[1] < 0 ||
          frame[1] > 999 ||
          frame[2] < 0 ||
          frame[2] > 20
        )
          throw new ApiError("2.0 波形帧超出协议范围");
    }
    const playbackTiming = new PlaybackTiming(timing);
    this.lab.stop(true, "切换到波形队列");
    this.stopPlayer(id, channel, false);
    const player = {
      deviceId: Number(id),
      slotId: device.slotId,
      channel,
      queue,
      index: 0,
      frame: 0,
      startedAt: Date.now(),
      runStartedAt: Date.now(),
      duration: queue[0].seconds,
      label: queue[0].name,
      loop,
      scale,
      timer: null,
      timing: playbackTiming,
      elapsedMs: 0,
    };
    const tick = () => {
      try {
        const current = this.device(id);
        if (
          current.slotId !== player.slotId ||
          current.slotState?.hasDevice === false ||
          current.props.connectState === "disconnected"
        ) {
          this.stopPlayer(id, channel, false);
          return;
        }
        const previousPhase = player.timing.phase;
        const clock = player.timing.tick();
        if (clock.phase === "finished") {
          this.stopPlayer(id, channel);
          return;
        }
        player.elapsedMs += clock.activeMs;
        if (previousPhase !== clock.phase) this.changed();
        if (clock.phase !== "playing") {
          this.batch([
            {
              t: 0,
              s: Number(id),
              c: channel,
              ver: 2,
              v: [[0, 0, 0]],
              d: 200,
              im: true,
              p: 1,
            },
          ]);
          return;
        }
        if (player.elapsedMs >= player.duration * 1000) {
          player.index++;
          if (player.index >= queue.length) {
            if (loop) player.index = 0;
            else {
              this.stopPlayer(id, channel);
              return;
            }
          }
          player.startedAt = Date.now();
          player.elapsedMs = 0;
          player.duration = queue[player.index].seconds;
          player.label = queue[player.index].name;
          player.frame = 0;
          this.changed();
        }
        const item = queue[player.index],
          frame = [...item.frames[player.frame++ % item.frames.length]];
        frame[2] = Math.round((frame[2] * scale) / 100);
        this.batch([
          {
            t: 0,
            s: Number(id),
            c: channel,
            ver: 2,
            v: [frame],
            d: 200,
            im: true,
            p: 1,
          },
        ]);
      } catch {
        this.stopPlayer(id, channel, false);
      }
    };
    this.players.set(`${id}:${channel}`, player);
    player.timer = setInterval(tick, 100);
    tick();
    this.log(`${channel === 0 ? "A" : "B"} 通道 · 播放 ${player.label}`);
  }
  stopDevice(id, bump = true) {
    const device = this.device(id);
    if (bump) this.controlEpoch++;
    if (this.lab.run?.id === device.id) this.lab.stop(false);
    const actions = [];
    for (const c of [0, 1]) {
      this.stopPlayer(id, c, false);
      const key = `${id}:${c}`;
      clearInterval(this.touchTimers.get(key)?.timer);
      this.touchTimers.delete(key);
      clearTimeout(this.fireTimers.get(key)?.timer);
      this.fireTimers.delete(key);
      this.commandTargets.delete(key);
      actions.push(
        {
          t: 0,
          s: device.id,
          c,
          ver: 2,
          v: [[0, 0, 0]],
          d: 200,
          im: true,
          p: 1,
        },
        {
          t: 0,
          s: device.id,
          c,
          ver: 2,
          v: [[0, 0, 0]],
          d: 200,
          im: true,
          p: 2,
        },
        { t: 4, s: device.id, c, v: 0, d: 100, im: true, p: 2 },
        { t: 4, s: device.id, c, v: 0, d: 100, im: true, p: 1 },
        { t: 7, s: device.id, c, v: 0, p: 1 },
        { t: 5, s: device.id, c, v: true, p: 1 },
      );
    }
    this.batch(actions);
    this.log("播放已停止，已发送双通道归零与暂停", "stop");
  }
  stopAll() {
    this.controlEpoch++;
    this.cancelPlayers();
    for (const d of this.devices)
      if (d.connected)
        try {
          this.stopDevice(d.id, false);
        } catch {}
    this.changed();
  }
  prepareLab(id) {
    // Switching waveform sources keeps base intensity and pause state intact.
    const actions = [];
    for (const c of [0, 1]) {
      this.stopPlayer(id, c, false);
      const key = `${id}:${c}`;
      clearInterval(this.touchTimers.get(key)?.timer);
      this.touchTimers.delete(key);
      clearTimeout(this.fireTimers.get(key)?.timer);
      this.fireTimers.delete(key);
      for (const p of [1, 2])
        actions.push(
          {
            t: 0,
            s: Number(id),
            c,
            p,
            ver: 2,
            v: [[0, 0, 0]],
            d: 100,
            im: true,
          },
          { t: 4, s: Number(id), c, p, v: 0, d: 100, im: true },
        );
    }
    this.batch(actions);
  }
  touch(id, channel, options) {
    this.device(id);
    this.channel(channel);
    const { active, epoch } = options,
      key = `${id}:${channel}`;
    if (typeof active !== "boolean") throw new ApiError("触控参数无效");
    if (epoch !== this.controlEpoch)
      throw new ApiError("控制状态已更新，请重新按下", 409);
    if (active) this.lab.stop(true, "切换到官方触控");
    const previous = this.touchTimers.get(key);
    const stop = () => {
      clearInterval(this.touchTimers.get(key)?.timer);
      this.touchTimers.delete(key);
      if (this.status === "connected")
        this.batch([
          {
            t: 0,
            s: Number(id),
            c: channel,
            ver: 2,
            v: [[0, 0, 0]],
            d: 100,
            im: true,
            p: 2,
          },
        ]);
    };
    if (!active) {
      stop();
      return { sent: true };
    }
    // Touch overrides the waveform only. Base channel intensity is unchanged.
    if (!options.frames) touchFrame(options, {});
    const input = { ...options };
    if (previous) {
      previous.options = input;
      previous.expires = Date.now() + 600;
      return { sent: true };
    }
    const held = {
      options: input,
      expires: Date.now() + 600,
      gradient: {},
      index: 0,
      presetId: null,
      timer: null,
    };
    const tick = () => {
      try {
        if (Date.now() > held.expires) {
          stop();
          return;
        }
        const o = held.options;
        if (o.presetId !== held.presetId) {
          held.index = 0;
          held.gradient = {};
          held.presetId = o.presetId;
        }
        const frame = o.frames
          ? o.frames[held.index++ % o.frames.length]
          : touchFrame(o, held.gradient);
        this.batch([
          {
            t: 0,
            s: Number(id),
            c: channel,
            ver: 2,
            v: [frame],
            d: 200,
            im: true,
            p: 2,
          },
        ]);
      } catch {
        clearInterval(held.timer);
        this.touchTimers.delete(key);
      }
    };
    this.touchTimers.set(key, held);
    held.timer = setInterval(tick, 100);
    tick();
    return { sent: true };
  }
  fire(id, channel, { active, value = 1, epoch }) {
    const device = this.device(id);
    this.channel(channel);
    if (epoch !== this.controlEpoch)
      throw new ApiError("控制状态已更新，请重新按下", 409);
    if (
      typeof active !== "boolean" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 30
    )
      throw new ApiError("开火增量应为 1–30");
    const key = `${id}:${channel}`,
      previous = this.fireTimers.get(key);
    clearTimeout(previous?.timer);
    const stop = () => {
      this.fireTimers.delete(key);
      if (this.status === "connected")
        this.batch([
          { t: 4, s: Number(id), c: channel, v: 0, d: 100, im: true, p: 2 },
        ]);
    };
    if (!active) {
      stop();
      return { sent: true };
    }
    const current = device.props[channel === 0 ? "intensityA" : "intensityB"];
    if (!Number.isFinite(current)) throw new ApiError("等待强度状态", 409);
    // Hold-to-fire is an offset, never a pulse or an absolute intensity.
    // Keep the original baseline until release: a delayed state echo must not
    // cause the held increment to be added repeatedly.
    const baseline = previous?.baseline ?? current;
    const delta = Math.min(
      value,
      Math.max(0, this.limit(id, channel) - baseline),
    );
    this.batch([
      { t: 4, s: Number(id), c: channel, v: delta, d: 1000, im: true, p: 2 },
    ]);
    this.fireTimers.set(key, { baseline, delta, timer: setTimeout(stop, 600) });
    if (!previous)
      this.log(`${channel === 0 ? "A" : "B"} 通道 · 按住开火 +${delta}`);
    return { sent: true, delta };
  }
  feel(id, feel) {
    const d = this.device(id, false);
    if (!Number.isInteger(feel) || feel < 1 || feel > 16)
      throw new ApiError("快捷反馈无效");
    this.batch(
      [],
      [
        {
          ev: 4,
          s: d.id,
          d: { slotId: d.slotId, type: 0, action: 1, opts: { feel } },
        },
      ],
    );
    this.log("快捷反馈已发送");
  }
  failPending() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ApiError("连接已断开", 409));
    }
    this.pending.clear();
  }
  closeTransport() {
    this.generation++;
    clearInterval(this.heartbeat);
    this.cancelPlayers();
    this.failPending();
    this.scope.clear();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState < 2) ws.close(1000, "panel disconnect");
  }
  async leave() {
    this.stopping = true;
    const roomId = this.info?.id;
    try {
      if (this.status === "connected") this.stopAll();
    } catch {}
    this.closeTransport();
    let error;
    if (roomId)
      try {
        await this.api.leave(roomId);
      } catch (e) {
        error = e;
      }
    this.info = null;
    this.devices = [];
    this.peer = null;
    this.status = "idle";
    this.stopping = false;
    this.log(
      error ? "本地连接已关闭，官方退房请求失败" : "已退出房间",
      error ? "error" : "info",
    );
    if (error) throw error;
  }
}
