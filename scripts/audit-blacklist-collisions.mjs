#!/usr/bin/env node
/**
 * 黑名单残余碰撞画像——离线复刻工具（issue #51）。
 *
 * 复刻 build-blacklist.mjs 的画像语义（parseNorvigTopWords 前 10000 纯字母词
 * → 对已提交 blacklist.ts 精确匹配，即 build-blacklist.mjs :715-720 逻辑），
 * 不跑 2.5h 再生成。断言口径来自 #51 勘误评论（2026-09-26 离线复算钉死）：
 *   top-1000 = 0；top-3000 = {md, doc}；top-10000 = 572
 *   （= md@1464 + doc@2660 + 570 词全部落排名 5006–9966）
 *
 * 用法：node scripts/audit-blacklist-collisions.mjs [--norvig=<path>] [--out=<dir>]
 *   --norvig  count_1w.txt 路径；缺省按序探测 build-blacklist.mjs 的 --resume
 *             断点缓存（os.tmpdir()）与 /tmp 字面副本，都没有则报错（不自动下载，
 *             下载需 NODE_USE_ENV_PROXY=1，见 memory/wiktionary-blacklist-pipeline）
 *   --out     产出目录，默认 /tmp/word-radar-issue51
 *
 * 产出：collisions-top10000.tsv（词+排名，全量 572）、bucket-target-570.tsv
 * （排名 5006–10000 的逐词分桶对象）、summary.json（口径数字）。只读仓库、
 * 不改 build-blacklist.mjs（#51 边界：只观测不修复）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLACKLIST_PATH = resolve(ROOT, "packages/core/src/blacklist.ts");
// 探测序：build-blacklist.mjs 的 --resume 断点缓存（tmpdir()，权威）→ /tmp 字面副本（历史手工副本兼容）
const NORVIG_CANDIDATES = [
  resolve(tmpdir(), "word-radar-blacklist-norvig.txt"),
  "/tmp/word-radar-blacklist-norvig.txt",
];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => (a.startsWith("--") ? a.slice(2).split("=") : [])),
);
const outDir = args.out ?? "/tmp/word-radar-issue51";
const norvigPath = args.norvig ?? NORVIG_CANDIDATES.find((p) => existsSync(p));

if (!norvigPath) {
  console.error(`Norvig 词表缺失，探测过：${NORVIG_CANDIDATES.join("、")}`);
  console.error("再生成一次 build-blacklist.mjs --resume 可留断点缓存，或手动下载 count_1w.txt 后用 --norvig 指定。");
  process.exit(1);
}

// parseNorvigTopWords 复刻（build-blacklist.mjs:498-508；GUARD_TOP 默认 5000 → need=10000）
const norvigTop = (() => {
  const words = [];
  const need = 10000;
  for (const line of readFileSync(norvigPath, "utf8").split("\n")) {
    if (!line) continue;
    const word = line.split("\t")[0];
    if (/^[a-z]+$/.test(word)) words.push(word);
    if (words.length >= need) break;
  }
  return words;
})();

// blacklist.ts 条目提取（产物行格式：`  "word",`）
const blacklist = new Set(
  [...readFileSync(BLACKLIST_PATH, "utf8").matchAll(/^  "([a-z]+)",$/gm)].map((m) => m[1]),
);

const rankOf = new Map(norvigTop.map((w, i) => [w, i + 1]));
const collisions = norvigTop.map((w, i) => ({ word: w, rank: i + 1 })).filter((c) => blacklist.has(c.word));

const at = (n) => collisions.filter((c) => c.rank <= n);
const summary = {
  blacklistSize: blacklist.size,
  top1000: at(1000).map((c) => c.word),
  top3000: at(3000).map((c) => c.word),
  top10000Count: collisions.length,
  bucketTarget: collisions.filter((c) => c.rank > 5000).length,
};

// 勘误评论钉死的口径断言——数字对不上说明上游语义漂移，禁止继续分桶
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`口径断言失败：${msg}\n${JSON.stringify(summary, null, 2)}`);
    process.exit(1);
  }
};
assert(blacklist.size === 16190, `黑名单词数应为 16190，实得 ${blacklist.size}`);
assert(summary.top1000.length === 0, "top-1000 应零碰撞");
assert(
  summary.top3000.length === 2 && summary.top3000.includes("md") && summary.top3000.includes("doc"),
  "top-3000 应仅 md/doc",
);
assert(summary.top10000Count === 572, `top-10000 碰撞应为 572，实得 ${summary.top10000Count}`);
assert(summary.bucketTarget === 570, `排名 >5000 分桶对象应为 570，实得 ${summary.bucketTarget}`);

const bucket = collisions.filter((c) => c.rank > 5000);
assert(bucket[0].rank === 5006 && bucket.at(-1).rank <= 10000, "分桶对象排名应落 5006–10000");

mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, "collisions-top10000.tsv"),
  ["word\trank", ...collisions.map((c) => `${c.word}\t${c.rank}`)].join("\n") + "\n",
);
writeFileSync(
  resolve(outDir, "bucket-target-570.tsv"),
  ["word\trank", ...bucket.map((c) => `${c.word}\t${c.rank}`)].join("\n") + "\n",
);
writeFileSync(resolve(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

console.log(`口径全绿：top-1000=0、top-3000=${summary.top3000.join(",")}、top-10000=${summary.top10000Count}、分桶对象=${summary.bucketTarget}（排名 ${bucket[0].rank}–${bucket.at(-1).rank}）`);
console.log(`产出：${outDir}/collisions-top10000.tsv、bucket-target-570.tsv、summary.json`);
