/**
 * 黑名单词条级 patch：小写词条页主动否决（issue #51「修」决策落地）。
 *
 * 背景：v2.1 小写真词页否决只对「类目来源恰好含小写页」的词生效——sad 类
 * 真词只有全大写变体页（SAD）入缩略类目，否决不可达，187+ 守卫外日常词
 * 静默误杀（分桶画像 docs/notes/issue-51-bucketing.md）。生成器已同步扩展
 * v3 否决（build-blacklist.mjs 层1，供未来全量再生成）；本脚本对**已提交
 * 产物**做等价的词条级修复——避免 2.5h 类目重爬与上游 Wiktionary 漂移
 * 噪音，diff 干净（只减不加）。
 *
 * 判定（与生成器 v3 同一 lib，零分叉）：对每个在榜词拉取小写词条页，
 * reason==="mixed"（词条真实存在且混合词义）= 真词页证据，剔除；
 * redirect / no-english / no-defs / pure 不构成否决（FBI/NASA 类零误伤）。
 *
 * 豁免：md/doc/stat（ADR-0002 验收线正向词，测试同步断言命中——doc/stat
 * 的词汇化边界与 cal/pee 同族，是否随判据本义出榜留 grilling，本 patch 不动）。
 *
 * 用法：node scripts/patch-blacklist-lowercase-veto.mjs [--dry-run]
 * 断点缓存：/tmp/word-radar-blacklist-lower-probe.jsonl（--resume 语义内置）。
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { apiGet, fetchWikitexts, purityVerdict } from "./lib/wikitext.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");
const BLACKLIST_TS = resolve(REPO_ROOT, "packages/core/src/blacklist.ts");
const CACHE = resolve(tmpdir(), "word-radar-blacklist-lower-probe.jsonl");
const DRY_RUN = process.argv.includes("--dry-run");

/** ADR-0002 验收线正向词（blacklist-data.test 同步断言命中）——本 patch 豁免 */
const KEEP_OVERRIDE = new Set(["md", "doc", "stat"]);

// 哨兵（修复正确性的双向断言，剔除集中不得出现/留存集中必须出现）。
// MUST_REMOVE 选「大写缩写变体页 + 小写普通词条页」型（v3 的修复对象，
// 小写页非缩略定义行占比 >4/5）；turbo/sim/sync 型「小写页自身半缩略」
// （clipping 义占比 ≥1/5 纯度线 → pure、留榜）不在 v3 射程——其人工
// 判据分歧与 doc/stat/cal/pee 同族，留 grilling（分桶报告终裁记录在案）。
const SENTINEL_MUST_REMOVE = ["sad", "silent", "egg", "wash", "juice", "das"];
// nato/hrs 不钉哨兵：nato 小写页含口语化行（mixed，随判据字面出榜）与
// asap/aka 同族；hrs 是 {{plural of|en|hr}} 词条（模板目标身份不可判定，
// 随字面出榜——损失仅「24 hrs」低频形态）。rpm/img 由 alt case 模板修正
// （lib/wikitext.mjs）后稳定回榜，钉入哨兵。
const SENTINEL_MUST_KEEP = ["md", "doc", "stat", "fbi", "ssl", "rpm", "img", "dns", "gpu", "ssd"];

function dirname(p) {
  return p.slice(0, p.lastIndexOf("/"));
}

function main() {
  const src = readFileSync(BLACKLIST_TS, "utf8");
  const words = [...src.matchAll(/^  "([a-z]+)",$/gm)].map((m) => m[1]);
  if (words.length < 10_000) {
    console.error(`patch-blacklist: 解析异常——只得 ${words.length} 词（预期 >10000）`);
    process.exit(1);
  }
  const unique = new Set(words);
  console.error(`patch-blacklist: 在榜 ${unique.size} 词（文件 ${words.length} 行）`);
  for (const w of SENTINEL_MUST_KEEP) {
    if (!unique.has(w)) {
      console.error(`patch-blacklist: 留存哨兵缺失——"${w}" 不在当前榜单（上游已变？）`);
      process.exit(1);
    }
  }

  const candidates = [...unique].filter((w) => !KEEP_OVERRIDE.has(w));
  console.error(`patch-blacklist: 待探测 ${candidates.length} 词（豁免 ${KEEP_OVERRIDE.size}：${[...KEEP_OVERRIDE].join("/")}）`);

  fetchWikitexts(candidates, {
    apiGet,
    cacheFile: CACHE,
    resume: existsSync(CACHE), // 缓存即断点：重跑跳过已抓词
    logPrefix: "patch-blacklist",
  })
    .then((texts) => {
      const removed = [];
      const reasonTally = {};
      for (const w of candidates) {
        const verdict = purityVerdict(texts.get(w) ?? null);
        reasonTally[verdict.reason] = (reasonTally[verdict.reason] ?? 0) + 1;
        if (verdict.reason === "mixed") removed.push(w);
      }
      console.error(
        `patch-blacklist: 小写页判定 — ${JSON.stringify(reasonTally)}；否决（mixed）${removed.length} 词`,
      );

      // 哨兵断言：修复方向双向验证
      for (const w of SENTINEL_MUST_REMOVE) {
        if (unique.has(w) && !removed.includes(w)) {
          console.error(`patch-blacklist: 剔除哨兵失败——"${w}" 未被否决（v3 判定疑似失效）`);
          process.exit(1);
        }
      }
      const removedSet = new Set(removed);
      const kept = [...unique].filter((w) => !removedSet.has(w)).sort();
      // 哨兵第二段：留存哨兵验证**新榜**（kept）——修复初版误检旧榜的 bug
      for (const w of SENTINEL_MUST_KEEP) {
        if (!kept.includes(w)) {
          console.error(`patch-blacklist: 留存哨兵失败——"${w}" 被误剔（v3 判定疑似过杀）`);
          process.exit(1);
        }
      }
      console.error(
        `patch-blacklist: ${unique.size} → ${kept.length}（剔除 ${removed.length}）；剔除样本：${removed.slice(0, 40).join(" ")}${removed.length > 40 ? " …" : ""}`,
      );

      if (DRY_RUN) {
        console.error("patch-blacklist: --dry-run，不写文件");
        return;
      }
      const lines = kept.map((w) => `  ${JSON.stringify(w)},`);
      const out = `/**
 * 由 scripts/build-blacklist.mjs 生成，勿手改；
 * 来源：Wiktionary clipping/abbreviation/initialism 类目
 *   → 层1 定义行纯度过滤（整页定义行缩略族模板占比 ≥1/5，
 *     小写真词页一票否决大小写变体页担保 + v3 小写词条页主动否决）
 *   → 层2 守卫（手工闭类功能词表 + Norvig count_1w.txt top-5000 高频词
 *     及其词形还原形；验收正向词 md/doc/stat 豁免守卫）
 *   + 手工种子表（md）；
 * 再生成命令：NODE_USE_ENV_PROXY=1 node scripts/build-blacklist.mjs；
 * 断点续跑加 --resume。v2 算法详见脚本头注与 docs/adr/0002。
 * 本次为词条级 patch（issue #51「修」决策，2026-10-10）：对在榜词做 v3
 * 小写词条页主动否决（等价逻辑见 scripts/patch-blacklist-lowercase-veto.mjs
 * 与生成器层1），剔除混合词义词 ${removed.length} 个；豁免验收线正向词
 * md/doc/stat。基线 ${unique.size} → ${kept.length}。
 */
export const ABBREVIATION_BLACKLIST: ReadonlySet<string> = new Set([
${lines.join("\n")}
]);
`;
      writeFileSync(BLACKLIST_TS, out, "utf8");
      // 剔除清单落档（报告与验收追溯）
      appendFileSync(
        CACHE.replace(/\.jsonl$/, "-removed.json"),
        JSON.stringify({ removed, tally: reasonTally }, null, 2) + "\n",
        "utf8",
      );
      console.error(`patch-blacklist: 已写 ${BLACKLIST_TS}（剔除清单缓存于 ${CACHE.replace(/\.jsonl$/, "-removed.json")}）`);
    })
    .catch((err) => {
      console.error(`patch-blacklist: 失败 — ${err instanceof Error ? err.stack : err}`);
      process.exit(1);
    });
}

main();
