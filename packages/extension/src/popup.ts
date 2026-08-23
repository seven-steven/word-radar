/**
 * Popup 入口：打开即对当前活动标签页重新采集，展示确认页
 * 「本次共计采集 N 个单词，其中新词 M 个」（新词 = 与本地词库的 lemma diff，
 * 零网络请求）。点「确认推送」→ SW 把待确认批次合并入词库并触发一轮推送
 * 全部待推；点「取消」或关闭弹窗 → 什么都不发生（批次只在内存，不持久化）。
 * 确认即推送是唯一路径，无自动推送开关（issue #22）。
 * 打开 popup 时的 checkLogin 若发现已登录，会触发一轮存量待推重推——
 * 那是允许的恢复路径，不与「唯一路径」冲突（见 docs/spec.md 扩展行为）。
 *
 * chrome.* 调用收在两个边界模块里：
 * - active-tab.ts：popup → content（COLLECT_WORDS / 应答）+ 新标签页打开
 * - sw-channel.ts：popup → service worker（GET_COUNTS / CHECK_LOGIN /
 *   EXPORT_CSV / IMPORT_CSV / CONFIRM_COLLECTED / DISCARD_COLLECTED）
 * 本地文件操作收在 csv-file.ts（下载 / 文件选择，可注入）。
 *
 * 词库读写 + HTTP 调用 全部发生在 service worker；popup 不直连 IndexedDB、不发 HTTP。
 */
import { CORE_VERSION } from "@word-radar/core";
import {
  chromeTabsGateway,
  openBbdcHome,
  requestCollection,
} from "./lib/active-tab.js";
import {
  chromeSwChannel,
  confirmCollected,
  consumeUploadTargetFlag,
  discardCollected,
  fetchCounts,
  fetchExportCsv,
  fetchLoginStatus,
  fetchPushStatus,
  importCsv,
  retryPush,
  uploadFile,
} from "./lib/sw-channel.js";
import { browserCsvFileGateway } from "./lib/csv-file.js";
import { defaultErrorLogStorage, formatErrorLog, readErrorLog } from "./lib/error-log.js";
import type { PushStatus } from "./lib/messages.js";

const BBDC_HOME_URL = "https://bbdc.cn/";

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
const exportCsvButton = document.querySelector<HTMLButtonElement>('[data-testid="export-csv"]');
const importCsvButton = document.querySelector<HTMLButtonElement>('[data-testid="import-csv"]');
const uploadFileButton = document.querySelector<HTMLButtonElement>('[data-testid="upload-file"]');
const syncStatusEl = document.querySelector<HTMLElement>('[data-testid="sync-status"]');
const exportLogButton = document.querySelector<HTMLButtonElement>('[data-testid="export-log"]');
const confirmSection = document.querySelector<HTMLElement>('[data-testid="confirm-section"]');
const confirmSummaryEl = document.querySelector<HTMLElement>('[data-testid="confirm-summary"]');
const confirmPushButton = document.querySelector<HTMLButtonElement>('[data-testid="confirm-push"]');
const cancelCollectButton = document.querySelector<HTMLButtonElement>('[data-testid="cancel-collect"]');

if (versionEl) {
  versionEl.textContent = `core ${CORE_VERSION}`;
}

function renderCounts(total: number | null, pending: number | null): void {
  if (totalEl) totalEl.textContent = total === null ? "—" : String(total);
  if (pendingEl) pendingEl.textContent = pending === null ? "—" : String(pending);
  // 已推送 = 词库总词数 - 待推（推送在 SW 逐词 markPushed，待推递减 → 已推送递增）
  if (pushedEl) {
    pushedEl.textContent =
      total === null || pending === null ? "—" : String(Math.max(0, total - pending));
  }
}

type LoginState = "unknown" | "logged-in" | "logged-out";

function renderLogin(state: LoginState): void {
  if (!loginStatusEl) return;
  loginStatusEl.dataset.state = state;
  loginStatusEl.textContent =
    state === "logged-in"
      ? "已登录不背单词"
      : state === "logged-out"
        ? "未登录不背单词"
        : "登录状态：未知";
  if (openBbdcButton) {
    openBbdcButton.hidden = state !== "logged-out";
  }
}

function renderPushStatus(status: PushStatus): void {
  const label = status.phase === "running"
    ? `推送中 已推送 ${status.processed}/${status.total} · 待推 ${status.pending}`
    : status.phase === "paused"
      ? `推送已暂停${status.error ? `：${status.error}` : ""}`
      : status.phase === "completed"
        ? "推送完成"
        : "推送状态：空闲";
  if (pushStatusEl) pushStatusEl.textContent = label;
  if (pushStatusEl) pushStatusEl.dataset.phase = status.phase;
  if (pushSucceededEl) pushSucceededEl.textContent = String(status.succeeded);
  if (pushExistingEl) pushExistingEl.textContent = String(status.existing);
  if (pushFailedEl) pushFailedEl.textContent = String(status.failed);
  if (retryPushButton) retryPushButton.disabled = status.phase === "running";
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
    if (retryPushButton) retryPushButton.disabled = false;
  }
}

function renderSyncStatus(text: string): void {
  if (syncStatusEl) syncStatusEl.textContent = text;
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
  renderSyncStatus("导出中…");
  try {
    const outcome = await fetchExportCsv(chromeSwChannel);
    if (outcome.ok) {
      browserCsvFileGateway.download(csvExportFileName(), outcome.csv);
      renderSyncStatus("已导出 CSV");
    } else {
      renderSyncStatus(`导出失败：${outcome.error}`);
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
  renderSyncStatus("导出中…");
  try {
    const records = await readErrorLog(defaultErrorLogStorage());
    if (records.length === 0) {
      renderSyncStatus("暂无错误日志");
      return;
    }
    browserCsvFileGateway.download(logExportFileName(), formatErrorLog(records));
    renderSyncStatus(`已导出 ${records.length} 条错误日志`);
  } catch {
    renderSyncStatus("导出日志失败");
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
  renderSyncStatus(`导入 ${picked.name} 中…`);
  try {
    const outcome = await importCsv(chromeSwChannel, picked.text, picked.name);
    if (outcome.ok) {
      // 批次已驻留 SW 内存：展示确认页（措辞用「导入」，计数语义与采集一致）
      renderConfirmPage("导入", outcome.total, outcome.newCount);
      renderSyncStatus(`已解析 ${picked.name}，待确认`);
    } else {
      renderSyncStatus(`导入失败：${outcome.error}`);
    }
  } finally {
    if (importCsvButton) importCsvButton.disabled = false;
  }
}


/**
 * 上传文件采集（issue #24）：文件网关读本地 .txt/.md → SW 用与网页采集同一
 * core 提取管线处理并驻留待确认批次（确认前零网络请求）→ 确认页展示
 * 「本次共计上传采集 N 个单词，其中新词 M 个」。确认 = 合并 + 一轮推送
 * （同采集）；取消丢弃批次。
 */
async function uploadFileFromDisk(): Promise<void> {
  const picked = await browserCsvFileGateway.pickUploadText();
  if (!picked) return; // 用户取消：静默
  if (uploadFileButton) uploadFileButton.disabled = true;
  renderSyncStatus(`上传采集 ${picked.name} 中…`);
  hideConfirmPage();
  try {
    const outcome = await uploadFile(chromeSwChannel, picked.text, picked.name);
    if (outcome.ok) {
      // 批次已驻留 SW 内存：展示确认页（措辞用「上传采集」，计数语义与采集一致）
      renderConfirmPage("上传采集", outcome.total, outcome.newCount);
      if (statusEl) statusEl.textContent = "待确认";
      renderSyncStatus(`已解析 ${picked.name}，待确认`);
    } else {
      renderSyncStatus(`上传采集失败：${outcome.error}`);
    }
  } finally {
    if (uploadFileButton) uploadFileButton.disabled = false;
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
  if (loginStatusEl) loginStatusEl.textContent = "检查中…";
  if (checkLoginButton) checkLoginButton.disabled = true;
  try {
    await refreshLogin();
  } finally {
    if (checkLoginButton) checkLoginButton.disabled = false;
  }
}

/**
 * 确认页：展示待确认批次的总数 / 新词数，并挂起确认 / 取消按钮。
 * source 仅影响措辞（采集 / 导入），计数语义与按钮行为完全一致（review S-3）。
 */
function renderConfirmPage(
  source: "采集" | "导入" | "上传采集",
  total: number,
  newCount: number,
): void {
  if (confirmSummaryEl) {
    confirmSummaryEl.textContent = `本次共计${source} ${total} 个单词，其中新词 ${newCount} 个`;
  }
  if (confirmSection) confirmSection.hidden = false;
  if (confirmPushButton) confirmPushButton.disabled = false;
}

function hideConfirmPage(): void {
  if (confirmSection) confirmSection.hidden = true;
}

async function collect(): Promise<void> {
  if (statusEl) statusEl.textContent = "采集中…";
  if (collectButton) collectButton.disabled = true;
  hideConfirmPage();
  try {
    const outcome = await requestCollection(chromeTabsGateway);
    if (outcome.ok) {
      // 确认闸门：采集结果只在 SW 内存（待确认批次），此处仅展示预览
      renderConfirmPage("采集", outcome.total, outcome.newCount);
      if (statusEl) statusEl.textContent = "待确认";
    } else if (statusEl) {
      statusEl.textContent = outcome.error;
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
      renderCounts(outcome.counts.total, outcome.counts.pending);
      if (statusEl) statusEl.textContent = "已确认，推送已启动";
      hideConfirmPage();
      // 确认即推送：拉起进度轮询（推送在 SW，popup 关闭不中断）
      await refreshPushStatus();
      startPushStatusPolling();
    } else {
      if (statusEl) statusEl.textContent = `确认失败：${outcome.error}`;
    }
  } finally {
    if (confirmPushButton) confirmPushButton.disabled = false;
    if (cancelCollectButton) cancelCollectButton.disabled = false;
  }
}

/** 取消：丢弃待确认批次，什么都不发生（词库、推送状态不变）。 */
async function cancelCollect(): Promise<void> {
  await discardCollected(chromeSwChannel);
  hideConfirmPage();
  if (statusEl) statusEl.textContent = "已取消";
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

uploadFileButton?.addEventListener("click", () => {
  void uploadFileFromDisk();
});

exportLogButton?.addEventListener("click", () => {
  void exportLog();
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

// 打开即：拉一次计数 + 自动采集 + 拉一次登录态 + 拉一次推送状态；
// 右键菜单「上传文件」目标（issue #24）：消费标记后跳过默认的当前页采集，
// 显示提示引导用户手动点击「上传文件」按钮（不再尝试自动点击 input 元素，
// 避免 Chromium 用户手势规则导致的静默失败）。标记消费经 SW 消息（写读同上下文）。
void refreshCounts();
void refreshLogin();
void refreshPushStatus().then(startPushStatusPolling);
consumeUploadTargetFlag(chromeSwChannel).then((uploadRequested) => {
  if (uploadRequested) {
    // 显示提示信息，引导用户手动点击「上传文件」按钮
    renderSyncStatus("已选择采集目标：上传文件——请点击「上传文件」选择文件");
  } else {
    void collect();
  }
});

export {};