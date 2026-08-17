import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  target: "node20",
  platform: "node",
  banner: {
    // 让 `node ./dist/index.js` 能直接当可执行文件跑（pnpm bin link 时无需显式 node 调用）。
    js: "#!/usr/bin/env node",
  },
  minify: false,
  // commander 是运行时依赖；core 是 workspace 依赖，tsup 必须把 core 的 dist 也 bundle 进去。
  noExternal: [/.*/],
});