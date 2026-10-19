import { randomBytes } from "node:crypto";
import { ApiError } from "./dg-api.mjs";

export class Cooperation {
  constructor() {
    this.invites = new Map();
  }
  valid(invite) {
    const o = invite?.owner,
      d = o?.room.devices.find((d) => d.id === invite.deviceId);
    return (
      !!invite &&
      !invite.revoked &&
      Date.now() < invite.expires &&
      o.room === invite.room &&
      (!o.canManage || o.canManage()) &&
      o.room.info?.id === invite.roomId &&
      o.room.controlEpoch === invite.epoch &&
      o.room.status === "connected" &&
      d?.connected &&
      d.slotId === invite.slotId
    );
  }
  create(owner, { id, role = "amplitude", minutes = 30 }) {
    const d = owner.room.device(id);
    if (!owner.clients.size) throw new ApiError("请保持主面板在线", 409);
    if (
      !["amplitude", "channelB", "choice"].includes(role) ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 60
    )
      throw new ApiError("邀请参数无效");
    this.revoke(owner);
    const token = randomBytes(32).toString("base64url");
    const invite = {
      token,
      owner,
      room: owner.room,
      roomId: owner.room.info?.id,
      deviceId: d.id,
      slotId: d.slotId,
      epoch: owner.room.controlEpoch,
      role,
      expires: Date.now() + minutes * 60000,
      guest: null,
      revoked: false,
    };
    invite.timer = setTimeout(
      () => this.invalidate(invite, "邀请已过期"),
      minutes * 60000,
    );
    invite.timer.unref();
    this.invites.set(token, invite);
    return { token, role, expires: invite.expires };
  }
  inspect(token) {
    const invite = this.invites.get(String(token));
    if (!this.valid(invite)) throw new ApiError("邀请已过期或已撤销", 410);
    return {
      role: invite.role,
      expires: invite.expires,
      demo: invite.owner.demo,
      claimed: !!invite.guest,
    };
  }
  join(guest, token) {
    const i = this.invites.get(String(token));
    if (!this.valid(i) || !i.owner.clients.size)
      throw new ApiError("邀请无效或主面板已离线", 410);
    if (guest === i.owner) throw new ApiError("请在另一个浏览器或设备打开邀请");
    if (guest.room.info) throw new ApiError("请先退出自己的房间再加入协作");
    if (i.guest && i.guest !== guest)
      throw new ApiError("此邀请已经被使用", 409);
    if (guest.guest && guest.guest !== i) this.exit(guest);
    i.guest = guest;
    i.lastSeen = Date.now();
    guest.guest = i;
    guest.guestReason = "";
    i.owner.emit();
    return this.guestState(guest);
  }
  invalidate(i, reason = "邀请已撤销") {
    if (i.revoked) return;
    i.revoked = true;
    clearTimeout(i.timer);
    this.invites.delete(i.token);
    if (i.room.lab.run?.mode === "coop" || i.room.lab.run?.mode === "scene")
      i.room.lab.stop(true, reason);
    if (i.guest) {
      i.guest.guestReason = reason;
      i.guest.emit();
    }
    i.owner.emit();
  }
  revoke(owner) {
    for (const i of [...this.invites.values()])
      if (i.owner === owner) this.invalidate(i);
  }
  ownerChanged(owner) {
    for (const i of [...this.invites.values()])
      if (i.owner === owner) {
        if (!this.valid(i)) this.invalidate(i, "房间或设备控制已改变");
        else i.guest?.emit();
      }
  }
  ownerOffline(owner) {
    for (const i of this.invites.values())
      if (i.owner === owner) {
        if (
          i.room.lab.run?.mode === "coop" ||
          (i.room.lab.run?.mode === "scene" && i.guest)
        )
          i.room.lab.stop(true, "主面板离线");
        i.guest?.emit();
      }
  }
  guestOffline(guest) {
    const i = guest.guest;
    if (i && this.valid(i) && ["coop", "scene"].includes(i.room.lab.run?.mode))
      i.room.lab.stop(true, "协作者离线");
    i?.owner.emit();
  }
  ownerState(owner) {
    return [...this.invites.values()]
      .filter((i) => i.owner === owner && this.valid(i))
      .map((i) => ({
        role: i.role,
        expires: i.expires,
        claimed: !!i.guest,
        online: !!i.guest?.clients.size,
      }));
  }
  guestState(guest) {
    const i = guest.guest;
    if (!this.valid(i))
      return { active: false, reason: guest.guestReason || "邀请已失效" };
    const lab = i.room.lab.publicState();
    return {
      active: true,
      role: i.role,
      expires: i.expires,
      demo: i.owner.demo,
      ownerOnline: !!i.owner.clients.size,
      lab: {
        running: lab.running,
        runId: lab.runId,
        epoch: lab.epoch,
        mode: lab.mode,
        label: lab.label,
        frames: lab.frames,
        waiting: lab.waiting,
        swap: lab.swap,
        reason: lab.reason,
      },
    };
  }
  access(guest) {
    const i = guest.guest;
    if (!this.valid(i)) throw new ApiError("邀请已失效", 410);
    if (!i.owner.clients.size) throw new ApiError("主面板已离线", 409);
    return i;
  }
  heartbeat(guest) {
    const i = this.access(guest);
    i.lastSeen = Date.now();
    return { ok: true };
  }
  guard(owner, mode, deviceId, coopMode) {
    const invites = [...this.invites.values()].filter(
      (i) =>
        i.owner === owner && i.deviceId === Number(deviceId) && this.valid(i),
    );
    const invite = invites.find(
      (i) =>
        i.role ===
        (mode === "scene"
          ? "choice"
          : coopMode === "channels"
            ? "channelB"
            : "amplitude"),
    );
    if (mode === "scene" && !invite?.guest) return true;
    return (
      !!invite?.guest?.clients.size &&
      !!owner.clients.size &&
      Date.now() - invite.lastSeen < 1500
    );
  }
  input(guest, body) {
    const i = this.access(guest),
      lab = i.room.lab,
      r = lab.check(body.runId, body.epoch);
    if (
      r.id !== i.deviceId ||
      r.mode !== "coop" ||
      i.role === "choice" ||
      (i.role === "amplitude" && r.coopMode !== "split") ||
      (i.role === "channelB" && r.coopMode !== "channels")
    )
      throw new ApiError("协作角色与当前模式不匹配", 403);
    if (
      Object.keys(body).some(
        (k) => !["runId", "epoch", "seq", "input"].includes(k),
      ) ||
      !body.input ||
      typeof body.input !== "object" ||
      Array.isArray(body.input)
    )
      throw new ApiError("协作输入无效", 403);
    const previous = i.inputRunId === r.runId ? i.inputSeq : -1;
    if (!Number.isSafeInteger(body.seq) || body.seq <= previous)
      throw new ApiError("已忽略过期的协作输入", 409);
    const result = lab.coopInput("guest", body.input);
    i.inputRunId = r.runId;
    i.inputSeq = body.seq;
    i.lastSeen = Date.now();
    return result;
  }
  choose(guest, body) {
    const i = this.access(guest);
    if (i.role !== "choice") throw new ApiError("你未获得场景选择权限", 403);
    if (i.room.lab.run?.id !== i.deviceId)
      throw new ApiError("场景设备不匹配", 403);
    return i.room.lab.choose(body);
  }
  stop(guest, body) {
    const i = this.access(guest);
    const r = i.room.lab.check(body.runId, body.epoch);
    if (
      r.id !== i.deviceId ||
      (i.role === "choice" ? r.mode !== "scene" : r.mode !== "coop") ||
      (r.mode === "coop" &&
        i.role !== (r.coopMode === "channels" ? "channelB" : "amplitude"))
    )
      throw new ApiError("该邀请不能停止当前实验", 403);
    i.room.lab.stop(true, "协作者停止了实验");
  }
  exit(guest) {
    const i = guest.guest;
    if (i && !i.revoked) this.invalidate(i, "协作者已退出");
    guest.guest = null;
    guest.guestReason = "";
  }
}
