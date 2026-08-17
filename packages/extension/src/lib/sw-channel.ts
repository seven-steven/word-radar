import {
  GET_COUNTS,
  MARK_PUSHED,
  type Counts,
  type GetCountsMessage,
  type MarkPushedMessage,
} from "./messages.js";

/**
 * popup 侧与 service worker 通信的边界。
 *
 * 把 `chrome.runtime.sendMessage` 收在这一个小模块，便于单测与未来切到
 * `chrome.runtime.connect` 长连接时不影响上层。
 *
 * GET_COUNTS / MARK_PUSHED 是异步应答，sendMessage 返回的 Promise 在 SW
 * 调用 sendResponse 时 resolve。
 */
export interface SwChannel {
  getCounts(): Promise<unknown>;
  markPushed(lemmas: string[]): Promise<unknown>;
}

export const chromeSwChannel: SwChannel = {
  getCounts() {
    const message: GetCountsMessage = { type: GET_COUNTS };
    return chrome.runtime.sendMessage(message);
  },
  markPushed(lemmas: string[]) {
    const message: MarkPushedMessage = { type: MARK_PUSHED, lemmas };
    return chrome.runtime.sendMessage(message);
  },
};

/**
 * 收窄 SW 应答到 Counts | null：
 * - 合法 Counts 对象 → 返回
 * - 任何其他应答 / 抛错 → 返回 null（popup 视作"未知"）
 */
export async function fetchCounts(channel: SwChannel): Promise<Counts | null> {
  try {
    const raw = await channel.getCounts();
    if (!isCounts(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

function isCounts(value: unknown): value is Counts {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.total === "number" && typeof obj.pending === "number";
}