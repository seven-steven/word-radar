import {
  extractWordEntries,
  parseWordListCsv,
  stringifyWordListCsv,
  type WordEntry,
} from "@word-radar/core";
import {
  isCheckLoginMessage,
  isConfirmCollectedMessage,
  isConsumeUploadTargetMessage,
  isDiscardCollectedMessage,
  isExportCsvMessage,
  isGetCountsMessage,
  isImportCsvMessage,
  isMarkPushedMessage,
  isUploadFileMessage,
  isWordsCollectedMessage,
  isRetryPushMessage,
  isGetPushStatusMessage,
  UPLOAD_TEXT_SUFFIXES,
  type BatchPreview,
  type CheckLoginResponse,
  type ConsumeUploadTargetResponse,
  type Counts,
  type ExportCsvResponse,
  type ImportCsvResponse,
  type PushStatus,
} from "./messages.js";
import { createBbdcClient, type BbdcClient } from "./bbdc-client.js";
import { chromeActionBadge, composeBadge } from "./action-badge.js";
import { UPLOAD_TARGET_FLAG } from "./collect-menu.js";
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
  set(text: string | null, color?: string): Promise<void>;
}

/**
 * 「上传文件」目标标记的 storage 边界（issue #24 验收缺陷修复）：
 * 标记由 collect-menu 在 SW 上下文写入；popup 若直读 storage 会撞上
 * chrome.storage 跨上下文最终一致传播（popup 可能读到未提交的空值）。
 * 改由 SW 收 CONSUME_UPLOAD_TARGET 消息后在同一上下文读并清掉——
 * 写读同上下文，严格有序，竞态消除。默认 chrome.storage.local。
 */
export interface UploadTargetStorage {
  get(key: string): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
}

export const chromeUploadTargetStorage: UploadTargetStorage = {
  async get(key) {
    return (await chrome.storage.local.get(key)) as Record<string, unknown>;
  },
  remove(key) {
    return chrome.storage.local.remove(key);
  },
};

export interface BackgroundListenerDeps {
  repository: BackgroundRepository;
  /** 注入 BbdcClient（默认 lazy 创建，使用全局 fetch）。 */
  bbdcClient?: BackgroundBbdcClient;
  /** 注入 action badge 网关（默认 lazy 创建 chromeActionBadge）。 */
  actionBadge?: ActionBadgeGateway;
  /** 注入上传目标标记 storage（默认 lazy 创建 chromeUploadTargetStorage）。 */
  uploadTargetStorage?: UploadTargetStorage;
  pushCoordinator?: PushCoordinator;
  /**
   * SW 冷启动推送自动恢复（issue #26）：true 时构造即检查待推池，
   * 非空且无轮在跑则自动起一轮推送（与登录恢复并列的恢复路径，
   * 不是自动推送开关）。仅由 SW 入口 background.ts 传入；单测默认关闭。
   */
  resumeOnStart?: boolean;
  /** 错误日志（issue #25）：默认写 chrome.storage.local 环形缓冲。 */
  errorLogger?: ErrorLogger;
  /**
   * 文本提取管线（issue #24）：默认 core 的 extractWordEntries（与网页采集
   * 同一管线）；注入仅用于单测。SW 只做纯提取，无网络请求。
   */
  extract?: (text: string) => WordEntry[];
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
 * - CHECK_LOGIN（T09）：调 BbdcClient.checkLogin；应答 {loggedIn}。
 *   登录状态不写 badge（issue #26）——未登录只在推送 paused 时经 "!" 表达
 * - EXPORT_CSV（T11）：getAll → core stringify，应答 {ok:true,csv}
 * - IMPORT_CSV（review S-3 改走确认闸门）：core parse（失败即应答错误，
 *   零写入）→ countNew 算新词 diff → 驻留待确认批次（与采集批次同形态，
 *   覆盖任何旧批次）→ 应答 {total,newCount}；不写库、不推送，入库与
 *   推送仅由 CONFIRM_COLLECTED 触发
 * - UPLOAD_FILE（issue #24，验收修订）：纯文本文件（UPLOAD_TEXT_SUFFIXES）
 *   走同一 core 提取管线后驻留待确认批次（同采集语义）；非法后缀零写入 +
 *   错误日志 stage=upload。注意：.csv 在这里当纯文本提词，不做 IMPORT_CSV
 *   的结构化解析
 * - CONSUME_UPLOAD_TARGET（issue #24 验收缺陷修复）：SW 上下文读并清掉
 *   右键菜单写的「上传文件」目标标记，应答 {ok:true,uploadRequested}
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
  const uploadTargetStorage = deps.uploadTargetStorage ?? chromeUploadTargetStorage;
  const errorLogger = deps.errorLogger ?? createErrorLogger();
  const pushCoordinator = deps.pushCoordinator ?? new PushCoordinator({
    client: bbdcClient,
    repository: deps.repository,
    // MV3 SW idle keepalive：纯 fetch 循环不会重置 SW 的 30s idle 计时器，
    // 长词表推送到一半 SW 会被静默杀掉。穿插一次扩展 API 调用即可重置。
    sleep: swKeepAliveSleep,
    // badge 进度（issue #23）：每词进度事件驱动 x/y 数字进度。
    onProgress: () => renderBadge(),
    // 错误日志（issue #25）：推送失败/登录失效暂停写入环形缓冲。
    onError: (event) => errorLogger.log(event),
  });
  /**
   * 待确认批次：只存活于内存（issue #22）。下一次 WORDS_COLLECTED 覆盖；
   * DISCARD_COLLECTED / 确认后清空；SW 被杀即丢弃——永不持久化。
   */
  let pendingBatch: WordEntry[] | null = null;

  /** 按优先级合成并写入 badge：推送 x/y > 暂停/完成回执 > 待确认 ?。 */
  const renderBadge = (): void => {
    const spec = composeBadge({
      push: pushCoordinator.getStatus(),
      hasPendingBatch: pendingBatch !== null,
    });
    // badge 写失败不阻塞消息处理（SW 重启后 chrome.action 短暂不可用等）
    void (spec ? actionBadge.set(spec.text, spec.color) : actionBadge.set(null))
      .catch(() => undefined);
  };

  /** 合并入库后触发一轮推送（确认即推送是唯一路径，无自动推送开关）。 */
  const startPushRound = (): void => {
    void pushCoordinator.start();
  };

  // SW 冷启动推送自动恢复（issue #26）：待推池非空且无轮在跑 → 自动起一轮。
  if (deps.resumeOnStart === true) {
    void resumePendingPush({ repository: deps.repository, pushCoordinator });
  }

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
        | ConsumeUploadTargetResponse
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
          renderBadge(); // 待确认批次 → badge "?" 提示（issue #23）
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
          renderBadge(); // 批次清空：badge 转入推送 x/y 或回执（issue #23）
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
      renderBadge(); // 批次丢弃：撤销 "?" 提示
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
      handleCheckLogin(bbdcClient, pushCoordinator)
        .then(({ loggedIn }) => {
          // badge 与登录状态解耦（issue #26）：未登录不亮 badge，登录失效经
          // 推送 paused 的 "!" 表达；CHECK_LOGIN 不再写 badge。
          sendResponse(loggedIn ? { loggedIn: true } : { loggedIn: false });
        }, () => {
          sendResponse({ ok: false, error: "check-login-failed" });
        })
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
            renderBadge(); // 导入驻留待确认批次 → badge "?"（issue #23）
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
    if (isUploadFileMessage(message)) {
      // 上传文件采集（issue #24）：原始文本走与网页采集同一 core 提取管线，
      // 提取结果只驻留待确认批次（不写库、不推送，确认动作是唯一入库路径）。
      // 与 IMPORT_CSV 的区别：这是自然语言文本，不是 lemma,flags 结构化词表。
      void handleUploadFile(message.text, message.fileName, {
        repository: deps.repository,
        extract: deps.extract ?? extractWordEntries,
      })
        .then((result) => {
          if ("entries" in result) {
            pendingBatch = result.entries;
            renderBadge(); // 上传驻留待确认批次 → badge "?"（issue #23）
            sendResponse(result.preview);
          } else {
            // 非法文件（issue #25）：零写入 + 错误写环形缓冲（stage=upload）
            errorLogger.log({ stage: "upload", summary: result.error });
            sendResponse(result);
          }
        }, (error: unknown) => {
          errorLogger.log({ stage: "upload", summary: `上传采集失败：${errorSummary(error)}` });
          sendResponse({ ok: false, error: "upload-failed" });
        })
        .catch(() => undefined);
      return true;
    }
    if (isConsumeUploadTargetMessage(message)) {
      // 读并清掉标记都在 SW 上下文（与写入同上下文，严格有序）——popup
      // 直读 storage 会撞上跨上下文最终一致传播（issue #24 验收缺陷）。
      handleConsumeUploadTarget(uploadTargetStorage)
        .then(sendResponse, () => sendResponse({ ok: false, error: "consume-upload-target-failed" }))
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

/**
 * 上传文件采集（issue #24，验收修订）：校验后缀属于 UPLOAD_TEXT_SUFFIXES
 * （txt/md/markdown/csv/log/text/json 等纯文本）→ core 提取管线（与网页采集
 * 同源）→ countNew 算新词 diff（零网络请求），返回 {entries,preview} 由调用
 * 方驻留为待确认批次——不直接 mergeCollected。
 *
 * .csv 特例（用户明确决策）：上传入口的 .csv 走自然语言提取管线（从文本中
 * 提词），不是 IMPORT_CSV 的 lemma,flags 结构化解析——结构化词表只走导入。
 */
async function handleUploadFile(
  text: string,
  fileName: string,
  deps: { repository: BackgroundRepository; extract: (text: string) => WordEntry[] },
): Promise<
  | { entries: WordEntry[]; preview: BatchPreview }
  | { ok: false; error: string }
> {
  const lower = fileName.toLowerCase();
  const allowed = UPLOAD_TEXT_SUFFIXES.some((suffix) => lower.endsWith(`.${suffix}`));
  if (!allowed) {
    const list = UPLOAD_TEXT_SUFFIXES.map((suffix) => `.${suffix}`).join(" / ");
    return { ok: false, error: `${fileName}: 仅支持纯文本文件（${list}）` };
  }
  const entries = deps.extract(text);
  const newCount = await deps.repository.countNew(entries);
  return { entries, preview: { total: entries.length, newCount } };
}

/**
 * 消费「上传文件」目标标记（issue #24 验收缺陷修复）：在 SW 上下文
 * （与 collect-menu 写入同上下文，严格有序）读标记，为 true 则清掉。
 */
async function handleConsumeUploadTarget(
  storage: UploadTargetStorage,
): Promise<ConsumeUploadTargetResponse> {
  const items = await storage.get(UPLOAD_TARGET_FLAG);
  const requested = items[UPLOAD_TARGET_FLAG] === true;
  if (requested) {
    await storage.remove(UPLOAD_TARGET_FLAG);
  }
  return { ok: true, uploadRequested: requested };
}

/**
 * T09 登录检查：返回 {loggedIn}。badge 与登录状态已解耦（issue #26）——
 * 未登录不写 badge，登录失效由推送 paused 的 "!" 表达。
 */
async function handleCheckLogin(
  bbdcClient: BackgroundBbdcClient,
  pushCoordinator: PushCoordinator,
): Promise<{ loggedIn: boolean }> {
  try {
    const result = await bbdcClient.checkLogin();
    if (result.loggedIn) {
      // 「确认即推送是唯一路径」指 采集/导入→推送 这条主路径（issue #22）；
      // 这里是登录恢复后对存量待推的重推，属于允许的恢复路径，不是自动推送开关。
      void pushCoordinator.start();
      return { loggedIn: true };
    }
    return { loggedIn: false };
  } catch {
    // 任何 BbdcAuthError / BbdcApiError / 网络错误：保守视为未登录
    return { loggedIn: false };
  }
}

/**
 * 推送自动恢复（issue #26，spec「推送自动恢复」）：SW 冷启动时若待推池
 * 非空且无推送轮在跑（status 为 idle），自动起一轮推送。覆盖浏览器启动、
 * 扩展安装/更新、任何事件唤醒 SW 的场景；PushCoordinator.start() 自带
 * 去重（已运行时返回同一 promise），调用方无需额外守卫。查库失败静默——
 * 下次 SW 唤醒会再试。
 */
export async function resumePendingPush(
  deps: { repository: Pick<BackgroundRepository, "listPending">; pushCoordinator: PushCoordinator },
): Promise<void> {
  const pending = await deps.repository.listPending().catch(() => undefined);
  if (!pending || pending.length === 0) return;
  if (deps.pushCoordinator.getStatus().phase !== "idle") return;
  void deps.pushCoordinator.start();
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