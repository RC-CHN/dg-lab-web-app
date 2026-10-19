import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chooseFeature } from "./navigation.mjs";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const errors = [];
const state = (page) =>
  page.evaluate(() => fetch("/api/state").then((r) => r.json()));
const slider = async (page, label, value) => {
  const control = page.getByRole("slider", { name: new RegExp(`^${label}`) });
  await control.evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};
const output = async (page, a, b) => {
  await expect(page.getByLabel("A 路合成幅值", { exact: true })).toHaveText(
    `${a}%`,
  );
  await expect(page.getByLabel("B 路合成幅值", { exact: true })).toHaveText(
    `${b}%`,
  );
};
try {
  await fs.mkdir("test-results", { recursive: true });
  const owner = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
  });
  owner.on("pageerror", (e) => errors.push(e.message));
  await owner.goto("http://127.0.0.1:8787");
  await owner.getByText("先体验演示").click();
  await owner.getByRole("button", { name: "接管设备", exact: true }).click();
  await owner.getByRole("button", { name: "邀请协作", exact: true }).click();
  await expect(
    owner.getByRole("combobox", { name: "合作方式", exact: true }),
  ).toHaveValue("vector");
  const guests = [];
  for (const [index, name] of ["小明", "小红"].entries()) {
    await owner.getByLabel("玩家备注", { exact: true }).fill(name);
    await owner
      .getByRole("button", { name: "创建邀请链接", exact: true })
      .click();
    const url = await owner
      .getByLabel(`${name}的邀请链接`, { exact: true })
      .inputValue();
    const guest = await browser.newPage({
      viewport: { width: index ? 1280 : 390, height: 844 },
      isMobile: !index,
      hasTouch: !index,
    });
    guest.on("pageerror", (e) => errors.push(e.message));
    await guest.goto(url);
    await guest.getByRole("button", { name: "加入协作", exact: true }).click();
    await expect
      .poll(async () => (await state(guest)).guest?.active)
      .toBe(true);
    guests.push(guest);
  }
  await expect(
    owner.getByText("2 人在线 · 2/7 个席位", { exact: true }),
  ).toBeVisible();
  await owner.locator(".vector-settings summary").click();
  await slider(owner, "A 路合成上限", 70);
  await slider(owner, "B 路合成上限", 60);
  await owner
    .getByRole("button", { name: "开始多人叠加", exact: true })
    .click();
  await expect
    .poll(async () => (await state(owner)).lab.coopMode)
    .toBe("vector");
  await slider(owner, "我的 A 路贡献", 20);
  await slider(owner, "我的 B 路贡献", 10);
  await slider(guests[0], "我的 A 路贡献", 30);
  await slider(guests[0], "我的 B 路贡献", 5);
  await slider(guests[1], "我的 A 路贡献", 40);
  await slider(guests[1], "我的 B 路贡献", 70);
  await output(owner, 70, 60);
  await output(guests[0], 70, 60);
  await expect(
    owner.getByText("合计 90% · 已封顶 70%", { exact: true }),
  ).toBeVisible();
  const runId = (await state(owner)).lab.runId;
  // Navigating to another panel does not discard either participant's input.
  await chooseFeature(owner, "通道控制");
  await owner.getByRole("button", { name: "邀请协作", exact: true }).click();
  await output(owner, 70, 60);
  assert.equal((await state(owner)).lab.runId, runId);
  for (const [theme, title] of [
    ["arcade", "暗黑街机"],
    ["retro", "复古音响"],
    ["classic", "原版暖色"],
  ]) {
    for (const page of [owner, guests[0]]) {
      await page.getByRole("button", { name: "外观主题", exact: true }).click();
      await page.getByRole("button", { name: new RegExp(title) }).click();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${theme} layout overflow`,
      );
      await page.screenshot({
        path: `test-results/coop-${theme}-${page === owner ? "desktop" : "mobile"}.png`,
        fullPage: true,
      });
    }
  }
  // Blurring one player clears only their contribution. Other clients retain the same run.
  await guests[0].evaluate(() => window.dispatchEvent(new Event("blur")));
  await output(owner, 60, 60);
  await expect(
    guests[0].getByRole("slider", { name: /^我的 A 路贡献/ }),
  ).toHaveValue("0");
  assert.equal((await state(owner)).lab.runId, runId);
  await slider(guests[0], "我的 A 路贡献", 15);
  await output(owner, 70, 60);
  await owner.getByRole("button", { name: "移除小明", exact: true }).click();
  await guests[0].getByText("邀请已撤销", { exact: true }).waitFor();
  await output(owner, 60, 60);
  assert.equal((await state(owner)).lab.runId, runId);
  await guests[1]
    .getByRole("button", { name: "清空我的贡献", exact: true })
    .click();
  await output(owner, 20, 10);
  assert.equal((await state(owner)).devices[0].props.intensityA, 12);
  await guests[1]
    .getByRole("button", { name: "停止波形", exact: true })
    .click();
  await expect.poll(async () => (await state(owner)).lab.running).toBe(false);
  // Phone owner layout, including expanded roster, stays within the viewport.
  await owner.setViewportSize({ width: 390, height: 844 });
  assert(
    await owner.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await owner.screenshot({
    path: "test-results/coop-owner-mobile.png",
    fullPage: true,
  });
  await owner
    .getByRole("button", { name: "撤销全部邀请", exact: true })
    .click();
  assert.deepEqual(errors, []);
  console.log(
    "Multiplayer UI passed: 3 clients, A/B sums and caps, navigation, individual removal, blur reset, stop, three themes and mobile layouts.",
  );
} finally {
  await browser.close();
}
