/**
 * L4 推送路径（mock 版，确认闸门版 issue #22）：采集驻留待确认批次 →
 * popup 确认 → SW 合并入词库并自动发起一轮推送（bbdc 请求全部被 mock 拦截）
 * → PushCoordinator 状态机走完 → popup 计数刷新。
 * 断言重点：确认即推送是唯一路径 + 请求形状（URL / newwordlist JSON / opcode）
 * + 最终 PushStatus 一致性。真实 bbdc.cn 登录路径永不自动化（安全边界）。
 */
import { writeFileSync } from "node:fs";
import { test, expect, waitCountsLoaded } from "./fixtures.js";

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
  await waitCountsLoaded(popup, "pending"); // 基线读取前置（骨架屏契约）
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
  // pending 是推送进行中的瞬时读数（每词 markPushed 后递减），可能比
  // 批次全量少 1——只要本轮处理的词数 ≥ 读到的待推数即覆盖全池；
  // 全池清零由下一条「待推清零」断言兜底。
  expect(succeeded + existing + failed).toBeGreaterThanOrEqual(pending);

  // 6) 待推清零（全部成功推走）
  await expect(popup.getByTestId("pending")).toHaveText("0");

  // 7) 全部成功 + 词库待推清零 → Retry 收起：判定源是词库待推池（Retry 的
  //    动作语义），池空即无可重试（用户报「Push completed 0 失败 0 待推」仍
  //    渲染按钮 + 撑出滚动条）。注意不能用 PushStatus.total——它是本轮快照，
  //    看不到池里失败保留的词（badge 用例的兜底重试靠「池>0 → 显示」）
  await expect(popup.getByTestId("retry-push")).toBeHidden();

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

  // 等目标推送轮启动（boot checkLogin 对非空待推池起的恢复轮即目标轮；
  // 空池零词轮已由 issue #36 修复消除，不再产生 0/0 干扰）
  // i18n（issue #28）：zh-CN pushRunning 文案「推送中 已推送 $1/$2 · 待推 $3」
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
    await waitCountsLoaded(reopened, "pending"); // 骨架期 Number("")=0 会假性 break
    const pending = Number(await reopened.getByTestId("pending").textContent());
    if (pending === 0) break;
    const retry = reopened.getByTestId("retry-push");
    await expect(retry).toBeEnabled();
    await retry.click();
    await reopened.waitForTimeout(500);
  }
  expect(await badgeText()).toBe("✓");
  await waitCountsLoaded(reopened, "pushed"); // 基线读取前置：等脱骨架（同帧覆盖 pending）
  const pushed = Number(await reopened.getByTestId("pushed").textContent());
  const pending = Number(await reopened.getByTestId("pending").textContent());
  expect(pending).toBe(0);
  expect(pushed).toBeGreaterThanOrEqual(6);

  await reopened.close();
  await article.close();
});

/**
 * 空轮收起 Retry + popup 无溢出（用户报告）：确认一批「0 新词」批次（全在库）
 * → 确认即推送触发的「推送全部待推」拿到空池 → completed total=0 的空轮。
 * 此时空轮无可推无失败可重试，Retry 必须收起；且这行收起后 popup 内容须收进
 * 视口不出现滚动条（用户报「Push completed Failed 0 & pending 0」时 Retry 仍
 * 渲染 + popup 右侧出滚动条——空轮按钮那一行正是撑出滚动条的增量）。
 */
test("completed EMPTY round collapses retry-push and keeps popup scroll-free", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 独有词（持久词库）两段式：先导入确认一遍（2 新词入池 + 一轮真实推送），
  // 再导入同一 CSV 确认（新词 0 → 空轮）。上一用例 afterEach 已排空待推池。
  const csvPath = "/tmp/word-radar-e2e-empty-round.csv";
  writeFileSync(csvPath, "lemma,flags\nemptyroundgamma,0\nemptyrounddelta,0\n");

  const importOnce = async (): Promise<void> => {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByTestId("import-csv").click(),
    ]);
    await chooser.setFiles(csvPath);
    await page.getByTestId("confirm-push").click();
  };

  // 工具抽屉默认收起（issue #35 重做）：导入按钮在抽屉内，先展开
  await page.getByTestId("tools-toggle").click();

  // 第一段：2 新词入池 → 确认即推送（total=2 非空轮），等它走完。
  // 终态锚用「成功 2」而非 not-running：反向断言立即评估，confirm 后 popup
  // 短暂仍显示旧 completed 态时会瞬间通过，第二段与第一轮并行发起，
  // start() 去重（BUSY）会吞掉第二段的空轮，succeeded 永不重置（#36 e2e
  // 取证实锤的竞态）。2 词 mock 全走 addWord → 成功 2 是确定锚。
  await importOnce();
  await expect(page.getByTestId("push-succeeded")).toHaveText("2", {
    timeout: 120_000,
  });

  // 第二段：同批再确认（新词 0）→ 触发空轮；succeeded 从第一轮的 2 重置为 0
  // 是两轮的区分锚（data-phase 在两次确认前后同为 completed，不能单独作锚）
  await importOnce();
  await expect(page.getByTestId("push-status")).toHaveAttribute(
    "data-phase",
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("push-succeeded")).toHaveText("0");

  // 空轮：Retry 收起（无意义入口）+ popup 内容收进视口（不出滚动条）
  await expect(page.getByTestId("retry-push")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= window.innerHeight,
    ),
  ).toBe(true);

  await page.close();
});
