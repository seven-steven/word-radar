/**
 * raw.githubusercontent.com 等价场景:
 * 1. 正文整体在 <pre> 的 fixture 页 → popup 采集计数 ≥ 1(pre 回退修复的 e2e 锁)
 * 2. 活动页无 content script(扩展自身页面)→ popup 显示「content script 未注入」
 *    (用户截图症状的机制复现:tab 在扩展(重)加载前打开 / 不可注入页)
 */
import { test, expect } from "./fixtures.js";

test.beforeEach(({ mockBbdc }) => {
  mockBbdc.reset();
});

test("collects words from a raw-like pre-only page", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  const raw = await extContext.newPage();
  await raw.goto(`${fixtureServer.url}/raw-pre.html`);
  await raw.waitForTimeout(500);

  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  // popup 标签页自身是「活动标签」→ 把 raw 页带回前台再手动采集
  await raw.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("status")).toHaveText(/本次采集 \d+ 词/, {
    timeout: 15_000,
  });
  await popup.close();
  await raw.close();
});

test("shows 未注入 error when active tab has no content script", async ({
  extContext,
  popupUrl,
}) => {
  // popup 自身作为活动页:chrome-extension:// 页面无 content script,
  // sendMessage 必然 throw → 与用户截图完全相同的错误文案路径。
  // 注意 workers=1 + 持久 context:先开这个"活动页",再开真 popup,
  // 真 popup 的 boot 采集应落到此页面上。真实活动标签取 currentWindow,
  // 所以这里需要让无脚本页成为活动页 —— 用 bringToFront 保证。
  const noScriptPage = await extContext.newPage();
  await noScriptPage.goto(popupUrl);
  await noScriptPage.bringToFront();

  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await expect(popup.getByTestId("status")).toHaveText(
    /此页面无法采集（content script 未注入）/,
    { timeout: 15_000 },
  );
  await popup.close();
  await noScriptPage.close();
});
