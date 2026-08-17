import {
  GET_COUNTS,
  MARK_PUSHED,
  CHECK_LOGIN,
  type CheckLoginResponse,
  type Counts,
  type GetCountsMessage,
  type MarkPushedMessage,
  type CheckLoginMessage,
} from "./messages.js";

/**
 * popup 侧与 service worker 通信的边界。
 *
 * 把 `chrome.runtime.sendMessage` 收在这一个小模块，便于单测与未来切到
 * `chrome.runtime.connect` 长连接时不影响上层。
 *
 * GET_COUNTS / MARK_PUSHED / CHECK_LOGIN 是异步应答，sendMessage 返回的
 * Promise 在 SW 调用 sendResponse 时 resolve。
 */
export interface SwChannel {
  getCounts(): Promise<unknown>;
  markPushed(lemmas: string[]): Promise<unknown>;
  checkLogin(): Promise<unknown>;
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
  checkLogin() {
    const message: CheckLoginMessage = { type: CHECK_LOGIN };
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

/**
 * popup 侧登录态查询收窄：
 * - SW 报 `{loggedIn:true|false}` → 原样返回（false 表示未登录）
 * - 任何其他应答 / 抛错 → 返回 `{loggedIn:false}`（按"未登录"保守处理，避免假阳性）
 *
 * 这里的收窄意图：popup 只关心"显示已登录 / 显示未登录 + 引导按钮"，
 * 真正的错误分类在 SW 端（已通过 BbdcAuthError / BbdcApiError 暴露给上层）。
 */
export async function fetchLoginStatus(
  channel: SwChannel,
): Promise<{ loggedIn: boolean }> {
  try {
    const raw = await channel.checkLogin();
    if (
      typeof raw === "object" &&
      raw !== null &&
      "loggedIn" in raw &&
      typeof (raw as { loggedIn: unknown }).loggedIn === "boolean"
    ) {
      return { loggedIn: (raw as { loggedIn: boolean }).loggedIn };
    }
    return { loggedIn: false };
  } catch {
    return { loggedIn: false };
  }
}

export type { CheckLoginResponse };