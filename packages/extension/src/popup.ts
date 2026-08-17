/**
 * Popup 入口：打开即向当前活动标签页发 COLLECT_WORDS 触发采集，
 * 显示「本次采集 N 词」；「重新采集」按钮再触发一次。
 * chrome.* 调用全部在 lib/active-tab.ts 的 TabsGateway 边界内。
 */
import { CORE_VERSION } from "@word-radar/core";
import { chromeTabsGateway, requestCollection } from "./lib/active-tab.js";

const statusEl = document.querySelector<HTMLElement>('[data-testid="status"]');
const versionEl = document.querySelector<HTMLElement>('[data-testid="version"]');
const collectButton = document.querySelector<HTMLButtonElement>(
  '[data-testid="collect"]',
);

if (versionEl) {
  versionEl.textContent = `core ${CORE_VERSION}`;
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
  } finally {
    if (collectButton) collectButton.disabled = false;
  }
}

collectButton?.addEventListener("click", () => {
  void collect();
});

void collect();

export {};
