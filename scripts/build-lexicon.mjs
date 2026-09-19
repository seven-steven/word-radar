#!/usr/bin/env node
/**
 * build-lexicon：构建词形还原守门词典，生成 packages/core/src/lexicon.ts。
 *
 * 来源：Norvig count_1w.txt（Google 万亿词料词频表，word<TAB>count，333333 行，
 * 静态数据集不再更新），取纯字母小写词 top-N。
 *
 * N=20000 的实证依据（2026-09-19 实测排名）：
 *   - 覆盖线：issue #48 复现词表最深的词 thrive 排名 18549 < 20000，
 *     11 个验收词全部落在截选内（脚本自检硬断言）；
 *   - 排杂线：this 的 compromise 误剥形 thi 排名 20241 > 20000——N 一旦 ≥ 20241，
 *     thi 会作为「词典词」骗过守门，this→thi 畸变复发（脚本自检硬断言 N < 20241）；
 *   - 体积：约 2 万词条与 blacklist.ts（16514 词条，源码 160KB / gzip 41KB）同量级。
 *
 * 匹配语义（消费方 lemma.ts finalize）：还原输出按小写精确查词典，
 * 因此本表只需小写纯字母单 token。
 *
 * 零 npm 依赖；Node >= 20（内置 fetch）。本机走代理时须 NODE_USE_ENV_PROXY=1
 * （Node fetch 不认 HTTPS_PROXY）。幂等可重跑；
 * 再生成命令：NODE_USE_ENV_PROXY=1 node scripts/build-lexicon.mjs
 * 原文缓存到 /tmp/count_1w.txt，--refresh 强制重新下载。
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(REPO_ROOT, "packages/core/src/lexicon.ts");
const CACHE_PATH = "/tmp/count_1w.txt";
const NORVIG_URL = "https://www.norvig.com/ngrams/count_1w.txt"; // 必须带 /ngrams 路径，裸域 301→404
const TOP_N = 20000;

// 自检·覆盖线：issue #48 复现词表 + knives→knife 正例，全部必须落在截选内。
const MUST_INCLUDE = [
  "this", "active", "survived", "negative", "thrive",
  "give", "love", "have", "solve", "serve", "knives",
];
// 自检·排杂线：compromise 误剥形（thi ← this、actife ← active 拼接）必须不在截选，
// 否则守门会把伪造形态当词典词放行，#48 畸变复发。
const MUST_EXCLUDE = ["thi", "actife"];

async function fetchWordlist() {
  if (!process.argv.includes("--refresh") && existsSync(CACHE_PATH)) {
    process.stderr.write(`cache hit: ${CACHE_PATH}\n`);
    return readFileSync(CACHE_PATH, "utf8");
  }
  const res = await fetch(NORVIG_URL);
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} ${NORVIG_URL}`);
  }
  const text = await res.text();
  writeFileSync(CACHE_PATH, text);
  return text;
}

const text = await fetchWordlist();
const lines = text.split("\n").filter(Boolean);

/** 纯字母小写单 token（匹配语义：还原输出小写精确查表）。 */
const words = [];
for (const line of lines) {
  const w = line.split("\t")[0].trim().toLowerCase();
  if (!/^[a-z]+$/.test(w)) continue;
  words.push(w);
  if (words.length >= TOP_N) break;
}
const lexicon = new Set(words);

// 数据自检：任何一条不过都拒绝生成（与 blacklist 同策略——产物自检在构建期）。
const rank = new Map();
lines.forEach((line, i) => {
  const w = line.split("\t")[0].trim().toLowerCase();
  if (w && !rank.has(w)) rank.set(w, i + 1);
});
for (const w of MUST_INCLUDE) {
  if (!lexicon.has(w)) {
    throw new Error(`self-check failed: "${w}" (rank ${rank.get(w) ?? "absent"}) not in top-${TOP_N} — N too small for issue #48 coverage`);
  }
}
for (const w of MUST_EXCLUDE) {
  if (lexicon.has(w)) {
    throw new Error(`self-check failed: "${w}" (rank ${rank.get(w)}) leaked into top-${TOP_N} — N too large, gate would accept the fabricated lemma`);
  }
}

const body = `/**
 * 由 scripts/build-lexicon.mjs 生成，勿手改；
 * 来源：Norvig count_1w.txt（Google 万亿词料词频表）纯字母小写词 top-${TOP_N}。
 * 用途：lemmatizeWord 输出的词典级守门（issue #48——畸形 lemma 回退原词形、
 * fixF 拼接形态须过词典、截选外冷僻词零行为变化），详见脚本头注与 lemma.ts finalize。
 * 再生成命令：NODE_USE_ENV_PROXY=1 node scripts/build-lexicon.mjs（--refresh 强制重下）。
 * N=${TOP_N} 依据：覆盖线 thrive 排名 18549；排杂线 thi 排名 20241（N 必须 < 20241）。
 * 本次构建：共 ${lexicon.size} 词条。
 */
export const LEXICON: ReadonlySet<string> = new Set([
${words.map((w) => `  ${JSON.stringify(w)},`).join("\n")}
]);
`;

writeFileSync(OUT_PATH, body);
process.stderr.write(
  `lexicon.ts written: ${lexicon.size} words (source top-${TOP_N}); ` +
  `boundary ranks: thrive=${rank.get("thrive")}, thi=${rank.get("thi")}\n`,
);
