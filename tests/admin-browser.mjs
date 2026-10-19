import { chooseFeature } from "./navigation.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ADMIN_PASSWORD } from "./fixtures.mjs";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
});
const errors = [];
await fs.mkdir("test-results", { recursive: true });
const state = (p) =>
  p.evaluate(() => fetch("/api/state").then((r) => r.json()));
const auth = async (p) => {
  await p.getByLabel("管理员口令", { exact: true }).fill(ADMIN_PASSWORD);
  await p.getByRole("button", { name: "进入管理面板", exact: true }).click();
  await expect(
    p.getByRole("heading", { name: "连接管理", exact: true }),
  ).toBeVisible();
};
const connect = async (p) => {
  await p.getByLabel("官方手机号", { exact: true }).fill("15500000000");
  await p.getByLabel("官方账号密码", { exact: true }).fill("fixture");
  await p.getByRole("button", { name: "登录官方账号", exact: true }).click();
  await expect(
    p.locator(".step-copy").getByText("测试管理员", { exact: true }),
  ).toBeVisible();
  await expect(p.locator("#step-1")).toHaveAttribute("aria-expanded", "false");
  await expect(p.locator("#step-2")).toHaveAttribute("aria-expanded", "true");
  await expect(p.getByLabel("官方账号密码", { exact: true })).toHaveCount(0);
  await p.getByLabel("远程码或邀请链接", { exact: true }).fill("TEST1234");
  await p.getByRole("button", { name: "加入房间", exact: true }).click();
  await expect(p.locator("#step-2")).toHaveAttribute("aria-expanded", "false");
  await expect(p.locator("#step-3")).toHaveAttribute("aria-expanded", "true");
  await p.screenshot({
    path: `test-results/wizard-device-${p.viewportSize().width}.png`,
    fullPage: true,
  });
  await p
    .getByRole("button", { name: "接管并进入控制台", exact: true })
    .click();
  await expect(p).toHaveURL("http://127.0.0.1:8787/");
  await expect(
    p.getByRole("button", { name: "A增加强度", exact: true }),
  ).toBeEnabled();
};
const noOverflow = async (p) =>
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    "horizontal overflow",
  );
const labels = async (p) => {
  const missing = await p
    .locator("input:not([type=hidden]),select,textarea")
    .evaluateAll((elements) =>
      elements
        .filter(
          (e) =>
            e.getBoundingClientRect().width &&
            !e.labels?.length &&
            !e.getAttribute("aria-label") &&
            !e.getAttribute("aria-labelledby"),
        )
        .map((e) => e.outerHTML.slice(0, 100)),
    );
  assert.deepEqual(missing, []);
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1040 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8787");
  await expect(
    page.getByText("连接设备，从管理员入口开始", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("官方账号密码", { exact: true })).toHaveCount(0);
  await noOverflow(page);
  await page.getByRole("button", { name: "管理员入口", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await labels(page);
  await page.screenshot({
    path: "test-results/admin-login.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "进入管理面板", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("管理员口令", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "显示口令", exact: true }).click();
  await expect(page.getByLabel("管理员口令", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByRole("button", { name: "隐藏口令", exact: true }).click();
  await page.getByLabel("管理员口令", { exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("管理员口令不正确");
  await expect(page.getByLabel("管理员口令", { exact: true })).toHaveValue("");
  const before = (await page.context().cookies()).find(
    (c) => c.name === "dgpanel",
  ).value;
  await auth(page);
  assert.notEqual(
    (await page.context().cookies()).find((c) => c.name === "dgpanel").value,
    before,
  );
  await expect(
    page.getByLabel("远程码或邀请链接", { exact: true }),
  ).toBeHidden();
  await labels(page);
  await page.getByLabel("官方手机号", { exact: true }).fill("15500000000");
  await page.getByLabel("官方账号密码", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "登录官方账号", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "模拟官方账号或密码不正确",
  );
  await expect(page.getByLabel("官方账号密码", { exact: true })).toHaveValue(
    "",
  );
  await connect(page);
  await page.getByRole("button", { name: "连接管理", exact: true }).click();
  await page.screenshot({
    path: "test-results/admin-desktop.png",
    fullPage: true,
  });
  await noOverflow(page);
  const other = await browser.newPage();
  await other.goto("http://127.0.0.1:8787/admin");
  await expect(
    other.getByRole("heading", { name: "管理员入口", exact: true }),
  ).toBeVisible();
  assert.equal((await state(other)).user, null);
  await other.close();
  await page.getByRole("button", { name: "进入控制台", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:8787/");
  await expect(
    page.getByRole("button", { name: "A增加强度", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "A增加强度", exact: true }).click();
  await expect
    .poll(async () => (await state(page)).devices[0].props.intensityA)
    .toBe(13);
  await expect(
    page.getByRole("button", { name: "接管设备", exact: true }),
  ).toHaveCount(0);
  await chooseFeature(page, "双人协作");
  await page.getByRole("button", { name: "创建邀请链接", exact: true }).click();
  const url = await page.getByLabel("邀请链接", { exact: true }).inputValue();
  const guest = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  guest.on("pageerror", (e) => errors.push(e.message));
  await guest.goto(url);
  await guest.getByRole("button", { name: "加入协作", exact: true }).click();
  await expect.poll(async () => (await state(guest)).guest?.active).toBe(true);
  await guest.goto("http://127.0.0.1:8787/admin");
  await expect(
    guest.getByRole("heading", { name: "管理员入口", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "连接管理", exact: true }).click();
  await page
    .getByRole("button", { name: "退出管理并断开", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "管理员入口", exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await state(guest)).guest?.active).toBe(false);
  await page.getByRole("link", { name: "返回控制台", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止并归零", exact: true }),
  ).toHaveCount(0);
  assert.equal((await state(page)).room, null);
  await guest.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto("http://127.0.0.1:8787/admin");
  await noOverflow(mobile);
  await labels(mobile);
  await mobile.screenshot({
    path: "test-results/admin-login-mobile.png",
    fullPage: true,
  });
  await auth(mobile);
  await noOverflow(mobile);
  await labels(mobile);
  await connect(mobile);
  await mobile.getByRole("button", { name: "连接管理", exact: true }).click();
  await mobile.screenshot({
    path: "test-results/admin-mobile.png",
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1024]) {
    await mobile.setViewportSize({ width, height: 844 });
    await noOverflow(mobile);
  }
  await mobile.getByRole("button", { name: "进入控制台", exact: true }).click();
  await mobile.setViewportSize({ width: 320, height: 844 });
  await noOverflow(mobile);
  await mobile.getByRole("button", { name: "连接管理", exact: true }).click();
  const enterBox = await mobile
    .getByRole("button", { name: "进入控制台", exact: true })
    .boundingBox();
  assert(
    enterBox.y >= 0 && enterBox.y + enterBox.height < 844,
    "return to console must be above the fold",
  );
  await mobile.locator("#step-3").click();
  await mobile.getByRole("button", { name: "释放控制", exact: true }).click();
  await expect(
    mobile.getByRole("button", { name: "进入控制台", exact: true }),
  ).toHaveCount(0);
  await mobile.locator("#step-2").click();
  await mobile.getByRole("button", { name: "退出房间", exact: true }).click();
  await expect(
    mobile.getByLabel("远程码或邀请链接", { exact: true }),
  ).toBeEnabled();
  await mobile.locator("#step-1").click();
  await mobile
    .getByRole("button", { name: "退出官方账号", exact: true })
    .click();
  await expect(mobile.getByLabel("官方手机号", { exact: true })).toBeVisible();
  await mobile
    .getByRole("button", { name: "退出管理并断开", exact: true })
    .click();
  // A completed upstream login response arriving after logout must not reopen the admin UI.
  await auth(mobile);
  let releaseLogin, loginArrived, responseDelivered;
  const arrived = new Promise((r) => (loginArrived = r)),
    hold = new Promise((r) => (releaseLogin = r)),
    delivered = new Promise((r) => (responseDelivered = r));
  await mobile.route("**/api/login", async (route) => {
    const response = await route.fetch();
    loginArrived();
    await hold;
    await route.fulfill({ response });
    responseDelivered();
  });
  await mobile.getByLabel("官方手机号", { exact: true }).fill("15500000000");
  await mobile.getByLabel("官方账号密码", { exact: true }).fill("fixture");
  await mobile
    .getByRole("button", { name: "登录官方账号", exact: true })
    .click();
  await arrived;
  await expect(
    mobile.getByRole("button", { name: "退出管理并断开", exact: true }),
  ).toBeEnabled();
  await mobile
    .getByRole("button", { name: "退出管理并断开", exact: true })
    .click();
  await expect(
    mobile.getByRole("heading", { name: "管理员入口", exact: true }),
  ).toBeVisible();
  releaseLogin();
  await delivered;
  await mobile.unroute("**/api/login");
  assert.equal((await state(mobile)).admin.authenticated, false);
  assert.equal((await state(mobile)).user, null);
  assert.deepEqual(errors, []);
  console.log(
    "Admin UI/UX passed: desktop and mobile authentication, error recovery, 3-step official connection with offline fixtures, device control, scoped guest, logout, session isolation, field labels, keyboard submit and 320–1440px layouts.",
  );
} finally {
  await browser.close();
}
