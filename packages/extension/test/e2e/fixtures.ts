/**
 * E2E 共享夹具（单文件，与 test/fakes.ts 单文件精神一致）。
 *
 * worker 级 fixtures（整套 run 只起一次）：
 * - `context`      : persistent Chromium + --load-extension=<repo>/packages/extension/dist
 * - `extensionId`  : 从 service worker URL 解析（chrome-extension://<id>/…）
 * - `popupUrl`     : chrome-extension://<id>/src/popup.html（读 manifest 的 default_popup）
 * - `swConsole`    : 持续抓取 service worker console（SW idle 被杀前日志已收）+
 *                    页面侧 chrome-extension 错误；失败时由 afterEach attach
 * - `mockBbdc`     : bbdc.cn / langeasy.com.cn 全量 mock（拦截 + 请求记录 + 可编程响应），
 *                    真实外网永不触达（安全边界：不读 cookie、不发真登录态）
 * - `fixtureServer`: 本地静态服务，托管 test/e2e/pages/ 下的 fixture 页（L3 用）
 *
 * 实现注记（spike 验证点）：
 * - context.route() 对 service worker 发起的 fetch 是否生效，首跑时验证；
 *   若不生效，回退：本地 mock server + host 重定向，见 run-e2e.mjs 顶部注释。
 */
import { test as base, expect, chromium } from "@playwright/test";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIST = resolve(__dirname, "../../dist");
const PAGES_DIR = join(__dirname, "pages");

/**
 * 骨架屏契约（issue #35 重做）：GET_COUNTS 应答前计数元素为空文本且带
 * `is-skeleton` 类（旧版「—」占位时代，「goto 后立刻读 textContent 作基线」
 * 隐式依赖加载竞态——竞态输掉时 Number("") === 0 会把基线钉成 0）。
 * 任何「读计数 textContent 作基线」之前必须先等对应元素脱骨架；
 * 三个计数同帧渲染，等任一即全部就绪。断言意图不变，只是前置同步。
 */
export async function waitCountsLoaded(
  page: Page,
  testId: "total" | "pending" | "pushed" = "total",
): Promise<void> {
  await expect(page.getByTestId(testId)).not.toHaveClass(/is-skeleton/, {
    timeout: 15_000,
  });
}

/**
 * 排空持久 context 的共享推送循环（popup.spec 4 份拷贝合并，code-review
 * Simplify）：确认入库的词进入待推池，若不等推送跑完就关页，下一个用例的
 * popup boot（check-login 恢复路径）会替本用例发起推送——污染后续「确认前
 * 零网络」断言。检查前置：先读 pending/phase，已排空立即返回（零睡眠）；
 * 未排空则轮内重开 popup（reload 后 boot 重拉计数/推送状态，与驻页轮询
 * 等价）+ 固定 3s 循环保底。结束时断言池已清、无推送在跑。
 *
 * #57 后「非 running」不再等价于「推送结束」：轮 completed 后 ~1s 可
 * 观测窗口内可能有补轮在排队（BUSY 期确认的新词靠它推走）。在瞬态里点
 * retry-push 会撞 hidden 按钮挂死（completed 无失败时按钮不显示）——先
 * 穿窗（1.5s > 1s 窗口）让补轮显形，仍无推进再手动重试；retry 不可见时仅
 * reload，boot 的 check-login 恢复路径（startIfIdle 查池非空即起轮）兜底。
 */
export async function drainPendingPool(page: Page): Promise<void> {
  for (let round = 0; round < 15; round += 1) {
    const pending = Number(await page.getByTestId("pending").textContent());
    const phase = await page.getByTestId("push-status").getAttribute("data-phase");
    if (pending === 0 && phase !== "running") break;
    if (pending > 0 && phase !== "running") {
      await page.waitForTimeout(1_500); // 穿补轮可观测窗口（issue #57，>FOLLOW_UP_DELAY_MS=1000）
      const phaseAfter = await page
        .getByTestId("push-status")
        .getAttribute("data-phase");
      if (phaseAfter === "running") continue; // 补轮在跑，回循环顶等它
      const retry = page.getByTestId("retry-push");
      if (await retry.isVisible()) await retry.click();
    }
    await page.reload();
    await page.waitForTimeout(3_000);
  }
  await expect(page.getByTestId("pending")).toHaveText(/^0$/);
  await expect(page.getByTestId("push-status")).not.toHaveAttribute("data-phase", "running");
}

/**
 * e2e 上传夹具临时文件（issue #58-2）：`tmpUpload.write(name, content)` 把
 * 文件写进本用例独享的 mkdtemp 目录并返回路径。固定 /tmp 路径的旧写法有两
 * 宗罪——重跑/改动时同名文件互相覆盖，用例失败时留下无人清理的垃圾。
 * mkdtemp 目录天然唯一（并发安全）；删除挂 fixture teardown——**不走
 * afterEach + 模块级登记**：Playwright 下每个 spec 文件独立求值 import 图，
 * 模块级状态与 afterEach 会落到不同实例（probe 实测第二个文件起全部漏删），
 * fixture 生命周期由 runner 核心管理，跨文件可靠。懒创建：不用例不落目录。
 * 后缀是上传白名单的判据，调用方按语义命名。
 */
export interface TmpUpload {
  write(name: string, content: string): Promise<string>;
}

/**
 * 收词过滤用例的采集底座（issue #43；自 popup.spec 提升为 e2e 共享）：
 * 开 fixture 文章页 + popup 标签页，等内容脚本注入余量后返回两页；采集动作
 * 由用例自行驱动——各用例采集前有不同的开关操作（check/uncheck）。
 */
export async function openFilterFixturePair(
  extContext: BrowserContext,
  popupUrl: string,
  fixtureServer: { url: string },
  page = "filter-gate.html",
): Promise<{ popup: Page; article: Page }> {
  const article = await extContext.newPage();
  await article.goto(`${fixtureServer.url}/${page}`);
  // content script 按 document_idle 注入；给一点余量（collect.spec 同款）
  await article.waitForTimeout(500);
  const popup = await extContext.newPage();
  await popup.goto(popupUrl);
  return { popup, article };
}

/**
 * 把文章页带回前台后点「采集当前页」并等确认卡摘要成形（issue #39：
 * popup 以标签页模拟时按钮显式触发，采集目标 = 触发时的活动标签）。
 * 断言文案是缺省批次形状（total / newCount 都不锚具体值）；要锚「新词 ≥1 /
 * 新词 0」等更紧形状的用例保持内联（push.spec / collect.spec 如此）。
 * timeout 参数吸收个别用例的 10s 窗口（不改断言语义）。
 */
export async function collectFilterFixture(
  popup: Page,
  article: Page,
  timeout = 15_000,
): Promise<void> {
  await article.bringToFront();
  await popup.getByTestId("collect").click();
  await expect(popup.getByTestId("confirm-summary")).toHaveText(
    /本次共计采集 \d+ 个单词，其中新词 \d+ 个/,
    { timeout },
  );
}

/**
 * e2e 专用扩展目录：复制 dist 并给 host_permissions 加上 fixture 服务与
 * raw.githubusercontent.com（issue #14 后采集主路径是 executeScript；真实
 * 使用中 popup 由 action 点击打开，activeTab 即刻授权，但 e2e 把 popup 当
 * 普通标签页打开 —— 无用户手势 → activeTab 不可用。host permission 是本
 * harness 的测试期替代授权，**只存在于临时副本**，产物 manifest 不受影响）。
 */
const TEST_ONLY_HOST_PERMISSIONS = [
  "http://127.0.0.1/*",
  "https://raw.githubusercontent.com/*",
];

async function makeE2eExtensionDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "word-radar-e2e-ext-"));
  await cp(EXTENSION_DIST, join(dir, "dist"), { recursive: true });
  const manifestPath = join(dir, "dist/manifest.json");
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as {
    host_permissions?: string[];
    default_locale?: string;
  };
  raw.host_permissions = [
    ...(raw.host_permissions ?? []),
    ...TEST_ONLY_HOST_PERMISSIONS,
  ];
  // i18n 强制 zh-CN（Playwright Chromium 扩展 i18n 恒走 en 的已知坑）：
  // 扩展消息解析跟随 Chromium 的 application locale（Playwright Chromium 只打包
  // en-US 资源，恒 en-US），--lang / context locale 只改 ICU 层、改不了消息链。
  // 测试副本两处改造——manifest default_locale 改 zh_CN + 删除 _locales/en，
  // 让 en-US 解析落空回退到 zh_CN，等价模拟中文环境（dist 产物不受影响）。
  raw.default_locale = "zh_CN";
  await writeFile(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);
  await rm(join(dir, "dist/_locales/en"), { recursive: true, force: true });
  return join(dir, "dist");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

/** mock 可编程状态：失败注入用 setAddWordResult / setCheckLoginResult 改写。 */
export interface MockBbdc {
  /** 所有被拦截的 bbdc / langeasy 请求（URL + method + body）。 */
  requests: Array<{ url: string; method: string; body?: string }>;
  addWordRequests(): Array<{ word: string; raw: string }>;
  setAddWordResult(resultCode: number): void;
  setCheckLoginResult(resultCode: number): void;
  reset(): void;
}

/** test 级 fixture：用例独享的上传临时目录（tmpUpload.write 懒创建，teardown 删）。 */
interface E2eTestFixtures {
  tmpUpload: TmpUpload;
}

/** worker 级 fixture：单一持久 context + 一份扩展状态，workers=1 串行消费。 */
interface E2eWorkerFixtures {
  extContext: BrowserContext;
  extensionId: string;
  popupUrl: string;
  swConsole: { lines: string[] };
  mockBbdc: MockBbdc;
  fixtureServer: { url: string };
}

export const test = base.extend<E2eTestFixtures, E2eWorkerFixtures>({
  tmpUpload: async ({ }, use) => {
    let dir: string | undefined;
    await use({
      async write(name, content) {
        dir ??= await mkdtemp(join(tmpdir(), "word-radar-e2e-upload-"));
        const path = join(dir, name);
        await writeFile(path, content);
        return path;
      },
    });
    if (dir) await rm(dir, { recursive: true, force: true });
  },

  extContext: [async ({ }, use) => {
    const userDataDir = await mkdtemp(join(tmpdir(), "word-radar-e2e-"));
    const extensionDir = await makeE2eExtensionDir();
    // channel 'chromium'：完整 Chromium 的 new headless。默认 headless-shell
    // 不支持 --load-extension（本轮 spike 实测结论）。
    const launchOptions = {
      headless: !process.env.E2E_HEADED,
      channel: process.env.E2E_CHANNEL ?? "chromium",
    } as const;
    const context = await chromium.launchPersistentContext(userDataDir, {      ...launchOptions,
      // i18n（issue #28）：钉死测试 Chromium 的 UI locale。不设置时 Chromium 跟随
      // 宿主 OS 语言（本机 zh-CN、CI 可能 en-US），chrome.i18n 消息解析随宿主漂移，
      // 文案断言就无法确定。产品核心用户是中文环境，钉 zh-CN 让 e2e 恰好持续
      // 验证「中文环境显示中文」这一 issue #28 的主诉；en 侧由 locale.test.ts +
      // verify-manifest 校验 en/zh key 完整性兜底。
      locale: "zh-CN",
      // MV3 扩展加载（new headless 支持；老 headless 不支持）
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        "--no-sandbox",
      ],
      viewport: { width: 1280, height: 800 },
    });
    await use(context);
    await context.close();
  }, { scope: "worker" }],

  extensionId: [async ({ extContext }, use) => {
    // 等任一 service worker 出现：加载成功的标志
    let [sw] = extContext.serviceWorkers();
    if (!sw) {
      sw = await extContext.waitForEvent("serviceworker", { timeout: 15_000 });
    }
    const match = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
    if (!match) throw new Error(`cannot parse extension id from sw url: ${sw.url()}`);
    await use(match[1]);
  }, { scope: "worker" }],

  popupUrl: [async ({ extensionId }, use) => {
    // manifest default_popup = src/popup.html（crxjs 产物保持该相对路径）
    await use(`chrome-extension://${extensionId}/src/popup.html`);
  }, { scope: "worker" }],

  swConsole: [async ({ extContext }, use) => {
    const state = { lines: [] as string[] };
    const attach = (sw: import("@playwright/test").Worker): void => {
      state.lines.push(`[sw] registered: ${sw.url()}`);
      sw.on("console", (msg) => {
        state.lines.push(`[sw] ${msg.type()}: ${msg.text()}`);
      });
    };
    extContext.serviceWorkers().forEach(attach);
    extContext.on("serviceworker", attach);
    // SW 被杀后重启时的新实例也接上（C 系列决策：日志在 idle 被杀前必须收走）
    await use(state);
  }, { scope: "worker" }],

  mockBbdc: [async ({ extContext, swConsole }, use) => {
    // 依赖 swConsole：mockBbdc 被所有 spec 消费，可保证 console 监听在测试
    // 开始前就已挂上（否则 worker fixture 惰性实例化会让 afterEach 才开始抓，
    // sw-console 附件恒为空）。
    void swConsole;
    const requests: MockBbdc["requests"] = [];
    let addWordResult = 200;
    let checkLoginResult = 200;

    // 只拦 bbdc / langeasy 域（issue #27）：早先用 "**/*" + route.continue() 全量
    // 兜底，所有真实外网请求（含 raw.githubusercontent.com 页面导航）都被代理进
    // Playwright Node 路由层，全量套件负载下偶发卡死 → raw-csp 用例超时漂移。
    // 收窄 pattern 后外网请求完全不经过本 handler。
    const handler = async (route: Route): Promise<void> => {
      const req = route.request();
      const url = new URL(req.url());
      const host = url.hostname;
      requests.push({
        url: req.url(),
        method: req.method(),
        body: req.postData() ?? undefined,
      });
      const isLexis = host === "langeasy.com.cn";
      const json = (body: unknown): Promise<void> =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

      if (isLexis) {
        // loadLexisList：永远命中释义
        await json({ wordlist: [{ interpret: "n. e2e mock 释义" }] });
        return;
      }
      if (url.pathname === "/api/check-login") {
        await json({ result_code: checkLoginResult });
        return;
      }
      if (url.pathname === "/api/check-new-word") {
        await json({ result_code: 200, data_body: { list: [] } });
        return;
      }
      if (url.pathname === "/api/user-new-word" && req.method() === "POST") {
        await json({ result_code: addWordResult });
        return;
      }
      await json({ result_code: 200, data_body: { list: [] } });
    };
    // 四条 pattern 覆盖裸域与子域（www.bbdc.cn 等）；Playwright glob 单段 `*`
    // 不跨 `.`，须分别注册。
    for (const pattern of [
      "**://bbdc.cn/**",
      "**://*.bbdc.cn/**",
      "**://langeasy.com.cn/**",
      "**://*.langeasy.com.cn/**",
    ]) {
      await extContext.route(pattern, handler);
    }

    const mock: MockBbdc = {
      requests,
      addWordRequests() {
        return requests
          .filter((r) => r.url.includes("/api/user-new-word") && r.method === "POST")
          .map((r) => ({ raw: r.body ?? "", word: parseNewWordListWord(r.body) }));
      },
      setAddWordResult(resultCode) {
        addWordResult = resultCode;
      },
      setCheckLoginResult(resultCode) {
        checkLoginResult = resultCode;
      },
      reset() {
        requests.length = 0;
        addWordResult = 200;
        checkLoginResult = 200;
      },
    };
    await use(mock);
  }, { scope: "worker" }],

  fixtureServer: [async ({ }, use) => {
    const server: Server = createServer(async (req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      const file = join(PAGES_DIR, path === "/" ? "article.html" : path);
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error("not a file");
        const content = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no server address");
    await use({ url: `http://127.0.0.1:${address.port}` });
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }, { scope: "worker" }],
});

/** 跨用例清理基准：本用例开始前已存在的页面（worker 级 context 共享）。 */
let pagesBefore: Page[] = [];

test.beforeEach(async ({ extContext, popupUrl }) => {
  pagesBefore = [...extContext.pages()];

  // 跨用例驻留批清理（issue #54 Wave D 适配），置于 **beforeEach**：覆盖闸门
  // 判定依据从 popup 影子记账（每用例重开 popup 即清零，感知不到残留）改为
  // 查询 SW 真相后，前序用例驻留的 collect/import 批会拦下本用例的上传
  //（弹覆盖确认条而非直接上传）。放 afterEach 不够：用例断言完成后，其
  // 触发的 SW 异步链路（提取/导入后 pendingBatch.set）可能迟到落地，把
  // 清理成果覆盖回去（probe 实测：afterEach 清理后批仍残留）。beforeEach
  // 在本用例第一动作前的最后时刻清，吞掉两用例之间的一切迟到落地。
  // 走临时 popup 页（chrome.runtime 仅扩展页可用）；DISCARD 不持通道、
  // sendMessage 以端口关闭收场故吞掉；轮询 GET_BATCH_STATE 等清理落地
  //（SW 冷启动慢唤醒时固定等待不够），双确认窗口挡迟到尾巴。
  try {
    const cleanupPage = await extContext.newPage();
    try {
      await cleanupPage.goto(popupUrl);
      await cleanupPage.evaluate(async () => {
        const discard = (): void => {
          void chrome.runtime.sendMessage({ type: "DISCARD_COLLECTED" }).catch(() => undefined);
        };
        discard();
        for (let i = 0; i < 30; i++) {
          const state = (await chrome.runtime
            .sendMessage({ type: "GET_BATCH_STATE" })
            .catch(() => null)) as { source?: string | null } | null;
          if (state === null || state.source == null) {
            // 双确认窗：再清一次并静默等待，迟到落地的驻留在此暴露后重清
            discard();
            await new Promise((resolve) => setTimeout(resolve, 300));
            const second = (await chrome.runtime
              .sendMessage({ type: "GET_BATCH_STATE" })
              .catch(() => null)) as { source?: string | null } | null;
            if (second === null || second.source == null) return;
            continue;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
    } finally {
      await cleanupPage.close();
    }
  } catch {
    // 清理尽力而为：极端场景（context 已收尾）不拖垮用例判定
  }
});

test.afterEach(async ({ extContext, swConsole }, testInfo) => {
  // 跨用例清理（issue #27，#23 unroute 先例的同类推广）：持久 context 整套
  // run 共享，任何中途失败/跳过的用例都会把路由与页面泄漏给后续用例
  //（失败点漂移的放大器）。
  // 1) 摘掉用例内注册的临时路由（pattern 与 mockBbdc 的四条 host pattern
  //    不相交，只会移除 push.spec 等注册的 **/api/user-new-word* 残留）。
  try {
    await extContext.unroute("**/api/user-new-word*");
  } catch {
    // context 已收尾等极端场景下忽略
  }
  // 2) 关掉本用例新开且未关的页面（失败现场跳出 close 的兜底）；
  //    保留至少一页，避免关掉最后一页连带收掉 persistent context。
  const before = new Set(pagesBefore);
  const leftover = extContext.pages().filter((p) => !before.has(p));
  const all = extContext.pages();
  const toClose = leftover.length === all.length && all.length > 0 ? leftover.slice(1) : leftover;
  await Promise.allSettled(toClose.map((p) => p.close()));

  if (testInfo.status !== testInfo.expectedStatus) {
    // 失败现场：SW console 随 testInfo 落进 outputDir（trace.zip 同目录）
    await testInfo.attach("sw-console", {
      body: swConsole.lines.join("\n") || "(no sw console output)",
      contentType: "text/plain",
    });
  }
});

/** 从 addWord 的 FormData body（URL-encoded newwordlist JSON 串）里抠出 word 字段。 */
function parseNewWordListWord(body: string | undefined): string {
  if (!body) return "";
  // route.request().postData() 对 multipart 是原文；newwordlist= 后面的 JSON 可能被
  // percent-encode，也可能裸奔 — 两种都试。
  const match = body.match(/newwordlist=([^&]*)/s);
  if (!match) {
    const bare = body.match(/"word"\s*:\s*"([^"]+)"/);
    return bare ? bare[1] : "";
  }
  try {
    const decoded = decodeURIComponent(match[1].replace(/\+/g, " "));
    const parsed = JSON.parse(decoded) as Array<{ word?: string }>;
    return parsed[0]?.word ?? "";
  } catch {
    return "";
  }
}

export { expect };
