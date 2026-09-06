/**
 * 上传画布 e2e（issue #41 v1.1-T4；issue #42 v1.1-T5 粘贴手势；code-review
 * 返工：覆盖询问改内联确认条、上传 meta 移入确认卡）：
 * 拖放多文件合并单一确认批、非白名单后缀计数摘要、双上限整批拒绝、覆盖
 * 语义两条（collect/import 驻留批内联确认条、upload 驻留批静默替换）、
 * 粘贴文本直进提取管线、粘贴文件同拖放语义（白名单后缀计数摘要）。
 *
 * 已知边界（code-review P1 修正为实况）：Playwright 合成 DragEvent 的
 * webkitGetAsEntry 恒 null（合成事件不产生 drag data store 的 entry），
 * 全部 drop 用例走的是 dataTransfer.files 回退路径——e2e 覆盖「回退路径
 * 全链路」（files 同步摘取 → 白名单过滤 → 双上限 → 读取 → SW 提取 →
 * 确认卡）；entry 递归（readEntries 分批、回调式 file() 包 Promise）由
 * test/drop-files.test.ts 的 fake entry 树单测覆盖（含回调式形态）。
 *
 * i18n（issue #28）：测试 Chromium 在 fixtures.ts 钉死 zh-CN locale，断言中文渲染。
 */
import type { Page } from "@playwright/test";
import { test, expect, waitCountsLoaded } from "./fixtures.js";

test.beforeEach(({ mockBbdc }) => {
  mockBbdc.reset();
});

/**
 * 在上传画布上合成一次 drop：DataTransfer + File 构造后 dispatchEvent。
 * 合成事件的 webkitGetAsEntry 恒 null → popup 走 dataTransfer.files 回退；
 * 与真实拖放共享其后的全部闸门管线（过滤/上限/读取/SW 提取）。
 */
async function dropOnCanvas(
  page: Page,
  files: Array<{ name: string; text: string }>,
): Promise<void> {
  await page.evaluate((specs) => {
    const dt = new DataTransfer();
    for (const spec of specs) {
      dt.items.add(new File([spec.text], spec.name, { type: "text/plain" }));
    }
    const canvas = document.querySelector<HTMLElement>(
      '[data-testid="upload-canvas"]',
    );
    if (!canvas) throw new Error("upload-canvas not found");
    canvas.dispatchEvent(
      new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  }, files);
}

/**
 * 在上传画布上合成一次 paste（issue #42）：ClipboardEventInit 的
 * clipboardData 可直接携带 DataTransfer（Chromium 支持）。画布 tabindex=0，
 * 先 focus 再派发——真实 ⌘V 只会落在聚焦元素上。
 */
async function pasteOnCanvas(
  page: Page,
  payload: { text?: string; files?: Array<{ name: string; text: string }> },
): Promise<void> {
  await page.evaluate((spec) => {
    const dt = new DataTransfer();
    for (const file of spec.files ?? []) {
      dt.items.add(new File([file.text], file.name, { type: "text/plain" }));
    }
    if (spec.text !== undefined) dt.setData("text/plain", spec.text);
    const canvas = document.querySelector<HTMLElement>(
      '[data-testid="upload-canvas"]',
    );
    if (!canvas) throw new Error("upload-canvas not found");
    canvas.focus();
    canvas.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, payload);
}

/**
 * 等 popup boot 初始化落定：i18n 静态回填把状态行刷成待机引导。boot 不再
 * 自动采集（issue #39 v1.1-T2），该待机文案常态驻留——以此作「popup 就绪、
 * 无进行中采集/上传状态」的同步锚点，避免 boot 期的瞬时状态行竞态覆盖
 * 后续用例写入的摘要/提示断言。
 */
async function waitPopupReady(page: Page): Promise<void> {
  await expect(page.getByTestId("status")).toHaveText(/就绪/, {
    timeout: 15_000,
  });
}

test("upload canvas replaces the upload button and renders the hint (issue #41)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 画布在场、指引文案按 zh-CN 回填、role=button 可聚焦；
  // 辅行（issue #42）：粘贴手势 + 文件夹拖放引导
  const canvas = page.getByTestId("upload-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("role", "button");
  await expect(canvas).toHaveAttribute("tabindex", "0");
  await expect(canvas).toContainText("点击选择文件，或拖放文件 / 文件夹");
  await expect(canvas).toContainText("可粘贴文本或文件；文件夹请拖放");
  // 旧「上传文件」按钮已删（决议 A3）：testid 引用清零
  await expect(page.getByTestId("upload-file")).toHaveCount(0);

  await page.close();
});

test("openReason=upload marker routes the reopened popup straight to the canvas with focus (issue #40 v1.1-T3)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);

  // 模拟 SW 侧右键菜单唤起标记：右键菜单原生 UI 在 e2e 无法点击（链路由
  // test/context-menu.test.ts 的 SW 单测覆盖「标记写入 + openPopup」），
  // 本例只验 popup 消费端——boot 读到 upload 标记 → 直达上传画布并落焦。
  await page.evaluate(() => chrome.storage.session.set({ openReason: "upload" }));
  await page.reload();
  await waitPopupReady(page);

  // boot 一次性消费标记后 uploadCanvas.focus()（画布 tabindex=0 已就位）
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null),
    )
    .toBe("upload-canvas");

  // 标记读到即清：再次打开回到默认态（无标记 → 不聚焦画布，T2 默认态）
  await page.reload();
  await waitPopupReady(page);
  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("data-testid") ?? null,
  );
  expect(focused).not.toBe("upload-canvas");

  await page.close();
});

test("drag-drop multiple files merges into ONE confirm batch (issue #41)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);
  await waitCountsLoaded(page);
  const totalBefore = Number(await page.getByTestId("total").textContent());

  await dropOnCanvas(page, [
    { name: "drop-a.txt", text: "The curious cartographer charted a silent fjord.\n" },
    { name: "drop-b.txt", text: "A diligent blacksmith forged bright iron.\n" },
  ]);

  // 整批 = 一次采集：单一确认卡（「上传采集」措辞）+ 卡内收录摘要（M=0 形态；
  // code-review P1：meta 移入确认卡，状态行在卡片展开期间被 D 互斥隐藏）
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("confirm-meta")).toBeVisible();
  await expect(page.getByTestId("confirm-meta")).toHaveText(/已收录 2 个文件/);
  // 确认前：不落库、零网络请求（boot 的 check-login 恢复路径豁免，同 popup.spec）
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore));
  expect(
    mockBbdc.requests.filter((r) => !r.url.includes("check-login")),
  ).toHaveLength(0);

  // 取消批次：不留待推，避免污染共享词库/推送循环
  await page.getByTestId("cancel-collect").click();
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await page.close();
});

test("drag-drop with non-whitelisted files shows the suffix summary and still collects the rest (issue #41)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);

  // 2 个白名单 + 3 个非白名单：摘要只报后缀类别（去重排序），不展开文件名
  await dropOnCanvas(page, [
    { name: "keep-a.txt", text: "The jovial taxidermist painted a wobbly ladder.\n" },
    { name: "keep-b.md", text: "A prudent locksmith juggled seven keys.\n" },
    { name: "snap.png", text: "binary" },
    { name: "photo.png", text: "binary" },
    { name: "virus.exe", text: "binary" },
  ]);

  // 摘要挂卡内 meta（code-review P1）：只报后缀类别（去重排序），不展开文件名
  await expect(page.getByTestId("confirm-meta")).toHaveText(
    /已收录 2 个文件，忽略 3 个（\.exe \.png）/,
    { timeout: 10_000 },
  );
  // 白名单部分照常驻留出卡
  await expect(page.getByTestId("confirm-section")).toBeVisible();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
  );

  await page.getByTestId("cancel-collect").click();
  await page.close();
});

test("drag-drop exceeding the double limit rejects the WHOLE batch (issue #41)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);
  await waitCountsLoaded(page);
  const totalBefore = Number(await page.getByTestId("total").textContent());

  // 201 个 .txt（> maxFiles 200）：整批拒绝，不静默截断
  const files = Array.from({ length: 201 }, (_, i) => ({
    name: `f${String(i).padStart(3, "0")}.txt`,
    text: "w",
  }));
  await dropOnCanvas(page, files);

  await expect(page.getByTestId("status")).toHaveText(
    // sweeper #27：本批量 201 文件 × 1 字节按 B 如实呈现（不再被 ceil 夸大成 1 MB）
    /超出上限：最多 200 个文件、20 MB；本次 201 个文件、201 B/,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore));
  // 零网络：拒绝发生在 popup 侧过滤层，消息从未发出（check-login 豁免同上）
  expect(
    mockBbdc.requests.filter((r) => !r.url.includes("check-login")),
  ).toHaveLength(0);
  await page.close();
});

test("upload over a resident collect batch asks via the inline bar (issue #41 决议 A5; code-review P0)", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/confirm-gate.html`);
  await article.waitForTimeout(500); // content script document_idle 注入余量

  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);

  // 先制造网页采集驻留批：文章页带回前台后点「采集当前页」（同 collect.spec）
  await article.bringToFront();
  await page.getByTestId("collect").click();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 15_000 },
  );

  // 驻留批来源 collect → 拖放弹内联确认条（window.confirm 在 action popup
  // 不显示且恒 false，popup 会被直接关掉——code-review P0）
  await dropOnCanvas(page, [
    { name: "over-collect.txt", text: "The sardonic locksmith welded a rusty hinge.\n" },
  ]);
  const ask = page.getByTestId("overwrite-ask");
  await expect(ask).toBeVisible();

  // dismiss 路径：丢弃本次上传——确认卡仍是旧 collect 批、状态行不变
  await page.getByTestId("overwrite-dismiss").click();
  await expect(ask).toBeHidden();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
  );
  await expect(page.getByTestId("status")).toHaveText(/待确认/);

  // accept 路径：再拖一次 → 「继续上传」→ 确认卡换成上传批
  await dropOnCanvas(page, [
    { name: "over-collect2.txt", text: "A jovial falconer traded ten brass bells.\n" },
  ]);
  await expect(ask).toBeVisible();
  await page.getByTestId("overwrite-accept").click();
  await expect(ask).toBeHidden();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );

  await page.getByTestId("cancel-collect").click();
  await page.close();
  await article.close();
});

test("re-upload over a resident upload batch replaces silently (issue #41 决议 A5)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);

  // 第一次拖放：驻留 upload 批
  await dropOnCanvas(page, [
    { name: "first.txt", text: "The grizzled shipwright carved a bone needle.\n" },
  ]);
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );

  // 第二次拖放：不询问、卡内 meta 提示已替换 + 收录摘要（code-review P1：
  // meta 移入确认卡）、确认卡是替换后的新批
  await dropOnCanvas(page, [
    { name: "second.txt", text: "A nimble falconer whistled at dawn.\n" },
  ]);
  // 确认卡是替换后的新批（单文件 → 文件数确定；提词数随管线，不钉死）；
  // 替换提示 + 摘要挂卡内 meta（code-review P1）
  await expect(page.getByTestId("confirm-meta")).toHaveText(
    /已替换上一批上传文件 · 已收录 1 个文件/,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
  );

  await page.getByTestId("cancel-collect").click();
  await page.close();
});

test("paste plain text on the canvas goes straight into the extraction pipeline (issue #42 决议 A3)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);
  await waitCountsLoaded(page);
  const totalBefore = Number(await page.getByTestId("total").textContent());

  // 粘贴文本通道：无文件名/后缀概念，直接进提取管线 → 待确认批次
  await pasteOnCanvas(page, {
    text: "The marzipan lighthouse hummed a quiet tune.\n",
  });

  // 确认卡措辞仍是「上传采集」（粘贴属于上传目标，不叫「剪贴板采集」）
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );
  // 确认前：不落库、零网络请求（check-login 豁免，同拖放用例）
  await expect(page.getByTestId("total")).toHaveText(String(totalBefore));
  expect(
    mockBbdc.requests.filter((r) => !r.url.includes("check-login")),
  ).toHaveLength(0);

  // 取消批次：不留待推，避免污染共享词库/推送循环
  await page.getByTestId("cancel-collect").click();
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await page.close();
});

test("pasted files go through the same whitelist filter and summary as drop (issue #42 决议 A4)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);

  // 粘贴文件通道：与拖放完全同语义——白名单过滤 + 计数摘要（1 收 1 忽）；
  // 摘要挂卡内 meta（code-review P1）
  await pasteOnCanvas(page, {
    files: [
      { name: "paste.txt", text: "A whimsical tobacconist shuffled ten envelopes.\n" },
      { name: "paste.png", text: "binary" },
    ],
  });

  await expect(page.getByTestId("confirm-meta")).toHaveText(
    /已收录 1 个文件，忽略 1 个（\.png）/,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("confirm-section")).toBeVisible();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
  );

  await page.getByTestId("cancel-collect").click();
  await page.close();
});

test("failed upload restores the resident confirm card (code-review #22)", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/confirm-gate.html`);
  await article.waitForTimeout(500); // content script document_idle 注入余量

  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);

  // 制造 collect 驻留批（同覆盖确认用例的制备段）
  await article.bringToFront();
  await page.getByTestId("collect").click();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 15_000 },
  );

  // 模拟 SW 整批拒绝：chromeSwChannel 在调用时动态解析
  // chrome.runtime.sendMessage，页面级覆写即可拦截 UPLOAD_FILE 应答。
  // 覆写只活在本用例的页面里（页面关闭即失效），不泄漏给其它用例。
  await page.evaluate(() => {
    const runtime = chrome.runtime as unknown as {
      sendMessage: (...args: unknown[]) => Promise<unknown>;
    };
    const original = runtime.sendMessage.bind(runtime);
    runtime.sendMessage = (...args: unknown[]) => {
      const message = args[0] as { type?: string } | undefined;
      if (message?.type === "UPLOAD_FILE") {
        return Promise.resolve({ ok: false, error: "e2e-simulated-rejection" });
      }
      return original(...args);
    };
  });

  // collect 驻留批 → 拖放先弹内联确认条 → accept 后上传被拒
  await dropOnCanvas(page, [
    { name: "orphan.txt", text: "The bwazi falconer carved ten zebra bells.\n" },
  ]);
  await expect(page.getByTestId("overwrite-ask")).toBeVisible();
  await page.getByTestId("overwrite-accept").click();

  // 失败反馈（error 豁免恒可见）+ 确认卡恢复为旧 collect 批（批次未成孤儿）
  await expect(page.getByTestId("status")).toHaveText(
    /上传采集失败：e2e-simulated-rejection/,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
  );

  // 恢复出的卡片可正常取消（丢弃驻留批，闭环）
  await page.getByTestId("cancel-collect").click();
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await page.close();
  await article.close();
});

test("new collect implicitly cancels a pending overwrite ask (sweeper #24)", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/confirm-gate.html`);
  await article.waitForTimeout(500); // content script document_idle 注入余量

  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitPopupReady(page);

  // 制造 collect 驻留批，拖放触发覆盖确认条
  await article.bringToFront();
  await page.getByTestId("collect").click();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 15_000 },
  );
  await dropOnCanvas(page, [
    { name: "stale.txt", text: "The quiet potter shaped a clay bowl.\n" },
  ]);
  await expect(page.getByTestId("overwrite-ask")).toBeVisible();

  // 新采集意图 = 隐式取消挂起确认（sweeper #24）：确认条消失、卡片重渲为
  // 新的 collect 批——否则挂起任务会在用户点「继续上传」时覆盖新批
  await page.getByTestId("collect").click();
  await expect(page.getByTestId("overwrite-ask")).toBeHidden();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );

  // 对新批再拖放：重新询问（而非沿用旧问题的挂起任务）
  await dropOnCanvas(page, [
    { name: "fresh.txt", text: "A bold cartographer redrew the coast.\n" },
  ]);
  await expect(page.getByTestId("overwrite-ask")).toBeVisible();

  // 清理：dismiss 丢弃上传 + cancel 丢弃驻留批，不污染后续用例
  await page.getByTestId("overwrite-dismiss").click();
  await page.getByTestId("cancel-collect").click();
  await expect(page.getByTestId("confirm-section")).toBeHidden();
  await page.close();
  await article.close();
});
