// Independent offline fixture; changed host telemetry exercises the actual SSE path.
import { chromium, expect } from "@playwright/test";
import express from "express";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/index.mjs";
import { ADMIN_PASSWORD, MockRoom, mockApi } from "./fixtures.mjs";
import { chooseFeature } from "./navigation.mjs";

let room;
const app = createApp({
  adminPassword: ADMIN_PASSWORD,
  apiFactory: mockApi,
  roomFactory: (api) => (room = new MockRoom(api)),
});
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
app.use(express.static(dist));
app.get("/{*path}", (req, res) => res.sendFile(dist + "index.html"));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const post = async (path, data) => {
  const s = await (await context.request.get(origin + "/api/state")).json();
  const res = await context.request.post(origin + "/api/" + path, {
    headers: { "X-Panel-CSRF": s.csrf },
    data,
  });
  assert(res.ok(), await res.text());
  return res.json();
};
try {
  await fs.mkdir("test-results", { recursive: true });
  await post("admin/login", { password: ADMIN_PASSWORD });
  await post("login", { phone: "15500000000", password: "fixture" });
  await post("room/join", { code: "TEST1234" });
  await post("device/attach", { id: 0 });
  const d = room.device(0);
  d.slotState.channelA.intensityMax = 160;
  d.slotState.channelA.comfortLimit.absoluteMax = 160;
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  const card = page.locator(".channel-card").first();
  await expect(card.getByText("设备上限 160", { exact: true })).toBeVisible();
  await card.getByLabel("A目标强度").fill("145");
  await card.getByRole("button", { name: "设定强度", exact: true }).click();
  await expect.poll(() => d.props.intensityA).toBe(145);
  await card.locator("summary").click();
  await card.getByLabel("自设上限", { exact: true }).click();
  await expect(card.getByLabel("自设上限", { exact: true })).toBeChecked();
  await card.getByLabel("面板发送上限", { exact: true }).fill("120");
  await expect.poll(() => room.limit(0, 0)).toBe(120);
  await card.getByLabel("自设上限", { exact: true }).click();
  await expect(card.getByLabel("自设上限", { exact: true })).not.toBeChecked();
  await expect.poll(() => room.limit(0, 0)).toBe(160);
  d.slotState.channelA.intensityMax = 60;
  d.slotState.channelA.comfortLimit.overheat = true;
  d.props.intensityA = 60;
  room.changed();
  await expect(card.getByText("设备上限 60", { exact: true })).toBeVisible();
  await expect(card.getByRole("status")).toHaveText("舒适保护中 · 上限 60");
  await expect(card.getByLabel("A目标强度")).toHaveValue("60");
  await expect(
    card.getByRole("button", { name: "A增加强度", exact: true }),
  ).toBeDisabled();
  delete d.slotState.channelA.intensityMax;
  room.changed();
  await expect(card.getByText("设备上限 —", { exact: true })).toBeVisible();
  await expect(card.getByRole("status")).toHaveText("等待上限同步");
  d.slotState.channelA.intensityMax = 160;
  d.slotState.channelA.comfortLimit.overheat = false;
  d.feedback = { feel: 6, time: Date.now(), action: 1 };
  room.changed();
  await expect(page.getByText("房主：轻一点", { exact: true })).toBeVisible();
  await card.locator("summary").click();
  for (const [theme, label] of [
    ["arcade", "暗黑街机"],
    ["retro", "复古音响"],
    ["classic", "原版暖色"],
  ]) {
    await page
      .getByRole("button", { name: "外观主题", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: new RegExp(label) }).click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: `test-results/compact-${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await chooseFeature(page, "波形工作室");
  await page.getByRole("button", { name: "加入队列", exact: true }).click();
  await page.locator(".playback-timing summary").click();
  await page.getByLabel("延时开始 / 秒", { exact: true }).fill("1");
  await page.getByLabel("开始后停止 / 分钟", { exact: true }).fill("1");
  await page.getByLabel("间隔播放", { exact: true }).check();
  await page.getByLabel("输出最长秒", { exact: true }).fill("2");
  await page.getByLabel("输出最短秒", { exact: true }).fill("2");
  await page.getByLabel("休息最短秒", { exact: true }).fill("5");
  await page.getByLabel("休息最长秒", { exact: true }).fill("5");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  await expect.poll(() => room.publicState().players[0]?.phase).toBe("delay");
  await page.reload();
  await expect.poll(() => room.publicState().players[0]?.phase).toBe("rest");
  await expect(page.locator(".scope-mini-job")).toContainText("间歇休息");
  await page
    .getByRole("button", { name: "打开发送波形示波器与设备反馈", exact: true })
    .click();
  const details = page.locator(".scope-feedback");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  for (const field of [
    "设备有效上限",
    "舒适上限",
    "绝对上限",
    "预热比例",
    "热量积累",
    "自动增强",
    "累计增强",
  ])
    await expect(
      details.getByText(field, { exact: true }).first(),
    ).toBeVisible();
  await page
    .getByRole("button", { name: "全部停止并归零", exact: true })
    .click();
  assert.equal(room.players.size, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: host cap updates / optional cap / unknown cap / feedback disclosure / three themes × four sizes / background timing / stop",
  );
} finally {
  await browser.close();
  await app.locals.dispose();
  await new Promise((r) => server.close(r));
}
