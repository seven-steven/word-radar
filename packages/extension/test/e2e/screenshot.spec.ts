/**
 * 商店截图生成（issue #19）：仅在 `pnpm screenshot`（E2E_SCREENSHOT_DIR 注入）
 * 时运行；`pnpm e2e` 常规 run 直接 skip。
 *
 * 复用 e2e 基座（persistent context + 真实扩展 + mockBbdc / fixtureServer），
 * 产出 3 张 1280×800 真实 UI 场景：
 *   01-reading.png  英文阅读页（采集目标）
 *   02-collect.png  popup 确认页：本次采集总数 + 新词数 + 已登录
 *   03-push.png     popup 推送完成：成功/已存在/失败计数 + phase completed
 *
 * 尺寸硬校验不在本 spec —— run-screenshots.mjs 生成后读 PNG IHDR 逐张断言。
 * 截图一律整 viewport（launchPersistentContext 未设 deviceScaleFactor →
 * 默认 1，viewport 像素 == 文件像素 == 1280×800）。
 */
import { join } from "node:path";
import { test, expect } from "./fixtures.js";

const OUT_DIR = process.env.E2E_SCREENSHOT_DIR;
const shots = (name: string) => join(OUT_DIR, name);

test.skip(!OUT_DIR, "store screenshot generation only — run via `pnpm screenshot`");

test.setTimeout(240_000); // 真实推送 pacing（~1s/词）

/** popup 以标签页打开时只是 240px 小部件 —— 居中卡片化呈现（纯展示样式，UI 本体不动）。 */
const POPUP_STAGE_STYLE = `
  html, body { height: 100%; }
  body {
    min-width: 0;
    display: grid;
    place-items: center;
    background: linear-gradient(160deg, #eef2f7 0%, #dfe6ee 100%);
    font-family: system-ui, sans-serif;
  }
  main {
    background: #fff;
    padding: 28px 32px;
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.16);
  }
`;

test("generates 1280x800 store screenshots of real extension UI", async ({
  extContext,
  popupUrl,
  fixtureServer,
  mockBbdc,
}) => {
  mockBbdc.reset();

  // ── 场景 1：英文阅读页（采集目标）──────────────────────────────
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/store-reading.html`);
  await article.waitForTimeout(500); // 等 content script 按 document_idle 注入
  await article.screenshot({ path: shots("01-reading.png") });
  await article.close();

  // ── 场景 2：popup 确认页（待确认批次：总数 + 新词） ────────────
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await popup.addStyleTag({ content: POPUP_STAGE_STYLE });
  // popup 标签页自身是「活动标签」→ 把文章页带回前台再手动采集（e2e 基座同款手法）
  // 重新开一页：场景 1 的页面已关，且换一页可确保采集链路走完整注入
  const article2 = await extContext.newPage();
  await article2.goto(`${fixtureServer.url}/store-reading.html`);
  await article2.waitForTimeout(500);
  await article2.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 15_000 },
  );
  // 登录态（mock check-login → 已登录）
  await popup.getByTestId("check-login").click();
  await expect(popup.getByTestId("login-status")).toHaveAttribute("data-state", "logged-in");
  // popup 必须前台：截图的是它，且后台标签的渲染轮询会被节流
  await popup.bringToFront();
  await popup.screenshot({ path: shots("02-collect.png") });

  // ── 场景 3：popup 推送完成 ─────────────────────────────────────
  await expect(popup.getByTestId("pending")).toHaveText(/^[1-9]\d*$/, { timeout: 10_000 });
  const pending = Number(await popup.getByTestId("pending").textContent());
  expect(pending).toBeGreaterThanOrEqual(1);
  // 确认即推送：批次入库 + 一轮推送（mock 全成功）
  await popup.getByTestId("confirm-push").click();
  await expect(popup.getByTestId("push-status")).toHaveAttribute(
    "data-phase",
    "completed",
    { timeout: 180_000 },
  );
  await expect(popup.getByTestId("pending")).toHaveText("0");
  await popup.screenshot({ path: shots("03-push.png") });

  await popup.close();
  await article2.close();
});
