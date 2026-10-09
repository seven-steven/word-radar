/**
 * 构建侧加载 packages/core 的 TS 源 lemmatizer（稳定入口，issue #54 Wave F）。
 *
 * 为什么需要钩子：core 的 TS 源以 `./xxx.js` 风格 specifier 互相 import
 * （tsc/tsup 编译约定），Node 原生 type-stripping（≥23.6）解析不了
 * .js→.ts 映射，故挂一个 resolve 钩子把 core/src 内的相对 .js 引用重写为
 * .ts。core 若改用 .ts 后缀 import（allowImportingTsExtensions），此工具的
 * 钩子可整体删除——这是「core TS 加载协议」的唯一持有处，构建脚本不再
 * 各自持有 core 内部文件名与 import 风格知识。
 *
 * 为什么必须与管线同一还原器：黑名单守卫要并入 top-N 词的词形还原形
 * （kids→kid、yes→ye、tips→tip 这类「表层高频在守卫内、还原形落守卫外」
 * 的缺口），用独立实现的还原器会漏杀（2026-09-10 实测）。
 *
 * 加载后哨兵断言：core 的还原行为漂移时，依赖它的构建管线（全量 ~2.5h）
 * 在起步即失败，而不是跑完后悄悄产出与管线行为不一致的黑名单。期望值以
 * packages/core/test/lemma.test.ts 为独立真值源（#48 守门 / #50 负启发
 * 两修复路径各留锚点），core 侧有意变更这些行为时须同步更新哨兵。
 */

import { resolve } from "node:path";

/** 哨兵：加载物必须是当前管线的 lemmatizer（期望值锁在 core lemma.test）。 */
const SENTINELS = [
  ["went", "go"], // 不规则动词表优先
  ["knives", "knife"], // #48 finalize 词典守门 -f/-fe 拼接
  ["pyjamas", "pyjamas"], // #50 -as→-ave 负启发：畸形输出被拒、回退原词形
  ["arenas", "arenas"], // #50 -as 复数同救
];

/**
 * @param {string} coreSrcDir packages/core/src 的绝对路径
 * @returns {Promise<{ lemmatizeWord: (word: string) => string }>}
 */
export async function loadCoreLemmatizer(coreSrcDir) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, next) {
      if (
        specifier.startsWith(".") &&
        specifier.endsWith(".js") &&
        (context.parentURL ?? "").includes("/packages/core/src/")
      ) {
        return next(specifier.slice(0, -3) + ".ts", context);
      }
      return next(specifier, context);
    },
  });
  const module = await import(resolve(coreSrcDir, "lemma.ts"));
  for (const [input, expected] of SENTINELS) {
    const actual = module.lemmatizeWord(input);
    if (actual !== expected) {
      throw new Error(
        `load-core-lemmatizer: 哨兵失败 lemmatizeWord(${JSON.stringify(input)}) = ` +
          `${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}——` +
          `core 的还原行为已漂移，黑名单管线不能继续用旧锚点跑（同步 ` +
          `scripts/lib/load-core-lemmatizer.mjs 的 SENTINELS 与 core/test/lemma.test.ts）`,
      );
    }
  }
  return module;
}
