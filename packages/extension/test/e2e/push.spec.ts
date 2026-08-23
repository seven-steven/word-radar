/**
 * L4 推送路径（mock 版，确认闸门版 issue #22）：采集驻留待确认批次 →
 * popup 确认 → SW 合并入词库并自动发起一轮推送（bbdc 请求全部被 mock 拦截）
 * → PushCoordinator 状态机走完 → popup 计数刷新。
 * 断言重点：确认即推送是唯一路径 + 请求形状（URL / newwordlist JSON / opcode）
 * + 最终 PushStatus 一致性。真实 bbdc.cn 登录路径永不自动化（安全边界）。
 */
import { test, expect } from "./fixtures.js";

test.beforeEach(({ mockBbdc }) => {
  mockBbdc.reset();
});

test("confirm merges the batch and pushes the whole pending pool to mocked bbdc", async ({
  extContext,
  popupUrl,
  fixtureServer,
  mockBbdc,
}) => {
  test.setTimeout(180_000); // 真实 pacing（~1s/词）× 前序测试累计的全部待推词

  // 1) 采集：fixture 页 → SW 内存中的待确认批次（不落库）。
  // 用独立词汇的 fixture 页：article.html 的词已被前序测试确认推走（pending=0）。
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/push-happy.html`);
  await article.waitForTimeout(500);
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 [1-9]\d* 个/,
    { timeout: 15_000 },
  );

  // 2) 确认推送：批次合并入词库 + 一轮推送覆盖全部待推。
  // popup 必须在前台：后台标签的 setTimeout 被节流，500ms 轮询会冻结。
  await popup.bringToFront();
  await popup.getByTestId("confirm-push").click();
  await expect(popup.getByTestId("pending")).toHaveText(/^[1-9]\d*$/, {
    timeout: 10_000,
  });
  const pending = Number(await popup.getByTestId("pending").textContent());
  expect(pending).toBeGreaterThanOrEqual(1);

  // 3) 状态机走完：phase 离开 running（mock 全成功 → completed）
  await expect(popup.getByTestId("push-status")).not.toHaveAttribute(
    "data-phase",
    "running",
    { timeout: 120_000 },
  );
  await expect(popup.getByTestId("push-status")).toHaveAttribute(
    "data-phase",
    "completed",
  );

  // 4) 请求形状：addWord POST 打到 /api/user-new-word，body 带 newwordlist JSON
  const addWords = mockBbdc.addWordRequests();
  expect(addWords.length).toBeGreaterThanOrEqual(pending);
  for (const { word } of addWords) {
    expect(word).toMatch(/^[a-z]+$/i);
  }
  // raw body 含 opcode:"1" 与 infoidx:"100"（spec §不背单词对接 要求的字段）
  const firstRaw = addWords[0]?.raw ?? "";
  expect(firstRaw).toContain("newwordlist");
  expect(firstRaw).toContain("opcode");
  expect(firstRaw).toContain("infoidx");

  // 5) 最终计数一致：本轮推送的 succeeded + existing + failed === 确认后的
  //    待推数（completed 文案「推送完成」不含 N/N，不能用状态文本反解 total）。
  const succeeded = Number(await popup.getByTestId("push-succeeded").textContent());
  const existing = Number(await popup.getByTestId("push-existing").textContent());
  const failed = Number(await popup.getByTestId("push-failed").textContent());
  expect(succeeded + existing + failed).toBe(pending);

  // 6) 待推清零（全部成功推走）
  await expect(popup.getByTestId("pending")).toHaveText("0");

  await popup.close();
  await article.close();
});

test("auth failure pauses the push and shows error state", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  // addWord 返回非 200 result_code 之外，check-login 也置失败态；
  // 这里用 HTTP 401 模拟 session 过期 → BbdcAuthError → Pause
  await extContext.route("**/api/user-new-word*", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
  });

  const article = await extContext.newPage();
  // 用独立词汇的 fixture 页：前一个测试已把 push-happy 的词全部推走。
  await article.goto(`${fixtureServer.url}/push-auth.html`);
  await article.waitForTimeout(500);
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 [1-9]\d* 个/,
    { timeout: 15_000 },
  );

  // 确认即推送（popup 前台，避免后台标签轮询节流）
  await popup.bringToFront();
  await popup.getByTestId("confirm-push").click();
  // BbdcAuthError → paused（不重试）
  await expect(popup.getByTestId("push-status")).toHaveAttribute(
    "data-phase",
    "paused",
    { timeout: 120_000 },
  );
  test.setTimeout(180_000);
  // paused 后 retry 按钮可再点（不残留在 disabled）
  await expect(popup.getByTestId("retry-push")).toBeEnabled();

  // 清理本用例的 401 路由：context 在整套 run 共享，残留的 401 会污染
  // 后续用例的 addWord（issue #23 e2e 发现的跨用例污染）
  await extContext.unroute("**/api/user-new-word*");

  await popup.close();
  await article.close();
});

test("push progress updates live in popup and badge shows x/y then ✓ (issue #23)", async ({
  extContext,
  popupUrl,
  fixtureServer,
  mockBbdc,
}) => {
  test.setTimeout(180_000);

  // 前一个 auth-failure 用例在 context 上留下的 401 路由会覆盖 mockBbdc（并发分发
  // 时会命中）：先摘掉同 pattern 的残留路由，再恢复 addWord 200，确保整轮推送
  // 不被 401 打断。
  await extContext.unroute("**/api/user-new-word*");
  await extContext.route("**/api/user-new-word*", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"result_code":200}' });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
  });

  // badge 读取：从扩展 SW 里调 chrome.action.getBadgeText。
  // 不等待 SW 事件（会阻塞整个轮询循环）：SW 列表暂空就直接抛错交给 toPass 重试。
  const badgeText = async (): Promise<string> => {
    const sw = extContext.serviceWorkers()[0];
    if (!sw) throw new Error("no service worker yet");
    return sw.evaluate(() => new Promise<string>((resolve) => {
      chrome.action.getBadgeText({}, (text: string) => resolve(text));
    }));
  };

  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/push-progress.html`);
  await article.waitForTimeout(500);
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 [1-9]\d* 个/,
    { timeout: 15_000 },
  );

  await popup.bringToFront();
  await popup.getByTestId("confirm-push").click();

  // 等目标推送轮启动（跳过 boot checkLogin 触发的空待推恢复轮 0/0）
  await expect(async () => {
    const text = await popup.getByTestId("push-status").textContent();
    const match = text?.match(/已推送 (\d+)\/(\d+)/);
    expect(match && Number(match[2]) >= 6).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  // 推送期间采样（popup 前台保证 500ms 轮询不被节流）：
  // - popup 进度文案含 已推送 x/y 且 x 递增（数字实时变化）
  // - badge 同步显示 x/y 数字进度（节奏与 popup 轮询可能差 1 个词，比形状+total）
  let firstProcessed = -1;
  let sawProcessedIncrease = false;
  let sawBadgeProgress = false;
  for (;;) {
    const text = await popup.getByTestId("push-status").textContent();
    const match = text?.match(/已推送 (\d+)\/(\d+)/);
    if (!match) break; // 推送结束（completed/paused 文案不含 x/y）
    const processed = Number(match[1]);
    const total = Number(match[2]);
    expect(total).toBeGreaterThanOrEqual(6);
    if (firstProcessed === -1) firstProcessed = processed;
    if (processed > firstProcessed) sawProcessedIncrease = true;
    const badge = await badgeText();
    const badgeMatch = badge.match(/^(\d+)\/(\d+)$/);
    if (badgeMatch && Number(badgeMatch[2]) === total && Number(badgeMatch[1]) <= processed + 1) {
      sawBadgeProgress = true;
    }
    // 进度已观测到实时变化即提前收手：把剩余词留给「关闭弹窗不中断」验证
    if (sawProcessedIncrease && sawBadgeProgress && total - processed >= 3) break;
  }
  expect(sawProcessedIncrease).toBe(true); // 数字实时变化
  expect(sawBadgeProgress).toBe(true); // badge x/y 与推送同步

  // 已推送（词库计数）随 SW 逐词 markPushed 递增
  const pushedBefore = Number(await popup.getByTestId("pushed").textContent());
  expect(pushedBefore).toBeGreaterThanOrEqual(1);

  // 关闭弹窗再重开：连上同一轮推送的当前进度（推送跑在 SW，不被打断）
  await popup.close();
  await article.waitForTimeout(1_000);
  const reopened = await extContext.newPage();
  await reopened.goto(popupUrl);
  await reopened.bringToFront();
  // 重开后 popup 处于 completed 或 running（取决于剩余词量）都算连上；
  // running → 等它走完。
  await expect(reopened.getByTestId("push-status")).not.toHaveAttribute(
    "data-phase",
    "idle",
    { timeout: 30_000 },
  );

  // 状态机走完（paused 也接受——SW 重启瞬间偶有请求逃逸 mock 拦截、真网 401，
  // 失败词按设计保留待推，走「重试待推」兜底，最多 3 轮）
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(reopened.getByTestId("push-status")).not.toHaveAttribute(
      "data-phase",
      "running",
      { timeout: 120_000 },
    );
    const pending = Number(await reopened.getByTestId("pending").textContent());
    if (pending === 0) break;
    const retry = reopened.getByTestId("retry-push");
    await expect(retry).toBeEnabled();
    await retry.click();
    await reopened.waitForTimeout(500);
  }
  expect(await badgeText()).toBe("✓");
  const pushed = Number(await reopened.getByTestId("pushed").textContent());
  const pending = Number(await reopened.getByTestId("pending").textContent());
  expect(pending).toBe(0);
  expect(pushed).toBeGreaterThanOrEqual(6);

  await reopened.close();
  await article.close();
});
