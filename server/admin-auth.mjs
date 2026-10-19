import { randomBytes, scryptSync, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ApiError } from "./dg-api.mjs";

const derive = promisify(scrypt);
export class AdminAuth {
  constructor(password = "") {
    this.configured =
      typeof password === "string" &&
      password.length >= 12 &&
      Buffer.byteLength(password) <= 1024;
    this.salt = randomBytes(16);
    this.hash = this.configured ? scryptSync(password, this.salt, 64) : null;
    this.attempts = new Map();
  }
  async verify(password, address) {
    if (!this.configured)
      throw new ApiError(
        "管理员认证尚未配置，请在服务器设置至少 12 位的 ADMIN_PASSWORD 后重启",
        503,
      );
    const now = Date.now(),
      recent = (this.attempts.get(address) || []).filter(
        (t) => t > now - 600000,
      );
    if (recent.length >= 8)
      throw new ApiError("认证尝试过多，请在 10 分钟后重试", 429);
    this.attempts.set(address, [...recent, now]);
    if (typeof password !== "string" || Buffer.byteLength(password) > 1024)
      throw new ApiError("管理员口令不正确", 401);
    const candidate = await derive(password, this.salt, 64);
    if (!timingSafeEqual(candidate, this.hash))
      throw new ApiError("管理员口令不正确", 401);
    this.attempts.delete(address);
  }
  cleanup() {
    for (const [ip, times] of this.attempts)
      if (!times.some((t) => t > Date.now() - 600000)) this.attempts.delete(ip);
  }
}
