/**
 * Wiktionary wikitext 拉取与词条纯度判定（build-blacklist 与词条级 patch 的
 * 共享模块，issue #51 修复抽出：纯度语义只此一份，两处脚本不得分叉）。
 *
 * 依赖注入：apiGet / cacheFile 由调用方传入（脚本各自的断点缓存与请求配置
 * 不同），纯度判定本身零依赖纯函数。
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** MediaWiki 非机器人 titles 上限 */
export const WIKITEXT_BATCH = 50;

/** 纯度线分子：整页缩略族定义行占比 ≥ 1/5（5*abbrev >= defCount） */
export const PURITY_THRESHOLD_NUM = 5;

/**
 * 定义行首模板的缩略族白名单（Wiktionary 模板名，小写，含长短变体）。
 * 2026-09-09 对全部缓存页定义行首模板做频次统计得出的完整族谱。
 * "alt case" / "alternative form of"（issue #51 patch 增补）：小写形词条页
 * 标注 {{alt case|en|RPM}} / {{alternative form of|en|IMG}} = 大写词条的
 * 大小写/异写变体——目标是大写缩写时小写形同属缩略族（rpm/img 类曾被
 * v3 探测误判 mixed 过杀）。
 */
export const ABBREV_TEMPLATES = new Set([
  "initialism of", "init of", "abbreviation of", "abbrev of", "abbr of",
  "acronym of", "acro of", "clipping of", "clip of", "short for",
  "sylabbr of", "syllabic abbreviation of", "pseudo-acronym of",
  "clipcomp of", "clipped compound of",
  "initialism", "init", "abbreviation", "abbrev", "abbr", "acronym", "acro",
  "clipping", "clip", "sylabbr", "alt case", "alternative form of",
]);

/**
 * 定义行里纯修饰性前导模板：不参与「首模板」判定（否则 {{lb|en|informal}}
 * {{initialism of|...}} 会被误判为非缩略定义）。整行全是修饰模板时按非缩略计。
 */
export const MASK_TEMPLATES = new Set([
  "lb", "lbl", "label", "cln",
  "q", "qual", "qualifier", "i", "italic",
  "senseid", "defdate",
  "n-g", "non-gloss", "gloss", "gl", "gg", "glossary",
  "l", "link", "m", "mention", "lang", "lbx",
]);

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const API = "https://en.wiktionary.org/w/api.php";
const HEADERS = {
  "User-Agent":
    "word-radar-build-blacklist/2.0 (repository: seven-steven/word-radar; build-time fetch, not runtime)",
};

/**
 * MediaWiki API GET（带超时、429/5xx 退避与限速抖动——保真自 build-blacklist
 * 原实现，2026-10-10 抽出）。
 */
export async function apiGet(params, { attempts = 8 } = {}) {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) {
        // Wikimedia 对共享出口 IP 间歇性 429：尊重 Retry-After，加随机抖动拉长退避
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        throw Object.assign(new Error(`HTTP ${res.status}`), { rateLimited: res.status === 429, retryAfter });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.pathname}${url.search}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      const limited = err.rateLimited;
      const backoff = limited
        ? Math.max(3000, err.retryAfter * 1000) + Math.floor(Math.random() * 2000)
        : 2000 * 2 ** i;
      console.error(`wikitext: 请求失败（${err instanceof Error ? err.message : err}），${backoff}ms 后重试`);
      await sleep(backoff);
    }
  }
  throw lastError;
}

/** 解析 wikitext 标题行：返回 { level, name } 或 null。 */
export function parseHeading(line) {
  const m = /^(={2,6})([^=].*?)\1\s*$/.exec(line);
  if (!m) return null;
  return { level: m[1].length, name: m[2].trim() };
}

/** 取 ==English== 段落原文（到下一个 L2 标题为止）。 */
export function extractEnglishSection(wikitext) {
  const lines = wikitext.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeading(lines[i]);
    if (h && h.level === 2) {
      if (h.name.toLowerCase() === "english") {
        start = i + 1;
        break;
      }
      if (start >= 0) break; // English 已过（理论上不会：Translingual 在前）
    }
  }
  if (start < 0) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const h = parseHeading(lines[i]);
    if (h && h.level <= 2) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/**
 * 统计英文段全部顶层定义行：总行数与「首模板属缩略族」的行数。
 * 首模板判定跳过纯修饰模板（MASK_TEMPLATES）；整行皆修饰按非缩略计（保守）。
 */
export function analyzeEnglishDefinitions(englishSection) {
  let defCount = 0;
  let abbrevCount = 0;
  for (const line of englishSection.split("\n")) {
    if (!/^#(?![*:=])/.test(line)) continue; // 顶层定义行（排除 ## 嵌套 / #: 例句 / #* 引文）
    defCount++;
    let head;
    for (const m of line.matchAll(/\{\{\s*([^{}|]+)/g)) {
      const name = m[1].trim().toLowerCase().replace(/\s+/g, " ");
      if (MASK_TEMPLATES.has(name)) continue;
      head = name;
      break;
    }
    if (head !== undefined && ABBREV_TEMPLATES.has(head)) abbrevCount++;
  }
  return { defCount, abbrevCount };
}

/**
 * 词条页纯度判定：整页定义行缩略族占比 ≥ 1/5（整数判定 5*abbrev >= total）
 * 才是「真缩略页」（reason="pure"）。无定义行的页丢弃（保守）。
 *
 * reason 语义（调用方按需分流）：
 * - "no-content" / "redirect" / "no-english" / "no-defs"：无独立小写词条证据
 *   ——对「小写页否决」语义（v3，issue #51）不构成否决理由（FBI/NASA 类
 *   真缩写的小写形通常 redirect 到大写页，不得误伤）。
 * - "pure"：词条存在且纯缩略（doc/stat 型自证通过）。
 * - "mixed"：词条存在且混合词义——真词页，构成小写否决证据。
 */
export function purityVerdict(wikitext) {
  if (!wikitext) return { pass: false, defCount: 0, abbrevCount: 0, reason: "no-content" };
  if (/^#redirect/i.test(wikitext.trim())) {
    return { pass: false, defCount: 0, abbrevCount: 0, reason: "redirect" };
  }
  const section = extractEnglishSection(wikitext);
  if (section === null) return { pass: false, defCount: 0, abbrevCount: 0, reason: "no-english" };
  const { defCount, abbrevCount } = analyzeEnglishDefinitions(section);
  if (defCount === 0) return { pass: false, defCount, abbrevCount, reason: "no-defs" };
  const pass = PURITY_THRESHOLD_NUM * abbrevCount >= defCount;
  return {
    pass,
    defCount,
    abbrevCount,
    reason: pass ? "pure" : "mixed",
  };
}

/**
 * 批量抓词条 wikitext（50 标题/请求），结果以 JSONL 增量缓存（断点续跑）。
 * @param {string[]} titles
 * @param {{ apiGet: Function, cacheFile: string, resume?: boolean, batchSize?: number, logPrefix?: string }} options
 * @returns {Promise<Map<string, string | null>>}
 */
export async function fetchWikitexts(titles, { apiGet, cacheFile, resume = false, batchSize = WIKITEXT_BATCH, logPrefix = "wikitext" }) {
  const cache = new Map();
  if (resume && existsSync(cacheFile)) {
    for (const line of readFileSync(cacheFile, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        cache.set(rec.t, rec.w);
      } catch {
        // 尾部半行（中断残迹）：忽略
      }
    }
  }
  const pending = titles.filter((t) => !cache.has(t));
  console.error(
    `${logPrefix}: wikitext — 共 ${titles.length} 页，缓存命中 ${titles.length - pending.length}，待抓 ${pending.length}`,
  );
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const data = await apiGet({
      action: "query",
      titles: batch.join("|"),
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      format: "json",
      formatversion: "2",
    });
    const received = new Map();
    for (const page of data.query?.pages ?? []) {
      let content = null;
      if (!page.missing && page.revisions?.[0]?.slots?.main?.content != null) {
        content = page.revisions[0].slots.main.content;
      }
      received.set(page.title, content);
    }
    const lines = [];
    for (const title of batch) {
      // 规范化标题差异（API 可能返回规范化后标题）：按收到的键回填，缺的按 null 记
      const content = received.get(title) ?? null;
      cache.set(title, content);
      lines.push(JSON.stringify({ t: title, w: content }));
    }
    appendFileSync(cacheFile, lines.join("\n") + "\n", "utf8");
    const done = Math.min(i + batchSize, pending.length);
    if (done % 2000 < batchSize || done === pending.length) {
      console.error(`${logPrefix}: wikitext 进度 ${done}/${pending.length}`);
    }
    await sleep(150);
  }
  return cache;
}
