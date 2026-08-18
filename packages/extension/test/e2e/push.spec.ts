/**
 * L4 推送路径（mock 版）：采集入词库 → retry-push → SW 发起 bbdc 请求（全部被
 * mock 拦截）→ PushCoordinator 状态机走完 → popup 计数刷新。
 * 断言重点：请求形状（URL / newwordlist JSON / opcode）+ 最终 PushStatus 一致性。
 * 真实 bbdc.cn 登录路径永不自动化（安全边界）。
 */
import { test, expect } from "./fixtures.js";

test.beforeEach(({ mockBbdc }) => {
  mockBbdc.reset();
});

test("push pipeline pushes collected words to mocked bbdc and completes", async ({
  extContext,
  popupUrl,
  fixtureServer,
  mockBbdc,
}) => {
  test.setTimeout(180_000); // 真实 pacing（~1s/词）× 前序测试累计的全部待推词

  // 1) 采集：fixture 页 → 词库。
  // 先关 autoPush（默认开 — collect 后 SW 立即自动推送，会和手动 retry-push 竞态）；
  // 持久化在 chrome.storage，对本 run 后续测试同样生效。
  // 用独立词汇的 fixture 页：article.html 的词已被前序测试自动推走（pending=0）。
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/push-happy.html`);
  await article.waitForTimeout(500);
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  const autoPush = popup.getByTestId("auto-push");
  if (await autoPush.isChecked()) await autoPush.click();
  // popup 标签页自身是「活动标签」→ 把文章页带回前台再手动采集
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("status")).toHaveText(/本次采集 \d+ 词/, {
    timeout: 15_000,
  });
  await expect(popup.getByTestId("pending")).toHaveText(/^[1-9]\d*$/, {
    timeout: 10_000,
  });
  const pending = Number(await popup.getByTestId("pending").textContent());
  expect(pending).toBeGreaterThanOrEqual(1);

  // 2) 手动触发推送（不依赖 autoPush 设置）。
  // popup 必须在前台：后台标签的 setTimeout 被节流，500ms 轮询会冻结。
  await popup.bringToFront();
  await popup.getByTestId("retry-push").click();

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

  // 5) 最终计数一致：succeeded + existing + failed === total（词级不丢不重）
  const succeeded = Number(await popup.getByTestId("push-succeeded").textContent());
  const existing = Number(await popup.getByTestId("push-existing").textContent());
  const failed = Number(await popup.getByTestId("push-failed").textContent());
  const statusText = (await popup.getByTestId("push-status").textContent()) ?? "";
  const totalInStatus = Number(/(\d+)\/(\d+)/.exec(statusText)?.[2] ?? "0");
  expect(succeeded + existing + failed).toBe(totalInStatus);

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
  const autoPush = popup.getByTestId("auto-push");
  if (await autoPush.isChecked()) await autoPush.click();
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("status")).toHaveText(/本次采集 \d+ 词/, {
    timeout: 15_000,
  });

  // popup 前台（避免后台标签轮询节流）
  await popup.bringToFront();
  await popup.getByTestId("retry-push").click();
  // BbdcAuthError → paused（不重试）
  await expect(popup.getByTestId("push-status")).toHaveAttribute(
    "data-phase",
    "paused",
    { timeout: 120_000 },
  );
  test.setTimeout(180_000);
  // paused 后 retry 按钮可再点（不残留在 disabled）
  await expect(popup.getByTestId("retry-push")).toBeEnabled();

  await popup.close();
  await article.close();
});
