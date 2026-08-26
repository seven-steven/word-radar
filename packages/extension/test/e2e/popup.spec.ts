/**
 * L2 popup 冒烟：popup.html 在标签页打开（扩展页上下文，chrome.* 可用），
 * 四个 render 视图初始渲染 + 按钮 → SW 消息回路。
 * 覆盖 popup.ts 胶水层（CONTEXT.md「已知未覆盖」盲区）。
 *
 * i18n 国际化（issue #28）：测试 Chromium 在 fixtures.ts 钉死 zh-CN locale，
 * 断言按中文渲染（也持续验证「中文环境显示中文」这一 issue #28 的主诉）。
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

  // i18n（issue #28）：zh-CN locale 下静态文本为中文
  await expect(page.getByTestId("collect")).toHaveText("重新采集");

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

  // i18n（issue #28）：zh-CN 按钮文案
  await expect(page.getByTestId("check-login")).toHaveText("检查登录");

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

  // i18n（issue #28）：zh-CN 按钮文案
  await expect(page.getByTestId("open-bbdc")).toHaveText("打开不背单词");

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

  // i18n（issue #28）：zh-CN 按钮文案
  await expect(page.getByTestId("retry-push")).toHaveText("重试待推");

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

  // i18n（issue #28）：zh-CN 确认摘要，来源措辞「导入」
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计导入 \d+ 个单词，其中新词 \d+ 个/,
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
  // i18n（issue #28）：zh-CN 确认摘要，词已在库 → 新词 0
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计导入 \d+ 个单词，其中新词 0 个/, // 词已在库
    { timeout: 10_000 },
  );
  await page.getByTestId("cancel-collect").click();
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore + 2));

  // 排空本用例确认触发的推送（issue #27）：确认入库的词进入待推池，若不等
  // 推送跑完就关页，下一个用例的 popup boot（check-login 恢复路径）会替本
  // 用例发起推送 —— 污染后续「确认前零网络」断言（失败点漂移的放大器）。
  for (let round = 0; round < 15; round += 1) {
    const pending = Number(await page.getByTestId("pending").textContent());
    const phase = await page.getByTestId("push-status").getAttribute("data-phase");
    if (pending === 0 && phase !== "running") break;
    if (pending > 0 && phase !== "running") {
      await page.getByTestId("retry-push").click();
    }
    await page.waitForTimeout(3_000);
  }
  await expect(page.getByTestId("pending")).toHaveText(/^0$/);
  await expect(page.getByTestId("push-status")).not.toHaveAttribute("data-phase", "running");
  await page.close();
});

test("upload-file target walks collect → confirm → push with .txt text (issue #24)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 独有词汇，保证对持久词库是全新词
  const txtPath = "/tmp/word-radar-e2e-upload.txt";
  writeFileSync(txtPath, "The curious astronomer photographed a luminous nebula.\n");

  const totalBefore = Number(await page.getByTestId("total").textContent());
  mockBbdc.reset();

  // 点「上传文件」→ 文件选择器 → 确认页展示「上传采集」措辞的批次预览
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-file").click(),
  ]);
  await chooser.setFiles(txtPath);
  // i18n（issue #28）：zh-CN 确认摘要，来源措辞「上传采集」
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );
  // 确认前：不落库、零网络请求（上传路径确认前无任何 bbdc/langeasy 请求）
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore));
  expect(mockBbdc.requests).toHaveLength(0);

  // 确认 → 合并入词库 → 计数刷新 → 推送启动（走确认即推送的唯一路径）
  await page.getByTestId("confirm-push").click();
  await expect
    .poll(async () => Number(await page.getByTestId("total").textContent()))
    .toBeGreaterThan(totalBefore);
  // 推送触达 bbdc 加词接口（mock 全 200 → 逐词成功）
  await expect
    .poll(() => mockBbdc.addWordRequests().length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  // 等本轮推送跑完再收尾：持久 context 共享推送循环，把进行中的推送
  // 泄漏给后续用例会让 push.spec 的 pending 计数与请求记录错位
  await expect
    .poll(
      async () => page.getByTestId("push-status").getAttribute("data-phase"),
      { timeout: 30_000 },
    )
    .toMatch(/idle|completed|paused/);
  // 排空待推池：确认触发的一轮推送以 listPending 快照为准，并发中的批次
  // 可能不在快照内（由下一次 check-login 恢复路径兜底）。这里手动 drain，
  // 避免把进行中的待推泄漏给 push.spec（持久 context 共享推送循环）。
  for (let round = 0; round < 15; round++) {
    await page.reload();
    await page.waitForTimeout(3_000);
    const pending = Number(await page.getByTestId("pending").textContent());
    const phase = await page.getByTestId("push-status").getAttribute("data-phase");
    if (pending === 0 && phase !== "running") break;
    if (pending > 0 && phase !== "running") {
      await page.getByTestId("retry-push").click();
    }
    await page.waitForTimeout(3_000);
  }
  await expect(page.getByTestId("pending")).toHaveText(/^0$/);
  await expect(page.getByTestId("push-status")).not.toHaveAttribute("data-phase", "running");
  await page.close();
});

test("upload-file target accepts .csv as plain text via NL pipeline, not IMPORT_CSV (issue #24)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 验收修订（用户决策）：上传入口的 .csv 走自然语言提词（extractWordEntries），
  // 不做 IMPORT_CSV 的 lemma,flags 结构化解析——确认页措辞是「上传采集」
  const csvPath = "/tmp/word-radar-e2e-upload-nl.csv";
  writeFileSync(csvPath, "name,count\nglimmer,3\n");
  mockBbdc.reset();

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-file").click(),
  ]);
  await chooser.setFiles(csvPath);
  // i18n（issue #28）：zh-CN 确认摘要，来源措辞「上传采集」（NL 提词管线）
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );
  // 确认前零网络（popup 打开本身的 check-login 恢复路径除外；不上传、不推送）
  expect(
    mockBbdc.requests.filter((r) => !r.url.includes("check-login")),
  ).toHaveLength(0);
  await expect(page.getByTestId("confirm-section")).toBeVisible();
  await page.close();
});

test("upload-file target rejects non plain-text (e.g. .png) file with zero writes (issue #24)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 验收修订：.csv 已是合法纯文本目标（走自然语言提词），改用 .png 做拒绝用例
  const pngPath = "/tmp/word-radar-e2e-upload-reject.png";
  writeFileSync(pngPath, "lemma,flags\nnotafiletarget,0\n");
  const totalBefore = Number(await page.getByTestId("total").textContent());

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-file").click(),
  ]);
  await chooser.setFiles(pngPath);
  // i18n（issue #28）：zh-CN 的纯文本拒绝文案
  await expect(page.getByTestId("sync-status")).toHaveText(
    /仅支持纯文本文件/,
    { timeout: 10_000 },
  );
  // 零写入 + 不出现确认页；网络零增量（上一用例的推送循环可能仍在后台
  // 逐词进行——持久 context 共享，只断言本文件的词从未触达任何接口）
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore));
  expect(
    mockBbdc.requests.filter((r) => r.url.includes("notafiletarget")),
  ).toHaveLength(0);
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await page.close();
});

test("export-log exports storage.local error ring buffer as text (issue #25)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 种子：直接写 storage.local（扩展页上下文 chrome.* 可用）
  await page.evaluate(async () => {
    await chrome.storage.local.set({
      errorLog: [{ time: 1750000000000, stage: "push", word: "run", summary: "网络错误" }],
    });
  });

  await page.getByTestId("export-log").click();
  // i18n（issue #28）：zh-CN 动态文案「已导出 N 条错误日志」
  await expect(page.getByTestId("sync-status")).toHaveText(/已导出 \d+ 条错误日志/);

  // 清空后再导出：提示暂无
  await page.evaluate(async () => {
    await chrome.storage.local.remove("errorLog");
  });
  await page.getByTestId("export-log").click();
  // i18n（issue #28）：zh-CN「暂无错误日志」
  await expect(page.getByTestId("sync-status")).toHaveText(/暂无错误日志/);
  await page.close();
});
