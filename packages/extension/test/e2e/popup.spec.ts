/**
 * L2 popup 冒烟：popup.html 在标签页打开（扩展页上下文，chrome.* 可用），
 * 四个 render 视图初始渲染 + 按钮 → SW 消息回路。
 * 覆盖 popup.ts 胶水层（CONTEXT.md「已知未覆盖」盲区）。
 *
 * i18n 国际化（issue #28）：测试 Chromium 在 fixtures.ts 钉死 zh-CN locale，
 * 断言按中文渲染（也持续验证「中文环境显示中文」这一 issue #28 的主诉）。
 */
import type { BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  drainPendingPool,
  waitCountsLoaded,
  openArticlePopupPair,
  collectCurrentPage,
} from "./fixtures.js";

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
  // 持久 context 跨测试共享状态：phase 可能是 idle（首跑）或 completed
  // （此前确认轮在 SW 内存的驻留终态；boot checkLogin 已不再对空待推池
  // 起零词轮，issue #36）。只断言渲染形状，不断言具体 phase。
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
  tmpUpload,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 独有词汇，保证对持久词库是全新词
  const csvPath = await tmpUpload.write(
    "import.csv",
    "lemma,flags\nimportwordalpha,0\nimportwordbeta,0\n",
  );

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
  // CSV 导入无收词过滤语义（issue #43）：结构化解析不带 filteredCount，
  // 确认卡不出「已过滤 N 个」行
  await expect(page.getByTestId("confirm-filtered")).toBeHidden();
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
  tmpUpload,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 独有词汇，保证对持久词库是全新词
  const txtPath = await tmpUpload.write(
    "upload.txt",
    "The curious astronomer photographed a luminous nebula.\n",
  );

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
  tmpUpload,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 两个独有词文件：多文件协议（issue #38）一次选中、整批 = 一次采集
  const pathA = await tmpUpload.write(
    "multi-a.txt",
    "The curious cartographer charted a silent fjord.\n",
  );
  const pathB = await tmpUpload.write(
    "multi-b.txt",
    "A diligent blacksmith forged bright iron.\n",
  );

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
  tmpUpload,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 验收修订（用户决策）：上传入口的 .csv 走自然语言提词（extractWordEntries），
  // 不做 IMPORT_CSV 的 lemma,flags 结构化解析——确认页措辞是「上传采集」
  const csvPath = await tmpUpload.write("upload-nl.csv", "name,count\nglimmer,3\n");
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
  tmpUpload,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 新后缀走通：.srt（字幕）在 issue #38 的 17 项白名单内
  const srtPath = await tmpUpload.write(
    "upload.srt",
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
  tmpUpload,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // .html 预处理（popup 侧 DOMParser→可见正文）：script/style 的源码文本
  // 不进提取管线，正文词正常进词库
  const htmlPath = await tmpUpload.write(
    "upload.html",
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
  tmpUpload,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 验收修订：.csv 已是合法纯文本目标（走自然语言提词），改用 .png 做拒绝用例
  const pngPath = await tmpUpload.write("upload-reject.png", "lemma,flags\nnotafiletarget,0\n");
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

/**
 * 过滤用例的「开底座 → 关开关 → 采集」前置（issue #43，组合 fixtures 提升
 * 出的两个共享 helper）：开 fixture 页对后展开工具抽屉（默认收起，issue #35
 * 重做）把 `off` 列出的开关逐个取消勾选，再驱动采集；`off` 缺省空 = 双开
 * 缺省采集（possessive 用例，此时可指定 fixture 页）。收尾的开关恢复不进
 * 本 helper：各用例恢复时机不同（有的在 cancel 前、有的在 drain 前），且
 * 此刻抽屉仍展开，直接 check 即可——tools-toggle 二次点击会收起抽屉。
 */
async function collectWithIntakeFilters(
  extContext: BrowserContext,
  popupUrl: string,
  fixtureServer: { url: string },
  off: ReadonlyArray<"filter-abbreviations" | "filter-contractions"> = [],
  page = "filter-gate.html",
): Promise<{ popup: Page; article: Page }> {
  const { popup, article } = await openArticlePopupPair(extContext, popupUrl, fixtureServer, page);
  if (off.length > 0) {
    await popup.getByTestId("tools-toggle").click();
    for (const testId of off) {
      await popup.getByTestId(testId).uncheck();
    }
  }
  await collectCurrentPage(popup, article);
  return { popup, article };
}

// ── 收词过滤（issue #43）：开关 UI + 确认卡「已过滤 N 个」行 ─────────────
//
// fixture 文本（pages/filter-gate.html）：
//   The doc and the md, you've aren't serendipity monorepo the dog's
// 用词纪律：the/and 是跨黑名单版本恒安全的功能词；doc/md 是跨版本恒过滤的
// 缩略词锚点；you've/aren't 走与数据无关的缩合判据；serendipity/monorepo
// 恒放行；dog's 是所有格剥离锚点（→dog，跨四种开关组合恒在批次——剥离属
// 归一化、不受开关控制）。期望值已用真实提取管线（core dist
// extractWordEntries）实证：
//
// | 开关组合     | total | filtered | 批次 lemma（按 lemma 去重）|
// |--------------|-------|----------|----------------------------|
// | 双开（默认） | 5     | 4        | the, and, serendipity, monorepo, dog |
// | 缩略词关     | 7     | 2        | the, doc, and, md, serendipity, monorepo, dog |
// | 缩合关       | 7     | 2        | the, and, you've, aren't, serendipity, monorepo, dog |
// | 双关         | 9     | 0        | the, doc, and, md, you've, aren't, serendipity, monorepo, dog |
//
// 断言只锚 total / filteredCount（由文本唯一决定，与词库状态无关）；
// newCount 依赖持久 context 的词库现状，一律放宽为 \d+。

test("intake filter toggles exist, default checked, persist across reload (issue #43)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 工具抽屉默认收起（issue #35 重做）：先展开抽屉再读面板内开关
  await page.getByTestId("tools-toggle").click();
  // 缺省全开：HTML checked 缺省 + storage 从未写过时读值兜底 true
  await expect(page.getByTestId("filter-abbreviations")).toBeVisible();
  await expect(page.getByTestId("filter-abbreviations")).toBeChecked();
  await expect(page.getByTestId("filter-contractions")).toBeChecked();

  // 重开 popup（reload 模拟）：持久化语义来自「缺省 true」，storage 仍未写过，
  // boot 异步回填后依旧全勾
  await page.reload();
  await page.getByTestId("tools-toggle").click();
  await expect(page.getByTestId("filter-abbreviations")).toBeChecked();
  await expect(page.getByTestId("filter-contractions")).toBeChecked();

  // 回填哨兵：上面的 reload 勾选仍可能只是 HTML checked 缺省属性——只有先经
  // UI uncheck 让 change 写入 storage，reload 后的未勾选才唯一来自 boot 的
  // storage 回填（popup.ts renderIntakeFilterSettings），钉住「用户关掉能记住」
  await page.getByTestId("filter-contractions").uncheck();
  // change 的 storage 写是异步无反馈的：等落盘再 reload，否则可能读到旧值误判
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await chrome.storage.local.get("filterContractions"))
            .filterContractions,
      ),
    )
    .toBe(false);
  await page.reload();
  await page.getByTestId("tools-toggle").click();
  await expect(page.getByTestId("filter-contractions")).not.toBeChecked();
  await expect(page.getByTestId("filter-abbreviations")).toBeChecked();

  // 收尾恢复：重新勾选写回 storage true 并等落盘，别把关态泄漏给后续用例
  await page.getByTestId("filter-contractions").check();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await chrome.storage.local.get("filterContractions"))
            .filterContractions,
      ),
    )
    .toBe(true);
  await page.close();
});

test("default-on filters collect the fixture page: filtered line shows 4 (issue #43)", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  const { popup, article } = await openArticlePopupPair(extContext, popupUrl, fixtureServer);
  await collectCurrentPage(popup, article);

  // 双开：doc/md（黑名单）+ you've/aren't（缩合判据）被拦，过滤 4；
  // the/and/serendipity/monorepo 按 lemma 去重后入批 + dog's 剥离成 dog
  // → total 5（保护词计入 total）
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /^本次共计采集 5 个单词，其中新词 \d+ 个$/,
  );
  await expect(popup.getByTestId("confirm-filtered")).toBeVisible();
  await expect(popup.getByTestId("confirm-filtered")).toHaveText("已过滤 4 个");

  // 过滤行位置契约：confirm-summary 与 confirm-meta 之间（popup.html 结构）
  const betweenSummaryAndMeta = await popup.evaluate(() => {
    const byTestId = (id: string): Element =>
      document.querySelector(`[data-testid="${id}"]`) as Element;
    return Boolean(
      byTestId("confirm-summary").compareDocumentPosition(byTestId("confirm-filtered")) &
        Node.DOCUMENT_POSITION_FOLLOWING &&
        byTestId("confirm-filtered").compareDocumentPosition(byTestId("confirm-meta")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(betweenSummaryAndMeta).toBe(true);

  // 取消弃批：不改词库、不起推送，后续开关用例的计数精算不受影响
  await popup.getByTestId("cancel-collect").click();
  await expect(popup.getByTestId("confirm-section")).toBeHidden();
  await popup.close();
  await article.close();
});

test("disabling filter-abbreviations lets doc/md enter the batch (issue #43)", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  // 经 UI 关开关：change 即写 chrome.storage.local，下一次采集在提取地读新鲜值
  const { popup, article } = await collectWithIntakeFilters(extContext, popupUrl, fixtureServer, [
    "filter-abbreviations",
  ]);
  // 黑名单关：doc/md 进批次（total 5→7），过滤只剩缩合判据的 you've/aren't
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /^本次共计采集 7 个单词，其中新词 \d+ 个$/,
  );
  await expect(popup.getByTestId("confirm-filtered")).toHaveText("已过滤 2 个");

  // 取消弃批 + 恢复开关（写回 true，别把关态泄漏给后续用例）
  await popup.getByTestId("filter-abbreviations").check();
  await popup.getByTestId("cancel-collect").click();
  await expect(popup.getByTestId("confirm-section")).toBeHidden();
  await popup.close();
  await article.close();
});

test("disabling filter-contractions lets you've/aren't enter as apostrophe lemmas (issue #43)", async ({
  extContext,
  popupUrl,
  fixtureServer,
  mockBbdc,
}) => {
  const { popup, article } = await collectWithIntakeFilters(extContext, popupUrl, fixtureServer, [
    "filter-contractions",
  ]);
  // 缩合关：you've/aren't 以带撇号 lemma 入批（total 5→7），过滤只剩黑名单 doc/md
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /^本次共计采集 7 个单词，其中新词 \d+ 个$/,
  );
  await expect(popup.getByTestId("confirm-filtered")).toHaveText("已过滤 2 个");

  // 确认 → 推送词面实证：带撇号 lemma 原样入批（未被拆成 you+ve、未被剥撇号；
  // addWord 逐词一请求，见 bbdc-client.addWord）
  await popup.getByTestId("confirm-push").click();
  const pushedWords = (): string[] => mockBbdc.addWordRequests().map((r) => r.word);
  await expect
    .poll(pushedWords, { timeout: 20_000 })
    .toEqual(expect.arrayContaining(["you've", "aren't"]));

  // 恢复开关 + 排空待推池（持久 context 共享推送循环，别把推送泄漏给后续用例）
  await popup.getByTestId("filter-contractions").check();
  await drainPendingPool(popup);
  await popup.close();
  await article.close();
});

test("both filters off: nothing filtered, filtered line hidden (issue #43)", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  const { popup, article } = await collectWithIntakeFilters(extContext, popupUrl, fixtureServer, [
    "filter-abbreviations",
    "filter-contractions",
  ]);
  // 双关：9 个 lemma 全部入批，filteredCount=0 → 过滤行隐藏（不渲染「已过滤 0 个」噪音行）
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /^本次共计采集 9 个单词，其中新词 \d+ 个$/,
  );
  await expect(popup.getByTestId("confirm-filtered")).toBeHidden();
  await expect(popup.getByTestId("confirm-filtered")).toHaveAttribute("hidden", "");

  // 取消弃批 + 恢复开关（双开，别把关态泄漏给上传用例）
  await popup.getByTestId("filter-abbreviations").check();
  await popup.getByTestId("filter-contractions").check();
  await popup.getByTestId("cancel-collect").click();
  await expect(popup.getByTestId("confirm-section")).toBeHidden();
  await popup.close();
  await article.close();
});

// 独立 fixture 页（possessive-gate.html：`The wolf's monorepo`）+ 全局独有
// 所有格锚点 wolf's→wolf：推送断言（addWord 词面）要求锚点词真实待推，而
// workers=1 共享持久词库——前序 `disabling filter-contractions` 用例已把
// 共享页的 dog 推走（flags=1 永不再进待推池），复用 dog's 会稳定空轮挂
// （2026-09-19 全量首证；独有词纪律与 confirm-summary 的 total/filtered
// 断言同理）。wolf：Norvig@5073 不在缩略词黑名单、未被其他用例消费、在
// 守门词典 top-20000 内走 finalize 主路径。
test("possessive wolf's enters the batch as stripped lemma wolf (issue #43)", async ({
  extContext,
  popupUrl,
  fixtureServer,
  mockBbdc,
}) => {
  // 双开缺省采集后确认推送：所有格剥离属归一化、不受过滤开关控制——
  // 扩展采集路径下批次词面必须是 wolf，不能是带撇号的 wolf's
  const { popup, article } = await collectWithIntakeFilters(
    extContext,
    popupUrl,
    fixtureServer,
    [],
    "possessive-gate.html",
  );
  await popup.getByTestId("confirm-push").click();

  // 推送词面实证（addWord 逐词一请求，见 bbdc-client.addWord）
  const pushedWords = (): string[] => mockBbdc.addWordRequests().map((r) => r.word);
  await expect
    .poll(pushedWords, { timeout: 20_000 })
    .toEqual(expect.arrayContaining(["wolf"]));

  // 排空待推池后全量复核：整批推送词表里无 wolf's 原样词条
  await drainPendingPool(popup);
  expect(mockBbdc.addWordRequests().map((r) => r.word)).not.toContain("wolf's");
  await popup.close();
  await article.close();
});

test("upload path reports the same filtered-count semantics as page collect (issue #43)", async ({
  extContext,
  popupUrl,
  tmpUpload,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 与网页路径同一份文本（两路共用 core 提取管线，filteredCount 进同一张确认卡）
  const txtPath = await tmpUpload.write(
    "filter-upload.txt",
    "The doc and the md, you've aren't serendipity monorepo the dog's\n",
  );

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByTestId("upload-canvas").click(),
  ]);
  await chooser.setFiles(txtPath);
  // 双开（前序用例已恢复缺省）：上传路径同样过滤 4、入批 5（dog's→dog）
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /^本次共计上传采集 5 个单词，其中新词 \d+ 个$/,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("confirm-filtered")).toBeVisible();
  await expect(page.getByTestId("confirm-filtered")).toHaveText("已过滤 4 个");
  await page.getByTestId("cancel-collect").click();
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await page.close();
});
