/**
 * Popup 入口：打开即向当前活动标签页发 COLLECT_WORDS 触发采集，
 * 显示「累计 N / 待推 M」；点击「重新采集」按钮再次触发。
 * T09 起再叠加：登录检查按钮 + 登录状态显示 + 未登录时显示「打开不背单词」按钮。
 * T11 起再叠加：导出 CSV（词库 → 本地下载）+ 导入 CSV（本地文件 → 词库合并）。
 *
 * chrome.* 调用收在两个边界模块里：
 * - active-tab.ts：popup → content（COLLECT_WORDS / 应答）+ 新标签页打开
 * - sw-channel.ts：popup → service worker（GET_COUNTS / CHECK_LOGIN / EXPORT_CSV / IMPORT_CSV）
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
  fetchCounts,
  fetchExportCsv,
  fetchLoginStatus,
  fetchPushStatus,
  importCsv,
  retryPush,
} from "./lib/sw-channel.js";
import { browserCsvFileGateway } from "./lib/csv-file.js";
import type { PushStatus } from "./lib/messages.js";

const BBDC_HOME_URL = "https://bbdc.cn/";

const totalEl = document.querySelector<HTMLElement>('[data-testid="total"]');
const pendingEl = document.querySelector<HTMLElement>('[data-testid="pending"]');
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
const syncStatusEl = document.querySelector<HTMLElement>('[data-testid="sync-status"]');

if (versionEl) {
  versionEl.textContent = `core ${CORE_VERSION}`;
}

function renderCounts(total: number | null, pending: number | null): void {
  if (totalEl) totalEl.textContent = total === null ? "—" : String(total);
  if (pendingEl) pendingEl.textContent = pending === null ? "—" : String(pending);
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
    ? `推送中 ${status.processed}/${status.total}${status.current ? `：${status.current}` : ""}`
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
  if (status) renderPushStatus(status);
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
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `word-radar-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.csv`
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
 * T11 导入：文件网关读本地 CSV → SW 合并（flags 按位或，坏文件零写入）→
 * 成功直接用返回的计数刷新显示；失败显示含文件名与行号的错误。
 */
async function importCsvFromFile(): Promise<void> {
  const picked = await browserCsvFileGateway.pickCsvText();
  if (!picked) return; // 用户取消：静默
  if (importCsvButton) importCsvButton.disabled = true;
  renderSyncStatus(`导入 ${picked.name} 中…`);
  try {
    const outcome = await importCsv(chromeSwChannel, picked.text, picked.name);
    if (outcome.ok) {
      renderCounts(outcome.counts.total, outcome.counts.pending);
      renderSyncStatus(
        `导入完成：累计 ${outcome.counts.total} / 待推 ${outcome.counts.pending}`,
      );
      // 导入可能带来新的待推词，推送状态随即变化
      await refreshPushStatus();
    } else {
      renderSyncStatus(`导入失败：${outcome.error}`);
    }
  } finally {
    if (importCsvButton) importCsvButton.disabled = false;
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

async function collect(): Promise<void> {
  if (statusEl) statusEl.textContent = "采集中…";
  if (collectButton) collectButton.disabled = true;
  try {
    const outcome = await requestCollection(chromeTabsGateway);
    if (statusEl) {
      statusEl.textContent = outcome.ok
        ? `本次采集 ${outcome.count} 词`
        : outcome.error;
    }
    // 采集后从 SW 拉一次最新计数（含累计 + 待推）
    await refreshCounts();
  } finally {
    if (collectButton) collectButton.disabled = false;
  }
}

collectButton?.addEventListener("click", () => {
  void collect();
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

// 推送进行中每 ~500ms 拉一次状态，结束即停。
let pushStatusTimer: number | undefined;
function startPushStatusPolling(): void {
  if (pushStatusTimer !== undefined) return;
  const tick = async (): Promise<void> => {
    await refreshPushStatus();
    const phase = pushStatusEl?.dataset.phase;
    if (phase === "running") {
      pushStatusTimer = window.setTimeout(tick, 500);
    } else {
      pushStatusTimer = undefined;
    }
  };
  pushStatusTimer = window.setTimeout(tick, 0);
}

// 打开即：拉一次计数 + 自动采集 + 拉一次登录态 + 拉一次推送状态
void refreshCounts();
void refreshLogin();
void refreshPushStatus().then(startPushStatusPolling);
void collect();

export {};