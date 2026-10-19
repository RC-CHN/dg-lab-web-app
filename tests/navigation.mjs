import { expect } from "@playwright/test";
const categories = {
  通道控制: "直接控制",
  触控与开火: "直接控制",
  波形工作室: "制作波形",
  场景组合: "制作波形",
  触控录制: "制作波形",
  画线波形: "制作波形",
  规律随机: "制作波形",
  "A/B 回声": "制作波形",
  音乐联动: "互动玩法",
  "波形 DJ": "互动玩法",
  多人协作: "互动玩法",
  互动场景: "互动玩法",
};
export async function chooseFeature(page, name) {
  const group = categories[name] || "操作记录";
  await page
    .getByRole("navigation", { name: "主导航", exact: true })
    .getByRole("button", { name: group, exact: true })
    .click();
  if (categories[name])
    await page
      .getByRole("navigation", { name: "功能选择", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
  await expect(
    page.getByRole("heading", { name, exact: true }).first(),
  ).toBeVisible();
}
