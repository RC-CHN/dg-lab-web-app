import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { ADMIN_PASSWORD } from "./fixtures.mjs";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const origin = "http://127.0.0.1:8787";
try {
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const post = async (path, body) => {
    const state = await (await page.request.get(`${origin}/api/state`)).json();
    const response = await page.request.post(`${origin}/api/${path}`, {
      headers: { "X-Panel-CSRF": state.csrf },
      data: body,
    });
    assert(response.ok(), await response.text());
  };
  await post("admin/login", { password: ADMIN_PASSWORD });
  await post("login", { phone: "15500000000", password: "fixture" });
  await post("room/join", { code: "EMPTYROOM" });
  assert.equal(
    (await (await page.request.get(`${origin}/api/state`)).json()).devices
      .length,
    0,
  );
  await page.goto(origin);
  await page.waitForTimeout(300);
  assert.deepEqual(
    errors,
    [],
    "joining a room before device discovery must not crash the scope",
  );
  const trigger = () =>
    page.getByRole("button", {
      name: "打开发送波形示波器与设备反馈",
      exact: true,
    });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await expect(trigger()).toBeVisible();
    await trigger().click();
    await expect(
      page.getByRole("dialog", { name: "实时示波器", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭示波器", exact: true }).click();
    await page.goto(`${origin}/admin`);
    await expect(
      page.getByRole("heading", { name: "连接管理", exact: true }),
    ).toBeVisible();
    await expect(trigger()).toBeVisible();
    await page.goto(origin);
  }
  await post("room/leave", {});
  await post("room/join", { code: "TEST1234" });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "管理账号与连接", exact: true }),
  ).toBeVisible();
  await expect(trigger()).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "Empty-room regression passed: no discovered device, empty traces, desktop/mobile reload, admin navigation, scope dialog and later device discovery.",
  );
} finally {
  await browser.close();
}
