import { Room } from "./room.mjs";

export class DemoRoom extends Room {
  constructor() {
    super({ leave: async () => {} });
    this.demo = true;
    this.boostTimers = new Map();
    this.status = "connected";
    this.info = { id: "demo", code: "DEMO", region: "本地演示", limitMode: 0 };
    this.peer = { nickname: "演示房间" };
    this.devices = [
      {
        id: 0,
        slotId: "demo-coyote-2",
        name: "COYOTE 2.0",
        type: "COYOTE_020",
        connected: false,
        props: { intensityA: 12, intensityB: 8, connectState: "connected" },
        slotState: {
          hasDevice: true,
          markLight: "yellow",
          channelA: this.demoChannel(),
          channelB: this.demoChannel(),
        },
      },
    ];
    this.log("演示模式：所有操作只在本地模拟");
  }
  demoChannel() {
    return {
      intensityMax: 100,
      isMuted: false,
      warmUpScale: 1,
      comfortLimit: {
        mode: "complex",
        comfortMax: 60,
        absoluteMax: 100,
        overheat: false,
        overheatPercent: 0,
        autoIncr: false,
        autoIncrMax: 20,
        autoIncrScope: 3,
        totalIncr: 0,
      },
    };
  }
  async refresh() {
    return this.devices;
  }
  async rpc(method, data, id) {
    if (method === "get_devices") return { devices: this.devices };
    if (method === "connect") return this.device(id, false);
    if (method === "disconnect") return {};
    return {};
  }
  send(packet) {
    if (packet.k !== 3) return;
    for (const a of packet.a || []) {
      const d = this.devices.find((d) => d.id === a.s);
      if (!d) continue;
      const key = a.c === 0 ? "intensityA" : "intensityB",
        channel = a.c === 0 ? "channelA" : "channelB";
      if (a.t === 3)
        d.props[key] = Math.max(
          0,
          Math.min(d.slotState[channel].intensityMax, d.props[key] + a.v),
        );
      if (a.t === 7)
        d.props[key] = Math.max(
          0,
          Math.min(d.slotState[channel].intensityMax, a.v),
        );
      if (a.t === 5) d.slotState[channel].isMuted = a.v;
      if (a.t === 4) {
        const id = `${a.s}:${a.c}`;
        const previous = this.boostTimers.get(id);
        if (previous) {
          clearTimeout(previous.timer);
          d.props[key] = Math.max(0, d.props[key] - previous.value);
        }
        d.props[key] += a.v;
        const timer = setTimeout(() => {
          d.props[key] = Math.max(0, d.props[key] - a.v);
          this.boostTimers.delete(id);
          this.changed();
        }, a.d);
        this.boostTimers.set(id, { timer, value: a.v });
      }
    }
    this.lastFrame = Date.now();
    if ((packet.a || []).some((a) => a.t !== 0)) {
      for (const d of this.devices)
        d.propsUpdatedAt = d.slotUpdatedAt = Date.now();
      this.changed();
    }
  }
  async leave() {
    this.cancelPlayers();
    for (const b of this.boostTimers.values()) clearTimeout(b.timer);
    this.boostTimers.clear();
    this.scope.clear();
    this.devices = [];
    this.info = null;
    this.status = "idle";
    this.changed();
  }
}
