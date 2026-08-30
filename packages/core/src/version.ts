/**
 * 包版本号。
 *
 * 刻意独立成无任何 import 的最小模块，并以 `@word-radar/core/version`
 * 子路径导出：只关心版本号的消费方（extension popup）经子路径导入，
 * 避免连带 barrel 入口（dist/index.js 是扁平单模块，首行即
 * `import nlp from 'compromise'`，~362 kB NLP 库）进入 popup bundle。
 */
export const CORE_VERSION = "0.1.0" as const;
