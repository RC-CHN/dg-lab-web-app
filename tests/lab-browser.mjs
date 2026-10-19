import { chooseFeature } from "./navigation.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
});
const errors = [];
await fs.mkdir("test-results", { recursive: true });
const getState = (p) =>
  p.evaluate(() => fetch("/api/state").then((r) => r.json()));
const range = async (locator, value) => {
  await locator.evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};
const choose = chooseFeature;
const stateUntil = async (page, predicate, label) => {
  for (let i = 0; i < 40; i++) {
    const s = await getState(page);
    if (predicate(s)) return s;
    await page.waitForTimeout(100);
  }
  const last = await getState(page);
  throw Error(
    `${label}: ${JSON.stringify({ lab: last.lab, logs: last.logs.slice(-6), toast: await page.locator(".toast").allTextContents() })}`,
  );
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", { value: undefined }),
  );
  await page.goto("http://127.0.0.1:8787");
  await page.getByText("先体验演示").click();
  await page.getByRole("button", { name: "接管设备", exact: true }).click();
  await choose(page, "触控录制");
  await page.getByRole("button", { name: "开始录制", exact: true }).click();
  const pad = page.locator(".record-pad");
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, {
    steps: 6,
  });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.getByRole("button", { name: "结束录制", exact: true }).click();
  await page.getByRole("button", { name: "保存片段", exact: true }).click();
  assert.equal(await page.locator(".clip-library>details").count(), 1);
  await page.getByRole("button", { name: "播放双轨", exact: true }).click();
  await stateUntil(
    page,
    (s) => s.lab.running,
    "recording playback did not start",
  );
  await choose(page, "A/B 回声");
  await page.getByRole("button", { name: "保存片段", exact: true }).click();
  assert.equal(await page.locator(".clip-library>details").count(), 2);
  await choose(page, "波形 DJ");
  await page.getByRole("button", { name: "开始混合", exact: true }).click();
  await stateUntil(
    page,
    (s) => s.lab.mode === "mix" && s.lab.running,
    "mix did not start",
  );
  const originalRun = (await getState(page)).lab.runId;
  await choose(page, "波形 DJ");
  assert.equal((await getState(page)).lab.runId, originalRun);
  assert.equal((await getState(page)).lab.running, true);
  await range(page.locator(".dj-fader input"), 75);
  await stateUntil(page, (s) => s.lab.mix === 75, "mix not applied");
  await page.screenshot({ path: "test-results/lab-dj.png", fullPage: true });
  await choose(page, "画线波形");
  await stateUntil(
    page,
    (s) => s.lab.running && s.lab.runId === originalRun,
    "switching feature must preserve the server player",
  );
  assert.equal((await getState(page)).devices[0].props.intensityA, 12);

  const curve = page.locator(".curve-editor svg").first();
  const rect = await curve.boundingBox();
  await page.mouse.move(rect.x + 10, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 10, rect.y + rect.height - 10, {
    steps: 10,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "平滑", exact: true }).first().click();
  await page.getByRole("button", { name: "追加当前片段", exact: true }).click();
  await page.getByRole("button", { name: "保存片段", exact: true }).click();
  assert.equal(await page.locator(".clip-library>details").count(), 3);
  await choose(page, "规律随机");
  await page.getByLabel("随机种子", { exact: true }).fill("qa-reproducible");
  await page.getByRole("button", { name: "保存片段", exact: true }).click();
  assert.equal(await page.locator(".clip-library>details").count(), 4);
  const downloadPromise = page.waitForEvent("download");
  await page
    .locator(".clip-library")
    .getByRole("button", { name: "导出", exact: true })
    .click();
  const download = await downloadPromise;
  const clips = JSON.parse(await fs.readFile(await download.path(), "utf8"));
  assert.equal(clips.clips.length, 4);
  assert(clips.clips[0].tracks[0].some((f) => f[2] > 0));
  await page.locator(".clip-library input[type=file]").setInputFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(clips.clips[0])),
  });
  await expect(page.locator(".clip-library>details")).toHaveCount(5);
  await choose(page, "互动场景");
  await page.getByLabel("播放秒数", { exact: true }).first().fill("1");
  await page.getByRole("button", { name: "开始互动场景", exact: true }).click();
  await page.locator(".branch-choice").waitFor();
  await page.getByRole("button", { name: "舒缓一点", exact: true }).click();
  await stateUntil(
    page,
    (s) => s.lab.node === 1 && !s.lab.waiting,
    "branch choice did not advance",
  );
  await page.getByRole("button", { name: "邀请协作", exact: true }).click();
  await page.getByRole("button", { name: "创建邀请链接", exact: true }).click();
  const invite = await page
    .getByLabel("邀请链接", { exact: true })
    .inputValue();
  await choose(page, "通道控制");
  await page.getByRole("button", { name: "邀请协作", exact: true }).click();
  await expect(page.getByLabel("邀请链接", { exact: true })).toHaveValue(invite);
  await page.reload();
  await page.getByRole("button", { name: "邀请协作", exact: true }).click();
  await expect(page.getByLabel("邀请链接", { exact: true })).toHaveValue(invite);
  const guest = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  guest.on("pageerror", (e) => errors.push(e.message));
  await guest.goto(invite);
  await guest.getByRole("button", { name: "加入协作", exact: true }).click();
  await stateUntil(
    guest,
    (s) => s.guest?.active && s.guest.ownerOnline,
    "guest did not join",
  );
  await page.getByRole("button", { name: "开始双人协作", exact: true }).click();
  await stateUntil(
    page,
    (s) => s.lab.mode === "coop" && s.lab.running,
    "coop did not start",
  );
  await range(guest.getByRole("slider").first(), 60);
  await stateUntil(
    page,
    (s) => s.lab.frames.some((f) => f[2] > 0),
    "guest amplitude not applied",
  );
  assert.equal((await getState(page)).devices[0].props.intensityA, 12);
  const denied = await guest.evaluate(async () => {
    const s = await fetch("/api/state").then((r) => r.json());
    return (
      await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Panel-CSRF": s.csrf },
        body: JSON.stringify({ id: 0, channel: 0, action: "set", value: 200 }),
      })
    ).status;
  });
  assert.equal(denied, 403);
  await expect(guest.locator(".brand > span")).toBeVisible();
  await guest.screenshot({
    path: "test-results/lab-guest.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "撤销邀请", exact: true }).click();
  await guest.getByText("邀请已撤销", { exact: true }).waitFor();
  assert.equal((await getState(page)).lab.running, false);
  await guest.close();
  await choose(page, "音乐联动");
  await page
    .getByRole("combobox", { name: "节拍来源", exact: true })
    .selectOption("manual");
  // Manual tempo now runs on the server and needs no browser frame updates.
  const picks = page.locator(".music-picks input");
  for (let i = 0; i < (await picks.count()); i++)
    await picks.nth(i).setChecked(i === 0);
  const streamFrames = [];
  const observeFrames = (request) => {
    if (request.url().endsWith("/api/lab/update")) {
      const body = request.postDataJSON();
      if (body.frames) streamFrames.push(body.frames[0][2]);
    }
  };
  page.on("request", observeFrames);
  await page.getByRole("button", { name: "开始音乐联动", exact: true }).click();
  await stateUntil(
    page,
    (s) => s.lab.mode === "tempo" && s.lab.frames.some((f) => f[2] > 0),
    "manual beat produced no pulse",
  );
  await expect
    .poll(
      async () =>
        (await getState(page)).scope[0].samples.filter((s) => s[3] > 0).length,
    )
    .toBeGreaterThan(1);
  await expect
    .poll(
      async () =>
        (await getState(page)).scope[0].samples.filter((s) => s[3] === 0)
          .length,
    )
    .toBeGreaterThan(1);
  page.off("request", observeFrames);
  assert.equal(streamFrames.length, 0);
  await page.getByRole("button", { name: "停止波形", exact: true }).click();
  await stateUntil(
    page,
    (s) => !s.lab.running,
    "normal stop did not stop waveform",
  );
  assert.equal((await getState(page)).devices[0].props.intensityA, 12);
  // Actual local audio analysis: a small generated PCM WAV, never a microphone.
  const rate = 8000,
    n = rate * 4,
    wav = Buffer.alloc(44 + n * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + n * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    wav.writeInt16LE(
      Math.round(
        Math.sin((i / rate) * 440 * Math.PI * 2) *
          8000 *
          (i % (rate / 2) < rate / 5 ? 1 : 0.1),
      ),
      44 + i * 2,
    );
  await page
    .getByRole("combobox", { name: "节拍来源", exact: true })
    .selectOption("audio");
  await page.locator('input[accept="audio/*"]').setInputFiles({
    name: "test-beats.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await page.getByRole("button", { name: "开始音乐联动", exact: true }).click();
  await stateUntil(
    page,
    (s) => s.lab.mode === "stream" && s.lab.frames.some((f) => f[2] > 0),
    "audio produced no pulse",
  );
  await page.getByRole("button", { name: "停止并归零", exact: true }).click();
  await stateUntil(
    page,
    (s) => !s.lab.running && s.devices[0].props.intensityA === 0,
    "global stop did not stop music",
  );
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);
  await expect(
    page.getByRole("button", { name: "开始音乐联动", exact: true }),
  ).toBeEnabled();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto("http://127.0.0.1:8787");
  await mobile.getByText("先体验演示").click();
  await mobile.getByRole("button", { name: "接管设备", exact: true }).click();
  await choose(mobile, "触控录制");
  for (const mode of [
    "触控录制",
    "A/B 回声",
    "波形 DJ",
    "画线波形",
    "规律随机",
    "双人协作",
    "互动场景",
    "音乐联动",
  ]) {
    await choose(mobile, mode);
    assert(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `mobile overflow ${mode}`,
    );
  }
  await choose(mobile, "画线波形");
  assert(
    (await mobile.locator(".curve-editor button svg").first().boundingBox())
      .height <= 24,
  );
  await mobile.screenshot({
    path: "test-results/lab-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  for (const p of [page, mobile])
    await p.evaluate(async () => {
      const s = await fetch("/api/state").then((r) => r.json());
      await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Panel-CSRF": s.csrf },
        body: JSON.stringify({ enabled: false }),
      });
    });
  console.log(
    "Lab browser QA passed: 8 features, saved/exported/imported tracks, actual WAV analysis, independent guest permissions/revocation, 8 mobile layouts, no page errors.",
  );
} finally {
  await browser.close();
}
