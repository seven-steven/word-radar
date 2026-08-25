/**
 * L3 content script 全链路（确认闸门版，issue #22）：本地 fixture 页注入 →
 * 采集 → SW 驻留待确认批次（不落库）→ popup 确认页展示总数/新词 → 确认后
 * 入词库（真实 IndexedDB）→ popup counts 变化。零外网（bbdc / langeasy 已被
 * worker 层 mock 拦截）。
 *
 * 注意：popup 打开时会自动对活动标签页触发一次采集，所以「先开 fixture 页、
 * 再开 popup」本身就走完整链路；再点一次「重新采集」按钮覆盖手动路径。
 *
 * i18n（issue #30）：e2e 使用 en-US locale，动态文案已本地化为英文
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
  // 独有词汇的 fixture 页：保证对当前持久词库而言是全新词（前序 spec 不用本页）
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/confirm-gate.html`);
  // content script 按 document_idle 注入；给一点余量
  await article.waitForTimeout(500);

  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  // popup 以标签页模拟时，popup 自己就是「活动标签」→ boot 自动采集会打到
  // 无 content script 的 popup 页（显示「未注入」）。把文章页带回前台后
  // 手动点「重新采集」，采集目标落到文章页。
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  // i18n（issue #30）：e2e 使用 en-US locale，动态文案已本地化为英文
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /Collected \d+ words via Collect \([1-9]\d* new\)/,
    { timeout: 15_000 },
  );
  // 确认前批次只在内存：词库计数不变
  const totalBefore = Number(await popup.getByTestId("total").textContent());
  await expect(popup.getByTestId("total")).toHaveText(String(totalBefore));

  // 确认 → 合并入词库 → 计数刷新
  await popup.getByTestId("confirm-push").click();
  await expect
    .poll(async () => Number(await popup.getByTestId("total").textContent()))
    .toBeGreaterThan(totalBefore);

  // 手动路径：同一页再采集一次（幂等：词形还原后同词不重复计数）→ 新词 0
  const totalAfterConfirm = Number(await popup.getByTestId("total").textContent());
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  // i18n（issue #30）：e2e 使用 en-US locale，动态文案已本地化为英文
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /Collected \d+ words via Collect \(0 new\)/,
    { timeout: 15_000 },
  );
  await popup.getByTestId("confirm-push").click();
  await expect(popup.getByTestId("total")).toHaveText(String(totalAfterConfirm), {
    timeout: 10_000,
  }); // 同一页重复采集确认不改变累计

  await popup.close();
  await article.close();
});

test("cancel discards the pending batch: counts unchanged, nothing merged", async ({
  extContext,
  popupUrl,
  fixtureServer,
  mockBbdc,
}) => {
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/push-happy.html`);
  await article.waitForTimeout(500);

  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  // 前序 spec 确认触发的推送可能仍在后台跑：等它停下来再取基线，
  // 否则 pending 会被并发推送改写造成假失败。
  await expect(popup.getByTestId("push-status")).not.toHaveAttribute(
    "data-phase",
    "running",
    { timeout: 120_000 },
  );
  // 等一次稳定计数（boot 自动采集可能打到 popup 自身，计数即词库现状）
  await expect(popup.getByTestId("total")).toHaveText(/^\d+$/);
  const totalBefore = Number(await popup.getByTestId("total").textContent());
  const pendingBefore = Number(await popup.getByTestId("pending").textContent());

  // 取消路径零新增网络请求：以上一次推送停下后的请求量为基线
  const addWordBaseline = mockBbdc.requests.filter((r) =>
    r.url.includes("user-new-word"),
  ).length;

  await article.bringToFront();
  await popup.getByTestId("collect").click();
  // i18n（issue #30）：e2e 使用 en-US locale，动态文案已本地化为英文
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /Collected [1-9]\d* words via Collect \(\d+ new\)/,
    { timeout: 15_000 },
  );

  // 取消 → 词库、推送状态均无变化，确认页收起
  await popup.getByTestId("cancel-collect").click();
  await expect(popup.getByTestId("confirm-section")).toBeHidden();
  await expect(popup.getByTestId("total")).toHaveText(String(totalBefore));
  await expect(popup.getByTestId("pending")).toHaveText(String(pendingBefore));
  // 取消不触发任何推送动作（确认页本就零网络；取消后也不应有新 addWord）
  expect(
    mockBbdc.requests.filter((r) => r.url.includes("user-new-word")).length,
  ).toBe(addWordBaseline);

  await popup.close();
  await article.close();
});
