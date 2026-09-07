/**
 * OPFS 真实目录树 e2e 探针（File System Access 迁移定稿）。
 *
 * 目的：单测的 fake handle 树证明不了真实形状——本 spec 用真实 Chromium +
 * 真实 OPFS（origin-private file system）验证 collectFilesFromHandles：
 * values() 的 async generator 形态、getFile() 读出可读 File、嵌套树全收。
 *
 * 不依赖扩展 SW：drop-files.ts 是纯 DOM 逻辑（messages.ts 只贡献常量与
 * 类型），用 esbuild 把源码 bundle 成 IIFE + globalName 暴露为
 * window.__dropFiles，addScriptTag 注入普通页面即可调用。
 *
 * 页面必须是 secure context（OPFS 与 show*Picker 只在 secure context 暴露）：
 * 127.0.0.1 属 potentially trustworthy origin，起一个极简本机 http 服务即可；
 * about:blank / data: 不是 secure context，不可用。
 *
 * 仍放进同一 playwright 跑批（playwright.config.ts，workers=1 串行）。
 */
import { test, expect, chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DROP_FILES_SRC = resolve(__dirname, "../../src/lib/drop-files.ts");

let bundlePath: string;
let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  // esbuild bundle：IIFE + globalName——esbuild 对 TS 的 `./messages.js`
  // import 会自动落到 messages.ts；产物为单文件自执行脚本
  const outDir = await mkdtemp(join(tmpdir(), "wr-opfs-bundle-"));
  bundlePath = join(outDir, "drop-files.js");
  await build({
    entryPoints: [DROP_FILES_SRC],
    bundle: true,
    format: "iife",
    globalName: "__dropFiles",
    platform: "browser",
    outfile: bundlePath,
    logLevel: "silent",
  });

  // secure context 宿主页：本机 127.0.0.1 极简静态服务（fixtures.ts 同款做法）
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html><body>opfs probe host page</body></html>");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no server address");
  baseUrl = `http://127.0.0.1:${address.port}/`;
});

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await rm(dirname(bundlePath), { recursive: true, force: true });
});

test("collectFilesFromHandles walks a REAL OPFS tree (values/getFile)", async () => {
  test.setTimeout(60_000);
  // 与 fixtures.ts 同款启动参数（channel chromium = 完整 Chromium 的 new
  // headless）；不加载扩展，普通 context 即可
  const browser = await chromium.launch({
    headless: !process.env.E2E_HEADED,
    channel: process.env.E2E_CHANNEL ?? "chromium",
  });
  try {
    const page = await browser.newPage();
    await page.goto(baseUrl);
    await page.addScriptTag({ path: bundlePath });

    const files = await page.evaluate(async () => {
      const mod = (window as unknown as {
        __dropFiles?: {
          collectFilesFromHandles(
            roots: readonly unknown[],
            files?: File[],
          ): Promise<File[]>;
        };
      }).__dropFiles;
      if (!mod) throw new Error("bundle not injected: __dropFiles missing");

      // 每轮唯一顶层目录：OPFS 按 origin 持久化，重跑不与遗留树互相污染
      const root = await navigator.storage.getDirectory();
      const tree = await root.getDirectoryHandle(`wr-opfs-${Date.now()}`, {
        create: true,
      });

      // 造真实嵌套树：tree/loose.txt、tree/a/a2.md、tree/a/b/b3.txt、
      // tree/a/b/empty/（空目录只展开不收录）
      const write = async (
        dir: FileSystemDirectoryHandle,
        name: string,
        text: string,
      ): Promise<void> => {
        const handle = await dir.getFileHandle(name, { create: true });
        const stream = await handle.createWritable();
        await stream.write(text);
        await stream.close();
      };
      const dirA = await tree.getDirectoryHandle("a", { create: true });
      const dirB = await dirA.getDirectoryHandle("b", { create: true });
      await dirB.getDirectoryHandle("empty", { create: true });
      await write(tree, "loose.txt", "root-loose");
      await write(dirA, "a2.md", "alpha");
      await write(dirB, "b3.txt", "bravo");

      const collected = await mod.collectFilesFromHandles([tree]);
      // File 无法跨 evaluate 序列化回 Node 侧，页内读文本后回传纯对象
      return Promise.all(
        collected.map(async (file) => ({ name: file.name, text: await file.text() })),
      );
    });

    // 数量 + 文件名集合（OPFS values() 列序不承诺，断言用排序后的集合）
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.name).sort()).toEqual(["a2.md", "b3.txt", "loose.txt"]);
    // 内容可读：getFile() 返回的是真实 File 而非空壳
    const byName = new Map(files.map((f) => [f.name, f.text]));
    expect(byName.get("loose.txt")).toBe("root-loose");
    expect(byName.get("a2.md")).toBe("alpha");
    expect(byName.get("b3.txt")).toBe("bravo");

    await page.close();
  } finally {
    await browser.close();
  }
});
