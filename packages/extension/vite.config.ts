import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./src/manifest.json" with { type: "json" };

export default defineConfig({
  // Vite 配置：把 dist 名字固定为 `dist/`，让 Chrome 「加载已解压」能直接指向它。
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
  plugins: [crx({ manifest })],
  // core 是 workspace 依赖；不在源码里 import src，只通过 dist 入口消费。
  resolve: {
    preserveSymlinks: false,
  },
});