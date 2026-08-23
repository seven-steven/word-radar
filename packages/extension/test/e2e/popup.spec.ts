/**
 * L2 popup 冒烟：popup.html 在标签页打开（扩展页上下文，chrome.* 可用），
 * 四个 render 视图初始渲染 + 按钮 → SW 消息回路。
 * 覆盖 popup.ts 胶水层（CONTEXT.md「已知未覆盖」盲区）。
 */
import { writeFileSync } from "node:fs";
import { test, expect } from "./fixtures.js";

test.beforeEach(({ mockBbdc }) => {
  mockBbdc.reset();
});

test("popup renders counts and version on open", async ({ extContext, popupUrl }) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  // boot：refreshCounts 把 total/pending 从 "—" 刷成数字（词库初始为空 → 0）
  await expect(page.getByTestId("total")).toHaveText(/^\d+$/);
  await expect(page.getByTestId("pending")).toHaveText(/^\d+$/);
  await expect(page.getByTestId("version")).toContainText(/^core \d/);
  // 「自动推送」开关已彻底移除（issue #22）：无残留 UI
  await expect(page.getByTestId("auto-push")).toHaveCount(0);
  // 确认页在采集应答前隐藏
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await page.close();
});

test("check-login button round-trips through service worker", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await page.getByTestId("check-login").click();
  // mock 返回 result_code=200 → 已登录
  await expect(page.getByTestId("login-status")).toHaveAttribute(
    "data-state",
    "logged-in",
  );
  expect(
    mockBbdc.requests.some((r) => r.url.includes("/api/check-login")),
  ).toBe(true);
  await page.close();
});

test("logged-out state shows the open-bbdc button", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  mockBbdc.setCheckLoginResult(20000); // 非 200 → 未登录
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await page.getByTestId("check-login").click();
  await expect(page.getByTestId("login-status")).toHaveAttribute(
    "data-state",
    "logged-out",
  );
  await expect(page.getByTestId("open-bbdc")).toBeVisible();
  await page.close();
});

test("push status renders with numeric counters", async ({ extContext, popupUrl }) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  // 持久 context 跨测试共享状态：phase 可能是 idle（首跑）或 completed（已推过），
  // 只断言渲染形状，不断言具体 phase。
  await expect(page.getByTestId("push-status")).toHaveAttribute(
    "data-phase",
    /^(idle|completed|paused)$/,
  );
  await expect(page.getByTestId("push-succeeded")).toHaveText(/^\d+$/);
  await page.close();
});

test("CSV import goes through the confirmation gate (issue #22 review S-3)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 独有词汇，保证对持久词库是全新词
  const csvPath = "/tmp/word-radar-e2e-import.csv";
  writeFileSync(csvPath, "lemma,flags\nimportwordalpha,0\nimportwordbeta,0\n");

  const totalBefore = Number(await page.getByTestId("total").textContent());

  // 点导入 → 文件选择器 → 确认页展示「导入」措辞的批次预览
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("import-csv").click(),
  ]);
  await chooser.setFiles(csvPath);
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计导入 2 个单词，其中新词 2 个/,
    { timeout: 10_000 },
  );
  // 确认前不落库
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore));

  // 确认 → 合并入词库 → 计数刷新；批次清空后确认页隐藏
  await page.getByTestId("confirm-push").click();
  await expect
    .poll(async () => Number(await page.getByTestId("total").textContent()))
    .toBe(totalBefore + 2);
  await expect(page.getByTestId("confirm-section")).toBeHidden();

  // 取消路径：再导入一次然后取消，词库不变
  const [chooser2] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("import-csv").click(),
  ]);
  await chooser2.setFiles(csvPath);
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计导入 2 个单词，其中新词 0 个/, // 词已在库
    { timeout: 10_000 },
  );
  await page.getByTestId("cancel-collect").click();
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore + 2));
  await page.close();
});
