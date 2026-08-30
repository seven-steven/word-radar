/**
 * popup bundle 体量守护（362 kB compromise 事件）：popup 静态可达的 JS 资产
 * 总量必须保持轻量。此前 popup.ts 为 CORE_VERSION import 整个 @word-radar/core
 * barrel（扁平单模块 dist/index.js，第 1 行 import nlp from 'compromise'），
 * 导致 popup 静态引入 ~362 kB NLP 库——修复是经 `@word-radar/core/version`
 * 子路径只取版本常量。
 *
 * 校验磁盘产物真实字节（png-size.test 同款做法），不信构建日志。
 * dist 未构建（纯单测场景）时跳过；build/e2e 链路必过本守护。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const EXTENSION_DIST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
const POPUP_HTML = join(EXTENSION_DIST, "src/popup.html");

/** 单个静态可达资产不得超过的体量（当前 popup.js ~10.4 kB，留 5 倍余量）。 */
const MAX_SINGLE_ASSET_BYTES = 50_000;
/** popup 静态可达资产总量上限（compromise 单块即 362 kB，必撞线）。 */
const MAX_TOTAL_BYTES = 60_000;

interface Asset {
  path: string;
  bytes: number;
}

/**
 * 收集 popup.html 起步、经静态 import 可达的全部 JS 资产（去重）。
 *
 * 导入面刻意从宽（review 加固）：`from"x"` / `import"x"` / 动态 `import("x")`
 * 三种形状、单双引号、相对与 /assets 绝对说明符都收；HTML 侧同时收
 * <script src> 与 <link rel="modulepreload" href>——任一通路漏收都会让
 * 体量预算静默失效。
 */
function collectPopupStaticAssets(): Asset[] {
  const html = readFileSync(POPUP_HTML, "utf8");
  const entrySpecifiers = [
    ...[...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]*modulepreload[^>]*href="([^"]+)"/g)].map((m) => m[1]),
  ];
  expect(entrySpecifiers.length, "popup.html should reference at least one script").toBeGreaterThan(0);

  const resolveSpecifier = (fromFile: string, spec: string): string => {
    if (spec.startsWith("/")) return resolve(EXTENSION_DIST, spec.slice(1));
    return resolve(dirname(fromFile), spec);
  };

  const seen = new Map<string, number>();
  const queue = entrySpecifiers.map((spec) =>
    resolveSpecifier(join(EXTENSION_DIST, "src", "popup.html"), spec),
  );

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    const content = readFileSync(file, "utf8");
    seen.set(file, Buffer.byteLength(content));

    for (const match of content.matchAll(/(?:from|import)\s*?\(??\s*?["']([^"']+\.js)["']/g)) {
      const spec = match[1];
      // 裸说明符（包名）不是磁盘相对资产，跳过；相对与 / 绝对路径都跟随
      if (spec.startsWith(".") || spec.startsWith("/")) {
        queue.push(resolveSpecifier(file, spec));
      }
    }
  }

  return [...seen.entries()].map(([path, bytes]) => ({ path, bytes }));
}

describe.skipIf(!existsSync(POPUP_HTML))("popup bundle weight guard", () => {
  it("popup 静态可达的每个 JS 资产都在体量线内（不携带 NLP 库）", () => {
    const assets = collectPopupStaticAssets();
    const oversized = assets.filter((asset) => asset.bytes > MAX_SINGLE_ASSET_BYTES);
    expect(
      oversized.map((asset) => `${asset.path}: ${asset.bytes} bytes`),
      "popup 静态引入了超重资产（历史上是 compromise 共享块；版本号请走 @word-radar/core/version 子路径）",
    ).toHaveLength(0);
  });

  it("popup 静态可达资产总量在预算内", () => {
    const assets = collectPopupStaticAssets();
    const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
    expect(
      total,
      `popup 静态可达资产总量 ${total} bytes 超预算（资产：${assets
        .map((asset) => `${asset.path.split("/").pop()}=${asset.bytes}`)
        .join(", ")}）`,
    ).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });
});
