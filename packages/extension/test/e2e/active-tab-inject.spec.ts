/**
 * issue #14（activeTab 瘦身）锁：manifest 已无 declarative content script，
 * 扩展加载后新开的普通网页标签**不刷新**也必须能采集 —— executeScript 注入
 * 是主路径，popup 打开即视为用户手势（activeTab 授权）。
 *
 * i18n（issue #30）：e2e 使用 en-US locale，动态文案已本地化为英文
 */
import { test, expect } from "./fixtures.js";

test.beforeEach(({ mockBbdc }) => {
  mockBbdc.reset();
});

test("collects into a fresh tab with no declarative injection and no reload", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  // 扩展已加载（worker fixture）；这里才开普通网页标签 → 无 declarative 注入
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/article.html`);

  // 不刷新、不等 document_idle —— 直接开 popup 采集
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await article.bringToFront();
  await popup.getByTestId("collect").click();

  // i18n（issue #30）：e2e 使用 en-US locale，动态文案已本地化为英文
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /Collected \d+ words via Collect \(\d+ new\)/,
    { timeout: 15_000 },
  );
  // 确认 → 入库 → 计数刷新
  await popup.getByTestId("confirm-push").click();
  await expect(popup.getByTestId("total")).toHaveText(/[1-9]\d*/, {
    timeout: 10_000,
  });

  // 再点一次（重复注入路径）：幂等守卫生效，累计不重复计数
  const totalBefore = Number(await popup.getByTestId("total").textContent());
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  // i18n（issue #30）：e2e 使用 en-US locale，动态文案已本地化为英文
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /Collected \d+ words via Collect \(0 new\)/,
    { timeout: 15_000 },
  );
  await popup.getByTestId("confirm-push").click();
  await expect(popup.getByTestId("total")).toHaveText(String(totalBefore), {
    timeout: 10_000,
  });

  await popup.close();
  await article.close();
});
