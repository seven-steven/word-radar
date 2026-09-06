/**
 * L2 popup 冒烟：popup.html 在标签页打开（扩展页上下文，chrome.* 可用），
 * 四个 render 视图初始渲染 + 按钮 → SW 消息回路。
 * 覆盖 popup.ts 胶水层（CONTEXT.md「已知未覆盖」盲区）。
 *
 * i18n 国际化（issue #28）：测试 Chromium 在 fixtures.ts 钉死 zh-CN locale，
 * 断言按中文渲染（也持续验证「中文环境显示中文」这一 issue #28 的主诉）。
 */
import { writeFileSync } from "node:fs";
import { test, expect, drainPendingPool, waitCountsLoaded } from "./fixtures.js";

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
  // 采集入口显式化（issue #39 v1.1-T2）：打开 popup 呈默认态——不自动采集，
  // 状态行是待机引导（而非「采集中…」/「此页面无法采集」），无批次驻留。
  // 若回归出 boot 自动采集，状态行会先变「采集中…」再变注入错误，回不到
  // 待机文案 → 本断言失败。
  await expect(page.getByTestId("status")).toHaveText(
    /就绪。点「采集当前页」或用下方画布上传文件/,
  );
  await expect(page.getByTestId("confirm-section")).toBeHidden();

  // i18n（issue #28）：zh-CN locale 下静态文本为中文
  await expect(page.getByTestId("collect")).toHaveText("采集当前页");

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

  await waitCountsLoaded(page); // 基线读取前置：等 total 脱骨架（骨架屏契约）
  const totalBefore = Number(await page.getByTestId("total").textContent());

  // 工具抽屉默认收起（issue #35 重做）：先展开抽屉再操作面板内按钮（交互适配）
  await page.getByTestId("tools-toggle").click();

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

  // 排空本用例确认触发的推送（issue #27）：持久 context 共享推送循环，
  // 泄漏给下个用例会污染「确认前零网络」断言（drainPendingPool 注释详述）
  await drainPendingPool(page);
  await page.close();
});

test("upload-canvas walks collect → confirm → push with .txt text (issue #24)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 独有词汇，保证对持久词库是全新词
  const txtPath = "/tmp/word-radar-e2e-upload.txt";
  writeFileSync(txtPath, "The curious astronomer photographed a luminous nebula.\n");

  await waitCountsLoaded(page); // 基线读取前置：等 total 脱骨架（骨架屏契约）
  const totalBefore = Number(await page.getByTestId("total").textContent());
  mockBbdc.reset();

  // 点上传画布→ 文件选择器 → 确认页展示「上传采集」措辞的批次预览
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-canvas").click(),
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
  // 排空待推池（持久 context 共享推送循环，别把进行中推送泄漏给 push.spec）
  await drainPendingPool(page);
  await page.close();
});

test("upload-canvas treats multiple selected files as ONE batch (issue #38)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 两个独有词文件：多文件协议（issue #38）一次选中、整批 = 一次采集
  const pathA = "/tmp/word-radar-e2e-multi-a.txt";
  const pathB = "/tmp/word-radar-e2e-multi-b.txt";
  writeFileSync(pathA, "The curious cartographer charted a silent fjord.\n");
  writeFileSync(pathB, "A diligent blacksmith forged bright iron.\n");

  await waitCountsLoaded(page); // 基线读取前置：等 total 脱骨架（骨架屏契约）
  const totalBefore = Number(await page.getByTestId("total").textContent());
  mockBbdc.reset();

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-canvas").click(),
  ]);
  await chooser.setFiles([pathA, pathB]);
  // 整批 = 一次采集：两个文件合成单张确认卡（「上传采集」措辞）
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );
  // 确认前：不落库、零网络请求
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore));
  expect(mockBbdc.requests).toHaveLength(0);

  // 确认 → 整批合并入词库 → 计数刷新 → 推送启动
  await page.getByTestId("confirm-push").click();
  await expect
    .poll(async () => Number(await page.getByTestId("total").textContent()))
    .toBeGreaterThan(totalBefore);
  await expect
    .poll(() => mockBbdc.addWordRequests().length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  // 排空待推池（持久 context 共享推送循环，别把进行中推送泄漏给后续用例）
  await drainPendingPool(page);
  await page.close();
});

test("upload-canvas accepts .csv as plain text via NL pipeline, not IMPORT_CSV (issue #24)", async ({
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
    page.getByTestId("upload-canvas").click(),
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

test("upload-canvas accepts .srt subtitle (17-item allowlist, issue #38)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 新后缀走通：.srt（字幕）在 issue #38 的 17 项白名单内
  const srtPath = "/tmp/word-radar-e2e-upload.srt";
  writeFileSync(
    srtPath,
    "1\n00:00:01,000 --> 00:00:04,000\nThe wanderer climbed beyond the fog.\n",
  );

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-canvas").click(),
  ]);
  await chooser.setFiles(srtPath);
  // i18n（issue #28）：zh-CN 确认摘要，来源措辞「上传采集」
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );
  // 确认前零网络（check-login 恢复路径除外）
  expect(
    mockBbdc.requests.filter((r) => !r.url.includes("check-login")),
  ).toHaveLength(0);
  await expect(page.getByTestId("confirm-section")).toBeVisible();
  await page.close();
});

test("upload-canvas preprocesses .html: script content never enters the vocabulary (issue #38 决议 A2)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // .html 预处理（popup 侧 DOMParser→可见正文）：script/style 的源码文本
  // 不进提取管线，正文词正常进词库
  const htmlPath = "/tmp/word-radar-e2e-upload.html";
  writeFileSync(
    htmlPath,
    '<html><head><style>.ghoststyle { color: red }</style></head><body>' +
      "<article><p>The meticulous falconer tamed a stubborn kestrel.</p>" +
      '<script>var e2eghost = "qqghosttoken";</script>' +
      "</article></body></html>",
  );

  await waitCountsLoaded(page);
  const totalBefore = Number(await page.getByTestId("total").textContent());
  mockBbdc.reset();

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-canvas").click(),
  ]);
  await chooser.setFiles(htmlPath);
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );

  // 确认 → 正文词合并入词库并推送
  await page.getByTestId("confirm-push").click();
  await expect
    .poll(async () => Number(await page.getByTestId("total").textContent()))
    .toBeGreaterThan(totalBefore);
  await expect
    .poll(() => mockBbdc.addWordRequests().length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  // script 里的幽灵 token 从未触达任何接口（DOMParser 预处理生效的集成证据）
  expect(
    mockBbdc.requests.filter((r) => JSON.stringify(r).includes("qqghosttoken")),
  ).toHaveLength(0);
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  // 排空待推池（持久 context 共享推送循环）
  await drainPendingPool(page);
  await page.close();
});

test("upload-canvas click path ignores non plain-text (e.g. .png) with zero writes (issue #24; code-review P0 unified gate)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 验收修订：.csv 已是合法纯文本目标（走自然语言提词），改用 .png 做拒绝用例
  const pngPath = "/tmp/word-radar-e2e-upload-reject.png";
  writeFileSync(pngPath, "lemma,flags\nnotafiletarget,0\n");
  await waitCountsLoaded(page); // 基线读取前置：等 total 脱骨架（骨架屏契约）
  const totalBefore = Number(await page.getByTestId("total").textContent());

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-canvas").click(),
  ]);
  await chooser.setFiles(pngPath);
  // 点击路径与拖放同闸门（code-review P0）：非白名单在 popup 侧过滤层就地
  // 摘要忽略——SW 的整批拒绝错误对合法用户不再触发
  await expect(page.getByTestId("status")).toHaveText(
    /已收录 0 个文件，忽略 1 个（\.png）/,
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

  await page.getByTestId("tools-toggle").click(); // 工具抽屉默认收起（issue #35 重做），先展开
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
