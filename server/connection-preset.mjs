import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError, parseRoomCode } from "./dg-api.mjs";

export class ConnectionPreset {
  constructor(file = "") {
    this.file = file;
    this.value = null;
    this.revision = 0;
    if (file) {
      try {
        this.value = this.validate(JSON.parse(fs.readFileSync(file, "utf8")));
      } catch (error) {
        if (error.code !== "ENOENT")
          throw new Error("无法读取连接预设文件，请检查路径、权限和格式");
      }
    }
  }
  validate(body) {
    const text = (key, max = 1024) => {
      const v = body[key] ?? "";
      if (typeof v !== "string" || v.length > max)
        throw new ApiError("连接预设格式无效");
      return v.trim();
    };
    const phone = text("phone", 32),
      email = text("email", 254);
    if ((!phone && !email) || (phone && email))
      throw new ApiError("请填写手机号或邮箱其中一项");
    const sameAccount =
      this.value?.phone === phone && this.value?.email === email;
    const password =
      text("password") || (sameAccount ? this.value.password : "");
    if (!password) throw new ApiError("请填写官方账号密码");
    const phoneCountryCode = text("phoneCountryCode", 4) || "86";
    if (!/^\d{1,4}$/.test(phoneCountryCode)) throw new ApiError("电话区号无效");
    return {
      phone,
      email,
      password,
      phoneCountryCode,
      code: parseRoomCode(text("code", 2048)),
      roomPassword: body.clearRoomPassword
        ? ""
        : text("roomPassword") || (sameAccount ? this.value.roomPassword : ""),
    };
  }
  publicState() {
    const v = this.value;
    return {
      available: !!this.file,
      configured: !!v,
      revision: this.revision,
      ...(v
        ? {
            phone: v.phone,
            email: v.email,
            phoneCountryCode: v.phoneCountryCode,
            code: v.code,
            hasPassword: true,
            hasRoomPassword: !!v.roomPassword,
          }
        : {}),
    };
  }
  save(body) {
    if (!this.file) throw new ApiError("服务器尚未配置连接预设存储", 503);
    const value = this.validate(body),
      temp = `${this.file}.${randomUUID()}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      fs.writeFileSync(temp, JSON.stringify(value) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      fs.renameSync(temp, this.file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    this.value = value;
    this.revision++;
    return this.publicState();
  }
  clear() {
    if (this.file) fs.rmSync(this.file, { force: true });
    this.value = null;
    this.revision++;
    return this.publicState();
  }
  credentials() {
    if (!this.value) throw new ApiError("请先保存账号和房间预设", 409);
    return { ...this.value };
  }
}
