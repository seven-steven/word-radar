import type { WordEntry } from "@word-radar/core";
import {
  isGetCountsMessage,
  isMarkPushedMessage,
  isWordsCollectedMessage,
  type Counts,
} from "./messages.js";

/** background 写入的 IndexedDB 仓储边界（service worker 独占）。 */
export interface BackgroundRepository {
  mergeCollected(entries: WordEntry[]): Promise<Counts>;
  getCounts(): Promise<Counts>;
  markPushed(lemmas: string[]): Promise<Counts>;
}

export interface BackgroundListenerDeps {
  repository: BackgroundRepository;
}

/**
 * service worker 的消息分发器：
 * - WORDS_COLLECTED：合并入 IndexedDB 仓储，返回最新计数（不主动 push 给 sender；
 *   popup 按需用 GET_COUNTS 拉，T09/T10 的推送循环再独立调度）
 * - GET_COUNTS：返回当前计数
 * - MARK_PUSHED：标记指定 lemma 已推，返回最新计数
 *
 * 其他消息一律忽略（返回 false，不持有消息通道）。
 *
 * 异步应答（GET_COUNTS / MARK_PUSHED）通过 return true 保持消息通道，
 * sendResponse 在仓库 promise resolve 时调用。
 */
export function createBackgroundListener(deps: BackgroundListenerDeps) {
  return (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: Counts | { ok: false; error: string }) => void,
  ): boolean => {
    if (isWordsCollectedMessage(message)) {
      void handleWordsCollected(message.entries, deps.repository).catch(() => undefined);
      return false;
    }
    if (isGetCountsMessage(message)) {
      deps.repository
        .getCounts()
        .then(sendResponse, () => sendResponse({ ok: false, error: "counts-failed" }));
      return true;
    }
    if (isMarkPushedMessage(message)) {
      deps.repository
        .markPushed(message.lemmas)
        .then(sendResponse, () => sendResponse({ ok: false, error: "mark-failed" }));
      return true;
    }
    return false;
  };
}

async function handleWordsCollected(
  entries: WordEntry[],
  repository: BackgroundRepository,
): Promise<void> {
  await repository.mergeCollected(entries);
}