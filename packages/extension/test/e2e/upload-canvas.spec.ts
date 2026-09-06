/**
 * 上传画布 e2e（issue #41 v1.1-T4）：拖放多文件合并单一确认批、非白名单
 * 后缀计数摘要、双上限整批拒绝、覆盖语义两条（collect/import 驻留批询问、
 * upload 驻留批静默替换）。
 *
 * 已知边界：Playwright 合成 DataTransfer 无法产生 webkitGetAsEntry（浏览器
 * 限制），目录递归进不了 e2e——由 test/drop-files.test.ts 的 fake entry 树
 * 单测覆盖；本文件用 page.evaluate 构造 DataTransfer + File 派发 drop，
 * Chromium 里 items.add(file) 的 webkitGetAsEntry 返回真实 entry，文件
 * 拖放路径（含 entry 递归、白名单过滤、双上限）在此全链路验证。
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
 * Chromium 里 webkitGetAsEntry 可用，popup 走的是与真实拖放同一递归路径。
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

/** 记录并接受本页出现的所有 dialog（window.confirm）；seen() 供「无 dialog」断言。 */
function trackDialogs(page: Page): { seen: () => boolean } {
  let seen = false;
  page.on("dialog", (dialog) => {
    seen = true;
    void dialog.accept();
  });
  return { seen: () => seen };
}

/**
 * 等 boot 自动采集在 popup 页上失败落定（扩展页不可注入 → 「此页面无法采集」），
 * 避免它的错误状态行竞态覆盖后续用例写入的摘要/提示断言。
 */
async function waitBootCollectSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("status")).toHaveText(/此页面无法采集/, {
    timeout: 15_000,
  });
}

test("upload canvas replaces the upload button and renders the hint (issue #41)", async ({
  extContext,
  popupUrl,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);

  // 画布在场、指引文案按 zh-CN 回填、role=button 可聚焦
  const canvas = page.getByTestId("upload-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("role", "button");
  await expect(canvas).toHaveAttribute("tabindex", "0");
  await expect(canvas).toContainText("点击选择文件，或拖放文件 / 文件夹");
  // 旧「上传文件」按钮已删（决议 A3）：testid 引用清零
  await expect(page.getByTestId("upload-file")).toHaveCount(0);

  await page.close();
});

test("drag-drop multiple files merges into ONE confirm batch (issue #41)", async ({
  extContext,
  popupUrl,
  mockBbdc,
}) => {
  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitBootCollectSettled(page);
  await waitCountsLoaded(page);
  const totalBefore = Number(await page.getByTestId("total").textContent());

  await dropOnCanvas(page, [
    { name: "drop-a.txt", text: "The curious cartographer charted a silent fjord.\n" },
    { name: "drop-b.txt", text: "A diligent blacksmith forged bright iron.\n" },
  ]);

  // 整批 = 一次采集：单一确认卡（「上传采集」措辞）+ 收录摘要（M=0 形态）
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("status")).toHaveText(/已收录 2 个文件/);
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
  await waitBootCollectSettled(page);

  // 2 个白名单 + 3 个非白名单：摘要只报后缀类别（去重排序），不展开文件名
  await dropOnCanvas(page, [
    { name: "keep-a.txt", text: "The jovial taxidermist painted a wobbly ladder.\n" },
    { name: "keep-b.md", text: "A prudent locksmith juggled seven keys.\n" },
    { name: "snap.png", text: "binary" },
    { name: "photo.png", text: "binary" },
    { name: "virus.exe", text: "binary" },
  ]);

  await expect(page.getByTestId("status")).toHaveText(
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
  await waitBootCollectSettled(page);
  await waitCountsLoaded(page);
  const totalBefore = Number(await page.getByTestId("total").textContent());

  // 201 个 .txt（> maxFiles 200）：整批拒绝，不静默截断
  const files = Array.from({ length: 201 }, (_, i) => ({
    name: `f${String(i).padStart(3, "0")}.txt`,
    text: "w",
  }));
  await dropOnCanvas(page, files);

  await expect(page.getByTestId("status")).toHaveText(
    /超出上限：最多 200 个文件、20 MB；本次 201 个文件/,
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

test("upload over a resident collect batch asks before discarding (issue #41 决议 A5)", async ({
  extContext,
  popupUrl,
  fixtureServer,
}) => {
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/confirm-gate.html`);
  await article.waitForTimeout(500); // content script document_idle 注入余量

  const page = await extContext.newPage();
  await page.goto(popupUrl);
  await waitBootCollectSettled(page);

  // 先制造网页采集驻留批：文章页带回前台后手动点「重新采集」（同 collect.spec）
  await article.bringToFront();
  await page.getByTestId("collect").click();
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 15_000 },
  );

  // 驻留批来源 collect → 拖放必须弹 confirm，接受后放行替换
  const dialogs = trackDialogs(page);
  await dropOnCanvas(page, [
    { name: "over-collect.txt", text: "The sardonic locksmith welded a rusty hinge.\n" },
  ]);
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );
  expect(dialogs.seen()).toBe(true);

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
  await waitBootCollectSettled(page);

  // 第一次拖放：驻留 upload 批
  await dropOnCanvas(page, [
    { name: "first.txt", text: "The grizzled shipwright carved a bone needle.\n" },
  ]);
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout: 10_000 },
  );

  // 第二次拖放：不询问（无 dialog）、状态行提示已替换、确认卡仍是上传批
  const dialogs = trackDialogs(page);
  await dropOnCanvas(page, [
    { name: "second.txt", text: "A nimble falconer whistled at dawn.\n" },
  ]);
  // 确认卡是替换后的新批（单文件 → 文件数确定；提词数随管线，不钉死）
  await expect(page.getByTestId("status")).toHaveText(
    /已替换上一批上传文件 · 已收录 1 个文件/,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("confirm-summary")).toHaveText(
    /本次共计上传采集 \d+ 个单词，其中新词 \d+ 个/,
  );
  expect(dialogs.seen()).toBe(false);

  await page.getByTestId("cancel-collect").click();
  await page.close();
});
