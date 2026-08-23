/**
 * 错误日志（issue #25）：chrome.storage.local 环形缓冲，保留最近 ~200 条。
 *
 * 只存 storage.local（键 `errorLog`），不与 IndexedDB 词库混杂，零新权限。
 * 写入采用「读-改-写 + 写队列串行化」：同一个 logger 实例上的并发 log()
 * 依次落盘，后写者基于前写者已提交的结果，保证不丢已提交记录；
 * 超出容量从最旧端淘汰。chrome.* 调用收在可注入网关后面，便于单测。
 */

/** storage.local 中的存储键。 */
export const ERROR_LOG_KEY = "errorLog";

/** 环形缓冲容量（spec §扩展行为：最近约 200 条）。 */
export const ERROR_LOG_CAP = 200;

/** 一条错误记录：时间 + 词/阶段上下文 + 可读摘要。 */
export interface ErrorLogRecord {
  /** 毫秒时间戳（写入时刻）。 */
  time: number;
  /** 阶段：push / push-pause / confirm / import 等。 */
  stage: string;
  /** 相关词（有明确词上下文时携带）。 */
  word?: string;
  /** 简明错误摘要（给排查用户报告的开发者读）。 */
  summary: string;
}

/** 记录事件（不含 time，由 logger 补写）。 */
export type ErrorLogEvent = Omit<ErrorLogRecord, "time">;

/** chrome.storage.local 的最小可注入面。 */
export interface ErrorLogStorage {
  get(key: string): Promise<unknown>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const chromeErrorLogStorage: ErrorLogStorage = {
  get(key: string): Promise<unknown> {
    return chrome.storage.local.get(key).then((items) => (items as Record<string, unknown>)[key]);
  },
  set(items: Record<string, unknown>): Promise<void> {
    return chrome.storage.local.set(items);
  },
}

/** 测试等无 chrome 环境下的兜底（读写丢弃，永不出错）。 */
const fallbackErrorLogStorage: ErrorLogStorage = {
  get: async () => undefined,
  set: async () => undefined,
};

export function defaultErrorLogStorage(): ErrorLogStorage {
  return typeof chrome !== "undefined" && chrome.storage?.local
    ? chromeErrorLogStorage
    : fallbackErrorLogStorage;
}

export interface ErrorLogger {
  /** 追加一条记录（fire-and-forget；内部串行落盘，永不 reject）。 */
  log(event: ErrorLogEvent): void;
}

/**
 * 创建环形缓冲 logger。同一实例的写入按提交顺序串行化，
 * 并发 log() 不丢已提交记录；storage 故障静默吞掉（日志不能反噬主流程）。
 */
export function createErrorLogger(
  storage: ErrorLogStorage = defaultErrorLogStorage(),
  cap: number = ERROR_LOG_CAP,
  now: () => number = Date.now,
): ErrorLogger {
  let chain: Promise<void> = Promise.resolve();
  return {
    log(event: ErrorLogEvent): void {
      chain = chain.then(async () => {
        const records = await readRecords(storage);
        const record: ErrorLogRecord = { time: now(), ...event };
        const next = [...records, record];
        if (next.length > cap) next.splice(0, next.length - cap);
        await storage.set({ [ERROR_LOG_KEY]: next });
      }).catch(() => undefined);
    },
  };
}

/** 读取全部记录（旧 → 新）。键缺失 / 形态异常时返回空数组（容错）。 */
export async function readErrorLog(
  storage: ErrorLogStorage = defaultErrorLogStorage(),
): Promise<ErrorLogRecord[]> {
  return readRecords(storage);
}

async function readRecords(storage: ErrorLogStorage): Promise<ErrorLogRecord[]> {
  const raw = await storage.get(ERROR_LOG_KEY);
  return Array.isArray(raw) ? raw.filter(isErrorLogRecord) : [];
}

function isErrorLogRecord(value: unknown): value is ErrorLogRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.time === "number" &&
    typeof record.stage === "string" &&
    typeof record.summary === "string" &&
    (record.word === undefined || typeof record.word === "string")
  );
}

/**
 * 导出为可读文本：一行一条，`[ISO 时间] 阶段 [词] 摘要`。
 * popup「导出日志」按钮用（issue #25）。
 */
export function formatErrorLog(records: ErrorLogRecord[]): string {
  return records
    .map((record) => {
      const time = new Date(record.time).toISOString();
      const word = record.word ? ` [${record.word}]` : "";
      return `[${time}] ${record.stage}${word} ${record.summary}`;
    })
    .join("\n");
}
