import {
  parseWordListCsv,
  stringifyWordListCsv,
  type WordEntry,
} from "@word-radar/core";
import {
  isCheckLoginMessage,
  isConfirmCollectedMessage,
  isDiscardCollectedMessage,
  isExportCsvMessage,
  isGetCountsMessage,
  isImportCsvMessage,
  isMarkPushedMessage,
  isWordsCollectedMessage,
  isRetryPushMessage,
  isGetPushStatusMessage,
  type BatchPreview,
  type CheckLoginResponse,
  type Counts,
  type ExportCsvResponse,
  type ImportCsvResponse,
  type PushStatus,
} from "./messages.js";
import { createBbdcClient, type BbdcClient } from "./bbdc-client.js";
import { chromeActionBadge } from "./action-badge.js";
import { PushCoordinator } from "./push-coordinator.js";
import { createErrorLogger, type ErrorLogger } from "./error-log.js";

/** background 写入的 IndexedDB 仓储边界（service worker 独占）。 */
export interface BackgroundRepository {
  mergeCollected(entries: WordEntry[]): Promise<Counts>;
  /** 确认页新词 diff（lemma 对比本地词库，零网络请求）。 */
  countNew(entries: WordEntry[]): Promise<number>;
  getCounts(): Promise<Counts>;
  markPushed(lemmas: string[]): Promise<Counts>;
  listPending(): Promise<WordEntry[]>;
  /** T11：导出全量词条（CSV 导出用）。 */
  getAll(): Promise<WordEntry[]>;
}

/**
 * BbdcClient 的最小面（spec §不背单词对接）。
 * background 持有客户端实例，注入 fetch；上层只调 checkLogin。
 * T10 起会被扩展到 lookupDefinition / checkExisting / addWord / 等。
 */
export interface BackgroundBbdcClient {
  checkLogin(): Promise<{ loggedIn: boolean; resultCode: number }>;
  listNewWords(page: number): Promise<ReturnType<BbdcClient["listNewWords"]> extends Promise<infer T> ? T : never>;
  checkExisting(word: string): ReturnType<BbdcClient["checkExisting"]>;
  lookupDefinition(word: string): ReturnType<BbdcClient["lookupDefinition"]>;
  addWord(word: string, info: string): ReturnType<BbdcClient["addWord"]>;
}

export interface ActionBadgeGateway {
  set(text: string | null): Promise<void>;
}

export interface BackgroundListenerDeps {
  repository: BackgroundRepository;
  /** 注入 BbdcClient（默认 lazy 创建，使用全局 fetch）。 */
  bbdcClient?: BackgroundBbdcClient;
  /** 注入 action badge 网关（默认 lazy 创建 chromeActionBadge）。 */
  actionBadge?: ActionBadgeGateway;
  pushCoordinator?: PushCoordinator;
  /** 错误日志（issue #25）：默认写 chrome.storage.local 环形缓冲。 */
  errorLogger?: ErrorLogger;
}

/**
 * service worker 的消息分发器（确认闸门定稿，issue #22）：
 * - WORDS_COLLECTED：批次只驻留内存（待确认批次），不写库不推送；
 *   用词库 lemma diff 算新词数，应答 {total,newCount}（零网络请求）
 * - CONFIRM_COLLECTED：确认——批次合并入词库（成功才清空待确认批次，
 *   失败保留以便重试），随后非阻塞触发一轮推送
 *   （覆盖整个待推池，含 CSV 导入的存量）；应答最新计数
 * - DISCARD_COLLECTED：取消——丢弃内存中的待确认批次，不持有通道
 * - GET_COUNTS：返回当前计数
 * - MARK_PUSHED：标记指定 lemma 已推，返回最新计数
 * - CHECK_LOGIN（T09）：调 BbdcClient.checkLogin；成功 → 清除 badge；
 *   失败 → 设 badge "!" 并应答 {loggedIn:false}
 * - EXPORT_CSV（T11）：getAll → core stringify，应答 {ok:true,csv}
 * - IMPORT_CSV（review S-3 改走确认闸门）：core parse（失败即应答错误，
 *   零写入）→ countNew 算新词 diff → 驻留待确认批次（与采集批次同形态，
 *   覆盖任何旧批次）→ 应答 {total,newCount}；不写库、不推送，入库与
 *   推送仅由 CONFIRM_COLLECTED 触发
 *
 * 其他消息一律忽略（返回 false，不持有消息通道）。
 *
 * 异步应答（WORDS_COLLECTED / CONFIRM_COLLECTED / GET_COUNTS / MARK_PUSHED /
 * CHECK_LOGIN / EXPORT_CSV / IMPORT_CSV）通过 return true 保持消息通道，
 * sendResponse 在仓库 promise resolve 时调用。
 */
export function createBackgroundListener(deps: BackgroundListenerDeps) {
  const bbdcClient = deps.bbdcClient ?? defaultBbdcClient();
  const actionBadge = deps.actionBadge ?? defaultActionBadge();
  const errorLogger = deps.errorLogger ?? createErrorLogger();
  const pushCoordinator = deps.pushCoordinator ?? new PushCoordinator({
    client: bbdcClient,
    repository: deps.repository,
    // MV3 SW idle keepalive：纯 fetch 循环不会重置 SW 的 30s idle 计时器，
    // 长词表推送到一半 SW 会被静默杀掉。穿插一次扩展 API 调用即可重置。
    sleep: swKeepAliveSleep,
    // 错误日志（issue #25）：推送失败/登录失效暂停写入环形缓冲。
    onError: (event) => errorLogger.log(event),
  });
  /**
   * 待确认批次：只存活于内存（issue #22）。下一次 WORDS_COLLECTED 覆盖；
   * DISCARD_COLLECTED / 确认后清空；SW 被杀即丢弃——永不持久化。
   */
  let pendingBatch: WordEntry[] | null = null;

  /** 合并入库后触发一轮推送（确认即推送是唯一路径，无自动推送开关）。 */
  const startPushRound = (): void => {
    void pushCoordinator.start();
  };

  return (
    message: unknown,
    _sender: unknown,
    sendResponse: (
      response:
        | BatchPreview
        | Counts
        | CheckLoginResponse
        | PushStatus
        | ExportCsvResponse
        | ImportCsvResponse
        | { ok: false; error: string },
    ) => void,
  ): boolean => {
    if (isWordsCollectedMessage(message)) {
      // 驻留待确认批次 + 算新词 diff（纯词库查询，零网络）；
      // 持有通道保证 content 侧应答在预览就绪后才返回（popup 确认页拿到
      // 的 total/newCount 一定与本批次一致）。
      void handleWordsCollected(message.entries, deps.repository)
        .then((preview) => {
          pendingBatch = message.entries;
          sendResponse(preview);
        }, () => sendResponse({ ok: false, error: "preview-failed" }))
        .catch(() => undefined);
      return true;
    }
    if (isConfirmCollectedMessage(message)) {
      const batch = pendingBatch;
      if (batch === null) {
        sendResponse({ ok: false, error: "no-pending-batch" });
        return false;
      }
      // 不在此清空批次（review St-1）：mergeCollected 失败时批次必须保留，
      // 用户重按「确认推送」即可重试；仅在合并成功后清空。
      void handleConfirm(batch, deps.repository)
        .then((counts) => {
          pendingBatch = null; // 合并成功，批次生命周期结束
          sendResponse(counts);
          // 确认即推送：合并完成后非阻塞触发一轮推送全部待推（含 CSV 存量）
          startPushRound();
        }, (error: unknown) => {
          // 确认失败（issue #25）：批次保留 + 错误写环形缓冲
          errorLogger.log({
            stage: "confirm",
            summary: `合并入库失败（批次 ${batch.length} 词已保留待重试）：${errorSummary(error)}`,
          });
          sendResponse({ ok: false, error: "confirm-failed" });
        })
        .catch(() => undefined);
      return true;
    }
    if (isDiscardCollectedMessage(message)) {
      pendingBatch = null;
      return false;
    }
    if (isGetCountsMessage(message)) {
      deps.repository
        .getCounts()
        .then(sendResponse, () => sendResponse({ ok: false, error: "counts-failed" }))
        .catch(() => undefined);
      return true;
    }
    if (isMarkPushedMessage(message)) {
      deps.repository
        .markPushed(message.lemmas)
        .then(sendResponse, () => sendResponse({ ok: false, error: "mark-failed" }))
        .catch(() => undefined);
      return true;
    }
    if (isRetryPushMessage(message)) {
      void pushCoordinator.start();
      return false;
    }
    if (isGetPushStatusMessage(message)) {
      sendResponse(pushCoordinator.getStatus());
      return false;
    }
    if (isCheckLoginMessage(message)) {
      handleCheckLogin(bbdcClient, actionBadge, pushCoordinator)
        .then(sendResponse, () => sendResponse({ ok: false, error: "check-login-failed" }))
        .catch(() => undefined);
      return true;
    }
    if (isExportCsvMessage(message)) {
      handleExportCsv(deps.repository)
        .then(sendResponse, () => sendResponse({ ok: false, error: "export-failed" }))
        .catch(() => undefined);
      return true;
    }
    if (isImportCsvMessage(message)) {
      // CSV 导入同过确认闸门（review S-3）：解析 + 新词 diff → 驻留待确认
      // 批次 → 应答预览。不写库、不推送；入库与推送仅由确认动作触发。
      void handleImportCsv(message.csvText, message.fileName, deps.repository)
        .then((result) => {
          if ("entries" in result) {
            pendingBatch = result.entries;
            sendResponse(result.preview);
          } else {
            // 解析失败（issue #25）：零写入 + 错误写环形缓冲
            errorLogger.log({ stage: "import", summary: result.error });
            sendResponse(result);
          }
        }, (error: unknown) => {
          errorLogger.log({ stage: "import", summary: `导入失败：${errorSummary(error)}` });
          sendResponse({ ok: false, error: "import-failed" });
        })
        .catch(() => undefined);
      return true;
    }
    return false;
  };
}

/**
 * 采集结果只算预览：新词 = 与本地词库的 lemma diff（零网络请求），
 * 不写库、不推送——入库仅由确认动作（CONFIRM_COLLECTED）触发。
 */
async function handleWordsCollected(
  entries: WordEntry[],
  repository: BackgroundRepository,
): Promise<BatchPreview> {
  const newCount = await repository.countNew(entries);
  return { total: entries.length, newCount };
}

/** 确认：待确认批次合并入词库，返回最新计数（推送由调用方在应答后触发）。 */
async function handleConfirm(
  entries: WordEntry[],
  repository: BackgroundRepository,
): Promise<Counts> {
  return repository.mergeCollected(entries);
}

/**
 * T11 导出：getAll → core stringifyWordListCsv（含已推位）。
 * 与 CLI merge 的消费端同源，导出的 CSV 可直接喂给 CLI。
 */
async function handleExportCsv(
  repository: BackgroundRepository,
): Promise<ExportCsvResponse> {
  const entries = await repository.getAll();
  return { ok: true, csv: stringifyWordListCsv(entries) };
}

/**
 * T11 导入（review S-3 改走确认闸门）：先整体解析（core parseWordListCsv），
 * 解析失败直接返回 {ok:false,error}（包装文件名 + core 报的行号），不产生
 * 任何写入、不覆盖待确认批次；解析成功算新词 diff（同采集预览，零网络），
 * 返回 {entries,preview} 由调用方驻留为待确认批次——不直接 mergeCollected。
 * （确认后的合并语义：同词 flags 按位或，已推不洗回待推。）
 */
async function handleImportCsv(
  csvText: string,
  fileName: string,
  repository: BackgroundRepository,
): Promise<
  | { entries: WordEntry[]; preview: BatchPreview }
  | { ok: false; error: string }
> {
  let entries: WordEntry[];
  try {
    entries = parseWordListCsv(csvText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${fileName}: ${detail}` };
  }
  const newCount = await repository.countNew(entries);
  return { entries, preview: { total: entries.length, newCount } };
}

async function handleCheckLogin(
  bbdcClient: BackgroundBbdcClient,
  actionBadge: ActionBadgeGateway,
  pushCoordinator: PushCoordinator,
): Promise<CheckLoginResponse> {
  try {
    const result = await bbdcClient.checkLogin();
    if (result.loggedIn) {
      // 已登录：清空 badge（用户之前若被标"!"，现在撤销）
      await actionBadge.set(null);
      // 「确认即推送是唯一路径」指 采集/导入→推送 这条主路径（issue #22）；
      // 这里是登录恢复后对存量待推的重推，属于允许的恢复路径，不是自动推送开关。
      void pushCoordinator.start();
      return { loggedIn: true };
    }
    await actionBadge.set("!");
    return { loggedIn: false };
  } catch {
    // 任何 BbdcAuthError / BbdcApiError / 网络错误：保守视为未登录 + 提示 badge
    await actionBadge.set("!");
    return { loggedIn: false };
  }
}

// ---------------------------------------------------------------------------
// 默认实现（lazy）：只在注入缺失时构造，避免生产代码额外传参。
// ---------------------------------------------------------------------------

function defaultBbdcClient(): BackgroundBbdcClient {
  return createBbdcClient();
}

function defaultActionBadge(): ActionBadgeGateway {
  return chromeActionBadge;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 带扩展 API 心跳的 sleep：距上次心跳超过 20s 时调一次
 * `chrome.runtime.getPlatformInfo()`（无副作用的扩展 API 调用会重置 MV3
 * SW 的 idle 计时器），防止长推送循环被 idle kill。非扩展环境（单测）
 * 退化为纯 sleep。
 */
const KEEPALIVE_INTERVAL = 20_000;
let lastKeepalive = 0;

export async function swKeepAliveSleep(milliseconds: number): Promise<void> {
  const runtimeApi = (globalThis as { chrome?: { runtime?: { getPlatformInfo?: () => Promise<unknown> } } })
    .chrome?.runtime;
  if (runtimeApi?.getPlatformInfo && Date.now() - lastKeepalive > KEEPALIVE_INTERVAL) {
    lastKeepalive = Date.now();
    try {
      await runtimeApi.getPlatformInfo();
    } catch {
      // 心跳失败不影响 sleep 语义
    }
  }
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}