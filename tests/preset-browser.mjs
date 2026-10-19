import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { ADMIN_PASSWORD } from "./fixtures.mjs";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const base = "http://127.0.0.1:8787";
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/admin`);
  await page.getByLabel("管理员口令", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "进入管理面板", exact: true }).click();
  const preset = page.locator(".connection-preset");
  await preset.getByText("设置连接预设", { exact: true }).click();
  await page.getByLabel("预设官方账号", { exact: true }).fill("15500000000");
  await page.getByLabel("预设官方密码", { exact: true }).fill("fixture-secret");
  await page.getByLabel("预设房间码", { exact: true }).fill("EMPTYROOM");
  await preset.getByRole("button", { name: "保存预设", exact: true }).click();
  await expect(preset.getByText("已持久保存", { exact: true })).toBeVisible();
  await page.reload();
  await preset.getByText("修改或清除预设", { exact: true }).click();
  await expect(page.getByLabel("预设官方密码", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("预设官方账号", { exact: true })).toHaveValue(
    "15500000000",
  );
  await page.getByLabel("预设房间码", { exact: true }).fill("TEST1234");
  await preset.getByRole("button", { name: "保存预设", exact: true }).click();
  await expect(preset.getByText(/房间 TEST1234/)).toBeVisible();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/preset-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await preset
    .getByRole("button", { name: "连接预设房间", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "接管并进入控制台", exact: true }),
  ).toBeVisible();
  const state = await page.evaluate(() =>
    fetch("/api/state").then((r) => r.json()),
  );
  assert.equal(state.room.code, "TEST1234");
  assert(state.devices.every((d) => !d.connected));
  assert(!JSON.stringify(state).includes("fixture-secret"));
  await page.screenshot({
    path: "test-results/preset-desktop.png",
    fullPage: true,
  });
  await preset.getByText("修改或清除预设", { exact: true }).click();
  await preset
    .getByRole("button", { name: "清除已保存预设", exact: true })
    .click();
  await expect(preset.getByText("尚未保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(preset.getByText("尚未保存", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "Preset UI passed: save, refresh, edit without exposing password, one-click connection without acquisition, clear, mobile/desktop.",
  );
} finally {
  await browser.close();
}
