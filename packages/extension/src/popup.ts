/**
 * Popup 入口：打开即向当前活动标签页发 COLLECT_WORDS 触发采集，
 * 显示「累计 N / 待推 M」；点击「重新采集」按钮再次触发。
 *
 * chrome.* 调用收在两个边界模块里：
 * - active-tab.ts：popup → content（COLLECT_WORDS / 应答）
 * - sw-channel.ts：popup → service worker（GET_COUNTS 查计数）
 *
 * 词库读写全部发生在 service worker；popup 不直连 IndexedDB。
 */
import { CORE_VERSION } from "@word-radar/core";
import { chromeTabsGateway, requestCollection } from "./lib/active-tab.js";
import { chromeSwChannel, fetchCounts } from "./lib/sw-channel.js";

const totalEl = document.querySelector<HTMLElement>('[data-testid="total"]');
const pendingEl = document.querySelector<HTMLElement>('[data-testid="pending"]');
const statusEl = document.querySelector<HTMLElement>('[data-testid="status"]');
const versionEl = document.querySelector<HTMLElement>('[data-testid="version"]');
const collectButton = document.querySelector<HTMLButtonElement>(
  '[data-testid="collect"]',
);

if (versionEl) {
  versionEl.textContent = `core ${CORE_VERSION}`;
}

function renderCounts(total: number | null, pending: number | null): void {
  if (totalEl) totalEl.textContent = total === null ? "—" : String(total);
  if (pendingEl) pendingEl.textContent = pending === null ? "—" : String(pending);
}

async function refreshCounts(): Promise<void> {
  const counts = await fetchCounts(chromeSwChannel);
  if (counts) {
    renderCounts(counts.total, counts.pending);
  } else {
    renderCounts(null, null);
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

// 打开即：拉一次计数 + 自动采集
void refreshCounts();
void collect();

export {};