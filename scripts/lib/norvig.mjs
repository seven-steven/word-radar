/**
 * Norvig count_1w.txt（Google 万亿词料词频表，word<TAB>count，33 万行，
 * 静态数据集不再更新）解析与排名构造的共享模块（issue #58 收敛：解析
 * 语义只此一份，build-blacklist / build-lexicon / audit-blacklist-collisions
 * 三方不再各自复刻）。零状态纯函数，零 npm 依赖。
 *
 * 两个语义档位——分叉是既有构建语义，本模块将其显式化为契约而非统一
 * （统一会改变构建产物的 rank 值，禁止跨档混用）：
 *
 * - 严格纯字母档（parseNorvigPureWords / buildPureWordRank）：词字段「原样」
 *   比对 /^[a-z]+$/——不 trim 不小写，大写行、带空白/杂字符行直接拒；
 *   排名 = 过滤后序号（重复词后写覆盖，保最后序号）。
 *   适用：build-blacklist.mjs（层2 守卫表与残余碰撞画像）、
 *   audit-blacklist-collisions.mjs（离线碰撞复刻）——两者关心「词料中
 *   严格纯字母词的高频序」。
 *
 * - 归一化档（parseNorvigNormalizedWords / buildNormalizedWordRank）：词字段
 *   trim+lowercase 后比对 /^[a-z]+$/；排名 = 去空行后的原始文件行号
 *   （非纯字母行仍占行号；重复词首现优先）。
 *   适用：build-lexicon.mjs（词典守门截选）——排杂线 thi@20241 依赖
 *   「行号口径、含被过滤行」的排名，归一化容忍行尾空白与大小写漂移。
 */

/**
 * 严格纯字母档解析：返回前 need 个 /^[a-z]+$/ 词（词字段原样比对，跳过
 * 空行）。build-blacklist 传 need = max(GUARD_TOP, 10000)（守卫取前
 * GUARD_TOP 个、残余碰撞画像取前 10000）；audit-blacklist-collisions 传
 * need = 10000（画像口径）。
 */
export function parseNorvigPureWords(text, need) {
  const words = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const word = line.split("\t")[0];
    if (/^[a-z]+$/.test(word)) words.push(word);
    if (words.length >= need) break;
  }
  return words;
}

/**
 * 严格纯字母档排名：Map<词, 过滤后序号（1 起）>，重复词后写覆盖。
 */
export function buildPureWordRank(words) {
  return new Map(words.map((w, i) => [w, i + 1]));
}

/**
 * 归一化档截选：词字段 trim+lowercase 后比对 /^[a-z]+$/（匹配语义：还原
 * 输出小写精确查词典，故只需小写纯字母单 token），返回前 topN 个
 * （build-lexicon 传 topN = TOP_N = 20000）。
 */
export function parseNorvigNormalizedWords(text, topN) {
  const words = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const w = line.split("\t")[0].trim().toLowerCase();
    if (!/^[a-z]+$/.test(w)) continue;
    words.push(w);
    if (words.length >= topN) break;
  }
  return words;
}

/**
 * 归一化档排名：Map<词, 去空行后的原始文件行号（1 起）>——非纯字母行仍占
 * 行号（thi@20241 排杂线口径），重复词首现优先。
 */
export function buildNormalizedWordRank(text) {
  const rank = new Map();
  text.split("\n").filter(Boolean).forEach((line, i) => {
    const w = line.split("\t")[0].trim().toLowerCase();
    if (w && !rank.has(w)) rank.set(w, i + 1);
  });
  return rank;
}
