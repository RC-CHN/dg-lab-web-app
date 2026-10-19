import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chooseFeature } from "./navigation.mjs";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const errors = [];
await fs.mkdir("test-results", { recursive: true });
const current = (p) =>
  p.evaluate(() => fetch("/api/state").then((r) => r.json()));
async function theme(p, name) {
  await p.getByRole("button", { name: "外观主题", exact: true }).click();
  await expect(p.getByRole("group", { name: "选择外观主题" })).toBeVisible();
  await p.getByRole("button", { name: new RegExp(name) }).click();
  await expect(p.getByRole("group", { name: "选择外观主题" })).toHaveCount(0);
  await expect(p.locator("html")).toHaveAttribute(
    "data-theme",
    { 暗黑街机: "arcade", 复古音响: "retro", 原版暖色: "classic" }[name],
  );
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `overflow in ${name}`,
  );
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:8787");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "arcade");
  await page.getByRole("button", { name: "先体验演示", exact: true }).click();
  await page.getByRole("button", { name: "接管设备", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "A增加强度", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "test-results/theme-arcade-desktop.png",
    animations: "disabled",
  });
  await theme(page, "原版暖色");
  await page.screenshot({
    path: "test-results/theme-classic-desktop.png",
    animations: "disabled",
  });
  await theme(page, "复古音响");
  await expect(
    page.getByRole("img", {
      name: "A通道强度表，当前 12，有效上限 100",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "A增加强度", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: "A通道强度表，当前 13，有效上限 100",
      exact: true,
    }),
  ).toHaveAttribute("data-ratio", "0.13");
  await page.screenshot({
    path: "test-results/theme-retro-desktop.png",
    animations: "disabled",
  });
  // Appearance persists through reload and is shared across tabs, without changing the session.
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:8787");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "retro");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "retro");
  await theme(page, "暗黑街机");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "arcade");
  await other.close();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "arcade");
  await expect(
    page.getByRole("button", { name: "A增加强度", exact: true }),
  ).toBeEnabled();
  const themeButton = page.getByRole("button", {
    name: "外观主题",
    exact: true,
  });
  await themeButton.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /暗黑街机/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(themeButton).toBeFocused();
  await expect(themeButton).toHaveAttribute("aria-expanded", "false");
  await themeButton.click();
  await page
    .getByRole("heading", { name: "通道控制", exact: true })
    .first()
    .click();
  await expect(themeButton).toHaveAttribute("aria-expanded", "false");
  // Changing appearance must not remount a running control feature or send commands.
  await chooseFeature(page, "音乐联动");
  await page
    .getByRole("combobox", { name: "节拍来源", exact: true })
    .selectOption("manual");
  await page.getByRole("button", { name: "开始音乐联动", exact: true }).click();
  await expect.poll(async () => (await current(page)).lab.running).toBe(true);
  const before = await current(page),
    mutations = [];
  const observe = (r) => {
    if (r.method() === "POST" && !r.url().endsWith("/api/lab/update"))
      mutations.push(new URL(r.url()).pathname);
  };
  page.on("request", observe);
  await theme(page, "复古音响");
  await theme(page, "原版暖色");
  await theme(page, "暗黑街机");
  const after = await current(page);
  assert.equal(after.lab.runId, before.lab.runId);
  assert.equal(after.lab.running, true);
  assert.deepEqual(after.devices[0].props, before.devices[0].props);
  assert.deepEqual(mutations, []);
  page.off("request", observe);
  await page.getByRole("button", { name: "停止并归零", exact: true }).click();
  await chooseFeature(page, "多人协作");
  await page
    .getByRole("combobox", { name: "合作方式", exact: true })
    .selectOption("split");
  await page.getByRole("button", { name: "创建邀请链接", exact: true }).click();
  const invite = await page
    .getByLabel("邀请链接", { exact: true })
    .inputValue();
  const guest = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  guest.on("pageerror", (e) => errors.push(e.message));
  await guest.goto(invite);
  await guest.getByRole("button", { name: "加入协作", exact: true }).click();
  await expect
    .poll(async () => (await current(guest)).guest?.active)
    .toBe(true);
  await guest.screenshot({
    path: "test-results/theme-guest-mobile.png",
    animations: "disabled",
  });
  await theme(guest, "复古音响");
  await guest.screenshot({
    path: "test-results/theme-retro-guest.png",
    animations: "disabled",
  });
  await theme(guest, "原版暖色");
  await theme(guest, "暗黑街机");
  await guest.getByRole("button", { name: "退出协作", exact: true }).click();
  await guest.close();
  await page.getByRole("button", { name: "退出演示", exact: true }).click();
  for (const width of [320, 390, 768]) {
    const mobile = await browser.newPage({
      viewport: { width, height: 844 },
      isMobile: width < 760,
      hasTouch: true,
    });
    mobile.on("pageerror", (e) => errors.push(e.message));
    await mobile.goto("http://127.0.0.1:8787");
    await mobile
      .getByRole("button", { name: "先体验演示", exact: true })
      .click();
    await mobile.getByRole("button", { name: "接管设备", exact: true }).click();
    await expect(
      mobile.getByRole("button", { name: "A增加强度", exact: true }),
    ).toBeEnabled();
    if (width <= 390) {
      const step = await mobile
        .getByRole("button", { name: "A增加强度", exact: true })
        .boundingBox();
      const dock = await mobile
        .getByRole("region", { name: "全局停止", exact: true })
        .boundingBox();
      assert(
        step.y + step.height <= dock.y,
        `first strength step obscured at ${width}px: ${step.y + step.height} > ${dock.y}`,
      );
    }
    if (width === 390)
      await mobile.screenshot({
        path: "test-results/theme-arcade-mobile.png",
        animations: "disabled",
      });
    await mobile.getByRole("button", { name: "外观主题", exact: true }).click();
    const menu = await mobile
      .getByRole("group", { name: "选择外观主题" })
      .boundingBox();
    assert(
      menu.x >= 0 && menu.x + menu.width <= width,
      "theme menu must fit narrow screens",
    );
    if (width === 390)
      await mobile.screenshot({
        path: "test-results/theme-picker-mobile.png",
        animations: "disabled",
      });
    await mobile.keyboard.press("Escape");
    await theme(mobile, "复古音响");
    if (width === 390)
      await mobile.screenshot({
        path: mobile.url().endsWith("/admin")
          ? "test-results/theme-retro-admin.png"
          : "test-results/theme-retro-mobile.png",
        animations: "disabled",
      });
    await theme(mobile, "原版暖色");
    await theme(mobile, "暗黑街机");
    await chooseFeature(mobile, "触控与开火");
    await theme(mobile, "复古音响");
    await mobile.locator(".fire-panel").scrollIntoViewIfNeeded();
    if (width === 390)
      await mobile.screenshot({
        path: "test-results/theme-retro-fire-mobile.png",
        animations: "disabled",
      });
    assert(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "theme overflow",
    );
    await mobile
      .getByRole("button", { name: "管理员入口", exact: true })
      .click();
    await expect(
      mobile.getByRole("heading", { name: "管理员入口", exact: true }),
    ).toBeVisible();
    if (width === 390)
      await mobile.screenshot({
        path: "test-results/theme-admin-mobile.png",
        animations: "disabled",
      });
    await theme(mobile, "复古音响");
    if (width === 390)
      await mobile.screenshot({
        path: mobile.url().endsWith("/admin")
          ? "test-results/theme-retro-admin.png"
          : "test-results/theme-retro-mobile.png",
        animations: "disabled",
      });
    await theme(mobile, "原版暖色");
    await theme(mobile, "暗黑街机");
    assert(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "admin theme overflow",
    );
    await mobile.close();
  }
  // Denied browser storage must not prevent the console from rendering.
  const privatePage = await browser.newPage();
  privatePage.on("pageerror", (e) => errors.push(e.message));
  await privatePage.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
  });
  await privatePage.goto("http://127.0.0.1:8787");
  await theme(privatePage, "复古音响");
  await privatePage.close();
  assert.deepEqual(errors, []);
  console.log(
    "Themes passed: three themes, live analog meter, default arcade, persistence and cross-tab sync, keyboard/Escape/outside click, storage denial, active playback preserved, admin/guest routes, 320–1440px layout.",
  );
} finally {
  await browser.close();
}
