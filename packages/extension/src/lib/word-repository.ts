/**
 * 浏览器扩展词库存储（idb 封装）。
 *
 * 职责：同 lemma 合并、flags 按位或、按 lemma 标记已推、计数与列表查询。
 * 不发 HTTP、不与 popup 直接对话——service worker 编排 repository 与消息协议，
 * popup 仅通过 chrome.runtime.sendMessage 与 service worker 通信。
 *
 * MV3 生命周期适配：service worker 随时可能被休眠/杀死，
 * 每次操作都在 withDb 内重新 openDb 并 closeDb，无跨操作长连接假设。
 *
 * 数据库结构：
 * - name:    "word-radar"
 * - version: 1
 * - store:   "words"（keyPath = "lemma"，value = WordEntry）
 *
 * 计数定义：
 * - total   = 词库总词数
 * - pending = flags === 0 的词数（待推：还没被任何背单词 APP 标记成功）
 * - flags 是位掩码；bit0=不背单词已推（推送成功后置位，恢复待推请清零位）。
 */
import { BBDC_PUSHED_FLAG, mergeWordEntries, type WordEntry } from "@word-radar/core";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** 默认数据库名 / 版本 / 对象仓库名（导出供测试与未来迁移脚本引用）。 */
export const DB_NAME = "word-radar";
export const DB_VERSION = 1;
export const WORDS_STORE = "words";

export interface WordRadarSchema extends DBSchema {
  words: {
    key: string;
    value: WordEntry;
  };
}

export interface Counts {
  /** 词库总词数（合并去重后的 lemma 数量）。 */
  total: number;
  /** 待推词数（flags === 0，未被任何 APP 标记为已推）。 */
  pending: number;
}

export interface WordRepository {
  /** 合并新采集的词条（lemma 同则 flags 按位或），返回最新计数。 */
  mergeCollected(entries: WordEntry[]): Promise<Counts>;
  /** 列出所有待推词（flags === 0）。 */
  listPending(): Promise<WordEntry[]>;
  /** 给定 lemma 列表标记不背单词位为已推；返回最新计数。 */
  markPushed(lemmas: string[]): Promise<Counts>;
  /** 返回全部词条。 */
  getAll(): Promise<WordEntry[]>;
  /** 返回 {total, pending}。 */
  getCounts(): Promise<Counts>;
  /** 清空词库（测试与未来「重置」用；不影响线上行为）。 */
  clear(): Promise<void>;
}

export interface RepositoryOptions {
  /** 注入 openDb，便于 fake-indexeddb / 自定义数据库名测试。 */
  openDb?: () => Promise<IDBPDatabase<WordRadarSchema>>;
  /** 数据库名（默认 DB_NAME）。 */
  dbName?: string;
}

/**
 * 创建词库仓储。每次操作 open→work→close，不持有跨调用连接，
 * 适配 MV3 service worker 随时被休眠的运行环境。
 */
export function createWordRepository(options: RepositoryOptions = {}): WordRepository {
  const openDb = options.openDb ?? (() => openDefaultDb(options.dbName ?? DB_NAME));

  return {
    async mergeCollected(entries) {
      // 1. 独立 readonly 事务读出全部（不与后续 readwrite 混在一处）
      const existing = await readAll(openDb);
      // 2. 内存合并（lemma 同则 flags 按位或；新条目 flags 默认 0）
      const merged = mergeWordEntries(existing, entries);
      // 3. 单个 readwrite 事务内清空并重写（避免跨事务不一致）
      await rewriteAll(openDb, merged);
      return computeCounts(merged);
    },

    async listPending() {
      const all = await readAll(openDb);
      return all.filter((entry) => entry.flags === 0);
    },

    async markPushed(lemmas) {
      const all = await readAll(openDb);
      if (all.length === 0) return { total: 0, pending: 0 };
      const target = new Set(lemmas.map((lemma) => lemma.toLowerCase()));
      let changed = false;
      const next = all.map<WordEntry>((entry) => {
        if (!target.has(entry.lemma)) return entry;
        if ((entry.flags & BBDC_PUSHED_FLAG) !== 0) return entry;
        changed = true;
        return { lemma: entry.lemma, flags: entry.flags | BBDC_PUSHED_FLAG };
      });
      if (!changed) {
        return computeCounts(all);
      }
      await rewriteAll(openDb, next);
      return computeCounts(next);
    },

    async getAll() {
      return readAll(openDb);
    },

    async getCounts() {
      const all = await readAll(openDb);
      return computeCounts(all);
    },

    async clear() {
      const db = await openDb();
      try {
        const tx = db.transaction(WORDS_STORE, "readwrite");
        await tx.objectStore(WORDS_STORE).clear();
        await tx.done;
      } finally {
        db.close();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function openDefaultDb(name: string): Promise<IDBPDatabase<WordRadarSchema>> {
  return openDB<WordRadarSchema>(name, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(WORDS_STORE)) {
        // keyPath = "lemma"：合并语义天然去重，put 同 lemma 覆盖 flags
        db.createObjectStore(WORDS_STORE, { keyPath: "lemma" });
      }
    },
  });
}

/** 独立事务读全部；closeDb 由 withDb 守护。 */
async function readAll(
  openDb: () => Promise<IDBPDatabase<WordRadarSchema>>,
): Promise<WordEntry[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(WORDS_STORE, "readonly");
    const all = await tx.objectStore(WORDS_STORE).getAll();
    await tx.done;
    return all;
  } finally {
    db.close();
  }
}

/**
 * 单个 readwrite 事务内清空并 put 全部词条。
 * Promise.all 把所有 put 排进同一 microtask cycle，避免事务过早 auto-commit。
 */
async function rewriteAll(
  openDb: () => Promise<IDBPDatabase<WordRadarSchema>>,
  entries: WordEntry[],
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(WORDS_STORE, "readwrite");
    const store = tx.objectStore(WORDS_STORE);
    await Promise.all([store.clear(), ...entries.map((entry) => store.put(entry))]);
    await tx.done;
  } finally {
    db.close();
  }
}

function computeCounts(entries: WordEntry[]): Counts {
  let pending = 0;
  for (const entry of entries) {
    if (entry.flags === 0) pending += 1;
  }
  return { total: entries.length, pending };
}