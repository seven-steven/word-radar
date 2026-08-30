import { defineConfig } from "tsup";

export default defineConfig({
// 两个入口刻意独立打包（splitting: false，各自完全内联、互不共享 chunk）：
// - index：完整 barrel（含 extract/lemma → compromise）
// - version：无依赖最小模块——popup 等只取版本号的消费方走
//   `@word-radar/core/version` 子路径，不把 NLP 库带进 bundle
entry: ["src/index.ts", "src/version.ts"],
  splitting: false,
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  treeshake: true,
  minify: false,
  external: [],
});