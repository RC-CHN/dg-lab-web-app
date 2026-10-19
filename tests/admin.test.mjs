import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server/index.mjs";
import { Room } from "../server/room.mjs";
import { ADMIN_PASSWORD, mockApi, MockRoom } from "./fixtures.mjs";
import { adminSessionTtl } from "../server/admin-auth.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(t, options = {}) {
  const rooms = [];
  const app = createApp({
    adminPassword: ADMIN_PASSWORD,
    apiFactory: mockApi,
    roomFactory: (api) => {
      const room = new MockRoom(api);
      rooms.push(room);
      return room;
    },
    ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api/`,
    streams = [];
  t.after(async () => {
    streams.forEach((s) => s.abort());
    await app.locals.dispose();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const client = async () => {
    const c = { cookie: "", csrf: "" };
    c.request = async (path, body, extra = {}) => {
      const r = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: c.cookie,
          "Content-Type": "application/json",
          "X-Panel-CSRF": c.csrf,
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await r.json();
      const cookie = r.headers.get("set-cookie");
      if (cookie) { c.cookie = cookie.split(";")[0]; c.cookieHeader = cookie; }
      if (data.csrf) c.csrf = data.csrf;
      return { status: r.status, data };
    };
    c.events = async () => {
      const controller = new AbortController();
      streams.push(controller);
      const response = await fetch(base + "events", {
        headers: { Cookie: c.cookie },
        signal: controller.signal,
      });
      controller.response = response;
      return response.body.getReader();
    };
    await c.request("state");
    return c;
  };
  return { client, base, rooms };
}
const auth = async (c) => {
  const r = await c.request("admin/login", { password: ADMIN_PASSWORD });
  assert.equal(r.status, 200);
  assert(r.data.admin.authenticated);
};
const connect = async (c) => {
  await auth(c);
  assert.equal(
    (await c.request("login", { phone: "fixture", password: "fixture" }))
      .status,
    200,
  );
  assert.equal(
    (await c.request("room/join", { code: "TEST1234" })).status,
    200,
  );
  assert.equal((await c.request("device/attach", { id: 0 })).status, 200);
};
test("only administrators manage persisted credentials; reconnect after a server restart never acquires a device", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dglab-admin-preset-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = { connectionPresetFile: path.join(dir, "preset.json") };
  const first = await fixture(t, options), a = await first.client(), outsider = await first.client();
  const body = { phone: "15500000000", password: "fixture-secret", code: "EMPTYROOM" };
  for (const op of ["save", "clear", "connect"])
    assert.equal((await outsider.request(`connection/${op}`, body)).status, 401);
  await outsider.request("demo", { enabled: true });
  assert.equal((await outsider.request("connection/save", body)).status, 401);
  assert.equal((await outsider.request("state")).data.connectionPreset, undefined);
  await auth(a);
  assert.equal((await a.request("connection/save", body)).status, 200);
  const state = (await a.request("state")).data;
  assert.equal(state.connectionPreset.configured, true);
  assert(!JSON.stringify(state).includes(body.password));
  const second = await fixture(t, options), b = await second.client();
  assert.equal((await b.request("state")).data.connectionPreset, undefined);
  await auth(b);
  assert.equal((await b.request("state")).data.connectionPreset.code, "EMPTYROOM");
  assert.equal((await b.request("connection/connect", {})).status, 200);
  const connected = (await b.request("state")).data;
  assert.equal(connected.status, "connected"); assert.equal(connected.devices.length, 0);
  assert.equal((await b.request("connection/connect", {})).status, 400);
  await b.request("connection/clear", {});
  assert.equal(fs.existsSync(options.connectionPresetFile), false);
  assert.equal((await b.request("state")).data.connectionPreset.configured, false);
});

test("admin configuration fails closed, wrong password and login throttle are enforced", async (t) => {
  const absent = await fixture(t, { adminPassword: "" }),
    a = await absent.client();
  assert.equal((await a.request("state")).data.admin.configured, false);
  assert.equal(
    (await a.request("admin/login", { password: ADMIN_PASSWORD })).status,
    503,
  );
  const { client } = await fixture(t),
    c = await client();
  for (let i = 0; i < 8; i++)
    assert.equal(
      (await c.request("admin/login", { password: "wrong" })).status,
      401,
    );
  assert.equal(
    (await c.request("admin/login", { password: ADMIN_PASSWORD })).status,
    429,
  );
});
test("real API routes require admin; anonymous demo and scoped invitations remain usable", async (t) => {
  const { client } = await fixture(t),
    c = await client();
  const protectedPaths = [
    "login",
    "logout",
    "room/join",
    "room/leave",
    "room/refresh",
    "device/attach",
    "device/detach",
    "control",
    "limit",
    "stop",
    "feel",
    "touch",
    "fire",
    "player/start",
    "player/stop",
    "lab/start",
    "lab/update",
    "lab/stop",
    "lab/choose",
    "coop/create",
    "coop/revoke",
  ];
  for (const path of protectedPaths)
    assert.equal(
      (await c.request(path, { id: 0, channel: 0, action: "set", value: 100 }))
        .status,
      401,
      path,
    );
  await c.request("demo", { enabled: true });
  assert.equal((await c.request("device/attach", { id: 0 })).status, 200);
  assert.equal(
    (
      await c.request("control", {
        id: 0,
        channel: 0,
        action: "set",
        value: 10,
      })
    ).status,
    200,
  );
  for (const path of ["login", "logout", "room/join"])
    assert.equal(
      (
        await c.request(path, {
          phone: "fixture",
          password: "fixture",
          code: "TEST1234",
        })
      ).status,
      401,
      path,
    );
  await c.request("demo", { enabled: false });
  assert.equal((await c.request("device/attach", { id: 0 })).status, 401);
});
test("admin login rotates cookie and CSRF, closes old SSE, and does not elevate other browsers", async (t) => {
  const { client, base } = await fixture(t),
    c = await client(),
    other = await client(),
    oldCookie = c.cookie,
    oldCsrf = c.csrf;
  const stream = await c.events();
  await stream.read();
  await auth(c);
  assert.notEqual(c.cookie, oldCookie);
  assert.notEqual(c.csrf, oldCsrf);
  let chunk;
  do {
    chunk = await stream.read();
    if (chunk.value)
      assert(
        !new TextDecoder().decode(chunk.value).includes("MOCK_OFFICIAL_TOKEN"),
      );
  } while (!chunk.done);
  assert.equal((await other.request("state")).data.admin.authenticated, false);
  const old = await fetch(base + "login", {
    method: "POST",
    headers: {
      Cookie: oldCookie,
      "Content-Type": "application/json",
      "X-Panel-CSRF": oldCsrf,
    },
    body: JSON.stringify({ phone: "fixture", password: "fixture" }),
  });
  assert.equal(old.status, 403);
  assert.equal(
    (
      await c.request(
        "login",
        { phone: "fixture", password: "fixture" },
        { "X-Panel-CSRF": oldCsrf },
      )
    ).status,
    403,
  );
  const state = (await c.request("state")).data;
  assert(!JSON.stringify(state).includes(ADMIN_PASSWORD));
});
test("admin logout clears active playback, credentials and grants; guest cannot elevate", async (t) => {
  const { client, rooms } = await fixture(t),
    c = await client(),
    guest = await client();
  await connect(c);
  await c.events();
  await guest.events();
  const room = rooms.find((r) => r.info?.id === "fixture-room");
  await c.request("touch", {
    id: 0,
    channel: 0,
    active: true,
    x: 0.5,
    y: 0.5,
    epoch: 0,
  });
  await c.request("fire", {
    id: 0,
    channel: 1,
    active: true,
    value: 2,
    epoch: 0,
  });
  const invite = (
    await c.request("coop/create", { id: 0, role: "amplitude", minutes: 1 })
  ).data;
  await guest.request("coop/join", { token: invite.token });
  assert.equal(
    (await guest.request("admin/login", { password: ADMIN_PASSWORD })).status,
    403,
  );
  const r = await c.request("admin/logout", {});
  assert.equal(r.status, 200);
  assert.equal(r.data.admin.authenticated, false);
  assert.equal(r.data.user, null);
  assert.deepEqual(r.data.devices, []);
  assert.equal(room.touchTimers.size, 0);
  assert.equal(room.fireTimers.size, 0);
  assert.equal(room.api.token, null);
  assert.equal((await guest.request("state")).data.guest.active, false);
  assert.equal(
    (await c.request("login", { phone: "fixture", password: "fixture" }))
      .status,
    401,
  );
});
test("absolute admin expiry stops a lab even while owner and guest SSE remain online", async (t) => {
  const { client, rooms } = await fixture(t, { adminTtlMs: 550 }),
    c = await client(),
    guest = await client();
  await connect(c);
  await c.events();
  await guest.events();
  const invite = (
    await c.request("coop/create", { id: 0, role: "amplitude", minutes: 1 })
  ).data;
  await guest.request("coop/join", { token: invite.token });
  const r = (
    await c.request("lab/start", {
      id: 0,
      epoch: 0,
      revision: 0,
      config: { mode: "coop", coopMode: "split" },
    })
  ).data;
  assert(r.runId);
  const room = rooms.find((r) => r.info?.id === "fixture-room");
  let seq = 0;
  const timer = setInterval(
    () =>
      c
        .request("lab/update", { runId: r.runId, epoch: 0, seq: ++seq })
        .catch(() => {}),
    100,
  );
  t.after(() => clearInterval(timer));
  await sleep(700);
  assert.equal(room.lab.run, null);
  assert.equal(room.api.token, null);
  assert.equal((await c.request("state")).data.admin.authenticated, false);
  assert.equal((await guest.request("state")).data.guest.active, false);
});
test("late official login after admin logout cannot restore credentials or room state", async (t) => {
  let release, entered;
  const started = new Promise((r) => (entered = r));
  const { client } = await fixture(t, {
    apiFactory: () => ({
      ...mockApi(),
      async login() {
        entered();
        await new Promise((r) => (release = r));
        this.token = "LATE_SECRET";
        return { nickname: "late" };
      },
    }),
  });
  const c = await client();
  await auth(c);
  const pending = c.request("login", { phone: "fixture", password: "fixture" });
  await started;
  assert.equal((await c.request("admin/logout", {})).status, 200);
  release();
  assert.equal((await pending).status, 409);
  const state = (await c.request("state")).data;
  assert.equal(state.admin.authenticated, false);
  assert.equal(state.user, null);
  assert(!JSON.stringify(state).includes("LATE_SECRET"));
});
test("cancelled pending room join never opens a transport", async () => {
  let release,
    opened = 0;
  const room = new Room({
    join: () => new Promise((r) => (release = r)),
    leave: async () => {},
  });
  room.connectTransport = () => {
    opened++;
  };
  const pending = room.join("TEST1234");
  await room.leave();
  release({
    roomId: "late",
    preferredWsUrl: "wss://fixture.dungeon-lab.cn",
    connectToken: "test",
  });
  await assert.rejects(pending, /取消/);
  assert.equal(opened, 0);
  assert.equal(room.info, null);
  assert.equal(room.status, "idle");
});

test("admin logout authenticates the official leave request before clearing credentials", async (t) => {
  const { DgApi } = await import("../server/dg-api.mjs");
  const calls = [];
  const { client } = await fixture(t, {
    apiFactory: () => {
      const api = new DgApi({
        fetcher: async (url, options) => {
          calls.push({
            url,
            authorization: options.headers.Authorization,
            cookie: options.headers.Cookie,
          });
          return new Response(JSON.stringify({ code: 200, data: {} }), {
            headers: { "Content-Type": "application/json" },
          });
        },
      });
      api.security = Promise.resolve({
        encrypt: (_, token) => `cipher|${token || ""}`,
      });
      api.login = async () => {
        api.token = "FIXTURE_TOKEN";
        api.cookies.set("fixture", "session");
        return { nickname: "fixture" };
      };
      return api;
    },
  });
  const c = await client();
  await connect(c);
  await c.request("admin/logout", {});
  await sleep(10);
  const leave = calls.find((c) => c.url.includes("/fixture-room/leave"));
  assert(leave);
  assert.equal(leave.authorization, "Bearer FIXTURE_TOKEN");
  assert.equal(leave.cookie, "fixture=session");
});
test("a late join is cleaned up with its original credentials after local cancellation", async () => {
  const { DgApi } = await import("../server/dg-api.mjs");
  let release, entered, authorization;
  const started = new Promise((r) => (entered = r));
  const api = new DgApi({
    fetcher: async (url, options) => {
      if (url.endsWith("/join")) {
        entered();
        await new Promise((r) => (release = r));
        return new Response(
          JSON.stringify({
            code: 200,
            data: {
              roomId: "late-room",
              preferredWsUrl: "wss://fixture.dungeon-lab.cn",
              connectToken: "fixture",
            },
          }),
        );
      }
      authorization = options.headers.Authorization;
      return new Response(JSON.stringify({ code: 200, data: {} }));
    },
  });
  api.security = Promise.resolve({
    encrypt: (_, token) => `cipher|${token || ""}`,
  });
  api.token = "FIXTURE_TOKEN";
  const room = new Room(api);
  let opened = false;
  room.connectTransport = () => {
    opened = true;
  };
  const pending = room.join("TEST1234");
  await started;
  await room.leave();
  api.token = null;
  release();
  await assert.rejects(pending, /取消/);
  assert.equal(opened, false);
  assert.equal(authorization, "Bearer FIXTURE_TOKEN");
});

test("administrator expiry stops autonomous playback even with no browser page online", async (t) => {
  const { client, rooms } = await fixture(t, {
    adminTtlMs: 650,
    offlineGraceMs: 50,
  });
  const c = await client();
  await connect(c);
  const started = await c.request("lab/start", {
    id: 0,
    epoch: 0,
    revision: 0,
    config: {
      mode: "tracks",
      tracks: [[[1, 9, 10]], [[1, 9, 10]]],
      loop: true,
      duration: 30,
    },
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.autonomous, true);
  const room = rooms.find((r) => r.info?.id === "fixture-room");
  await sleep(150);
  assert(room.lab.run);
  await sleep(650);
  assert.equal(room.lab.run, null);
  assert.equal(room.players.size, 0);
  assert.equal(room.api.token, null);
  assert.equal(room.info, null);
});

test("administrator session defaults to seven days with matching cookie and configurable expiry", async (t) => {
  assert.equal(adminSessionTtl("168"), 7 * 86400000);
  assert.equal(adminSessionTtl("720"), 30 * 86400000);
  for (const value of ["0", "721", "no", "1.5"]) assert.throws(() => adminSessionTtl(value));
  const { client } = await fixture(t), c = await client();
  const now = Date.now();
  const result = await c.request("admin/login", { password: ADMIN_PASSWORD });
  assert.equal(result.data.admin.sessionHours, 168);
  assert(result.data.admin.expiresAt >= now + 7 * 86400000);
  assert(result.data.admin.expiresAt < Date.now() + 7 * 86400000 + 1000);
  assert.match(c.cookieHeader, /Max-Age=604800/);
  const custom = await fixture(t, { adminTtlMs: adminSessionTtl("720") });
  const other = await custom.client();
  await other.request("admin/login", { password: ADMIN_PASSWORD });
  await sleep(25);
  assert.equal((await other.request("state")).data.admin.authenticated, true, "30-day timer must not overflow and expire immediately");
  assert.match(other.cookieHeader, /Max-Age=2592000/);
});
