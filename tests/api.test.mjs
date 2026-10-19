import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server/index.mjs";
import { parseRoomCode, loadSecurity, DgApi } from "../server/dg-api.mjs";
test("session isolation, CSRF, demo controls and clearing login", async (t) => {
  const app = createApp({
    adminPassword: "Fixture-Admin-Only-2026",
    apiFactory: () => ({
      token: null,
      cookies: new Map(),
      login: async function () {
        this.token = "TEST_ONLY";
        return { nickname: "测试" };
      },
      leave: async () => {},
    }),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await app.locals.dispose();
    await new Promise((r) => server.close(r));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/`,
    initial = await fetch(base + "state"),
    initialCookie = initial.headers.get("set-cookie").split(";")[0],
    state = await initial.json();
  let cookie = initialCookie;
  const post = async (path, body, headers = {}) => {
    const r = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-Panel-CSRF": state.csrf,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const data = await r.clone().json();
    if (data.csrf) state.csrf = data.csrf;
    return r;
  };
  assert.equal(
    (await post("demo", { enabled: true }, { "X-Panel-CSRF": "bad" })).status,
    403,
  );
  assert.equal(
    (await post("demo", { enabled: true }, { Origin: "https://wrong.example" }))
      .status,
    403,
  );
  assert.equal(
    (await post("admin/login", { password: "Fixture-Admin-Only-2026" })).status,
    200,
  );
  assert.equal(
    (await post("login", { phone: "test", password: "test" })).status,
    200,
  );
  const d = await (await post("demo", { enabled: true })).json();
  assert.equal(d.demo, true);
  assert.equal(d.devices[0].connected, false);
  assert.equal((await post("device/attach", { id: 0 })).status, 200);
  assert.equal(
    (await post("control", { id: 0, channel: 0, action: "set", value: 20 }))
      .status,
    200,
  );
  const current = await (
    await fetch(base + "state", { headers: { Cookie: cookie } })
  ).json();
  assert.equal(current.devices[0].props.intensityA, 20);
  assert(!JSON.stringify(current).includes("TEST_ONLY"));
  const other = await (await fetch(base + "state")).json();
  assert.equal(other.demo, false);
  assert.deepEqual(other.devices, []);
  assert.equal((await post("logout", {})).status, 200);
  assert.equal(
    (await post("control", { id: 0, channel: 0, action: "set", value: 20 }))
      .status,
    401,
  );
});
test("WASM loads and request encryption does not leak password plaintext", async () => {
  const security = await loadSecurity();
  assert.equal(typeof security.encrypt, "function");
  let request;
  const api = new DgApi({
    fetcher: async (url, options) => {
      request = { url, ...options };
      return new Response(JSON.stringify({ code: 200, data: { ok: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  await api.request("/app/login/phone-password", {
    phone: "fixture",
    password: "UNIQUE_FIXTURE_PASSWORD",
  });
  assert(request.body.startsWith('["dg-'));
  assert(!request.body.includes("UNIQUE_FIXTURE_PASSWORD"));
  assert.equal(request.redirect, "error");
  assert(request.url.startsWith("https://api4.dungeon-lab.cn/api/"));
});
test("room code accepts official invitation and rejects invalid input", () => {
  assert.equal(
    parseRoomCode("https://dungeon-lab.cn/s/?v=1&action=remote&code=TEST12345"),
    "TEST12345",
  );
  assert.throws(() => parseRoomCode(""));
  assert.throws(() => parseRoomCode("a/b?token=secret"));
});
