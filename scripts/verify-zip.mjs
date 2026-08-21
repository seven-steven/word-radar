#!/usr/bin/env node
/**
 * verify-zip：断言 dist/ 下恰好一个 word-radar-*-chrome.zip，且 zip 结构合规：
 * manifest.json 在根、三尺寸图标存在、无 .map 泄漏。
 *
 * zip 条目列表用纯 Node 解析 central directory（无系统 unzip 依赖）。
 * 断言逻辑抽纯函数 `verifyZipContents(entries)` / `listZipEntries(buffer)`，便于单测。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(REPO_ROOT, "dist");

const ZIP_NAME_RE = /^word-radar-.+-chrome\.zip$/;
const ICON_ENTRIES = ["src/assets/icons/icon-16.png", "src/assets/icons/icon-48.png", "src/assets/icons/icon-128.png"];

/**
 * 校验 zip 条目列表：manifest 在根、三尺寸图标存在、无 .map。
 *
 * @param {string[]} entries - zip 内全部文件路径（目录分隔符为 /，目录条目可含可不含）
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verifyZipContents(entries) {
  const errors = [];
  const files = entries.filter((e) => !e.endsWith("/"));

  if (!files.includes("manifest.json")) {
    errors.push("manifest.json not found at zip root (must be exactly 'manifest.json' at top level)");
  }
  for (const icon of ICON_ENTRIES) {
    if (!files.includes(icon)) errors.push(`missing icon in zip: ${icon}`);
  }
  const maps = files.filter((e) => e.endsWith(".map"));
  if (maps.length > 0) {
    errors.push(`source map leak in zip: ${maps.join(", ")}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 纯 Node 解析 zip central directory，返回条目路径列表。
 * 支持 0 条目 zip；非 zip 缓冲区抛错。
 *
 * @param {Buffer} buf
 * @returns {string[]}
 */
export function listZipEntries(buf) {
  // 从尾部找 EOCD（签名 0x06054b50，最小 22 字节，前面可能有注释）
  let eocd = -1;
  const maxScan = Math.min(buf.length, 22 + 0xffff);
  for (let i = buf.length - 22; i >= buf.length - maxScan && i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: end-of-central-directory signature not found");

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`corrupt zip: bad central directory header at entry ${i}`);
    }
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    names.push(buf.toString("utf8", offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * 从 zip 缓冲区提取指定条目的原始内容（支持 stored=0 / deflate=8）。
 * 供 verify-manifest 提取 zip 内 manifest.json；条目不存在抛错。
 *
 * @param {Buffer} buf
 * @param {string} name - 条目路径
 * @returns {Buffer}
 */
export function readZipEntry(buf, name) {
  // 复用 EOCD 定位逻辑
  let eocd = -1;
  const maxScan = Math.min(buf.length, 22 + 0xffff);
  for (let i = buf.length - 22; i >= buf.length - maxScan && i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip: end-of-central-directory signature not found");

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`corrupt zip: bad central directory header at entry ${i}`);
    }
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const entryName = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    const compSize = buf.readUInt32LE(offset + 20);
    const localOffset = buf.readUInt32LE(offset + 42);
    offset += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;

    // 解析 local file header 取数据区
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`corrupt zip: bad local header for entry ${entryName}`);
    }
    const method = buf.readUInt16LE(localOffset + 8);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) return Buffer.from(comp);
    if (method === 8) return inflateRawSync(comp);
    throw new Error(`unsupported zip compression method ${method} for entry ${entryName}`);
  }
  throw new Error(`zip entry not found: ${name}`);
}

/**
 * 在目录中定位唯一的 word-radar-<version>-chrome.zip。
 * 目录缺失 / 无 zip / 多个 zip 时抛错（消息与 CLI 口径一致）。
 *
 * @param {string} outDir
 * @returns {string} zip 绝对路径
 */
export function findChromeZip(outDir) {
  if (!existsSync(outDir)) {
    throw new Error("dist/ not found. Run 'pnpm build && pnpm package' first.");
  }
  const zips = readdirSync(outDir).filter((n) => ZIP_NAME_RE.test(n));
  if (zips.length === 0) {
    throw new Error("no word-radar-<version>-chrome.zip found in dist/. Run 'pnpm package' first.");
  }
  if (zips.length > 1) {
    throw new Error(`expected exactly one versioned zip, found ${zips.length}: ${zips.join(", ")}`);
  }
  return resolve(outDir, zips[0]);
}

function main() {
  let zipPath;
  try {
    zipPath = findChromeZip(OUT_DIR);
  } catch (err) {
    console.error("verify-zip:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const entries = listZipEntries(readFileSync(zipPath));

  const result = verifyZipContents(entries);
  if (!result.ok) {
    console.error(`verify-zip: FAILED for ${zips[0]}`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log(`verify-zip: OK — ${zipPath} (${entries.length} entries): manifest at root, 3 icons, no .map leak`);
}

// 仅作为 CLI 直接执行时运行 main（被测试 import 时不执行）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error("verify-zip:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
