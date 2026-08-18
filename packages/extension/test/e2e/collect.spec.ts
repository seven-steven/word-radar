/**
 * L3 content script 全链路：本地 fixture 页注入 → 采集 → 入词库（真实 IndexedDB）
 * → popup counts 变化。零外网（bbdc / langeasy 已被 worker 层 mock 拦截）。
 *
 * 注意：popup 打开时会自动对活动标签页触发一次采集，所以「先开 fixture 页、
 * 再开 popup」本身就走完整链路；再点一次「重新采集」按钮覆盖手动路径。
 */
import { test, expect } from "./fixtures.js";

test.beforeEach(({ mockBbdc }) => {
  mockBbdc.reset();
});

test("collects rare words from a fixture page into the vocabulary", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/article.html`);
  // content script 按 document_idle 注入；给一点余量
  await article.waitForTimeout(500);

  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  // popup 以标签页模拟时，popup 自己就是「活动标签」→ boot 自动采集会打到
  // 无 content script 的 popup 页（显示「未注入」）。把文章页带回前台后
  // 手动点「重新采集」，采集目标落到文章页。
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  // status 显示「本次采集 N 词」，N ≥ 1
  await expect(popup.getByTestId("status")).toHaveText(/本次采集 \d+ 词/, {
    timeout: 15_000,
  });
  // 计数刷新（expect 自带重试，避免和 popup 内异步 refreshCounts 竞态）：
  // total 与 pending 至少有采集到的词数
  await expect(popup.getByTestId("total")).toHaveText(/[1-9]\d*/, {
    timeout: 10_000,
  });
  await expect(popup.getByTestId("pending")).toHaveText(/^[1-9]\d*$/, {
    timeout: 10_000,
  });

  // 手动路径：再走一遍（幂等：词形还原后同词不重复计数）
  const totalBefore = Number(await popup.getByTestId("total").textContent());
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("status")).toHaveText(/本次采集 \d+ 词/, {
    timeout: 15_000,
  });
  await expect(popup.getByTestId("total")).toHaveText(String(totalBefore), {
    timeout: 10_000,
  }); // 同一页重复采集不改变累计

  await popup.close();
  await article.close();
});
