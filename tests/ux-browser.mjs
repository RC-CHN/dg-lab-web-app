import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { chooseFeature } from "./navigation.mjs";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const errors = [];
const targets = [
  "通道控制",
  "触控与开火",
  "波形工作室",
  "场景组合",
  "触控录制",
  "画线波形",
  "规律随机",
  "A/B 回声",
  "音乐联动",
  "波形 DJ",
  "多人协作",
  "互动场景",
  "操作记录",
];
async function reachable(locator) {
  await expect(locator).toBeVisible();
  assert(
    await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.top >= 0 &&
        r.bottom <= innerHeight &&
        r.left >= 0 &&
        r.right <= innerWidth &&
        el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        )
      );
    }),
    "control is outside viewport or covered",
  );
}
try {
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width < 760,
      isMobile: width < 760,
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      (theme) => localStorage.setItem("dg-panel-theme", theme),
      process.env.PANEL_THEME || "arcade",
    );
    await page.goto("http://127.0.0.1:8787");
    await expect(page.locator(".channel-card")).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "主导航", exact: true })
        .getByRole("button"),
    ).toHaveCount(4);
    if (width === 390)
      await page.screenshot({
        path: `test-results/ux-${process.env.PANEL_THEME || "arcade"}-start-mobile.png`,
      });
    await page.getByRole("button", { name: "先体验演示", exact: true }).click();
    await page.getByRole("button", { name: "接管设备", exact: true }).click();
    const stop = page.getByRole("button", { name: "停止并归零", exact: true });
    await expect(stop).toBeEnabled();
    for (const target of targets) {
      await chooseFeature(page, target);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `overflow ${width}/${target}`,
      );
      await reachable(stop);
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await reachable(stop);
      if (width < 760) {
        const nav = page.getByRole("navigation", {
          name: "主导航",
          exact: true,
        });
        for (const button of await nav.getByRole("button").all())
          await reachable(button);
      }
    }
    // Group selection remembers the last feature without a second menu layer.
    await chooseFeature(page, "触控与开火");
    await chooseFeature(page, "波形 DJ");
    await page
      .getByRole("navigation", { name: "主导航", exact: true })
      .getByRole("button", { name: "直接控制", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "触控与开火", exact: true }),
    ).toBeVisible();
    await chooseFeature(page, "通道控制");
    if (width < 760) {
      const step = await page
        .getByRole("button", { name: "A增加强度", exact: true })
        .boundingBox();
      assert(
        step.height >= 44 && step.width >= 44,
        "small-screen strength step must fit a thumb",
      );
    }
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: `test-results/ux-${process.env.PANEL_THEME || "arcade"}-control-${width}.png`,
      });
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await stop.click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          fetch("/api/state")
            .then((r) => r.json())
            .then((s) => [
              s.devices[0].props.intensityA,
              s.devices[0].props.intensityB,
            ]),
        ),
      )
      .toEqual([0, 0]);
    await page.getByRole("button", { name: "退出演示", exact: true }).click();
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "UX passed: 13 features at 320/390/768/1440px, 4 primary entries, remembered group selection, reachable fixed stop and mobile navigation, 44px strength targets, clean first-use screen.",
  );
} finally {
  await browser.close();
}
