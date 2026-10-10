import {
  GET_BATCH_STATE,
  GET_COUNTS,
  CHECK_LOGIN,
  CONFIRM_COLLECTED,
  DISCARD_COLLECTED,
  GET_PUSH_STATUS,
  RETRY_PUSH,
  EXPORT_CSV,
  IMPORT_CSV,
  UPLOAD_FILE,
  UPLOAD_TEXT,
  isBatchPreview,
  isBatchStateResponse,
  isCounts,
  isExportCsvResponse,
  isPushStatus,
  type BatchSource,
  type BatchPreview,
  type CheckLoginResponse,
  type ConfirmCollectedMessage,
  type Counts,
  type DiscardCollectedMessage,
  type PushStatus,
  type ExportCsvMessage,
  type GetBatchStateMessage,
  type GetCountsMessage,
  type ImportCsvMessage,
  type CheckLoginMessage,
  type UploadFileMessage,
  type UploadTextMessage,
  type UploadedFilePart,
} from "./messages.js";

/**
 * popup 侧与 service worker 通信的边界。
 *
 * 把 `chrome.runtime.sendMessage` 收在这一个小模块，便于单测与未来切到
 * `chrome.runtime.connect` 长连接时不影响上层。
 *
 * 各方法 = sendMessage + 就地收窄：返回值即 popup 可直接消费的收窄形态，
 * Promise<unknown> 透传层不再单独存在（issue #54 Wave B：透传层与收窄层合一）。
 * 畸形应答 / sendMessage 抛错（SW 未启动等）一律归一到各自的降级值，不向上层
 * 传播；唯二例外——retryPush 保持透传（popup 侧 try/finally 自决），
 * discardCollected fire-and-forget 静默吞错。
 */
/** 确认待确认批次（issue #22）的应答（popup 侧收窄后的形态）。 */
export type ConfirmCollectedOutcome =
  | { ok: true; counts: Counts }
  | { ok: false; error: string };

/** T11 导出应答（popup 侧收窄后的形态）。 */
export type ExportCsvOutcome =
  | { ok: true; csv: string }
  | { ok: false; error: string };

/** 批次驻留应答（popup 侧收窄后的形态）：CSV 导入 / 文件上传 / 粘贴文本三通道共用，成功为待确认批次预览。 */
export type BatchOutcome =
  | ({ ok: true } & BatchPreview)
  | { ok: false; error: string };

export interface SwChannel {
  /**
   * 收窄 SW 应答到 Counts | null：
   * - 合法 Counts 对象 → 返回
   * - 任何其他应答 / 抛错 → 返回 null（popup 视作「未知」）
   */
  getCounts(): Promise<Counts | null>;
  /**
   * popup 侧登录态查询收窄：
   * - SW 报 `{loggedIn:true|false}` → 原样返回（false 表示未登录）
   * - 任何其他应答 / 抛错 → 返回 `{loggedIn:false}`（按「未登录」保守处理，避免假阳性）
   *
   * 这里的收窄意图：popup 只关心「显示已登录 / 显示未登录 + 引导按钮」，
   * 真正的错误分类在 SW 端（已通过 BbdcAuthError / BbdcApiError 暴露给上层）。
   */
  checkLogin(): Promise<{ loggedIn: boolean }>;
  /** SW 推送轮快照；畸形应答 / 抛错 → null（popup 不渲染）。 */
  getPushStatus(): Promise<PushStatus | null>;
  /**
   * 驻留批来源真相查询（issue #54 Wave D，覆盖闸门判定依据）：
   * - SW 报 {source:"collect"|"import"|"upload"|null} → 原样返回
   * - 畸形应答 / sendMessage 抛错（SW 未启动等）→ null（视同无驻留批，
   *   与影子失忆时代的行为一致）
   */
  getBatchState(): Promise<BatchSource | null>;
  /** 触发一轮推送；应答体为空，拒绝原样传播（popup 侧 try/finally 自决）。 */
  retryPush(): Promise<void>;
  /**
   * T11 导出收窄：
   * - SW 报 `{ok:true,csv}` / `{ok:false,error}` → 原样透传
   * - 任何其他应答 / 抛错 → `{ok:false,"export-unavailable"}`（popup 只负责展示失败）
   */
  exportCsv(): Promise<ExportCsvOutcome>;
  /**
   * T11 导入收窄（review S-3：导入同过确认闸门）：
   * - SW 返回 BatchPreview（解析成功，批次已驻留）→ `{ok:true,total,newCount,filteredCount}`
   *   （filteredCount 必填化后恒透传；CSV 导入侧 SW 恒报 0，issue #58-6b）
   * - SW 返回 `{ok:false,error}`（坏 CSV：含文件名 + 行号）→ 原样透传
   * - 任何其他应答 / 抛错 → `{ok:false,"import-unavailable"}`
   */
  importCsv(csvText: string, fileName: string): Promise<BatchOutcome>;
  /** issue #24；#38 改文件批：把本地纯文本文件批（UPLOAD_TEXT_SUFFIXES）交给 SW（整批 = 一次采集，驻留待确认批次）。 */
  uploadFile(files: UploadedFilePart[]): Promise<BatchOutcome>;
  /** issue #42 T5：把画布粘贴的纯文本交给 SW（直进提取管线，驻留待确认批次）；应答与 uploadFile 同构（BatchOutcome）。 */
  uploadText(text: string): Promise<BatchOutcome>;
  /** 确认待确认批次（issue #22）：SW 合并入词库并触发一轮推送。 */
  confirmCollected(): Promise<ConfirmCollectedOutcome>;
  /** 取消：丢弃 SW 内存中的待确认批次。fire-and-forget，失败不打扰用户。 */
  discardCollected(): Promise<void>;
}

export const chromeSwChannel: SwChannel = {
  async getCounts() {
    const message: GetCountsMessage = { type: GET_COUNTS };
    try {
      const raw: unknown = await chrome.runtime.sendMessage(message);
      return isCounts(raw) ? raw : null;
    } catch {
      return null;
    }
  },

  async checkLogin() {
    const message: CheckLoginMessage = { type: CHECK_LOGIN };
    try {
      const raw: unknown = await chrome.runtime.sendMessage(message);
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
  },

  async getPushStatus() {
    try {
      const raw: unknown = await chrome.runtime.sendMessage({
        type: GET_PUSH_STATUS,
      });
      return isPushStatus(raw) ? raw : null;
    } catch {
      return null;
    }
  },

  async getBatchState() {
    const message: GetBatchStateMessage = { type: GET_BATCH_STATE };
    try {
      const raw: unknown = await chrome.runtime.sendMessage(message);
      // 守卫已校验 source ∈ {collect,import,upload,null}；畸形（缺字段 /
      // 未知值）与抛错一律降级 null = 无驻留批
      return isBatchStateResponse(raw) ? raw.source : null;
    } catch {
      return null;
    }
  },

  async retryPush() {
    // 不 catch：拒绝原样传播（原顶层 retryPush 的语义），popup 侧 try/finally 自决
    await chrome.runtime.sendMessage({ type: RETRY_PUSH });
  },

  async exportCsv() {
    const message: ExportCsvMessage = { type: EXPORT_CSV };
    try {
      const raw: unknown = await chrome.runtime.sendMessage(message);
      return isExportCsvResponse(raw)
        ? raw
        : { ok: false, error: "export-unavailable" };
    } catch {
      return { ok: false, error: "export-unavailable" };
    }
  },

  async importCsv(csvText: string, fileName: string) {
    const message: ImportCsvMessage = { type: IMPORT_CSV, csvText, fileName };
    try {
      const raw: unknown = await chrome.runtime.sendMessage(message);
      if (isBatchPreview(raw)) {
        // filteredCount 必填化后恒透传（CSV 导入侧 SW 恒报 0，issue #58-6b）
        return {
          ok: true,
          total: raw.total,
          newCount: raw.newCount,
          filteredCount: raw.filteredCount,
        };
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
  },

  uploadFile(files: UploadedFilePart[]) {
    const message: UploadFileMessage = { type: UPLOAD_FILE, files };
    return narrowUploadOutcome(() => chrome.runtime.sendMessage(message));
  },

  uploadText(text: string) {
    const message: UploadTextMessage = { type: UPLOAD_TEXT, text };
    return narrowUploadOutcome(() => chrome.runtime.sendMessage(message));
  },

  async confirmCollected() {
    const message: ConfirmCollectedMessage = { type: CONFIRM_COLLECTED };
    try {
      const raw: unknown = await chrome.runtime.sendMessage(message);
      if (isCounts(raw)) {
        return { ok: true, counts: raw };
      }
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
  },

  async discardCollected() {
    const message: DiscardCollectedMessage = { type: DISCARD_COLLECTED };
    try {
      await chrome.runtime.sendMessage(message);
    } catch {
      // SW 不可达时批次同样只在内存，随 SW 生命周期消失
    }
  },
};

/**
 * 上传两通道（UPLOAD_FILE / UPLOAD_TEXT）的应答同构，收窄逻辑抽成一份
 * （code-review Simplify）：
 * - SW 返回 BatchPreview（提取成功，批次已驻留）→ `{ok:true,total,newCount,filteredCount}`
 * - SW 返回 `{ok:false,error}`（任一文件后缀非法等）→ 原样透传
 * - 任何其他应答 / 抛错 → `{ok:false}`（归一 error "upload-unavailable"，
 *   两条上传通道的失败反馈同文案）
 */
async function narrowUploadOutcome(
  send: () => Promise<unknown>,
): Promise<BatchOutcome> {
  try {
    const raw = await send();
    if (isBatchPreview(raw)) {
      // filteredCount（issue #43）：必填化后恒透传（issue #58-6b；CSV 导入
      // 不经本收窄器，importCsv 自行透传、SW 侧恒报 0）
      return {
        ok: true,
        total: raw.total,
        newCount: raw.newCount,
        filteredCount: raw.filteredCount,
      };
    }
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as { ok?: unknown }).ok === false &&
      typeof (raw as { error?: unknown }).error === "string"
    ) {
      return { ok: false, error: (raw as { error: string }).error };
    }
    return { ok: false, error: "upload-unavailable" };
  } catch {
    return { ok: false, error: "upload-unavailable" };
  }
}


export type { CheckLoginResponse };