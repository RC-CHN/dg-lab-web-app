import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DgApi, ApiError, parseRoomCode } from "./dg-api.mjs";
import { Room } from "./room.mjs";
import { Cooperation } from "./cooperation.mjs";
import { DemoRoom } from "./demo.mjs";
import { AdminAuth } from "./admin-auth.mjs";
import { generateV2, makeCustomPulse } from "../shared/pulse-v2.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = JSON.parse(
  await fs.readFile(new URL("../shared/presets.json", import.meta.url), "utf8"),
);
export const presets = source.presets.map((p) => ({
  id: String(p.id),
  name: p.label,
  content: p.content,
  frames: generateV2(p.content, source.frequencies, source.durations),
  official: true,
}));
const origin = process.env.APP_ORIGIN || "";
const ttl = 24 * 60 * 60 * 1000;
const random = () => randomBytes(24).toString("base64url");

export function createApp({
  roomFactory = (api) => new Room(api),
  apiFactory = () => new DgApi(),
  adminPassword = process.env.ADMIN_PASSWORD || "",
  adminTtlMs = 8 * 60 * 60 * 1000,
  offlineGraceMs = 15000,
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  const coop = new Cooperation(),
    auth = new AdminAuth(adminPassword);
  const sessions = new Map(),
    loginAttempts = new Map();
  const guestPaths = new Set([
    "/state",
    "/presets",
    "/events",
    "/coop/inspect",
    "/coop/join",
    "/coop/input",
    "/coop/heartbeat",
    "/coop/choose",
    "/coop/stop",
    "/coop/exit",
  ]);
  const publicPaths = new Set([
    ...guestPaths,
    "/admin/login",
    "/admin/logout",
    "/demo",
    "/pulse/import",
    "/pulse/custom",
  ]);
  const demoPaths = new Set([
    "/room/leave",
    "/room/refresh",
    "/device/attach",
    "/device/detach",
    "/control",
    "/limit",
    "/stop",
    "/feel",
    "/touch",
    "/fire",
    "/player/start",
    "/player/stop",
    "/lab/start",
    "/lab/update",
    "/lab/choose",
    "/lab/stop",
    "/coop/create",
    "/coop/revoke",
  ]);
  const isAdmin = (s) => !s.disposed && s.adminExpiresAt > Date.now();
  const isDemo = (s) => !s.disposed && s.demo && s.room instanceof DemoRoom;
  const emptyState = () => ({
    user: null,
    room: null,
    peer: null,
    demo: false,
    status: "idle",
    devices: [],
    players: [],
    logs: [],
    limits: {},
    cooperation: [],
    controlEpoch: 0,
    lab: { running: false, revision: 0 },
  });
  const state = (s) => {
    const base = {
      csrf: s.csrf,
      admin: {
        configured: auth.configured,
        authenticated: isAdmin(s),
        expiresAt: isAdmin(s) ? s.adminExpiresAt : null,
      },
    };
    if (s.guest) return { ...emptyState(), ...base, guest: coop.guestState(s) };
    if (!isAdmin(s) && !isDemo(s)) return { ...emptyState(), ...base };
    return {
      ...base,
      user: isAdmin(s) && s.user ? { nickname: s.user.nickname } : null,
      demo: isDemo(s),
      cooperation: coop.ownerState(s),
      ...s.room.publicState(),
    };
  };
  // A phone may suspend its SSE connection while locked. Prepared playback is
  // owned by the server; only idle rooms and live-input runs depend on a page.
  const scheduleIdleClose = (s) => {
    if (s.disposed || s.clients.size || s.room.hasBackgroundPlayback()) {
      clearTimeout(s.offlineTimer);
      s.offlineTimer = null;
      return;
    }
    if (s.offlineTimer || !s.room.info) return;
    s.offlineTimer = setTimeout(() => {
      s.offlineTimer = null;
      if (
        !s.disposed &&
        !s.clients.size &&
        !s.room.hasBackgroundPlayback() &&
        s.room.info
      )
        s.room.leave().catch(() => {});
    }, offlineGraceMs);
    s.offlineTimer.unref();
  };
  const replaceConnection = (
    s,
    { demo = false, api = apiFactory(), user = null } = {},
  ) => {
    s.connectionVersion++;
    coop.revoke(s);
    const oldRoom = s.room,
      oldApi = s.api;
    oldRoom.removeListener("change", s.emit);
    const leaving = oldRoom.leave().catch(() => {});
    s.api = api;
    s.user = user;
    s.demo = demo;
    s.room = demo ? new DemoRoom() : roomFactory(api);
    s.room.on("change", s.emit);
    leaving.finally(() => {
      if (oldApi !== api) {
        oldApi.token = null;
        oldApi.cookies?.clear();
      }
    });
  };
  const dispose = (s) => {
    if (s.disposed) return;
    s.disposed = true;
    s.adminExpiresAt = 0;
    s.connectionVersion++;
    clearTimeout(s.adminTimer);
    clearTimeout(s.offlineTimer);
    if (s.guest) coop.exit(s);
    else coop.revoke(s);
    s.room.removeListener("change", s.emit);
    // leave() stops local tasks and closes transport synchronously, before its remote request.
    const leaving = s.room.leave().catch(() => {});
    leaving.finally(() => {
      s.api.token = null;
      s.api.cookies?.clear();
    });
    s.api.token = null;
    s.api.cookies?.clear();
    s.user = null;
    s.demo = false;
    const data = JSON.stringify(state(s));
    for (const c of s.clients) {
      c.write(`data: ${data}\n\n`);
      c.end();
    }
    s.clients.clear();
    sessions.delete(s.id);
    return leaving;
  };
  const newSession = (res, admin = false) => {
    const s = {
      id: random(),
      csrf: random(),
      user: null,
      api: apiFactory(),
      clients: new Set(),
      touched: Date.now(),
      demo: false,
      offlineTimer: null,
      connectionVersion: 0,
      disposed: false,
      adminExpiresAt: admin ? Date.now() + adminTtlMs : 0,
    };
    s.room = roomFactory(s.api);
    s.canManage = () => isAdmin(s) || isDemo(s);
    s.emit = () => {
      if (s.disposed) return;
      scheduleIdleClose(s);
      coop.ownerChanged(s);
      if (!s.clients.size) return;
      const data = JSON.stringify(state(s));
      for (const client of s.clients) client.write(`data: ${data}\n\n`);
    };
    s.room.on("change", s.emit);
    sessions.set(s.id, s);
    if (admin) {
      s.adminTimer = setTimeout(() => dispose(s), adminTtlMs);
      s.adminTimer.unref();
    }
    res.cookie("dgpanel", s.id, {
      httpOnly: true,
      sameSite: "strict",
      secure: origin.startsWith("https://"),
      maxAge: ttl,
      path: "/",
    });
    return s;
  };
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/healthz", (req, res) => res.json({ ok: true }));
  app.use("/api", (req, res, next) => {
    const cookie = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("dgpanel="))
      ?.slice(8);
    let s = sessions.get(cookie);
    if (
      s &&
      (s.disposed ||
        Date.now() - s.touched > ttl ||
        (s.adminExpiresAt && !isAdmin(s)))
    ) {
      dispose(s);
      s = null;
    }
    if (!s) s = newSession(res);
    s.touched = Date.now();
    req.session = s;
    if (!["GET", "HEAD"].includes(req.method)) {
      const expectedOrigin = origin || `${req.protocol}://${req.get("host")}`;
      if (req.headers.origin && req.headers.origin !== expectedOrigin)
        return res
          .status(403)
          .json({ error: "请求来源不匹配，请检查 APP_ORIGIN 配置" });
      const token = String(req.headers["x-panel-csrf"] || "");
      if (
        Buffer.byteLength(token) !== Buffer.byteLength(s.csrf) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(s.csrf))
      )
        return res.status(403).json({ error: "页面会话已更新，请刷新后重试" });
    }
    if (s.guest) {
      if (!guestPaths.has(req.path))
        return res.status(403).json({ error: "协作邀请没有此操作权限" });
    } else if (
      !publicPaths.has(req.path) &&
      !isAdmin(s) &&
      !(isDemo(s) && demoPaths.has(req.path))
    )
      return res
        .status(401)
        .json({ error: "请先从管理员入口完成认证", adminRequired: true });
    next();
  });
  app.get("/api/state", (req, res) => res.json(state(req.session)));
  app.get("/api/presets", (req, res) => res.json(presets));
  app.get("/api/events", (req, res) => {
    const s = req.session;
    clearTimeout(s.offlineTimer);
    s.offlineTimer = null;
    res.set({
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    s.clients.add(res);
    res.write(`data: ${JSON.stringify(state(s))}\n\n`);
    if (s.guest) s.guest.owner.emit();
    const timer = setInterval(() => {
      if (s.disposed || (s.adminExpiresAt && !isAdmin(s))) {
        dispose(s);
        return;
      }
      s.touched = Date.now();
      res.write(": heartbeat\n\n");
    }, 15000);
    req.on("close", () => {
      clearInterval(timer);
      s.clients.delete(res);
      if (s.disposed) return;
      if (!s.clients.size) {
        if (s.guest) coop.guestOffline(s);
        else {
          coop.ownerOffline(s);
          if (!s.room.lab.run?.autonomous)
            s.room.lab.stop(true, "实时输入页面离线");
        }
      }
      scheduleIdleClose(s);
    });
  });
  const current = (s, version = s.connectionVersion) => {
    if (s.disposed || version !== s.connectionVersion)
      throw new ApiError("管理会话或连接已更新，请重新操作", 409);
  };
  const route = (url, handler) =>
    app.post(url, async (req, res, next) => {
      try {
        const result = await handler(req.session, req.body || {}, req, res);
        current(req.session);
        req.session.emit();
        res.json(result ?? { ok: true });
      } catch (error) {
        next(error);
      }
    });
  route("/api/admin/login", async (s, body, req, res) => {
    await auth.verify(body.password, req.socket.remoteAddress || "local");
    current(s);
    dispose(s);
    req.session = newSession(res, true);
    return state(req.session);
  });
  route("/api/admin/logout", (s, body, req, res) => {
    dispose(s);
    req.session = newSession(res);
    return state(req.session);
  });
  const authenticated = (s) => {
    if (!s.api.token && !isDemo(s))
      throw new ApiError("请先在管理员面板登录 DG-LAB 账号", 401);
  };
  route("/api/login", async (s, body, req) => {
    if (s.room.info) throw new ApiError("请先退出当前房间");
    const ip = req.socket.remoteAddress || "local",
      recent = (loginAttempts.get(ip) || []).filter(
        (t) => t > Date.now() - 600000,
      );
    if (recent.length >= 8) throw new ApiError("登录尝试过多，请稍后再试", 429);
    loginAttempts.set(ip, [...recent, Date.now()]);
    const version = ++s.connectionVersion,
      candidate = apiFactory();
    try {
      const user = await candidate.login(body);
      current(s, version);
      if (!isAdmin(s)) throw new ApiError("管理员认证已过期", 401);
      replaceConnection(s, { api: candidate, user });
      return { nickname: user.nickname };
    } catch (error) {
      candidate.token = null;
      candidate.cookies?.clear();
      throw error;
    }
  });
  route("/api/logout", (s) => {
    replaceConnection(s);
  });
  route("/api/demo", (s, body) => {
    if (typeof body.enabled !== "boolean") throw new ApiError("演示开关无效");
    if (!s.demo && s.room.info)
      throw new ApiError("请先在管理员面板退出真实房间，再进入演示");
    replaceConnection(s, { demo: body.enabled, api: s.api, user: s.user });
    return state(s);
  });
  route("/api/room/join", async (s, body) => {
    authenticated(s);
    if (s.demo) throw new ApiError("请先退出演示");
    return s.room.join(parseRoomCode(body.code), body.password);
  });
  route("/api/room/leave", (s) => s.room.leave());
  route("/api/room/refresh", (s) => {
    authenticated(s);
    return s.room.refresh();
  });
  route("/api/device/attach", (s, body) => {
    authenticated(s);
    return s.room.attach(body.id);
  });
  route("/api/device/detach", (s, body) => s.room.detach(body.id));
  route("/api/control", (s, body) => {
    authenticated(s);
    return s.room.control(
      body.id,
      body.channel,
      body.action,
      body.value,
      body.duration,
    );
  });
  route("/api/limit", (s, body) =>
    s.room.setLimit(body.id, body.channel, body.value),
  );
  route("/api/stop", (s) => s.room.stopAll());
  route("/api/feel", (s, body) => s.room.feel(body.id, body.feel));
  route("/api/touch", (s, body) => {
    authenticated(s);
    const options = { ...body };
    delete options.frames;
    if (body.active && body.presetId != null) {
      const preset = presets.find((p) => p.id === String(body.presetId));
      if (!preset) throw new ApiError("请选择触控波形");
      options.frames = preset.frames;
    }
    return s.room.touch(body.id, body.channel, options);
  });
  route("/api/fire", (s, body) => {
    authenticated(s);
    return s.room.fire(body.id, body.channel, body);
  });
  route("/api/pulse/import", (s, body) => {
    const frames = generateV2(
      body.content,
      source.frequencies,
      source.durations,
    );
    return {
      id: `custom-${random()}`,
      name: String(body.name || "导入波形").slice(0, 40),
      frames,
      content: body.content,
      official: false,
    };
  });
  route("/api/pulse/custom", (s, body) => ({
    id: `custom-${random()}`,
    name: String(body.name || "自定义波形").slice(0, 40),
    frames: makeCustomPulse(body),
    official: false,
  }));
  route("/api/player/start", (s, body) => {
    authenticated(s);
    const queue = (Array.isArray(body.queue) ? body.queue : []).map((item) => {
      const preset = presets.find((p) => p.id === String(item.presetId));
      if (preset)
        return {
          name: preset.name,
          frames: preset.frames,
          seconds: item.seconds,
        };
      return {
        name: String(item.name || "自定义波形").slice(0, 40),
        frames: item.frames,
        seconds: item.seconds,
      };
    });
    return s.room.play(body.id, body.channel, queue, {
      loop: !!body.loop,
      scale: body.scale ?? 100,
      timing: body.timing ?? {},
    });
  });
  route("/api/player/stop", (s, body) => {
    s.room.device(body.id);
    s.room.channel(body.channel);
    s.room.stopPlayer(body.id, body.channel);
  });
  route("/api/lab/start", (s, body) => {
    authenticated(s);
    const config = body.config || {};
    if (!Number.isSafeInteger(body.revision))
      throw new ApiError("缺少实验状态版本，请刷新页面", 409);
    if (
      config.mode === "coop" &&
      !coop.guard(s, "coop", body.id, config.coopMode)
    )
      throw new ApiError("请先邀请协作者并等待对方在线", 409);
    s.room.lab.start(body.id, body.epoch, config, body.revision);
    if (
      config.mode === "scene" &&
      coop.ownerState(s).some((i) => i.role === "choice" && i.claimed)
    )
      s.room.lab.run.autonomous = false;
    if (["coop", "scene"].includes(config.mode) && s.room.lab.run)
      s.room.lab.run.guard = () =>
        coop.guard(s, config.mode, body.id, config.coopMode);
    return s.room.lab.publicState();
  });
  route("/api/lab/update", (s, body) => {
    authenticated(s);
    return s.room.lab.update(body);
  });
  route("/api/lab/choose", (s, body) => {
    authenticated(s);
    return s.room.lab.choose(body);
  });
  route("/api/lab/stop", (s, body) => {
    s.room.lab.check(body.runId, body.epoch);
    s.room.lab.stop(true);
    return s.room.lab.publicState();
  });
  route("/api/coop/create", (s, body) => {
    authenticated(s);
    return coop.create(s, body);
  });
  route("/api/coop/revoke", (s) => coop.revoke(s));
  route("/api/coop/inspect", (s, body) => coop.inspect(body.token));
  route("/api/coop/join", (s, body) => coop.join(s, body.token));
  route("/api/coop/heartbeat", (s) => coop.heartbeat(s));
  route("/api/coop/input", (s, body) => coop.input(s, body));
  route("/api/coop/choose", (s, body) => coop.choose(s, body));
  route("/api/coop/stop", (s, body) => coop.stop(s, body));
  route("/api/coop/exit", (s) => coop.exit(s));
  app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error instanceof ApiError
        ? Math.min(599, Math.max(400, error.code))
        : 400;
    res
      .status(status)
      .json({ error: error.message || "操作失败", ...(error.details || {}) });
  });
  app.locals.cleanup = () => {
    for (const s of sessions.values())
      if (Date.now() - s.touched > ttl) dispose(s);
    for (const [ip, times] of loginAttempts)
      if (!times.some((t) => t > Date.now() - 600000)) loginAttempts.delete(ip);
    auth.cleanup();
  };
  app.locals.dispose = async () => {
    await Promise.allSettled([...sessions.values()].map(dispose));
  };
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const dev = process.argv.includes("--dev");
  if (dev) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root,
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(root, "dist")));
    app.get("/{*path}", (req, res) =>
      res.sendFile(path.join(root, "dist/index.html")),
    );
  }
  const host = process.env.HOST || "127.0.0.1",
    port = Number(process.env.PORT || 8787);
  const server = app.listen(port, host, () =>
    console.log(
      `DG-LAB panel: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`,
    ),
  );
  const cleanup = setInterval(app.locals.cleanup, 60000);
  cleanup.unref();
  const shutdown = async () => {
    clearInterval(cleanup);
    const timeout = setTimeout(() => process.exit(0), 3000);
    timeout.unref();
    await app.locals.dispose();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
