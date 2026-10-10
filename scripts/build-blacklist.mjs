#!/usr/bin/env node
/**
 * build-blacklist：构建缩略词黑名单（v2），生成
 *   - packages/core/src/blacklist.ts
 *   - packages/core/test/fixtures/top-words-1000.txt（管线级回归测试夹具）
 *
 * v2 算法（数据质量审计推翻 v1 后重设计。v1 只按 Wiktionary 类目成员资格收词，
 * 但成员资格只表示「该词条含有一个缩略释义」而非「词本身就是缩略语」，
 * 导致 man(MAN=Metro Area Network)、war(脚注缩写义) 等高频真词大面积误入）：
 *
 *   层0 类目候选：抓 Wiktionary 三个类目（clipping/abbreviation/initialism）成员，
 *      含子类目 BFS（深度 ≤ 2）——只当「候选池」，不再直接入名单。
 *   层1 定义行纯度过滤：批量抓词条 wikitext，统计 ==English== 段全部 `^#`
 *      定义行中「首模板属缩略族」的占比，≥1/5 才保留；无定义行的页
 *      丢弃（保守）。种子词（md）不参与纯度过滤。
 *      v2.1 小写真词页一票否决：词自身的小写页存在且未过纯度线时，
 *      大小写变体页不得为其担保（cat←CAT 连坐问题，2026-09-10 裁决）。
 *   层2 双守卫（最高优先级）：
 *      - 闭类功能词表（GUARD_WORDS，手工维护 ~185 词）；
 *      - 现代语料高频守卫：Norvig count_1w.txt（Google 万亿词料）top-N，默认
 *        N=5000（issue #49 前为 1400；fox@3222 误杀证明上界过低）——必须 ≥1000
 *        （覆盖 fixture top-1000，构造性保证零碰撞），且 ≤5000（GUARD_TOP_MAX；
 *        再大会误保 app@5355 类高频真缩略词，漏收面扩大）。
 *        验收正向词（md@1464/doc@2660）豁免守卫（ACCEPTANCE_POSITIVE，
 *        人工裁决优先于自动启发）。
 *        用 --guard-top=N 覆盖；守卫命中即剔除，即使词通过了纯度过滤。
 *        守卫同时并入 top-N 词的词形还原形（用 packages/core 真实 lemmatizer）：
 *        管线按还原后 lemma 查黑名单，只守表层会漏 kids→kid、yes→ye 这类缺口。
 *
 * 判据事实依据（2026-09 实测）：
 *   - doc/stat 词条头词模板是 {{en-noun}}，缩略义在定义行（# {{clipping of|en|...}}），
 *     所以纯度判据必须下到定义行级别；
 *   - man 小写页首名词块全真实释义（纯度救），MAN 全大写页全 initialism-of
 *     （纯度不救、靠守卫：man Norvig 排名 413）；
 *   - war/progressive/invest/substitute 是「真词页 + 脚注缩写义」，纯度过滤应杀。
 *
 * 清洗规则：去尾部括注（(disambiguation) 类）→ 小写 → 只收 /^[a-z]+$/ 纯字母
 * 单 token。带句点（U.S.）、撇号（don't）、数字、连字符、多词的一律不收。
 *
 * 匹配语义（消费方 extract 管线）：词形还原后按小写 lemma 精确匹配，
 * 因此本名单只需小写单词形态。
 *
 * 零 npm 依赖；Node >= 23.6——加载 packages/core 真实 lemmatizer 需要
 * 原生 TS type-stripping 与 module.registerHooks（fetch 亦为内置）；幂等可重跑；统计输出到 stderr。
 * 本机走代理时须 NODE_USE_ENV_PROXY=1（Node fetch 不认 HTTPS_PROXY）。
 * 再生成命令：NODE_USE_ENV_PROXY=1 node scripts/build-blacklist.mjs
 * 断点续跑：… node scripts/build-blacklist.mjs --resume（类目成员/wikitext/Norvig
 * 原文缓存到 /tmp；调 --guard-top 重跑不需要重新抓 wikitext）。
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadCoreLemmatizer } from "./lib/load-core-lemmatizer.mjs";
import {
  apiGet,
  sleep,
  purityVerdict,
  fetchWikitexts,
} from "./lib/wikitext.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(REPO_ROOT, "packages/core/src/blacklist.ts");
const FIXTURE_PATH = resolve(REPO_ROOT, "packages/core/test/fixtures/top-words-1000.txt");

const HEADERS = {
  "User-Agent":
    "word-radar-build-blacklist/2.0 (repository: seven-steven/word-radar; build-time fetch, not runtime)",
};
const ROOT_CATEGORIES = [
  "Category:English clippings",
  "Category:English abbreviations",
  "Category:English initialisms",
];
const MAX_SUBCAT_DEPTH = 2; // 子类目递归深度上限（根类目自身为 0）
const PAGE_NS = 0;
const CATEGORY_NS = 14;

const NORVIG_URL = "https://www.norvig.com/ngrams/count_1w.txt"; // word<TAB>count，33 万行
const GUARD_TOP_DEFAULT = 5000; // ≥1000 覆盖 fixture；5000 构造性覆盖 fox@3222（issue #49）及 cat/pass 类常用真词
const GUARD_TOP_MAX = 5000;
const FIXTURE_TOP = 1000;
const CORE_SRC_DIR = resolve(REPO_ROOT, "packages/core/src");
// 纯度阈值与判定链（WIKITEXT_BATCH / PURITY_THRESHOLD_NUM / purityVerdict /
// fetchWikitexts 等）自 issue #51 修复起收在 ./lib/wikitext.mjs 单一事实源，
// 词条级 patch 脚本（scripts/patch-blacklist-lowercase-veto.mjs）共用，
// 两处不得分叉。阈值取值的实证夹逼见 lib 内注释。

// `--resume`：断点续跑。类目成员 / 词条 wikitext / Norvig 原文缓存到 /tmp，
// 抓取中断后重跑可跳过已完成部分。默认（不带 flag）永远实时抓取。
const RESUME = process.argv.includes("--resume");
const guardTopArg = process.argv.find((a) => a.startsWith("--guard-top="));
const GUARD_TOP = guardTopArg
  ? Math.min(GUARD_TOP_MAX, Math.max(FIXTURE_TOP, Number(guardTopArg.split("=")[1]) || GUARD_TOP_DEFAULT))
  : GUARD_TOP_DEFAULT;
const CACHE_DIR = tmpdir();
const CACHE_CATEGORIES = resolve(CACHE_DIR, "word-radar-blacklist-pages-cache.json");
const CACHE_WIKITEXT = resolve(CACHE_DIR, "word-radar-blacklist-wikitext-cache.jsonl");
const CACHE_NORVIG = resolve(CACHE_DIR, "word-radar-blacklist-norvig.txt");

/**
 * 纯度判据的实证教训（2026-09-09 落档防回退，2026-10-10 增补 v3）：
 * 1. 「首 POS 块占比」判据必杀 doc——现代 Wiktionary 把 POS 嵌在编号词源下
 *    （===Etymology 1=== → ====Noun====），且 doc 首名词块仅一条无模板释义
 *    （{{lb|en|informal}} A doctor），首块无任何缩略模板可数；
 * 2. 「任一 POS 块占比」判据必放 progressive——其第三个名词块仅一条
 *    {{clip of|en|progressive dinner}}，单定义块 ratio=1.0 顶翻整页；
 * 3. 故改为整页占比：==English== 全部顶层定义行统一计数（fbi 1/5 救、
 *    progressive 1/12 杀，天然分离），无需 POS 块定位。
 * 4. 「任一来源页通过」会真词连坐：cat 的来源 {cat, CAT}，小写真词页 7/78
 *    被正确拒绝，但全大写 CAT 页 18/23 通过并为 cat 词目担保（man←MAN、
 *    war←WAR 同构）。v2.1 引入小写真词页一票否决：小写页存在且未过线时
 *    变体页不得担保；无小写页的真缩写（NASA/FBI）与小写页自证者（doc/stat）
 *    均不受影响。实测救回 244 个守卫外日常词，验收线零损伤。
 * 5. v3（issue #51，2026-10-10）：小写自证不再依赖「类目来源恰好含小写页」
 *    的偶然性——sad 类真词只有全大写变体页（SAD）入类目，v2.1 否决不可达，
 *    187+ 个守卫外日常词（分桶报告：sad/silent/egg/wash/juice…）静默误杀。
 *    修复：对纯度通过词主动拉取其小写词条页，仅 reason==="mixed"（词条
 *    真实存在且混合词义）构成否决；redirect/no-english 不算（FBI/NASA 类
 *    真缩写的小写形通常 redirect 到大写页，零误伤）。
 */

/**
 * 手工种子表：验证确属三个类目抓不到、又必须拦的词。宁少勿多。
 * - md：验收线目标。英文词条是埃及语转写 mdw 的变体拼写
 *   （{{alternative spelling of|egy|mdw}}），不走 clipping/abbreviation/initialism
 *   标签通道，三个类目均不收录，必须手工种子；同时豁免层1纯度过滤
 *   （其定义行是 alternative spelling of，不属缩略族）。（2026-09-09 API 核验）
 * 曾核查过的候选（均实证无需种子，勿再加回）：
 * - ft：英文词条带 {{abbr of|en|foot}}，自动归入 English abbreviations。
 * - hrs：wikitext 推断疑似漏网，但真实类目抓取证实它已被收录（2026-09-09 构建日志
 *   「类目已收录」），以类目数据为准。
 */
const SEED_WORDS = ["md"];

/**
 * 验收线正向词（ADR-0002：md/doc/stat 必须命中黑名单，测试同步断言）。
 * 豁免守卫剔除：md@1464、doc@2660 在 Norvig top-5000 守卫圈内（issue #49
 * 提界前上限 1400 恰好绕开它们），无豁免则守卫吞掉验收词。种子 md 天然
 * 在此表——人工裁决的必收词优先级高于自动守卫启发。
 */
const ACCEPTANCE_POSITIVE = ["md", "doc", "stat"];

/** 候选种子：疑似漏网词。构建时对照类目成员检查并在 stderr 报告是否真漏网，据此决定是否转正。 */
const SEED_CANDIDATES = ["hrs", "ft"];

/**
 * 闭类功能词守卫表（stay-list 手工部分）：英语闭类高频词，即使出现在类目里也剔除。
 * 只保护闭类高频词；内容词同形碰撞（stat 拉丁借词、ad=advertisement 截短）不守卫，
 * 黑名单制天然接受这类代价（ADR-0002）。必含：is am are was were be been being
 * do does did have has had can will would may no so if by he she it we they my why not。
 * 现代语料高频部分（Norvig top-N）在 main() 里动态并入，不在此表。
 */
const GUARD_WORDS = [
  // 冠词与指示词
  "a", "an", "the", "this", "that", "these", "those",
  // 人称代词（主格/宾格）
  "i", "you", "he", "she", "it", "we", "they",
  "me", "him", "her", "us", "them",
  // 物主代词
  "my", "your", "his", "its", "our", "their", "mine", "yours", "hers", "ours", "theirs",
  // 反身代词
  "myself", "yourself", "himself", "herself", "itself", "ourselves", "themselves", "yourselves",
  // 疑问/关系词
  "who", "whom", "whose", "which", "what", "when", "where", "why", "how",
  "whoever", "whomever", "whatever", "whichever", "whenever", "wherever", "however",
  // be 变位
  "be", "is", "am", "are", "was", "were", "been", "being",
  // do 变位
  "do", "does", "did", "doing",
  // have 变位
  "have", "has", "had", "having",
  // 情态与助动类
  "can", "could", "will", "would", "shall", "should", "may", "might", "must", "let", "ought", "cannot",
  // 否定与极性
  "not", "no", "yes", "never", "ever", "nor",
  // 并列/从属连词
  "and", "or", "but", "if", "because", "as", "than", "so", "too",
  "whether", "while", "until", "till", "since", "though", "although", "unless", "either", "neither",
  // 介词
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "about", "into",
  "over", "under", "up", "down", "out", "off", "upon", "among", "amongst",
  "across", "along", "around", "behind", "below", "beside", "besides", "between", "beyond",
  "despite", "during", "except", "inside", "outside", "toward", "towards",
  "through", "throughout", "without", "within", "against", "amid",
  // 限定词与量词
  "all", "any", "both", "each", "few", "more", "most", "other", "some", "such",
  "only", "own", "same", "every", "many", "much",
  // 不定代词
  "one", "someone", "anyone", "everyone", "nobody", "somebody", "anybody", "everybody",
  "something", "anything", "everything", "nothing",
  // 常用闭类副词
  "very", "just", "now", "then", "there", "here", "again", "once", "also", "always", "already",
];

const REQUIRED_GUARD = [
  "is", "am", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "can", "will", "would", "may",
  "no", "so", "if", "by", "he", "she", "it", "we", "they", "my", "why", "not",
];

function assert(condition, message) {
  if (!condition) {
    console.error(`build-blacklist: 自检失败 — ${message}`);
    process.exit(1);
  }
}

// sleep / apiGet 自 ./lib/wikitext.mjs 共享导入（issue #51 修复抽出）。

/** 大文件下载（Norvig 词料），复用退避策略。 */
async function downloadText(url) {
  let lastError;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      const backoff = 3000 * 2 ** i;
      console.error(`build-blacklist: 下载失败（${err instanceof Error ? err.message : err}），${backoff}ms 后重试`);
      await sleep(backoff);
    }
  }
  throw lastError;
}

/**
 * 收集一个类目的全部 page 成员，子类目 BFS 递归（深度 ≤ MAX_SUBCAT_DEPTH）。
 */
async function collectCategoryPages(rootCategory) {
  const pages = new Set();
  const visitedCats = new Set();
  let subcatCount = 0;
  let requests = 0;
  const queue = [{ title: rootCategory, depth: 0 }];

  while (queue.length > 0) {
    const { title, depth } = queue.shift();
    const key = title.toLowerCase();
    if (visitedCats.has(key)) continue;
    visitedCats.add(key);
    subcatCount += depth === 0 ? 0 : 1;

    let cmcontinue = "";
    do {
      const params = {
        action: "query",
        list: "categorymembers",
        cmtitle: title,
        cmlimit: "500",
        cmtype: "page|subcat", // 注意：值是 subcat 不是 subcategory
        format: "json",
        formatversion: "2",
      };
      if (cmcontinue) params.cmcontinue = cmcontinue;
      const data = await apiGet(params);
      requests++;
      for (const member of data.query?.categorymembers ?? []) {
        if (member.ns === CATEGORY_NS) {
          if (depth < MAX_SUBCAT_DEPTH) queue.push({ title: member.title, depth: depth + 1 });
        } else if (member.ns === PAGE_NS) {
          pages.add(member.title);
        }
      }
      cmcontinue = data.continue?.cmcontinue ?? "";
      await sleep(150); // 礼貌抓取
    } while (cmcontinue);
  }
  return { pages, subcats: subcatCount, requests };
}

/**
 * 清洗归一化：去尾部括注 → 小写 → 只收 /^[a-z]+$/ 纯字母单 token。
 * @returns {string | null}
 */
function normalizeTitle(title) {
  const stripped = title.trim().replace(/\s*\([^)]*\)\s*$/, ""); // (disambiguation) 类后缀
  const lowered = stripped.toLowerCase();
  return /^[a-z]+$/.test(lowered) ? lowered : null;
}

// ---------- 层1：定义行纯度过滤（判定链在 ./lib/wikitext.mjs） ----------

// ---------- 层2：Norvig 高频守卫 ----------

// lemmatizer 经 scripts/lib/load-core-lemmatizer.mjs 稳定入口加载（issue #54
// Wave F）：Node 原生加载 core TS 源所需的 resolve 钩子与加载后哨兵断言都
// 收在该工具里——core 还原行为漂移时管线起步即失败，不再持有 core 内部
// import 风格知识。守卫必须与管线使用同一还原器：否则 kids→kid、yes→ye、
// tips→tip 这类「表层高频在守卫内、还原形落守卫外」的词形缺口会漏杀
// （2026-09-10 实测）。
const loadLemmatizer = () => loadCoreLemmatizer(CORE_SRC_DIR);

/**
 * 解析 count_1w.txt：返回前 max(needTopN, 10000) 个 /^[a-z]+$/ 词（排名序）。
 * 守卫取前 GUARD_TOP 个；残余碰撞画像取前 10000。
 */
function parseNorvigTopWords(text) {
  const words = [];
  const need = Math.max(GUARD_TOP, 10000);
  for (const line of text.split("\n")) {
    if (!line) continue;
    const word = line.split("\t")[0];
    if (/^[a-z]+$/.test(word)) words.push(word);
    if (words.length >= need) break;
  }
  return words;
}

// ---------- 产物生成 ----------

function buildBlacklistTs(words, stats) {
  const sorted = [...words].sort();
  const lines = sorted.map((w) => `  ${JSON.stringify(w)},`);
  return `/**
 * 由 scripts/build-blacklist.mjs 生成，勿手改；
 * 来源：Wiktionary clipping/abbreviation/initialism 类目
 *   → 层1 定义行纯度过滤（整页定义行缩略族模板占比 ≥1/5，
 *     小写真词页一票否决大小写变体页担保）
 *   → 层2 守卫（手工闭类功能词表 + Norvig count_1w.txt top-${GUARD_TOP} 高频词
 *     及其词形还原形；验收正向词 md/doc/stat 豁免守卫）
 *   + 手工种子表（md）；
 * 再生成命令：NODE_USE_ENV_PROXY=1 node scripts/build-blacklist.mjs；
 * 断点续跑加 --resume。v2 算法详见脚本头注与 docs/adr/0002。
 * 本次构建：类目候选 ${stats.normalized} → 纯度+否决后 ${stats.afterPurity}
 *   → 守卫剔除后 ${stats.afterGuard}（剔除 ${stats.guardDropped}）
 *   → + 种子 ${stats.seeds.join("、")} = 最终 ${sorted.length}。
 */
export const ABBREVIATION_BLACKLIST: ReadonlySet<string> = new Set([
${lines.join("\n")}
]);
`;
}

function buildFixture(topWords) {
  const fixtureWords = topWords.slice(0, FIXTURE_TOP);
  const header = [
    "# Norvig count_1w.txt（Google Trillion Word Corpus）词频前 " + FIXTURE_TOP + " 名（已过滤为纯字母词）。",
    "# 来源：https://www.norvig.com/ngrams/count_1w.txt（word<TAB>count，按行序即词频排名）。",
    "# 由 scripts/build-blacklist.mjs 自动重写，勿手改；",
    "# 再生成命令：NODE_USE_ENV_PROXY=1 node scripts/build-blacklist.mjs",
    "#",
  ];
  return header.join("\n") + "\n" + fixtureWords.join("\n") + "\n";
}

async function main() {
  // 形态自检：守卫表与种子表自身必须满足纯字母单 token，必含项必须齐
  for (const w of [...GUARD_WORDS, ...SEED_WORDS]) {
    assert(/^[a-z]+$/.test(w), `守卫/种子表形态非法：${w}`);
  }
  for (const w of REQUIRED_GUARD) {
    assert(GUARD_WORDS.includes(w), `守卫表缺必含词：${w}`);
  }

  // ---------- 层2 前置：Norvig 词料 ----------
  let norvigText;
  if (RESUME && existsSync(CACHE_NORVIG) && statSync(CACHE_NORVIG).size > 1_000_000) {
    norvigText = readFileSync(CACHE_NORVIG, "utf8");
    console.error(`build-blacklist: Norvig — 命中断点缓存（${(norvigText.length / 1e6).toFixed(1)} MB）`);
  } else {
    norvigText = await downloadText(NORVIG_URL);
    if (RESUME) writeFileSync(CACHE_NORVIG, norvigText, "utf8");
  }
  const norvigTop = parseNorvigTopWords(norvigText);
  assert(norvigTop.length >= GUARD_TOP, `Norvig 词料解析不足 ${GUARD_TOP} 词（只得 ${norvigTop.length}）`);
  const rankOf = new Map(norvigTop.map((w, i) => [w, i + 1]));
  for (const w of ACCEPTANCE_POSITIVE) {
    const r = rankOf.get(w);
    console.error(`build-blacklist: Norvig 排名 — ${w}: ${r ?? ">10000"}`);
  }

  // ---------- 层0：类目候选 ----------
  // --resume 装载类目缓存须容错（issue #53-4）：缓存由下方非原子
  // writeFileSync 写出，~2.5h 运行期间被杀（SIGKILL/断电/pmset sleep）会留
  // 下断尾 JSON，裸 JSON.parse 使此后每次 --resume 启动即 SyntaxError
  // （错误里连文件名都没有）、被迫手工删缓存丢全部类目进度——恰是 --resume
  // 要在崩溃残骸中存活的对象。损坏按空缓存从头重爬（自愈，wikitext JSONL
  // 缓存仍有效），stderr 带文件名提示。
  const catCache = RESUME && existsSync(CACHE_CATEGORIES)
    ? (() => {
        try {
          return JSON.parse(readFileSync(CACHE_CATEGORIES, "utf8"));
        } catch (error) {
          console.error(
            `build-blacklist: 类目缓存损坏，按空缓存从头重爬（${CACHE_CATEGORIES}）：${error.message}`,
          );
          return {};
        }
      })()
    : {};
  const wordTitles = new Map(); // 归一化词 → Set<原始标题>
  let rawTitleCount = 0;

  for (const category of ROOT_CATEGORIES) {
    const label = category.replace(/^Category:/, "");
    let pageTitles;
    let subcats = 0;
    let requests = 0;
    if (RESUME && Array.isArray(catCache[label])) {
      pageTitles = catCache[label];
      console.error(`build-blacklist: ${label} — 命中断点缓存，跳过抓取（${pageTitles.length} 页）`);
    } else {
      const fetched = await collectCategoryPages(category);
      pageTitles = [...fetched.pages];
      subcats = fetched.subcats;
      requests = fetched.requests;
      catCache[label] = pageTitles;
      writeFileSync(CACHE_CATEGORIES, JSON.stringify(catCache), "utf8");
    }
    rawTitleCount += pageTitles.length;
    for (const title of pageTitles) {
      const word = normalizeTitle(title);
      if (word === null) continue;
      if (!wordTitles.has(word)) wordTitles.set(word, new Set());
      wordTitles.get(word).add(title);
    }
    console.error(
      `build-blacklist: ${label} — 原始 page ${pageTitles.length}，子类目 ${subcats}（请求 ${requests} 次）`,
    );
  }

  const normalized = new Set(wordTitles.keys());
  console.error(`build-blacklist: 类目候选 — 原始标题 ${rawTitleCount}，归一化后 ${normalized.size} 词`);

  // 候选种子核验（对照归一化候选，是否转正由人工决定后写死进 SEED_WORDS）
  for (const candidate of SEED_CANDIDATES) {
    const leak = !normalized.has(candidate);
    console.error(
      `build-blacklist: 种子候选 "${candidate}" — ${leak ? "确认漏网（类目数据不含）" : "类目已收录，无需种子"}`,
    );
  }

  // ---------- 层1：wikitext 纯度过滤 ----------
  const seedSet = new Set(SEED_WORDS);
  const purityTitles = new Set();
  for (const [word, titles] of wordTitles) {
    if (seedSet.has(word)) continue; // 种子豁免纯度过滤
    for (const t of titles) purityTitles.add(t);
  }
  const wikitexts = await fetchWikitexts([...purityTitles].sort(), {
    apiGet,
    cacheFile: CACHE_WIKITEXT,
    resume: RESUME,
    logPrefix: "build-blacklist",
  });

  const pure = new Set();
  const titleReasons = new Map();
  let vetoCount = 0;
  const needLowerProbe = new Set(); // v3：类目来源无小写自证页的纯度幸存词
  for (const [word, titles] of wordTitles) {
    if (seedSet.has(word)) continue; // 种子不走纯度判定，最后单独合并
    let anyPass = false;
    let lowerPass = false;
    let lowerFail = false;
    let hasLowerSource = false;
    for (const t of titles) {
      const verdict = purityVerdict(wikitexts.get(t) ?? null);
      titleReasons.set(t, verdict.reason);
      if (verdict.pass) anyPass = true;
      // 小写来源标题（=== 归一化词本身）= 词自身的权威词条页
      if (t === word) {
        hasLowerSource = true;
        if (verdict.pass) lowerPass = true;
        else lowerFail = true;
      }
    }
    // v2.1 小写真词页一票否决（2026-09-10 lead 裁决）：词自身的小写页存在且
    // 未过纯度线时，其他大小写变体页（纯缩写的全大写页）不得为其担保——
    // 否则 cat←CAT(18/23)、man←MAN、war←WAR 这类「真词页被连坐」误入名单。
    // 词无小写来源页（NASA/FBI 类真缩写）或小写页自身通过（doc/stat）则不触发。
    const pass = anyPass && (lowerPass || !lowerFail);
    if (anyPass && !pass) vetoCount++;
    if (pass) {
      pure.add(word);
      // v3（issue #51）：v2.1 的否决只对「类目来源恰好含小写页」生效——sad 类
      // 真词只有全大写变体页（SAD）入类目，否决不可达。幸存且无小写来源页的
      // 词补一次主动小写词条页探测（下方批量拉取）。
      if (!hasLowerSource) needLowerProbe.add(word);
    }
  }

  // v3 小写页主动否决（issue #51 修复）：对无小写自证来源的幸存词拉取其
  // 小写词条页——reason==="mixed"（词条真实存在且混合词义）= 真词页证据，
  // 否决出榜；redirect / no-english / no-defs / pure 不构成否决（FBI/NASA
  // 类真缩写的小写形通常 redirect 到大写页，doc/stat 型小写页自证通过）。
  if (needLowerProbe.size > 0) {
    const probeTexts = await fetchWikitexts([...needLowerProbe].sort(), {
      apiGet,
      cacheFile: CACHE_WIKITEXT,
      resume: RESUME,
      logPrefix: "build-blacklist:lower-probe",
    });
    let v3Veto = 0;
    for (const word of needLowerProbe) {
      const verdict = purityVerdict(probeTexts.get(word) ?? null);
      if (verdict.reason === "mixed") {
        pure.delete(word);
        v3Veto++;
        titleReasons.set(word, `${verdict.reason}(v3-probe)`);
      }
    }
    console.error(
      `build-blacklist: v3 小写页主动否决 — 探测 ${needLowerProbe.size} 词，否决 ${v3Veto}（守卫层与豁免词随后仍会再筛）`,
    );
  }

  const pureCountAfterPurity = pure.size;
  const purityReasonTally = {};
  for (const r of titleReasons.values()) purityReasonTally[r] = (purityReasonTally[r] ?? 0) + 1;
  console.error(
    `build-blacklist: 纯度过滤 — 候选 ${normalized.size} → 保留 ${pureCountAfterPurity}，剔除 ${normalized.size - pureCountAfterPurity}` +
      `（其中小写页否决 ${vetoCount}；页面级原因：${JSON.stringify(purityReasonTally)}）`,
  );

  // ---------- 层2：守卫剔除 ----------
  const { lemmatizeWord } = await loadLemmatizer();
  const norvigGuard = new Set(norvigTop.slice(0, GUARD_TOP));
  // 守卫补还原形：管线按还原后 lemma 查黑名单，只守表层会漏 kids→kid、tips→tip、
  // yes→ye、rss→rs 这类「表层在 top-N 内、还原形在 N 外」的缺口
  let stemAdded = 0;
  for (const w of norvigGuard) {
    let lemma;
    try {
      lemma = lemmatizeWord(w);
    } catch {
      continue;
    }
    if (typeof lemma === "string" && /^[a-z]+$/.test(lemma) && !norvigGuard.has(lemma)) {
      norvigGuard.add(lemma);
      stemAdded++;
    }
  }
  const guardSet = new Set([...GUARD_WORDS, ...norvigGuard]);
  console.error(
    `build-blacklist: 守卫表 — 闭类手工 ${GUARD_WORDS.length} + Norvig top-${GUARD_TOP} ` +
      `${norvigGuard.size - stemAdded} + 还原形补丁 ${stemAdded} = ${guardSet.size}`,
  );
  // 守卫豁免：验收正向词人工裁决必收，优先于自动守卫启发（见 ACCEPTANCE_POSITIVE 注释）
  const guardExempt = new Set(ACCEPTANCE_POSITIVE);
  const guardFiltered = [...pure].filter((w) => guardSet.has(w) && !guardExempt.has(w));
  for (const w of guardFiltered) pure.delete(w);

  // 种子合并（豁免集 ⊇ SEED_WORDS，无条件并入）
  const seededIn = SEED_WORDS;
  for (const w of seededIn) pure.add(w);
  const final = pure;

  // ---------- 自检断言 ----------
  // 种子表必须全在豁免表内：种子无条件并入（不先过守卫），将来往 SEED_WORDS
  // 加词若漏同步 ACCEPTANCE_POSITIVE，会静默绕过守卫剔除。
  assert(
    SEED_WORDS.every((w) => ACCEPTANCE_POSITIVE.includes(w)),
    "SEED_WORDS 存在未进 ACCEPTANCE_POSITIVE 的种子——种子绕守卫须显式豁免",
  );
  for (const w of ACCEPTANCE_POSITIVE) {
    assert(final.has(w), `验收线正向词 "${w}" 不在结果中（纯度通道失效或豁免缺失）`);
  }
  for (const w of ["serendipity", "monorepo"]) {
    assert(!final.has(w), `验收线负向词 "${w}" 混入结果`);
  }
  for (const w of guardSet) {
    // 豁免词（md/doc 类）允许同时是守卫词与在榜词——人工裁决优先于自动启发
    if (guardExempt.has(w)) continue;
    assert(!final.has(w), `守卫词 "${w}" 混入结果`);
  }
  assert(final.size >= 1000, `结果规模 ${final.size} < 1000`);

  // ---------- 残余碰撞画像（仅报告，不进 CI） ----------
  for (const bound of [1000, 3000, 10000]) {
    const collisions = norvigTop.slice(0, bound).filter((w) => final.has(w));
    console.error(
      `build-blacklist: 残余碰撞 — Norvig top-${bound}: ${collisions.length} 词` +
        (collisions.length ? `（${collisions.slice(0, 20).join("、")}${collisions.length > 20 ? " …" : ""}）` : ""),
    );
  }

  // ---------- 写产物 ----------
  const stats = {
    normalized: normalized.size,
    afterPurity: pureCountAfterPurity,
    afterGuard: pureCountAfterPurity - guardFiltered.length,
    guardDropped: guardFiltered.length,
    seeds: seededIn,
  };
  const ts = buildBlacklistTs(final, stats);
  writeFileSync(OUT_PATH, ts, "utf8");
  mkdirSync(resolve(FIXTURE_PATH, ".."), { recursive: true });
  writeFileSync(FIXTURE_PATH, buildFixture(norvigTop), "utf8");

  console.error(
    `build-blacklist: 类目候选 ${normalized.size} → 纯度保留 ${pureCountAfterPurity}（剔除 ${normalized.size - pureCountAfterPurity}）` +
      ` → 守卫剔除 ${guardFiltered.length}（${guardFiltered.length <= 40 ? guardFiltered.sort().join("、") : guardFiltered.slice(0, 40).sort().join("、") + ` 等 ${guardFiltered.length} 个`}）` +
      ` + 种子 ${seededIn.join("、")} = 最终 ${final.size} 词`,
  );
  console.error(`build-blacklist: 已写入 ${OUT_PATH}（${(Buffer.byteLength(ts) / 1024).toFixed(1)} KB）`);
  console.error(`build-blacklist: 已写入 ${FIXTURE_PATH}（top-${FIXTURE_TOP}）`);
  console.error(`build-blacklist: 自检通过 — md/doc/stat ∈，serendipity/monorepo ∉，守卫全 ∉，规模 ${final.size}`);
}

main().catch((err) => {
  console.error("build-blacklist:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
