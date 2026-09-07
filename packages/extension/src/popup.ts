/**
 * Popup 入口：点工具栏图标只打开弹窗、不采集（issue #39 v1.1-T2 采集入口
 * 显式化——采集时机归还用户）；对当前页的采集由弹窗内「采集当前页」按钮
 * 显式触发。触发后展示确认页
 * 「本次共计采集 N 个单词，其中新词 M 个」（新词 = 与本地词库的 lemma diff，
 * 零网络请求）。点「确认推送」→ SW 把待确认批次合并入词库并触发一轮推送
 * 全部待推；点「取消」或关闭弹窗 → 什么都不发生（批次只在内存，不持久化）。
 * 确认即推送是唯一路径，无自动推送开关（issue #22）。
 * 打开 popup 时的 checkLogin 若发现已登录，会触发一轮存量待推重推——
 * 那是允许的恢复路径，不与「唯一路径」冲突（见 docs/spec.md 扩展行为）。
 *
 * chrome.* 调用收在边界模块里：
 * - active-tab.ts：popup → content（COLLECT_WORDS / 应答）+ 新标签页打开
 * - sw-channel.ts：popup → service worker（GET_COUNTS / CHECK_LOGIN /
 *   EXPORT_CSV / IMPORT_CSV / UPLOAD_FILE / CONFIRM_COLLECTED / DISCARD_COLLECTED）
 * - i18n.ts：chrome.i18n（applyStaticI18n 静态回填 + t/t1/t2/t3/t4 动态文案）
 * 本地文件操作收在 csv-file.ts（下载 / 文件选择 / 拖放文件批读取，可注入；
 * 上传为多选，issue #38：一次上传的全部文件整批 = 一次采集，html/xml 经
 * html-text.ts 在 popup 侧预处理为纯文本）。
 * 拖放文件树收集与上传闸门（白名单过滤 + 双上限）收在 drop-files.ts
 * （issue #41 v1.1-T4：画布成为唯一上传入口，删除「上传文件」按钮）。
 * 画布粘贴（issue #42 v1.1-T5）：第三种输入手势——粘贴文件与拖放同管线
 * （UPLOAD_FILE），粘贴文本直进提取管线（UPLOAD_TEXT，无文件名/后缀概念）。
 *
 * 词库读写 + HTTP 调用 全部发生在 service worker；popup 不直连 IndexedDB、不发 HTTP。
 *
 * i18n 静态文本国际化（issue #30）：通过 data-i18n 属性标记静态文本元素，
 * 在 popup 启动时用 chrome.i18n.getMessage() 回填，并动态设置 <html lang>。
 *
 * UI/UX 重做（issue #35）：锁定布局 + 6 项交互增量——
 * A 条件可见（retry-push 按 phase/pending 显隐）、B 焦点管理（确认卡聚焦
 * confirm-push + Esc 取消）、C 布局防抖（confirm/tools 走 grid-template-rows
 * 过渡）、D 状态行互斥（confirm 可见时隐藏 info 态 status，error 豁免始终
 * 可见——语义锁在 lib/status-visibility.ts + 单测）、E 数字微反馈（计数变化
 * 闪品牌色）、F 完成收束（completed 定格 100%，下一次 collect 复位）。
 * 视觉 token 全在 popup.css。
 */
// 版本号走 version 子路径：barrel 入口首行 import compromise（~362 kB），
// popup 只取 CORE_VERSION 不能让 NLP 库进 bundle（popup-bundle.test 守护）
import { CORE_VERSION } from "@word-radar/core/version";
import {
  chromeTabsGateway,
  openBbdcHome,
  requestCollection,
} from "./lib/active-tab.js";
import {
  chromeSwChannel,
  confirmCollected,
  discardCollected,
  fetchCounts,
  fetchExportCsv,
  fetchLoginStatus,
  fetchPushStatus,
  importCsv,
  retryPush,
  uploadFile,
  uploadPastedText,
  type UploadFileOutcome,
} from "./lib/sw-channel.js";
import { browserCsvFileGateway } from "./lib/csv-file.js";
import { defaultErrorLogStorage, formatErrorLog, readErrorLog } from "./lib/error-log.js";
import {
  collectDroppedFiles,
  collectFilesFromHandles,
  filterUploadFiles,
  NO_SUFFIX,
} from "./lib/drop-files.js";
import { UPLOAD_LIMITS } from "./lib/messages.js";
import { isStatusLineVisible } from "./lib/status-visibility.js";
import { consumeOpenReason, chromeOpenReasonSession } from "./lib/open-reason.js";
import type { PushStatus } from "./lib/messages.js";
import { applyStaticI18n, t, t1, t3, t4 } from "./lib/i18n.js";

const BBDC_HOME_URL = "https://bbdc.cn/";

// i18n 静态回填（issue #30）：[data-i18n] 元素文本 + <html lang>，实现与
// chrome.i18n 直调全部收在 lib/i18n.ts 的 applyStaticI18n（边界模块约定）。
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => applyStaticI18n(document));
} else {
  applyStaticI18n(document);
}

const totalEl = document.querySelector<HTMLElement>('[data-testid="total"]');
const pendingEl = document.querySelector<HTMLElement>('[data-testid="pending"]');
const pushedEl = document.querySelector<HTMLElement>('[data-testid="pushed"]');
const statusEl = document.querySelector<HTMLElement>('[data-testid="status"]');
const versionEl = document.querySelector<HTMLElement>('[data-testid="version"]');
const collectButton = document.querySelector<HTMLButtonElement>(
  '[data-testid="collect"]',
);
const loginStatusEl = document.querySelector<HTMLElement>(
  '[data-testid="login-status"]',
);
const checkLoginButton = document.querySelector<HTMLButtonElement>(
  '[data-testid="check-login"]',
);
const openBbdcButton = document.querySelector<HTMLButtonElement>(
  '[data-testid="open-bbdc"]',
);
const retryPushButton = document.querySelector<HTMLButtonElement>('[data-testid="retry-push"]');
const pushStatusEl = document.querySelector<HTMLElement>('[data-testid="push-status"]');
const pushSucceededEl = document.querySelector<HTMLElement>('[data-testid="push-succeeded"]');
const pushExistingEl = document.querySelector<HTMLElement>('[data-testid="push-existing"]');
const pushFailedEl = document.querySelector<HTMLElement>('[data-testid="push-failed"]');
const pushProgressEl = document.querySelector<HTMLElement>('[data-testid="push-progress"]');
const pushProgressFillEl = document.querySelector<HTMLElement>('[data-testid="push-progress-fill"]');
const emptyHintEl = document.querySelector<HTMLElement>('[data-testid="empty-hint"]');
const exportCsvButton = document.querySelector<HTMLButtonElement>('[data-testid="export-csv"]');
const importCsvButton = document.querySelector<HTMLButtonElement>('[data-testid="import-csv"]');
const uploadCanvas = document.querySelector<HTMLElement>('[data-testid="upload-canvas"]');
// 「选择文件夹」次级入口（bug A）：showDirectoryPicker 目录 picker（见下）
const uploadPickDirButton = document.querySelector<HTMLButtonElement>('[data-testid="upload-pick-dir"]');
const syncStatusEl = document.querySelector<HTMLElement>('[data-testid="sync-status"]');
const exportLogButton = document.querySelector<HTMLButtonElement>('[data-testid="export-log"]');
const confirmSection = document.querySelector<HTMLElement>('[data-testid="confirm-section"]');
const confirmSummaryEl = document.querySelector<HTMLElement>('[data-testid="confirm-summary"]');
// 上传 meta（替换提示/收录摘要，code-review P1）：确认卡展开期间状态行 info
// 态被 D 互斥隐藏，meta 移入卡内呈现
const confirmMetaEl = document.querySelector<HTMLElement>('[data-testid="confirm-meta"]');
const confirmPushButton = document.querySelector<HTMLButtonElement>('[data-testid="confirm-push"]');
const cancelCollectButton = document.querySelector<HTMLButtonElement>('[data-testid="cancel-collect"]');
const toolsToggleButton = document.querySelector<HTMLButtonElement>('[data-testid="tools-toggle"]');
const toolsPanel = document.querySelector<HTMLElement>('[data-testid="tools-panel"]');
const toolsChevron = document.querySelector<HTMLElement>('[data-testid="tools-chevron"]');
// 覆盖确认条（code-review P0）：window.confirm 在扩展 action popup 中不显示
// 且恒 false、popup 直接被关——覆盖询问改为画布下方内联确认条
const overwriteAskEl = document.querySelector<HTMLElement>('[data-testid="overwrite-ask"]');
const overwriteAcceptButton = document.querySelector<HTMLButtonElement>('[data-testid="overwrite-accept"]');
const overwriteDismissButton = document.querySelector<HTMLButtonElement>('[data-testid="overwrite-dismiss"]');

if (versionEl) {
  versionEl.textContent = `core ${CORE_VERSION}`;
}

// 推送进度条的可访问名称：data-i18n 只回填文本，属性须启动时设置
if (pushProgressEl) {
  pushProgressEl.setAttribute("aria-label", t("pushProgress"));
}

// ── 显隐防抖（C）：confirm 卡片与工具面板统一走 grid-template-rows 过渡 ──

function isRevealOpen(el: HTMLElement | null): boolean {
  return el?.classList.contains("open") ?? false;
}

function setRevealOpen(el: HTMLElement | null, open: boolean): void {
  el?.classList.toggle("open", open);
}

// ── 状态行互斥（D）+ 空态提示 ──────────────────────────────────────────

let lastKnownTotal: number | null = null;

function updateStatusVisibility(): void {
  if (statusEl) {
    // D 互斥 + error 豁免（返工锁定）：卡片开着只藏中性状态，错误始终可见
    statusEl.hidden = !isStatusLineVisible(isRevealOpen(confirmSection), statusEl.dataset.tone);
  }
}

function updateEmptyHint(): void {
  if (emptyHintEl) {
    emptyHintEl.hidden = !(lastKnownTotal === 0 && !isRevealOpen(confirmSection));
  }
}

/** 状态行统一写入口：tone 区分中性 / 错误（错误态 danger 深红文字，见 popup.css）。
 *  statusEl 的 tone 变化即时重算互斥可见性（error 豁免在卡片可见时生效）。 */
function renderStatusLine(
  el: HTMLElement | null,
  text: string,
  tone: "info" | "error" = "info",
): void {
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = tone;
  if (el === statusEl) updateStatusVisibility();
}

// ── 计数渲染：null → 骨架脉冲；值变化 → 品牌色一闪（E，初始 null→值 不闪）──

let prevTotal: number | null = null;
let prevPending: number | null = null;
let prevPushed: number | null = null;

function flashCountValue(el: HTMLElement): void {
  el.classList.remove("flash");
  void el.offsetWidth; // 强制 reflow：连续变化时重启动画
  el.classList.add("flash");
}

function renderCountValue(el: HTMLElement | null, next: number | null, prev: number | null): void {
  if (!el) return;
  if (next === null) {
    el.textContent = "";
    el.classList.add("is-skeleton");
    return;
  }
  el.classList.remove("is-skeleton");
  el.textContent = String(next);
  if (prev !== null && prev !== next) flashCountValue(el);
}

function renderCounts(total: number | null, pending: number | null): void {
  // 已推送 = 词库总词数 - 待推（推送在 SW 逐词 markPushed，待推递减 → 已推送递增）
  const pushed = total === null || pending === null ? null : Math.max(0, total - pending);
  renderCountValue(totalEl, total, prevTotal);
  renderCountValue(pendingEl, pending, prevPending);
  renderCountValue(pushedEl, pushed, prevPushed);
  prevTotal = total;
  prevPending = pending;
  prevPushed = pushed;
  // 词库待推池是 Retry 可见性的判定源（updateRetryVisibility 注释），counts
  // 可能晚于 push 状态渲染到达——到达即重评，避免「全推完仍显示 Retry」驻留
  lastPoolPending = pending;
  updateRetryVisibility(lastPushStatus);
  lastKnownTotal = total;
  updateEmptyHint();
}

// 数字微反馈收尾：动画结束摘掉类（animationName 过滤，避免误清骨架脉冲）
for (const el of [totalEl, pendingEl, pushedEl]) {
  el?.addEventListener("animationend", (event) => {
    if ((event as AnimationEvent).animationName === "wr-count-flash") {
      el.classList.remove("flash");
    }
  });
}

type LoginState = "unknown" | "logged-in" | "logged-out";

function renderLogin(state: LoginState): void {
  if (!loginStatusEl) return;
  loginStatusEl.dataset.state = state;
  // unknown = 加载中：骨架脉冲（无文本、无状态点）
  if (state === "unknown") {
    loginStatusEl.textContent = "";
    loginStatusEl.classList.add("is-skeleton");
    return;
  }
  loginStatusEl.classList.remove("is-skeleton");
  loginStatusEl.textContent =
    state === "logged-in" ? t("statusLoggedIn") : t("statusLoggedOut");
  if (openBbdcButton) {
    openBbdcButton.hidden = state !== "logged-out";
  }
}

// ── 推送状态渲染：文本 + 进度条（F：completed 定格 100%）+ retry 条件可见（A）──

function clamp01(ratio: number): number {
  return Math.min(1, Math.max(0, ratio));
}

function renderPushProgress(phase: PushStatus["phase"], processed: number, total: number): void {
  if (!pushProgressEl) return;
  pushProgressEl.dataset.phase = phase;
  // completed 定格 100%；running/paused 按 processed/total；idle 归零
  const ratio = phase === "completed" ? 1 : total > 0 ? clamp01(processed / total) : 0;
  if (pushProgressFillEl) {
    pushProgressFillEl.style.transform = `scaleX(${ratio})`;
  }
  pushProgressEl.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
}

/** F 完成收束的复位侧：下一次 collect() 开始新周期时进度条归零。 */
function resetPushProgress(): void {
  if (pushProgressEl) {
    pushProgressEl.dataset.phase = "idle";
    pushProgressEl.setAttribute("aria-valuenow", "0");
  }
  if (pushProgressFillEl) {
    pushProgressFillEl.style.transform = "scaleX(0)";
  }
}

/**
 * Retry 可见性的双源状态（用户报告「全推完仍显示 Retry」的修复）：
 * - lastPushStatus：SW PushStatus（renderPushStatus 写入）
 * - lastPoolPending：词库待推池计数（renderCounts 写入；null=尚未到达）
 * 两路异步渲染，任一路到达都经 updateRetryVisibility 重评（晚到的一方
 * 触发收敛），避免「轮次渲染早于计数到达」的状态驻留。
 */
let lastPushStatus: PushStatus | null = null;
let lastPoolPending: number | null = null;

/**
 * Retry 可见性：判定源是【词库待推池】而非 SW 轮次快照——Retry 的动作语义
 * 就是「把词库待推池再推一轮」，池空即无可重试（含全部成功的 completed 轮
 * 与空轮，用户报「Push completed 0 失败 0 待推」时按钮仍渲染、还撑出滚动条）。
 * 池里有词则一律显示（completed 后失败保留词/真网 401 逃逸词的兜底入口，
 * e2e badge 用例靠它；PushStatus.total 是本轮快照量、看不到池，不能用）。
 * counts 未到达（null）时保守按 total>0 显示（避免 boot 闪隐）；
 * running 恒显示（禁用）。
 */
function updateRetryVisibility(status: PushStatus | null): void {
  if (!retryPushButton || !status) return;
  const poolHasWords =
    lastPoolPending === null ? status.total > 0 : lastPoolPending > 0;
  retryPushButton.hidden = status.phase !== "running" && !poolHasWords;
  retryPushButton.disabled = status.phase === "running";
}

function renderPushStatus(status: PushStatus): void {
  const label = status.phase === "running"
    ? t3("pushRunning", status.processed, status.total, status.pending)
    : status.phase === "paused"
      ? status.error
        ? t1("pushPausedWithError", status.error)
        : t("pushPaused")
      : status.phase === "completed"
        ? t("pushCompleted")
        : t("pushIdle");
  if (pushStatusEl) pushStatusEl.textContent = label;
  if (pushStatusEl) pushStatusEl.dataset.phase = status.phase;
  renderPushProgress(status.phase, status.processed, status.total);
  if (pushSucceededEl) pushSucceededEl.textContent = String(status.succeeded);
  if (pushExistingEl) pushExistingEl.textContent = String(status.existing);
  if (pushFailedEl) {
    pushFailedEl.textContent = String(status.failed);
    // failed > 0 时数值转 danger（纯视觉类切换，语义在 popup.css）
    pushFailedEl.classList.toggle("is-failed", status.failed > 0);
  }
  if (retryPushButton) {
    lastPushStatus = status;
    updateRetryVisibility(status);
  }
}

async function refreshPushStatus(): Promise<void> {
  const status = await fetchPushStatus(chromeSwChannel);
  if (status) {
    renderPushStatus(status);
    // 任何一次刷新发现 running 就自启轮询：boot 时轮询会因 phase=idle 自行
    // 停止，之后手动 retry-push / 采集触发的自动推送必须重新拉起，否则
    // 推送状态永久冻结在最后一次渲染（e2e 发现的产品 bug）。
    if (status.phase === "running") startPushStatusPolling();
  }
}

async function requestRetryPush(): Promise<void> {
  if (retryPushButton) retryPushButton.disabled = true;
  try {
    await retryPush(chromeSwChannel);
    await refreshPushStatus();
  } finally {
    // 恢复可用性交给 phase 语义：running 仍禁用（A），其余放行
    if (retryPushButton) {
      retryPushButton.disabled = pushStatusEl?.dataset.phase === "running";
    }
  }
}

function renderSyncStatus(text: string): void {
  renderStatusLine(syncStatusEl, text);
}

/** 导出文件名：word-radar-YYYYMMDD-HHmm.csv（本地时区）。 */
function csvExportFileName(now: Date = new Date()): string {
  return exportFileName("csv", now);
}

/** 导出日志文件名：word-radar-YYYYMMDD-HHmm.log（本地时区，issue #25）。 */
function logExportFileName(now: Date = new Date()): string {
  return exportFileName("log", now);
}

function exportFileName(extension: string, now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `word-radar-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.${extension}`
  );
}

/** T11 导出：向 SW 要 CSV 文本，交给文件网关触发浏览器下载。 */
async function exportCsv(): Promise<void> {
  if (exportCsvButton) exportCsvButton.disabled = true;
  renderSyncStatus(t("exporting"));
  try {
    const outcome = await fetchExportCsv(chromeSwChannel);
    if (outcome.ok) {
      browserCsvFileGateway.download(csvExportFileName(), outcome.csv);
      renderSyncStatus(t("exportCsvSuccess"));
    } else {
      renderStatusLine(syncStatusEl, t1("exportFailed", outcome.error), "error");
    }
  } finally {
    if (exportCsvButton) exportCsvButton.disabled = false;
  }
}

/**
 * 导出日志（issue #25）：读 storage.local 环形缓冲的错误日志 → 可读文本下载。
 * 直读 storage.local（扩展自身存储，无需消息转发、零新权限）。
 */
async function exportLog(): Promise<void> {
  if (exportLogButton) exportLogButton.disabled = true;
  renderSyncStatus(t("exporting"));
  try {
    const records = await readErrorLog(defaultErrorLogStorage());
    if (records.length === 0) {
      renderSyncStatus(t("noErrorLogs"));
      return;
    }
    browserCsvFileGateway.download(logExportFileName(), formatErrorLog(records));
    renderSyncStatus(t1("exportedLogCount", records.length));
  } catch {
    renderStatusLine(syncStatusEl, t("exportLogFailed"), "error");
  } finally {
    if (exportLogButton) exportLogButton.disabled = false;
  }
}

/**
 * T11 导入（review S-3 改走确认闸门）：文件网关读本地 CSV → SW 解析并
 * 驻留待确认批次（坏文件零写入）→ 确认页展示「本次共计导入 N 个单词，
 * 其中新词 M 个」。确认 = 合并入库 + 一轮推送（同采集）；取消丢弃批次。
 */
async function importCsvFromFile(): Promise<void> {
  const picked = await browserCsvFileGateway.pickCsvText();
  if (!picked) return; // 用户取消：静默
  if (importCsvButton) importCsvButton.disabled = true;
  renderSyncStatus(t1("importingFile", picked.name));
  try {
    const outcome = await importCsv(chromeSwChannel, picked.text, picked.name);
    if (outcome.ok) {
      // 批次已驻留 SW 内存：展示确认页（措辞用「导入」，计数语义与采集一致）
      renderConfirmPage("sourceImport", outcome.total, outcome.newCount);
      renderSyncStatus(t1("importParsedPending", picked.name));
    } else {
      renderStatusLine(syncStatusEl, t1("importFailed", outcome.error), "error");
    }
  } finally {
    if (importCsvButton) importCsvButton.disabled = false;
  }
}


/**
 * 上传采集（issue #24；#38 改多文件；#41 v1.1-T4 画布化；code-review 返工）：
 * 三种输入手势（画布点击 / 拖放 / 粘贴文件）统一汇入同一条闸门管线：
 * File[] → filterUploadFiles（白名单过滤 + 双上限整批校验）→ 摘要反馈
 * → readUploadFiles（读取 + html/xml 预处理）→ SW 合并提取（整批 =
 * 一次采集）→ 驻留待确认批次 → 确认卡。点击路径不再绕过白名单/双上限。
 * 覆盖语义（决议 A5）：驻留批来源 upload → 静默替换（确认卡内提示「已替换」）；
 * 来源 collect/import → 内联确认条询问（window.confirm 在 action popup 不可用），
 * 拒绝即丢弃本次输入。
 */

// 驻留批次来源（issue #41 覆盖语义）：renderConfirmPage 时记录，批次确认 /
// 取消后清空。仅 popup 本地记忆——popup 重开后对 SW 内存中的旧批次不可知，
// 视同无驻留批（与确认卡可见性同一记忆边界）。
let lastBatchSource: "collect" | "import" | "upload" | null = null;

/** 确认卡内容快照（code-review #22）：上传失败分支用它恢复被收起的卡片。 */
interface ConfirmCardSnapshot {
  sourceKey: "sourceCollect" | "sourceImport" | "sourceUpload";
  total: number;
  newCount: number;
  meta?: string;
}

// 最近一次确认卡快照：renderConfirmPage 时记录，批次确认 / 取消后清空
// （此时批次已消费，恢复旧卡反而错误）。上传失败分支恢复用——SW 整批拒绝
// 时旧 pendingBatch 仍驻留内存，卡片已撤会让它成孤儿（无法确认/取消、
// badge "?" 常驻）。
let lastConfirmCard: ConfirmCardSnapshot | null = null;

// 上传进行中防重入（issue #41）：期间忽略画布新的点击/拖放输入。
// 覆盖确认条可见期间同样置 true（防并发新输入），关闭时复位。
let isUploading = false;

/**
 * 上传前的覆盖闸门（决议 A5；code-review P1 改 requestOverwriteGate 一次
 * 返回两值，消掉「gate 放行后、hideConfirmPage 前取值」的隐式时序陷阱）：
 * - 无驻留批（lastBatchSource === null，即 popup 认为没有驻留批）：放行；
 * - upload 驻留批：静默替换，replacing=true（确认卡内提示「已替换」）；
 * - collect/import 驻留批：allowed=false → 弹内联确认条。
 * 判定依据从确认卡可见性改为 lastBatchSource（驻留记忆本身）：collect /
 * 上传失败路径 hideConfirmPage 不清 lastBatchSource——SW 内存里的批次仍
 * 驻留，卡片可见性判定会静默越过 confirm。
 */
function requestOverwriteGate(): { allowed: boolean; replacing: boolean } {
  if (lastBatchSource === null) return { allowed: true, replacing: false };
  if (lastBatchSource === "upload") return { allowed: true, replacing: true };
  return { allowed: false, replacing: false };
}

// ── 覆盖确认条（code-review P0）：window.confirm 的内联替代 ──────────────

/** 待上传上下文：覆盖确认通过后要继续执行的作业（闭包捕获本次输入）。 */
let pendingOverwriteJob: (() => Promise<void>) | null = null;

/** 显示确认条并暂存作业：期间 isUploading=true 挡新输入；accept 按钮落焦。 */
function showOverwriteAsk(job: () => Promise<void>): void {
  pendingOverwriteJob = job;
  isUploading = true;
  if (overwriteAskEl) overwriteAskEl.hidden = false;
  overwriteAcceptButton?.focus();
}

/** 关闭确认条并丢弃暂存作业（dismiss / Esc / 上传收尾共用），复位 isUploading。 */
function hideOverwriteAsk(): void {
  const hadFocus = overwriteAskEl?.contains(document.activeElement) ?? false;
  pendingOverwriteJob = null;
  if (overwriteAskEl) overwriteAskEl.hidden = true;
  isUploading = false; // 复位防重入：accept 路径不经此函数（自行保持 true 到作业收尾）
  if (hadFocus) uploadCanvas?.focus(); // 焦点回收：回到上传入口（同 hideConfirmPage 先例）
}

overwriteAcceptButton?.addEventListener("click", () => {
  const job = pendingOverwriteJob;
  if (!job) return;
  // 收条但不复位 isUploading：上传仍在进行，作业的 withUploadGuard finally 复位
  pendingOverwriteJob = null;
  if (overwriteAskEl) overwriteAskEl.hidden = true;
  void job();
});

overwriteDismissButton?.addEventListener("click", () => {
  hideOverwriteAsk(); // 丢弃本次输入：什么都不发生
});

// Esc 丢弃（同确认卡 Esc=取消的先例）：accept 落焦时 Esc 落到本监听器
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && overwriteAskEl && !overwriteAskEl.hidden) {
    event.preventDefault();
    hideOverwriteAsk();
  }
});

/**
 * 上传作业包装：isUploading 防重入置位 + 三入口统一顶层兜底（code-review
 * P1：意外异常不再变成 void 调用的 unhandled rejection、用户零反馈）+
 * 收尾一律复位确认条（上传开始后确认条必须隐藏；暂存作业被异常打断时
 * 一并复位）。
 */
function withUploadGuard(job: () => Promise<void>): () => Promise<void> {
  return async () => {
    isUploading = true;
    try {
      await job();
    } catch {
      renderStatusLine(statusEl, t("uploadUnexpectedError"), "error");
    } finally {
      hideOverwriteAsk();
      isUploading = false;
    }
  };
}

/**
 * 上传入口统一分流（三入口共用）：isUploading 防重入 → 覆盖闸门 →
 * - 放行：立即执行作业（withUploadGuard 包裹）；
 * - collect/import 驻留批：不执行上传，暂存作业并显示内联确认条。
 * replacing 在闸门判定时一并取值注入作业（accept 路径恒 false——需要确认
 * 的必然是 collect/import 驻留批，不存在「替换上传批」的确认形态）。
 */
async function dispatchUpload(
  job: (replacing: boolean) => Promise<void>,
): Promise<void> {
  if (isUploading) return; // 上传进行中 / 确认条待决：防重入
  const gate = requestOverwriteGate();
  if (!gate.allowed) {
    showOverwriteAsk(withUploadGuard(() => job(false)));
    return;
  }
  await withUploadGuard(() => job(gate.replacing))();
}

/**
 * 收录摘要（决议 A6）：只报后缀类别（去重排序，不展开文件名）。
 * M>0 → 「已收录 N 个文件，忽略 M 个（.x .y）」；M=0 → 「已收录 N 个文件」。
 */
function renderUploadSummary(
  acceptedCount: number,
  ignoredCount: number,
  ignoredSuffixes: readonly string[],
): string {
  if (ignoredCount === 0) return t1("uploadSummaryFiles", acceptedCount);
  const categories = ignoredSuffixes
    .map((suffix) => (suffix === NO_SUFFIX ? t("uploadIgnoredNoSuffix") : `.${suffix}`))
    .join(" ");
  return t3("uploadSummaryIgnored", acceptedCount, ignoredCount, categories);
}

/**
 * 上传批的公共尾段（code-review #20 参数化：文件通道与粘贴文本通道共用一
 * 份成功/失败尾部）：收卡 → 进行中状态行 → send() 发送 → 成功出确认卡
 * （替换提示 / 收录摘要挂卡内 meta——状态行 info 态在卡片展开期间被 D 互斥
 * 隐藏，两段都在时以「·」并置）/ 失败恢复确认卡 + 错误状态行。
 */
async function runUploadBatch(
  send: () => Promise<UploadFileOutcome>,
  collectingStatus: string,
  meta: { replaced: boolean; summary: string | null },
): Promise<void> {
  hideConfirmPage();
  renderStatusLine(statusEl, collectingStatus);
  const outcome = await send();
  if (outcome.ok) {
    // 批次已驻留 SW 内存：确认卡即成功反馈（措辞用「上传采集」）
    const notes = [meta.replaced ? t("uploadReplacedBatch") : null, meta.summary]
      .filter(Boolean)
      .join(" · ");
    renderConfirmPage("sourceUpload", outcome.total, outcome.newCount, notes || undefined);
  } else {
    // 失败恢复确认卡（code-review #22）：开头 hideConfirmPage 已把卡片撤下，
    // 而 SW 整批拒绝时旧 pendingBatch 仍驻留内存——不恢复就成孤儿（无法确认/
    // 取消、badge "?" 常驻）。用快照重渲染恢复是正确语义；若失败源于
    // sendMessage 断连（批次实际已丢），恢复后的确认会得到 SW 的明确错误
    //（no-pending-batch），可接受边界。
    const snapshot = lastConfirmCard;
    if (snapshot) {
      renderConfirmPage(
        snapshot.sourceKey,
        snapshot.total,
        snapshot.newCount,
        snapshot.meta,
      );
    }
    renderStatusLine(statusEl, t1("uploadFailed", outcome.error), "error");
  }
}

/**
 * File[] 闸门管线（三入口统一，issue #41 决议 A6/A7）：白名单过滤 + 双上限
 * 整批校验（超限 = 整批拒绝 + 明确反馈，绝不静默截断）+ 摘要 + accepted=0
 * 早退 + 读取 → runUploadBatch。点击 / 拖放 / 粘贴文件在此汇合，语义完全一致。
 */
/**
 * 上传批量的人类可读字节（sweeper #27）：Math.ceil 换算会把 201 字节报成
 * 「1 MB」，误导用户以为触发的是体积上限——小批量按 B / KB 如实呈现；
 * 一位小数去尾零（1.0 KB → 1 KB）。上限常量本身是整 MB，展示侧仍写「20 MB」。
 */
function formatUploadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const trim = (value: string): string => value.replace(/\.0$/, "");
  if (bytes < 1024 * 1024) return `${trim((bytes / 1024).toFixed(1))} KB`;
  return `${trim((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

async function processUploadFiles(files: File[], replacing: boolean): Promise<void> {
  const gate = filterUploadFiles(files, UPLOAD_LIMITS);
  if (gate.limitError) {
    // 整批拒绝：上限（常量，整 MB）与本批量（sweeper #27：B/KB/MB 如实换算）
    renderStatusLine(
      statusEl,
      t4(
        "uploadLimitExceeded",
        UPLOAD_LIMITS.maxFiles,
        UPLOAD_LIMITS.maxTotalBytes / (1024 * 1024),
        gate.limitError.count,
        formatUploadBytes(gate.limitError.bytes),
      ),
      "error",
    );
    return;
  }
  const summary = renderUploadSummary(
    gate.accepted.length,
    files.length - gate.accepted.length,
    gate.ignoredSuffixes,
  );
  if (gate.accepted.length === 0) {
    // 过滤后一无所剩：只报摘要，不发消息、不出确认卡（三入口同语义）
    renderStatusLine(statusEl, summary);
    return;
  }
  const parts = await browserCsvFileGateway.readUploadFiles(gate.accepted);
  if (!parts) {
    // 读取失败（sweeper #25）：不再静默中止——与超限/摘要/SW 拒绝同为明确
    // 反馈，状态行停留旧文案会让用户以为上传仍在进行
    renderStatusLine(statusEl, t("uploadReadFailed"), "error");
    return;
  }
  await runUploadBatch(
    () => uploadFile(chromeSwChannel, parts),
    // 进行中状态行（issue #38）：单文件带文件名；多文件整批带文件数
    parts.length > 1
      ? t1("uploadCollectingFiles", parts.length)
      : t1("uploadCollectingFile", parts[0]?.name ?? ""),
    { replaced: replacing, summary },
  );
}

/** 画布点击（或 Enter/Space）作业：多选选择器 → 与拖放同一条闸门管线。 */
async function performUploadFromCanvas(replacing: boolean): Promise<void> {
  const picked = await browserCsvFileGateway.pickUploadFiles();
  if (!picked) return; // 用户取消：静默
  await processUploadFiles(picked, replacing);
}

/**
 * 画布「选择文件夹」作业（bug A 定稿）：<input type=file> 天生不能选目录，
 * 文件夹点选走 File System Access 的 showDirectoryPicker（Chromium-only，
 * minimum_chrome_version 127 恒有）→ collectFilesFromHandles 递归 → 与点击/
 * 拖放/粘贴完全同一条闸门管线。用户取消（AbortError）静默返回（与点击路径
 * 取消语义一致）；空目录收集为 0 也静默（同拖放 0 文件语义）。
 */
async function performUploadFromDirectory(replacing: boolean): Promise<void> {
  let handle: FileSystemDirectoryHandle;
  try {
    const pick = window.showDirectoryPicker;
    if (typeof pick !== "function") return; // 防御：入口按钮已在 boot 隐藏，此处兜底
    handle = await pick({ mode: "read" });
  } catch (error) {
    // 用户取消是正常流：AbortError 静默；其余错误交 withUploadGuard 出明确反馈
    if ((error as DOMException)?.name === "AbortError") return;
    throw error;
  }
  const files = await collectFilesFromHandles([handle]);
  if (files.length === 0) return; // 空目录 / 全熔断：静默
  await processUploadFiles(files, replacing);
}

/** 画布拖放作业：collectDroppedFiles 已在监听器内同步起链，这里续其后段。 */
async function performUploadFromDrop(
  filesPromise: Promise<File[]>,
  replacing: boolean,
): Promise<void> {
  const files = await filesPromise;
  if (files.length === 0) return; // 拖入的既无文件也无 entry：静默
  await processUploadFiles(files, replacing);
}

/**
 * 画布粘贴作业（issue #42 v1.1-T5 决议 A3/A4）：
 * - 文件通道：与拖放同一条闸门管线（白名单过滤 + 计数摘要 + 双上限）；
 * - 文本通道：无文件名/后缀概念、不过白名单，经 UPLOAD_TEXT 直进 SW 文本
 *   提取管线（确认卡措辞仍是「上传采集」）。
 */
async function performUploadFromPaste(
  snapshot: { files: File[]; text: string },
  replacing: boolean,
): Promise<void> {
  if (snapshot.files.length > 0) {
    await processUploadFiles(snapshot.files, replacing);
    return;
  }
  // 文本通道（决议 A3）：与文件通道共用 runUploadBatch 尾段（code-review
  // #20）——批次驻留后 renderConfirmPage 记录 lastBatchSource="upload"，
  // 后续覆盖判定与拖放/点选一致
  await runUploadBatch(
    () => uploadPastedText(chromeSwChannel, snapshot.text),
    t("uploadCollectingPasted"),
    { replaced: replacing, summary: null },
  );
}

async function refreshCounts(): Promise<void> {
  const counts = await fetchCounts(chromeSwChannel);
  if (counts) {
    renderCounts(counts.total, counts.pending);
  } else {
    renderCounts(null, null);
  }
}

async function refreshLogin(): Promise<void> {
  const { loggedIn } = await fetchLoginStatus(chromeSwChannel);
  renderLogin(loggedIn ? "logged-in" : "logged-out");
}

async function checkLogin(): Promise<void> {
  if (loginStatusEl) {
    loginStatusEl.classList.remove("is-skeleton");
    loginStatusEl.textContent = t("checkingLogin");
  }
  if (checkLoginButton) checkLoginButton.disabled = true;
  try {
    await refreshLogin();
  } finally {
    if (checkLoginButton) checkLoginButton.disabled = false;
  }
}

/**
 * 确认页：展示待确认批次的总数 / 新词数，并挂起确认 / 取消按钮。
 * sourceKey 仅影响措辞（采集 / 导入 / 上传采集），计数语义与按钮行为完全一致（review S-3）。
 * meta（可选，code-review P1）：上传批的替换提示 / 收录摘要，挂卡内
 * confirm-meta——状态行在卡片展开期间被 D 互斥隐藏，meta 必须随卡呈现。
 * 同时记录驻留批次来源（issue #41 覆盖语义的判定依据）；确认 / 取消后由各自路径清空。
 */
function renderConfirmPage(
  sourceKey: "sourceCollect" | "sourceImport" | "sourceUpload",
  total: number,
  newCount: number,
  meta?: string,
): void {
  lastBatchSource =
    sourceKey === "sourceCollect"
      ? "collect"
      : sourceKey === "sourceImport"
        ? "import"
        : "upload";
  lastConfirmCard = { sourceKey, total, newCount, meta }; // #22 失败恢复用快照
  if (confirmSummaryEl) {
    const source = t(sourceKey);
    confirmSummaryEl.textContent = t3("confirmSummary", source, total, newCount);
  }
  if (confirmMetaEl) {
    confirmMetaEl.textContent = meta ?? "";
    confirmMetaEl.hidden = !meta;
  }
  setRevealOpen(confirmSection, true);
  if (confirmPushButton) {
    confirmPushButton.disabled = false;
    // B 焦点管理：卡片浮现即落到主操作
    confirmPushButton.focus();
  }
  updateStatusVisibility(); // D 状态行互斥
  updateEmptyHint();
}

function hideConfirmPage(): void {
  // 焦点回收（B 的对称侧）：卡片持有焦点时收起（确认成功 / 取消 / Esc /
  // 上传开头），reveal-clip 转 visibility:hidden 会把焦点坠回 body——先
  // 归还给稳定的采集入口；随后状态行更新由 role="status" 播报。
  if (confirmSection?.contains(document.activeElement)) {
    collectButton?.focus();
  }
  setRevealOpen(confirmSection, false);
  updateStatusVisibility(); // D：卡片收起后恢复状态行
  updateEmptyHint();
}

async function collect(): Promise<void> {
  // 挂起的上传覆盖确认 = 隐式取消（sweeper #24）：新采集会替换 SW 驻留批并
  // 重渲卡片——确认条若继续挂起，用户稍后点「继续上传」覆盖的将是他未同意
  // 丢弃的新 collect 批。收条丢弃暂存任务；对新批的覆盖询问由下次输入重新触发。
  if (pendingOverwriteJob) hideOverwriteAsk();
  renderStatusLine(statusEl, t("statusCollecting"));
  if (collectButton) collectButton.disabled = true;
  hideConfirmPage();
  resetPushProgress(); // F：新采集周期收束上一轮的完成定格
  try {
    const outcome = await requestCollection(chromeTabsGateway);
    if (outcome.ok) {
      // 确认闸门：采集结果只在 SW 内存（待确认批次），此处仅展示预览
      renderConfirmPage("sourceCollect", outcome.total, outcome.newCount);
      renderStatusLine(statusEl, t("pendingConfirm"));
    } else {
      renderStatusLine(statusEl, outcome.error, "error");
    }
  } finally {
    if (collectButton) collectButton.disabled = false;
  }
}

/** 确认推送：批次合并入词库 + 触发一轮推送全部待推，确认页过渡为推送进度。 */
async function confirmPush(): Promise<void> {
  if (confirmPushButton) confirmPushButton.disabled = true;
  if (cancelCollectButton) cancelCollectButton.disabled = true;
  try {
    const outcome = await confirmCollected(chromeSwChannel);
    if (outcome.ok) {
      // 批次已消费：驻留来源记忆与卡片快照一并清空（issue #41；code-review
      // #22——快照残留会让后续失败分支错误恢复已消费的旧卡）
      lastBatchSource = null;
      lastConfirmCard = null;
      renderCounts(outcome.counts.total, outcome.counts.pending);
      renderStatusLine(statusEl, t("confirmedPushStarted"));
      hideConfirmPage();
      // 确认即推送：拉起进度轮询（推送在 SW，popup 关闭不中断）
      await refreshPushStatus();
      startPushStatusPolling();
    } else {
      renderStatusLine(statusEl, t1("confirmFailed", outcome.error), "error");
    }
  } finally {
    if (confirmPushButton) confirmPushButton.disabled = false;
    if (cancelCollectButton) cancelCollectButton.disabled = false;
  }
}

/** 取消：丢弃待确认批次，什么都不发生（词库、推送状态不变）。 */
async function cancelCollect(): Promise<void> {
  await discardCollected(chromeSwChannel);
  // 批次已丢弃：驻留来源记忆与卡片快照一并清空（issue #41；code-review #22）
  lastBatchSource = null;
  lastConfirmCard = null;
  hideConfirmPage();
  renderStatusLine(statusEl, t("cancelled"));
}

collectButton?.addEventListener("click", () => {
  void collect();
});

confirmPushButton?.addEventListener("click", () => {
  void confirmPush();
});

cancelCollectButton?.addEventListener("click", () => {
  void cancelCollect();
});

// B 焦点管理：确认卡上 Esc 等同取消（卡片收起态 visibility:hidden，不会误触）
confirmSection?.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isRevealOpen(confirmSection)) {
    event.preventDefault();
    void cancelCollect();
  }
});

checkLoginButton?.addEventListener("click", () => {
  void checkLogin();
});

openBbdcButton?.addEventListener("click", () => {
  // spec §扩展行为：「打开不背单词」指向 https://bbdc.cn/（不固化深层 login URL）。
  void openBbdcHome(chromeTabsGateway, BBDC_HOME_URL);
});

retryPushButton?.addEventListener("click", () => {
  void requestRetryPush();
});

exportCsvButton?.addEventListener("click", () => {
  void exportCsv();
});

importCsvButton?.addEventListener("click", () => {
  void importCsvFromFile();
});

// ── 上传画布（issue #41）：唯一上传入口 ─────────────────
// aria-label 启动时按 locale 回填（data-i18n 只回填文本，属性须手动设置，
// 同 pushProgress 的先例）；role="button" 的键盘激活走 Enter/Space。
if (uploadCanvas) {
  uploadCanvas.setAttribute("aria-label", t("uploadCanvasHint"));

  uploadCanvas.addEventListener("click", () => {
    void dispatchUpload((replacing) => performUploadFromCanvas(replacing));
  });

  uploadCanvas.addEventListener("keydown", (event) => {
    // 键盘事件源自画布内后代可交互元素（「选择文件夹」按钮）时直接放行：
    // preventDefault 会取消按钮的原生激活（合成 click 不再触发，目录路径
    // 死掉），还会把 Enter/Space 劫持成 performUploadFromCanvas 的多选
    // 【文件】选择器——按钮 click 上的 stopPropagation 只拦得住鼠标路径
    if (event.target !== uploadCanvas) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void dispatchUpload((replacing) => performUploadFromCanvas(replacing));
    }
  });

  // dragenter/dragover preventDefault 才能成为放置目标；dragleave 以计数器
  // 对抗子元素间移动的抖动（进出子元素各触发一次 leave/enter）。
  let dragDepth = 0;
  const setDragging = (dragging: boolean): void => {
    uploadCanvas.dataset.dragging = String(dragging);
  };
  uploadCanvas.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    setDragging(true);
  });
  uploadCanvas.addEventListener("dragover", (event) => {
    event.preventDefault();
  });
  uploadCanvas.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragging(false);
  });
  uploadCanvas.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    setDragging(false);
    if (!event.dataTransfer) return;
    // webkitGetAsEntry / dataTransfer.files 必须在监听器内同步摘取
    //（collectDroppedFiles 首行同步快照）：先起收集 promise，再交给
    // 覆盖闸门 / 确认条流程——确认条 accept 是后续事件，届时 drag data
    // store 已释放，不能再等 accept 后才读 dataTransfer。
    const filesPromise = collectDroppedFiles(event.dataTransfer);
    void dispatchUpload((replacing) => performUploadFromDrop(filesPromise, replacing));
  });

  // 粘贴（issue #42）：画布 tabindex=0 聚焦时收到 ⌘V。paste 的 clipboardData
  // 在事件处理让出事件循环后进入保护态（getData 返回空串），文本与文件清单
  // 必须在本监听器内同步摘下（同 drop 的 webkitGetAsEntry 必须同步调用的
  // 先例），再交给覆盖闸门 / 确认条流程。
  uploadCanvas.addEventListener("paste", (event) => {
    event.preventDefault();
    const clipboard = event.clipboardData;
    const snapshot = {
      files: Array.from(clipboard?.files ?? []),
      text: (clipboard?.getData("text/plain") ?? "").trim(),
    };
    // 两者皆空：静默忽略（不进闸门，避免对空输入弹覆盖确认条）。
    // 粘贴目录技术不可行（OS 剪贴板不传目录内容）；文件夹不再靠拖放独占，
    // 改走画布内「选择文件夹」按钮（performUploadFromDirectory），辅行只留
    // 粘贴引导。
    if (snapshot.files.length === 0 && !snapshot.text) return;
    void dispatchUpload((replacing) => performUploadFromPaste(snapshot, replacing));
  });
}

// ── 画布「选择文件夹」入口（bug A 定稿）─────────────────
// TS 5.9 lib.dom 尚未收录 Window.showDirectoryPicker（File System Access，
// Chromium 86+；minimum_chrome_version 127 恒有），模块内局部 declare 兜底，
// 不引第三方类型包。
declare global {
  interface Window {
    showDirectoryPicker?(options?: {
      mode?: "read" | "readwrite";
    }): Promise<FileSystemDirectoryHandle>;
  }
}

if (uploadPickDirButton) {
  // showDirectoryPicker 缺失时隐藏入口（防御，理论上 127+ 恒有）
  if (typeof window.showDirectoryPicker !== "function") {
    uploadPickDirButton.hidden = true;
  } else {
    uploadPickDirButton.addEventListener("click", (event) => {
      // 按钮在画布内：画布自身的 click 会开多选文件选择器，冒泡会连开
      // 两条选择器——必须在此截断
      event.stopPropagation();
      void dispatchUpload((replacing) => performUploadFromDirectory(replacing));
    });
  }
}

// 页面级拖放兜底（code-review P1）：文件拖偏画布、落到页面其它区域时，
// drop 的默认行为会让 popup 导航到 file:// URL（整页被文件内容替换、扩展
// 弹窗报废）。在 document 级拦掉 dragover / drop 的默认行为——画布内处理
// 不受影响（画布是 drop 目标，事件先在画布监听器走完同一 preventDefault，
// 这里只兜住画布之外的落点）。
document.addEventListener("dragover", (event) => {
  event.preventDefault();
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
});

exportLogButton?.addEventListener("click", () => {
  void exportLog();
});

// 工具抽屉：aria-expanded + ASCII 括号标记 [+]（收起）/[-]（展开）与面板 grid 过渡联动
toolsToggleButton?.addEventListener("click", () => {
  const open = !isRevealOpen(toolsPanel);
  setRevealOpen(toolsPanel, open);
  toolsToggleButton.setAttribute("aria-expanded", String(open));
  if (toolsChevron) toolsChevron.textContent = open ? "[-]" : "[+]";
});

// 推送进行中每 ~500ms 拉一次状态，结束即停。
let pushStatusTimer: number | undefined;
function startPushStatusPolling(): void {
  if (pushStatusTimer !== undefined) return;
  const tick = async (): Promise<void> => {
    await refreshPushStatus();
    // 词库计数（待推/已推送）随 SW 的逐词 markPushed 实时变化，轮询期间同步刷新
    await refreshCounts();
    const phase = pushStatusEl?.dataset.phase;
    if (phase === "running") {
      pushStatusTimer = window.setTimeout(tick, 500);
    } else {
      pushStatusTimer = undefined;
    }
  };
  pushStatusTimer = window.setTimeout(tick, 0);
}

// 打开即：拉一次计数 + 拉一次登录态 + 拉一次推送状态。不自动采集——对当前页
// 的采集只由「采集当前页」按钮显式触发（issue #39 v1.1-T2），点图标只开弹窗。
// （上传入口是 popup 内的上传画布（issue #41），不做右键菜单目标。）
void refreshCounts();
void refreshLogin();
void refreshPushStatus().then(startPushStatusPolling);

/**
 * 右键菜单唤起分流（issue #40 v1.1-T3，决议 B1/B3/B4）：openPopup 无「打开
 * 原因」参数，SW 侧点击菜单项后写 storage.session 的 openReason 标记再
 * openPopup；本处在 boot 时一次性消费（读到即清，先清后执行，防中断残留）：
 * - "collect" → 复用「采集当前页」按钮路径 void collect()（同一确认闸门，
 *   待确认批次呈现；无独立链路，由 SW 单测的标记写入 + 既有按钮路径 e2e
 *   组合保证）；
 * - "upload" → 上传画布 focus()（tabindex=0 已就位，直达上传入口）；
 * - 无标记 → 默认态（什么都不做）：点工具栏图标打开的 popup 不经过 SW 写
 *   标记路径，不受标记影响；标记只在右键菜单路径写入、popup 一次性消费。
 */
async function applyOpenReason(): Promise<void> {
  try {
    const reason = await consumeOpenReason(chromeOpenReasonSession);
    if (reason === "collect") {
      void collect();
    } else if (reason === "upload") {
      uploadCanvas?.focus();
    }
  } catch {
    // storage.session 读/清失败（code-review 补充）：静默降级默认态——与 SW
    // 侧写失败降级对称；否则 consumeOpenReason 的 reject 会成为启动期
    // unhandled rejection（void 调用无人兜底）
  }
}
void applyOpenReason();

export {};
