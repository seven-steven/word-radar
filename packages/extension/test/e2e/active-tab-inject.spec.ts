/**
 * issue #14（activeTab 瘦身）锁：manifest 已无 declarative content script，
 * 扩展加载后新开的普通网页标签**不刷新**也必须能采集 —— executeScript 注入
 * 是主路径，popup 打开即视为用户手势（activeTab 授权）。
 *
 * i18n（issue #28）：测试 Chromium 在 fixtures.ts 钉死 zh-CN locale，断言中文渲染
 */
import { test, expect, waitCountsLoaded } from "./fixtures.js";

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

  // i18n（issue #28）：zh-CN 确认摘要
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 15_000 },
  );
  // 确认 → 入库 → 计数刷新
  await popup.getByTestId("confirm-push").click();
  await expect(popup.getByTestId("total")).toHaveText(/[1-9]\d*/, {
    timeout: 10_000,
  });

  // 再点一次（重复注入路径）：幂等守卫生效，累计不重复计数
  await waitCountsLoaded(popup); // 基线读取前置：等 total 脱骨架（骨架屏契约）
  const totalBefore = Number(await popup.getByTestId("total").textContent());
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  // i18n（issue #28）：重复注入幂等 → 新词 0
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 0 个/,
    { timeout: 15_000 },
  );
  await popup.getByTestId("confirm-push").click();
  await expect(popup.getByTestId("total")).toHaveText(String(totalBefore), {
    timeout: 10_000,
  });

  await popup.close();
  await article.close();
});
