// Builds are external; this smoke test owns a temporary read-only container.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { chooseFeature } from "./navigation.mjs";
const name = `dglab-ux-smoke-${process.pid}`;
const password = randomBytes(24).toString("base64url");
const origin = "http://127.0.0.1:8791";
let browser,
  started = false;
try {
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "-p",
      "127.0.0.1:8791:8787",
      "-e",
      "ADMIN_PASSWORD",
      "-e",
      `APP_ORIGIN=${origin}`,
      "dglab-panel:local",
    ],
    { env: { ...process.env, ADMIN_PASSWORD: password }, stdio: "pipe" },
  );
  started = true;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${origin}/healthz`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/admin`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "arcade");
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim(),
    ),
    "#dcff50",
  );
  await page.getByRole("button", { name: "外观主题", exact: true }).click();
  await page.getByRole("button", { name: /原版暖色/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "classic");
  await page.getByRole("button", { name: "外观主题", exact: true }).click();
  await page.getByRole("button", { name: /暗黑街机/ }).click();
  await page.getByRole("button", { name: "外观主题", exact: true }).click();
  await page.getByRole("button", { name: /复古音响/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "retro");
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
    "light",
  );

  await page.getByLabel("管理员口令", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入管理面板", exact: true }).click();
  await expect(page.locator("#step-1")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    page.getByLabel("远程码或邀请链接", { exact: true }),
  ).toBeHidden();
  await page.getByRole("link", { name: "返回控制台", exact: true }).click();
  await page.getByRole("button", { name: "先体验演示", exact: true }).click();
  await page.getByRole("button", { name: "接管设备", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: "A通道强度表，当前 12，有效上限 100",
      exact: true,
    }),
  ).toBeVisible();
  await chooseFeature(page, "音乐联动");
  await page
    .getByRole("combobox", { name: "节拍来源", exact: true })
    .selectOption("manual");
  await page.getByRole("button", { name: "开始音乐联动", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        fetch("/api/state")
          .then((r) => r.json())
          .then((s) => s.lab.running),
      ),
    )
    .toBe(true);
  const startedRun = await page.evaluate(() =>
    fetch("/api/state").then((r) => r.json()),
  );
  assert.equal(startedRun.lab.autonomous, true);
  await page.getByRole("button", { name: "连接管理", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "打开发送波形示波器与设备反馈",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回控制台", exact: true }).click();
  await page
    .getByRole("button", { name: "打开发送波形示波器与设备反馈", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "实时示波器", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const s = await page.evaluate(() =>
        fetch("/api/state").then((r) => r.json()),
      );
      assert.equal(s.lab.runId, startedRun.lab.runId);
      return s.scope[0]?.samples.length || 0;
    })
    .toBeGreaterThan(2);
  await page.getByRole("button", { name: "关闭示波器", exact: true }).click();
  await page.getByRole("button", { name: "停止并归零", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        fetch("/api/state")
          .then((r) => r.json())
          .then((s) => [
            s.lab.running,
            s.devices[0].props.intensityA,
            s.devices[0].props.intensityB,
          ]),
      ),
    )
    .toEqual([false, 0, 0]);
  await page.getByRole("button", { name: "连接管理", exact: true }).click();
  await page
    .getByRole("button", { name: "退出管理并断开", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "管理员入口", exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "Production Docker passed: read-only container, three themes and analog meter, admin authentication, server-owned playback through admin navigation, live scope, global stop and logout. No official service used.",
  );
} finally {
  await browser?.close();
  if (started) execFileSync("docker", ["stop", name], { stdio: "pipe" });
}
