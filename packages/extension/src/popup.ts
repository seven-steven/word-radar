/**
 * Popup 入口：打开即向当前活动标签页发 COLLECT_WORDS 触发采集，
 * 显示「累计 N / 待推 M」；点击「重新采集」按钮再次触发。
 * T09 起再叠加：登录检查按钮 + 登录状态显示 + 未登录时显示「打开不背单词」按钮。
 *
 * chrome.* 调用收在两个边界模块里：
 * - active-tab.ts：popup → content（COLLECT_WORDS / 应答）+ 新标签页打开
 * - sw-channel.ts：popup → service worker（GET_COUNTS / CHECK_LOGIN）
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
  fetchLoginStatus,
} from "./lib/sw-channel.js";

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

// 打开即：拉一次计数 + 自动采集 + 拉一次登录态
void refreshCounts();
void refreshLogin();
void collect();

export {};