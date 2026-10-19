import { Room } from "../server/room.mjs";
import { DemoRoom } from "../server/demo.mjs";
import { ApiError } from "../server/dg-api.mjs";

// Offline fixtures only: no official HTTP or WebSocket requests.
export const ADMIN_PASSWORD = "Fixture-Admin-Only-2026";
export function mockApi() {
  return {
    token: null,
    cookies: new Map(),
    leave: async () => {},
    async login(body) {
      if (
        (!body.phone && !body.email && !body.token) ||
        body.password === "wrong"
      )
        throw new ApiError("模拟官方账号或密码不正确", 401);
      this.token = "MOCK_OFFICIAL_TOKEN";
      return { nickname: "测试管理员", id: "fixture-user" };
    },
  };
}
export class MockRoom extends Room {
  constructor(api) {
    super(api);
    this.boostTimers = new Map();
  }
  async join(code) {
    this.info = { id: "fixture-room", code, region: "test" };
    this.status = "connected";
    this.peer = { nickname: "测试房主" };
    this.devices = code === "EMPTYROOM" ? [] : new DemoRoom().devices;
    this.log("已加入测试房间");
    return this.publicState();
  }
  send(packet) {
    return DemoRoom.prototype.send.call(this, packet);
  }
  async rpc(method, data, id) {
    return DemoRoom.prototype.rpc.call(this, method, data, id);
  }
  async refresh() {
    this.changed();
    return this.devices;
  }
  closeTransport() {
    for (const t of this.boostTimers.values()) clearTimeout(t.timer);
    this.boostTimers.clear();
    super.closeTransport();
  }
}
