#!/usr/bin/env node
/**
 * 打包脚本：把 packages/extension/dist 打成 zip，便于分发与加载。
 *
 * 输出：dist/word-radar-extension.zip（位于仓库根目录 dist/）
 *
 * 策略：
 * - 优先使用系统 `zip`（Info-ZIP），Linux / macOS 通常自带；
 * - 若系统无 `zip`，回退到纯 Node 实现（无额外依赖，仅 deflate 普通文件）。
 *
 * 保证：zip 内 manifest.json 位于根层级，解压后可直接作为「已解压的扩展」加载。
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, readdir, stat, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, relative, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const EXTENSION_DIST = resolve(REPO_ROOT, "packages/extension/dist");
const OUT_DIR = resolve(REPO_ROOT, "dist");

/** 版本号取根 package.json，产物名 word-radar-<version>-chrome.zip。 */
function versionedZipName() {
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("root package.json has no version");
  }
  return `word-radar-${pkg.version}-chrome.zip`;
}

async function collectFiles(rootDir) {
  const results = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        // 跳过 source map，避免包体过大
        if (entry.name.endsWith(".map")) continue;
        results.push(full);
      }
    }
  }
  await walk(rootDir);
  return results;
}

/**
 * 纯 Node 的最小 zip 写入（STORE + DEFLATE，无加密，仅支持普通文件）。
 * 生成的 zip 可被 Chrome/Edge 加载扩展的「解压后加载」流程识别。
 */
async function writeZip(files, rootDir, outPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const rel = relative(rootDir, file).split(sep).join("/");
    const content = await readFile(file);
    const crc = crc32(content);
    const compressed = deflateRawSync(content);
    const useDeflate = compressed.length < content.length;
    const storedContent = useDeflate ? compressed : content;
    const method = useDeflate ? 8 : 0;
    const nameBytes = Buffer.from(rel, "utf8");

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8); // compression
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(storedContent.length, 18); // compressed
    localHeader.writeUInt32LE(content.length, 22); // uncompressed
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra length
    nameBytes.copy(localHeader, 30);

    // Central directory header
    const centralHeader = Buffer.alloc(46 + nameBytes.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(storedContent.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBytes.copy(centralHeader, 46);

    localParts.push(localHeader, storedContent);
    centralParts.push(centralHeader);
    offset += localHeader.length + storedContent.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const part of centralParts) centralSize += part.length;

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir start disk
  eocd.writeUInt16LE(centralParts.length, 8);
  eocd.writeUInt16LE(centralParts.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  const final = Buffer.concat([...localParts, ...centralParts, eocd]);
  await writeFile(outPath, final);
}

/** CRC32（IEEE 多项式），用于 zip 条目校验。 */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function runSystemZip(rootDir, files, outPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = ["-q", "-X", outPath, ...files.map((f) => relative(rootDir, f).split(sep).join("/"))];
    const child = spawn("zip", args, { cwd: rootDir, stdio: "ignore" });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`zip exited with code ${code}`));
    });
  });
}

async function main() {
  if (!existsSync(EXTENSION_DIST)) {
    console.error(`package: dist not found at ${EXTENSION_DIST}. Run 'pnpm build' first.`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  // 清理旧版本 zip，保证 dist/ 下唯一版本化产物
  for (const name of await readdir(OUT_DIR)) {
    if (/^word-radar-.*-chrome\.zip$/.test(name) || name === "word-radar-extension.zip") {
      await rm(resolve(OUT_DIR, name));
    }
  }
  const OUT_ZIP = resolve(OUT_DIR, versionedZipName());
  if (existsSync(OUT_ZIP)) await rm(OUT_ZIP);

  const files = await collectFiles(EXTENSION_DIST);
  if (files.length === 0) {
    console.error("package: no files to pack.");
    process.exit(1);
  }

  try {
    await runSystemZip(EXTENSION_DIST, files, OUT_ZIP);
  } catch {
    // 回退：纯 Node 实现
    await writeZip(files, EXTENSION_DIST, OUT_ZIP);
  }

  // 验证 manifest.json 在 zip 根层级
  const { execFileSync } = await import("node:child_process");
  let listing;
  try {
    listing = execFileSync("unzip", ["-l", OUT_ZIP], { encoding: "utf8" });
  } catch {
    listing = "";
  }
  const manifestAtRoot = /^\s*\d+.*\smanifest\.json\s*$/m.test(listing);

  const sizeMb = ((await stat(OUT_ZIP)).size / (1024 * 1024)).toFixed(2);
  console.log(`package: wrote ${relative(REPO_ROOT, OUT_ZIP)} (${sizeMb} MiB, ${files.length} files)`);
  console.log(`package: manifest.json at zip root: ${manifestAtRoot ? "YES" : "NO"}`);
  if (!manifestAtRoot) {
    console.error("package: ERROR — manifest.json is not at the root of the zip.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("package:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
