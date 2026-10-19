import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { chooseFeature } from "./navigation.mjs";
import fs from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const origin = "http://127.0.0.1:8787",
  errors = [];
const get = (page) =>
  page.evaluate(() => fetch("/api/state").then((r) => r.json()));
const trigger = (page) =>
  page.getByRole("button", {
    name: "打开发送波形示波器与设备反馈",
    exact: true,
  });
const post = (context, path, body) =>
  (async () => {
    const s = await (await context.request.get(`${origin}/api/state`)).json();
    const response = await context.request.post(`${origin}/api/${path}`, {
      headers: { "X-Panel-CSRF": s.csrf },
      data: body,
    });
    assert(response.ok(), await response.text());
    return response.json();
  })();
const fit = async (page) => {
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "page overflow",
  );
  const dialog = page.getByRole("dialog", { name: "实时示波器", exact: true });
  await expect(dialog).toBeVisible();
  assert(
    await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        b = el.querySelector(".scope-dialog-body");
      return (
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth &&
        r.bottom <= innerHeight &&
        b.scrollWidth <= b.clientWidth
      );
    }),
    "dialog overflow",
  );
  for (const b of await dialog.locator("footer button").all()) {
    assert(
      await b.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.height >= 44 &&
          r.bottom <= innerHeight &&
          el.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          )
        );
      }),
      "stop button covered",
    );
  }
};
try {
  await fs.mkdir("test-results", { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  let page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "先体验演示", exact: true }).click();
  await page.getByRole("button", { name: "接管设备", exact: true }).click();
  await chooseFeature(page, "画线波形");
  await page.getByRole("button", { name: "播放双轨", exact: true }).click();
  await expect.poll(async () => (await get(page)).lab.running).toBe(true);
  const started = (await get(page)).lab;
  await chooseFeature(page, "波形工作室");
  await expect(trigger(page)).toBeVisible();
  await expect
    .poll(async () => (await get(page)).lab.runId)
    .toBe(started.runId);
  await page.reload();
  await expect(trigger(page)).toBeVisible();
  assert.equal((await get(page)).lab.runId, started.runId);
  // Freeze this page like a suspended mobile tab: all playback stays server-side.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const frozen = await (
    await context.request.get(`${origin}/api/state`)
  ).json();
  assert.equal(frozen.lab.runId, started.runId);
  assert(frozen.lab.tick >= started.tick + 10);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.close();
  // Exceed the original 15-second disconnected-page timeout, with zero pages.
  await new Promise((resolve) => setTimeout(resolve, 16000));
  const background = await (
    await context.request.get(`${origin}/api/state`)
  ).json();
  assert.equal(background.lab.runId, started.runId);
  assert(background.lab.tick > frozen.lab.tick + 100);
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await expect(trigger(page)).toBeVisible();
  assert.equal((await get(page)).lab.runId, started.runId);
  await trigger(page).click();
  await fit(page);
  const dialog = page.getByRole("dialog", { name: "实时示波器", exact: true });
  await expect(
    dialog.getByText("本面板发送波形", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("绝对上限", { exact: true }).first(),
  ).not.toBeVisible();
  await dialog.locator("summary").filter({ hasText: "设备详情" }).click();
  await expect(
    dialog.getByText("绝对上限", { exact: true }).first(),
  ).toBeVisible();
  await dialog.locator("summary").filter({ hasText: "设备详情" }).click();
  const canvas = dialog.locator("canvas").first();
  const before = await canvas.evaluate((el) => el.toDataURL());
  await page.waitForTimeout(350);
  assert.notEqual(
    await canvas.evaluate((el) => el.toDataURL()),
    before,
    "scope must animate actual history",
  );
  await context.setOffline(true);
  await expect(dialog.locator(".scope-offline")).toBeVisible();
  await page.waitForTimeout(250);
  const frozenTrace = await canvas.evaluate((el) => el.toDataURL());
  await page.waitForTimeout(350);
  assert.equal(
    await canvas.evaluate((el) => el.toDataURL()),
    frozenTrace,
    "disconnected scope must not invent new motion",
  );
  await context.setOffline(false);
  await expect(dialog.locator(".scope-offline")).toHaveCount(0, {
    timeout: 10000,
  });
  assert.equal((await get(page)).lab.runId, started.runId);
  await post(context, "control", {
    id: 0,
    channel: 0,
    action: "mute",
    value: true,
  });
  await expect(dialog.getByText("设备已暂停", { exact: true })).toBeVisible();
  await post(context, "control", {
    id: 0,
    channel: 0,
    action: "mute",
    value: false,
  });
  for (const [id, label] of [
    ["arcade", "暗黑街机"],
    ["retro", "复古音响"],
    ["classic", "原版暖色"],
  ]) {
    await dialog.getByRole("button", { name: "外观主题", exact: true }).click();
    await dialog.getByRole("button", { name: new RegExp(label) }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await fit(page);
    await page.screenshot({
      path: `test-results/scope-${id}-desktop.png`,
      animations: "disabled",
    });
    assert.equal((await get(page)).lab.runId, started.runId);
  }
  await page.keyboard.press("Escape");
  await expect(trigger(page)).toBeFocused();
  await page.getByRole("button", { name: "管理员入口", exact: true }).click();
  await expect(trigger(page)).toBeVisible();
  assert.equal((await get(page)).lab.runId, started.runId);
  await page.getByRole("link", { name: "返回控制台", exact: true }).click();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await trigger(page).click();
    for (const [id, label] of [
      ["arcade", "暗黑街机"],
      ["retro", "复古音响"],
      ["classic", "原版暖色"],
    ]) {
      await dialog
        .getByRole("button", { name: "外观主题", exact: true })
        .click();
      await dialog.getByRole("button", { name: new RegExp(label) }).click();
      await fit(page);
      if (width === 390) {
        await page.screenshot({
          path: `test-results/scope-${id}-mobile.png`,
          animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await page.screenshot({
          path: `test-results/scope-dock-${id}-mobile.png`,
          animations: "disabled",
        });
        await trigger(page).click();
      }
    }
    await page.keyboard.press("Escape");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trigger(page).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "全部停止并归零", exact: true })
    .click();
  await expect
    .poll(async () => {
      const s = await get(page);
      return [
        s.lab.running,
        s.devices[0].props.intensityA,
        s.devices[0].props.intensityB,
      ];
    })
    .toEqual([false, 0, 0]);
  await expect
    .poll(async () => (await get(page)).scope[0].frames)
    .toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  await post(context, "demo", { enabled: false });
  await context.close();
  assert.deepEqual(errors, []);
  console.log(
    "Scope passed: actual frames animate, feedback/mute, all three themes at 320/390/768/1440px, modal keyboard and stop, page switching/reload/admin, frozen tab and >15s with no pages, same run restored, global stop and reduced motion. Simulated devices only.",
  );
} finally {
  await browser.close();
}
