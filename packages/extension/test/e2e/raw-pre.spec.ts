/**
 * raw.githubusercontent.com 等价场景:
 * 1. 正文整体在 <pre> 的 fixture 页 → popup 采集计数 ≥ 1(pre 回退修复的 e2e 锁)
 * 2. 活动页为扩展自身页面(不可注入)→ popup 显示「此页面无法采集」
 *    (不可注入页的机制复现:chrome:// / chrome-extension:// 等页面)
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
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /Collected \d+ words via Collect \(\d+ new\)/,
    { timeout: 15_000 },
  );
  await popup.close();
  await raw.close();
});

test("shows 不可注入 error when active tab is an extension page", async ({
  extContext,
  popupUrl,
}) => {
  // popup 自身作为活动页:chrome-extension:// 页面不可注入(executeScript 无
  // 对应 host 权限,activeTab 也不覆盖扩展自身页面)→ 注入 reject,归一为
  // 「此页面无法采集」文案(issue #14 后注入是主路径,失败即整体失败)。
  const noScriptPage = await extContext.newPage();
  await noScriptPage.goto(popupUrl);
  await noScriptPage.bringToFront();

  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await expect(popup.getByTestId("status")).toHaveText(
    /Cannot collect from this page: chrome:\/\/ and other special pages do not support injection/s,
    { timeout: 15_000 },
  );
  await popup.close();
  await noScriptPage.close();
});
