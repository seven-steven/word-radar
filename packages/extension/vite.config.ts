import { defineConfig, type Plugin } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { build as esbuild } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "./src/manifest.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));

/** 采集内容脚本的稳定产物路径（active-tab.ts 的 CONTENT_SCRIPT_FILES 指向它）。 */
export const CONTENT_SCRIPT_OUTPUT = "assets/content-script.js";

/**
 * activeTab 瘦身（issue #14）：src manifest 不再声明 content_scripts，
 * crxjs 因此不会打包 src/content.ts。内容脚本改为独立 esbuild 产物：
 * 单文件 IIFE（依赖内联，同步执行）。
 *
 * 为什么不用 crxjs 的 content_scripts seam：crxjs 产物套一层 classic loader，
 * loader 用动态 import() 拉取哈希命名的 ES module bundle —— executeScript
 * 在 loader 执行完就 resolve，listener 注册在异步 import 之后，紧随的
 * sendMessage 会竞态性拿到 "Receiving end does not exist"（e2e 实测复现）。
 * 单文件 IIFE 无此竞态，且路径稳定、不随内容哈希变化。
 */
function buildContentScript(): Plugin {
  return {
    name: "word-radar:build-content-script",
    async closeBundle() {
      await esbuild({
        entryPoints: [resolve(here, "src/content.ts")],
        bundle: true,
        format: "iife",
        target: "es2022",
        outfile: resolve(here, "dist", CONTENT_SCRIPT_OUTPUT),
        sourcemap: true,
        minify: false,
        logLevel: "warning",
      });
    },
  };
}

export default defineConfig({
  // Vite 配置：把 dist 名字固定为 `dist/`，让 Chrome 「加载已解压」能直接指向它。
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
  plugins: [crx({ manifest }), buildContentScript()],
  // core 是 workspace 依赖；不在源码里 import src，只通过 dist 入口消费。
  resolve: {
    preserveSymlinks: false,
  },
});
