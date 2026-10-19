import { chooseFeature } from "./navigation.mjs";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
});
const errors = [];
const theme = process.env.PANEL_THEME || "arcade";
await fs.mkdir("test-results", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  await page.addInitScript(
    (theme) => localStorage.setItem("dg-panel-theme", theme),
    theme,
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8787");
  await page.getByText("先体验演示").click();
  await page.getByRole("button", { name: "接管设备", exact: true }).click();
  await page
    .locator(".channel-card")
    .first()
    .getByText("12", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "A增加强度", exact: true }).click();
  await page
    .locator(".channel-card")
    .first()
    .getByText("13", { exact: true })
    .waitFor();
  await page.screenshot({
    path: `test-results/${theme}-desktop.png`,
    fullPage: true,
    animations: "disabled",
  });
  await chooseFeature(page, "波形工作室");
  await page.getByRole("button", { name: "加入队列", exact: true }).click();
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  await page
    .locator(".playback-item")
    .first()
    .getByText("挤压", { exact: true })
    .waitFor();
  await chooseFeature(page, "触控与开火");
  const pad = await page.locator(".touchpad").boundingBox();
  await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  assert.equal(await page.locator(".touch-cursor").count(), 1);
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".touch-cursor").count(), 0);
  let state = await page.evaluate(() =>
    fetch("/api/state").then((r) => r.json()),
  );
  assert.equal(state.devices[0].props.intensityA, 13);
  assert.equal(state.players.length, 1);
  const fire = page.locator(".fire-button").first();
  await fire.scrollIntoViewIfNeeded();
  const box = await fire.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  state = await page.evaluate(() => fetch("/api/state").then((r) => r.json()));
  assert.equal(state.devices[0].props.intensityA, 14);
  await page.mouse.up();
  await page.waitForTimeout(200);
  state = await page.evaluate(() => fetch("/api/state").then((r) => r.json()));
  assert.equal(state.devices[0].props.intensityA, 13);
  await page.getByRole("button", { name: "节奏触控", exact: true }).click();
  await page.screenshot({
    path: `test-results/${theme}-touch.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "停止并归零", exact: true }).click();
  await page.waitForTimeout(150);
  state = await page.evaluate(() => fetch("/api/state").then((r) => r.json()));
  assert.equal(state.devices[0].props.intensityA, 0);
  assert.equal(state.devices[0].props.intensityB, 0);
  assert.equal(state.players.length, 0);
  await chooseFeature(page, "场景组合");
  await page.getByRole("button", { name: /随机漫游/ }).click();
  assert.equal(await page.locator(".queue-panel .queue-row").count(), 5);
  await page.getByRole("button", { name: "保存当前队列", exact: true }).click();
  await page.getByRole("button", { name: "载入", exact: true }).waitFor();
  await chooseFeature(page, "波形工作室");
  await page.getByText("制作与导入波形", { exact: true }).click();
  await page
    .getByRole("button", { name: "生成自定义波形", exact: true })
    .click();
  await page.getByRole("heading", { name: "我的波形", exact: true }).waitFor();
  await chooseFeature(page, "操作记录");
  assert((await page.locator(".log-row").count()) > 3);
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await mobile.addInitScript(
    (theme) => localStorage.setItem("dg-panel-theme", theme),
    theme,
  );
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto("http://127.0.0.1:8787");
  await mobile.getByText("先体验演示").click();
  await mobile.getByRole("button", { name: "接管设备", exact: true }).click();
  await mobile
    .locator(".channel-card")
    .first()
    .getByText("12", { exact: true })
    .waitFor();
  for (const tab of [
    "通道控制",
    "触控与开火",
    "波形工作室",
    "场景组合",
    "操作记录",
  ]) {
    await chooseFeature(mobile, tab);
    assert(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `mobile overflow: ${tab}`,
    );
  }
  await chooseFeature(mobile, "触控与开火");
  await mobile.screenshot({
    path: `test-results/${theme}-mobile.png`,
    fullPage: true,
    animations: "disabled",
  });
  // Two independently allocated touch pointers, then explicit cancellation.
  const mpad = mobile.locator(".touchpad");
  await mpad.scrollIntoViewIfNeeded();
  const mb = await mpad.boundingBox();
  const cdp = await mobile.context().newCDPSession(mobile);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: mb.x + 80, y: mb.y + 100, id: 1 },
      { x: mb.x + 200, y: mb.y + 150, id: 2 },
    ],
  });
  await mobile.waitForTimeout(200);
  assert.equal(await mobile.locator(".touch-cursor").count(), 2);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await mobile.waitForTimeout(200);
  assert.equal(await mobile.locator(".touch-cursor").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Browser QA passed: desktop controls, touch/fire release, queue/custom/scenes, stop, mobile 5 views, multitouch, no page errors.",
  );
  // Explicitly leave demo, so test teardown owns no room or output timers.
  for (const p of [page, mobile])
    await p.evaluate(async () => {
      const s = await fetch("/api/state").then((r) => r.json());
      await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Panel-CSRF": s.csrf },
        body: JSON.stringify({ enabled: false }),
      });
    });
} finally {
  await browser.close();
}
