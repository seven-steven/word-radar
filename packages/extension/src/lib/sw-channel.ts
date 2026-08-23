import {
  GET_COUNTS,
  MARK_PUSHED,
  CHECK_LOGIN,
  CONFIRM_COLLECTED,
  DISCARD_COLLECTED,
  GET_PUSH_STATUS,
  RETRY_PUSH,
  EXPORT_CSV,
  IMPORT_CSV,
  isBatchPreview,
  isExportCsvResponse,
  type BatchPreview,
  type CheckLoginResponse,
  type ConfirmCollectedMessage,
  type Counts,
  type DiscardCollectedMessage,
  type PushStatus,
  type ExportCsvMessage,
  type GetCountsMessage,
  type ImportCsvMessage,
  type MarkPushedMessage,
  type CheckLoginMessage,
} from "./messages.js";

/**
 * popup 侧与 service worker 通信的边界。
 *
 * 把 `chrome.runtime.sendMessage` 收在这一个小模块，便于单测与未来切到
 * `chrome.runtime.connect` 长连接时不影响上层。
 *
 * GET_COUNTS / MARK_PUSHED / CHECK_LOGIN / EXPORT_CSV / IMPORT_CSV 是异步应答，
 * sendMessage 返回的 Promise 在 SW 调用 sendResponse 时 resolve。
 */
export interface SwChannel {
  getCounts(): Promise<unknown>;
  markPushed(lemmas: string[]): Promise<unknown>;
  checkLogin(): Promise<unknown>;
  getPushStatus(): Promise<unknown>;
  retryPush(): Promise<unknown>;
  /** T11：请求 SW 导出整个词库为 CSV 文本。 */
  exportCsv(): Promise<unknown>;
  /** T11：把本地 CSV 文本交给 SW（解析后驻留待确认批次，确认才入库）。 */
  importCsv(csvText: string, fileName: string): Promise<unknown>;
  /** 确认待确认批次（issue #22）：SW 合并入词库并触发一轮推送。 */
  confirmCollected(): Promise<unknown>;
  /** 取消：丢弃 SW 内存中的待确认批次。 */
  discardCollected(): Promise<unknown>;
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
  getPushStatus() {
    return chrome.runtime.sendMessage({ type: GET_PUSH_STATUS });
  },
  retryPush() {
    return chrome.runtime.sendMessage({ type: RETRY_PUSH });
  },
  exportCsv() {
    const message: ExportCsvMessage = { type: EXPORT_CSV };
    return chrome.runtime.sendMessage(message);
  },
  importCsv(csvText: string, fileName: string) {
    const message: ImportCsvMessage = { type: IMPORT_CSV, csvText, fileName };
    return chrome.runtime.sendMessage(message);
  },
  confirmCollected() {
    const message: ConfirmCollectedMessage = { type: CONFIRM_COLLECTED };
    return chrome.runtime.sendMessage(message);
  },
  discardCollected() {
    const message: DiscardCollectedMessage = { type: DISCARD_COLLECTED };
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

export async function fetchPushStatus(channel: SwChannel): Promise<PushStatus | null> {
  try {
    const raw = await channel.getPushStatus();
    return isPushStatus(raw) ? raw : null;
  } catch {
    return null;
  }
}

export async function retryPush(channel: SwChannel): Promise<void> {
  await channel.retryPush();
}

/**
 * 确认待确认批次（issue #22）：
 * - SW 返回 Counts（合并成功）→ `{ok:true,counts}`
 * - SW 返回 `{ok:false,error}`（无待确认批次 / 合并失败）→ 原样透传
 * - 任何其他应答 / 抛错 → `{ok:false}`
 */
export type ConfirmCollectedOutcome =
  | { ok: true; counts: Counts }
  | { ok: false; error: string };

export async function confirmCollected(
  channel: SwChannel,
): Promise<ConfirmCollectedOutcome> {
  try {
    const raw = await channel.confirmCollected();
    if (isCounts(raw)) return { ok: true, counts: raw };
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as { ok?: unknown }).ok === false &&
      typeof (raw as { error?: unknown }).error === "string"
    ) {
      return { ok: false, error: (raw as { error: string }).error };
    }
    return { ok: false, error: "confirm-unavailable" };
  } catch {
    return { ok: false, error: "confirm-unavailable" };
  }
}

/** 取消：丢弃待确认批次。fire-and-forget，失败不打扰用户。 */
export async function discardCollected(channel: SwChannel): Promise<void> {
  try {
    await channel.discardCollected();
  } catch {
    // SW 不可达时批次同样只在内存，随 SW 生命周期消失
  }
}

/** T11 导出应答（popup 侧收窄后的形态）。 */
export type ExportCsvOutcome =
  | { ok: true; csv: string }
  | { ok: false; error: string };

/**
 * T11 导出收窄：
 * - SW 报 `{ok:true,csv}` / `{ok:false,error}` → 原样透传
 * - 任何其他应答 / 抛错 → `{ok:false}`（popup 只负责展示失败）
 */
export async function fetchExportCsv(
  channel: SwChannel,
): Promise<ExportCsvOutcome> {
  try {
    const raw = await channel.exportCsv();
    if (isExportCsvResponse(raw)) return raw;
    return { ok: false, error: "export-unavailable" };
  } catch {
    return { ok: false, error: "export-unavailable" };
  }
}

/** T11 导入应答（popup 侧收窄后的形态）：成功为待确认批次预览。 */
export type ImportCsvOutcome =
  | ({ ok: true } & BatchPreview)
  | { ok: false; error: string };

/**
 * T11 导入收窄（review S-3：导入同过确认闸门）：
 * - SW 返回 BatchPreview（解析成功，批次已驻留）→ `{ok:true,total,newCount}`
 * - SW 返回 `{ok:false,error}`（坏 CSV：含文件名 + 行号）→ 原样透传
 * - 任何其他应答 / 抛错 → `{ok:false}`
 */
export async function importCsv(
  channel: SwChannel,
  csvText: string,
  fileName: string,
): Promise<ImportCsvOutcome> {
  try {
    const raw = await channel.importCsv(csvText, fileName);
    if (isBatchPreview(raw)) {
      return { ok: true, total: raw.total, newCount: raw.newCount };
    }
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as { ok?: unknown }).ok === false &&
      typeof (raw as { error?: unknown }).error === "string"
    ) {
      return { ok: false, error: (raw as { error: string }).error };
    }
    return { ok: false, error: "import-unavailable" };
  } catch {
    return { ok: false, error: "import-unavailable" };
  }
}

function isPushStatus(value: unknown): value is PushStatus {
  if (typeof value !== "object" || value === null) return false;
  const status = value as Record<string, unknown>;
  return ["idle", "running", "paused", "completed"].includes(String(status.phase)) &&
    ["total", "processed", "succeeded", "existing", "failed", "pending"].every(
      (field) => typeof status[field] === "number",
    );
}

export type { CheckLoginResponse };