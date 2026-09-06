/**
 * Popup 入口：打开即对当前活动标签页重新采集，展示确认页
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
} from "./lib/sw-channel.js";
import { browserCsvFileGateway } from "./lib/csv-file.js";
import { defaultErrorLogStorage, formatErrorLog, readErrorLog } from "./lib/error-log.js";
import {
  collectDroppedFiles,
  filterUploadFiles,
  NO_SUFFIX,
} from "./lib/drop-files.js";
import { UPLOAD_LIMITS } from "./lib/messages.js";
import { isStatusLineVisible } from "./lib/status-visibility.js";
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
const syncStatusEl = document.querySelector<HTMLElement>('[data-testid="sync-status"]');
const exportLogButton = document.querySelector<HTMLButtonElement>('[data-testid="export-log"]');
const confirmSection = document.querySelector<HTMLElement>('[data-testid="confirm-section"]');
const confirmSummaryEl = document.querySelector<HTMLElement>('[data-testid="confirm-summary"]');
const confirmPushButton = document.querySelector<HTMLButtonElement>('[data-testid="confirm-push"]');
const cancelCollectButton = document.querySelector<HTMLButtonElement>('[data-testid="cancel-collect"]');
const toolsToggleButton = document.querySelector<HTMLButtonElement>('[data-testid="tools-toggle"]');
const toolsPanel = document.querySelector<HTMLElement>('[data-testid="tools-panel"]');
const toolsChevron = document.querySelector<HTMLElement>('[data-testid="tools-chevron"]');

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
    // A 条件可见：无推送历史且无待推时收起；running 期间禁用
    retryPushButton.hidden = status.phase === "idle" && status.pending === 0;
    retryPushButton.disabled = status.phase === "running";
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
 * 上传采集（issue #24；#38 改多文件；#41 v1.1-T4 画布化）：
 * - 画布点击 → 多选选择器（accept 白名单兜底）→ 逐文件读文本；
 * - 画布拖放 → collectDroppedFiles 递归全树 → filterUploadFiles 白名单过滤
 *   + 双上限整批校验（超限 = 整批拒绝 + 明确反馈，绝不静默截断）；
 * - 文本批 → SW 合并提取（整批 = 一次采集）→ 驻留待确认批次 → 确认卡。
 * 覆盖语义（决议 A5）：驻留批来源 upload → 静默替换 + 状态行提示；
 * 来源 collect/import → window.confirm 询问，拒绝即中止。
 * 反馈路由（返工锁定）：进行中 / 失败 / 摘要 / 替换提示一律走主状态行
 * statusEl（卡片可见时 info 态被互斥隐藏，卡关闭后仍可读；错误豁免恒可见）；
 * 成功则以确认卡为反馈。
 */

// 驻留批次来源（issue #41 覆盖语义）：renderConfirmPage 时记录，批次确认 /
// 取消后清空。仅 popup 本地记忆——popup 重开后对 SW 内存中的旧批次不可知，
// 视同无驻留批（与确认卡可见性同一记忆边界）。
let lastBatchSource: "collect" | "import" | "upload" | null = null;

// 上传进行中防重入（issue #41）：期间忽略画布新的点击/拖放输入。
let isUploading = false;

/**
 * 上传前的覆盖闸门（决议 A5）：卡片可见且有驻留批时——来源 upload 直接
 * 放行（成功后提示「已替换」）；来源 collect/import 弹 confirm 询问，
 * 用户拒绝则中止上传。
 */
function gateOverwrite(): boolean {
  if (!isRevealOpen(confirmSection)) return true; // 无驻留批：直接放行
  if (lastBatchSource === "upload") return true; // 上传覆盖上传：静默，成功后提示
  return window.confirm(t("uploadConfirmOverwrite"));
}

/** 本次上传是否将替换上一批上传文件（gate 放行后、hideConfirmPage 前取值）。 */
function isReplacingUpload(): boolean {
  return isRevealOpen(confirmSection) && lastBatchSource === "upload";
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

/** 上传批的公共尾段：SW 合并提取 → 确认卡；替换提示 / 收录摘要挂主状态行。 */
async function runUploadBatch(
  parts: { name: string; text: string }[],
  meta: { replaced: boolean; summary: string | null },
): Promise<void> {
  hideConfirmPage();
  // 进行中状态行（issue #38）：单文件带文件名；多文件整批带文件数
  renderStatusLine(
    statusEl,
    parts.length > 1
      ? t1("uploadCollectingFiles", parts.length)
      : t1("uploadCollectingFile", parts[0]?.name ?? ""),
  );
  const outcome = await uploadFile(chromeSwChannel, parts);
  if (outcome.ok) {
    // 批次已驻留 SW 内存：确认卡即成功反馈（措辞用「上传采集」）
    renderConfirmPage("sourceUpload", outcome.total, outcome.newCount);
    // 替换提示 / 收录摘要走主状态行；两段都在时以「·」并置，互不吞并
    const notes = [meta.replaced ? t("uploadReplacedBatch") : null, meta.summary]
      .filter(Boolean)
      .join(" · ");
    if (notes) renderStatusLine(statusEl, notes);
  } else {
    renderStatusLine(statusEl, t1("uploadFailed", outcome.error), "error");
  }
}

/** 画布点击（或 Enter/Space）：覆盖闸门 → 多选选择器 → 整批上传。 */
async function uploadFromCanvas(): Promise<void> {
  if (isUploading) return; // 上传进行中防重入
  if (!gateOverwrite()) return; // collect/import 驻留批被拒：中止
  const replaced = isReplacingUpload();
  isUploading = true;
  try {
    const picked = await browserCsvFileGateway.pickUploadFiles();
    if (!picked) return; // 用户取消：静默
    await runUploadBatch(picked, { replaced, summary: null });
  } finally {
    isUploading = false;
  }
}

/** 画布拖放：递归收集 → 白名单过滤 + 双上限 → 读取 → 整批上传。 */
async function uploadFromDrop(dataTransfer: DataTransfer): Promise<void> {
  if (isUploading) return; // 上传进行中防重入
  if (!gateOverwrite()) return; // collect/import 驻留批被拒：中止
  const replaced = isReplacingUpload();
  isUploading = true;
  try {
    const files = await collectDroppedFiles(dataTransfer);
    if (files.length === 0) return; // 拖入的既无文件也无 entry：静默
    const gate = filterUploadFiles(files, UPLOAD_LIMITS);
    if (gate.limitError) {
      // 整批拒绝：上限（常量）/ 本批量（进位 MB，不低估）都换算进反馈
      const mb = (bytes: number): number => Math.ceil(bytes / (1024 * 1024));
      renderStatusLine(
        statusEl,
        t4(
          "uploadLimitExceeded",
          UPLOAD_LIMITS.maxFiles,
          UPLOAD_LIMITS.maxTotalBytes / (1024 * 1024),
          gate.limitError.count,
          mb(gate.limitError.bytes),
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
      // 过滤后一无所剩：只报摘要，不发消息、不出确认卡
      renderStatusLine(statusEl, summary);
      return;
    }
    const parts = await browserCsvFileGateway.readUploadFiles(gate.accepted);
    if (!parts) return; // 任一文件读取失败：整批静默中止（与选择器路径同语义）
    await runUploadBatch(parts, { replaced, summary });
  } finally {
    isUploading = false;
  }
}

/**
 * 画布粘贴（issue #42 v1.1-T5 决议 A3/A4）：画布的第三种输入手势（是上传
 * 目标的一部分，不叫「剪贴板采集」）。
 * - 文件通道（决议 A4）：clipboardData.files 非空 → 装回 DataTransfer 走
 *   uploadFromDrop 同管线（白名单过滤 + 计数摘要 + 双上限，与拖放完全同
 *   语义）；
 * - 文本通道（决议 A3）：text/plain trim 后非空 → 无文件名/后缀概念、不过
 *   白名单，经 UPLOAD_TEXT 直进 SW 文本提取管线 → 待确认批次（确认卡措辞
 *   仍是「上传采集」）；
 * - 两者皆空：静默忽略。粘贴目录技术不可行（OS 剪贴板不传目录内容），
 *   画布辅行文案引导「文件夹请拖放」。
 * 覆盖语义与 T4 一致：粘贴也是再次输入——upload 驻留批静默替换 + 提示；
 * collect/import 驻留批 window.confirm（gateOverwrite），拒绝即中止。
 */
async function uploadFromPaste(snapshot: { files: File[]; text: string }): Promise<void> {
  if (snapshot.files.length > 0) {
    // 文件通道：装回 DataTransfer 复用拖放管线（含 isUploading 防重入与
    // gateOverwrite 覆盖闸门）；剪贴板文件没有 webkitGetAsEntry 树，
    // collectDroppedFiles 自然走 dataTransfer.files 顶层回退。
    const dt = new DataTransfer();
    for (const file of snapshot.files) dt.items.add(file);
    await uploadFromDrop(dt);
    return;
  }
  if (!snapshot.text) return; // 既无文件也无文本：静默忽略
  if (isUploading) return; // 上传进行中防重入（同两条拖放/点选通道）
  if (!gateOverwrite()) return; // collect/import 驻留批被拒：中止
  const replaced = isReplacingUpload();
  isUploading = true;
  try {
    hideConfirmPage();
    renderStatusLine(statusEl, t("uploadCollectingPasted"));
    const outcome = await uploadPastedText(chromeSwChannel, snapshot.text);
    if (outcome.ok) {
      // 批次已驻留 SW 内存：确认卡即成功反馈（措辞用「上传采集」）；
      // renderConfirmPage 记录 lastBatchSource="upload"，后续粘贴/拖放/点选
      // 的覆盖判定与 T4 完全一致，无需额外代码。
      renderConfirmPage("sourceUpload", outcome.total, outcome.newCount);
      if (replaced) renderStatusLine(statusEl, t("uploadReplacedBatch"));
    } else {
      renderStatusLine(statusEl, t1("uploadFailed", outcome.error), "error");
    }
  } finally {
    isUploading = false;
  }
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
 * 同时记录驻留批次来源（issue #41 覆盖语义的判定依据）；确认 / 取消后由各自路径清空。
 */
function renderConfirmPage(
  sourceKey: "sourceCollect" | "sourceImport" | "sourceUpload",
  total: number,
  newCount: number,
): void {
  lastBatchSource =
    sourceKey === "sourceCollect"
      ? "collect"
      : sourceKey === "sourceImport"
        ? "import"
        : "upload";
  if (confirmSummaryEl) {
    const source = t(sourceKey);
    confirmSummaryEl.textContent = t3("confirmSummary", source, total, newCount);
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
      lastBatchSource = null; // 批次已消费：驻留来源记忆清空（issue #41）
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
  lastBatchSource = null; // 批次已丢弃：驻留来源记忆清空（issue #41）
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
    void uploadFromCanvas();
  });

  uploadCanvas.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void uploadFromCanvas();
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
    if (event.dataTransfer) void uploadFromDrop(event.dataTransfer);
  });

  // 粘贴（issue #42）：画布 tabindex=0 聚焦时收到 ⌘V。paste 的 clipboardData
  // 在事件处理让出事件循环后进入保护态（getData 返回空串），文本与文件清单
  // 必须在本监听器内同步摘下（同 drop 的 webkitGetAsEntry 必须同步调用的
  // 先例），再交给异步的 uploadFromPaste。
  uploadCanvas.addEventListener("paste", (event) => {
    event.preventDefault();
    const clipboard = event.clipboardData;
    void uploadFromPaste({
      files: Array.from(clipboard?.files ?? []),
      text: (clipboard?.getData("text/plain") ?? "").trim(),
    });
  });
}

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

// 打开即：拉一次计数 + 自动采集当前页 + 拉一次登录态 + 拉一次推送状态。
// （上传入口是 popup 内的上传画布（issue #41），不做右键菜单目标。）
void refreshCounts();
void refreshLogin();
void refreshPushStatus().then(startPushStatusPolling);
void collect();

export {};
