import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { ADMIN_PASSWORD } from "./fixtures.mjs";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const origin = "http://127.0.0.1:8787";
const image = async text => ({ name: "invitation.png", mimeType: "image/png", buffer: await QRCode.toBuffer(text, { width: 600 }) });
try {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [], joins = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (r.url().endsWith("/api/room/join")) joins.push(r.postDataJSON()); });
  await page.goto(`${origin}/admin`);
  await page.getByLabel("管理员口令", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "进入管理面板", exact: true }).click();
  await page.getByLabel("官方手机号", { exact: true }).fill("15500000000");
  await page.getByLabel("官方账号密码", { exact: true }).fill("fixture");
  await page.getByRole("button", { name: "登录官方账号", exact: true }).click();
  const code = page.getByLabel("远程码或邀请链接", { exact: true });
  await expect(code).toBeVisible();
  const valid = await image("dglab4://remote?action=remote&code=QRTEST1234");
  await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
  }, valid.buffer.toString("base64"));
  await code.focus();
  await page.keyboard.press("Control+V");
  await expect(code).toHaveValue("QRTEST1234");
  await expect(page.getByText("已识别，点击加入房间", { exact: true })).toBeVisible();
  assert.equal(joins.length, 0, "QR decode must not auto-join");
  await code.fill("");
  await page.getByRole("button", { name: "粘贴图片", exact: true }).click();
  await expect(code).toHaveValue("QRTEST1234");

  await page.getByLabel("二维码图片", { exact: true }).setInputFiles(await image("https://example.com/not-a-room"));
  await expect(page.getByRole("alert")).toHaveText("这张二维码不是有效的远程房间邀请");
  await expect(code).toHaveValue("QRTEST1234");
  await page.getByLabel("二维码图片", { exact: true }).setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("invalid image") });
  await expect(page.getByRole("alert")).toContainText("图片无法读取");

  // Text paste still uses the normal browser editing behavior.
  await page.evaluate(() => navigator.clipboard.writeText("TEXT1234"));
  await code.fill(""); await code.focus(); await page.keyboard.press("Control+V");
  await expect(code).toHaveValue("TEXT1234");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("二维码图片", { exact: true }).setInputFiles(await image("#DGLAB-4#MOBILE1234"));
  await expect(code).toHaveValue("MOBILE1234");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "test-results/qr-mobile.png", fullPage: true });
  assert.equal(joins.length, 0);
  await page.getByRole("button", { name: "加入房间", exact: true }).click();
  await expect(page.locator("#step-3")).toHaveAttribute("aria-expanded", "true");
  assert.equal(joins.length, 1);
  assert.equal(joins[0].code, "MOBILE1234");
  await page.getByRole("button", { name: "退出管理并断开", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log("QR passed: real clipboard image paste, clipboard button, mobile file selection, text paste, invalid payload/image, manual join, no official services.");
} finally { await browser.close(); }
