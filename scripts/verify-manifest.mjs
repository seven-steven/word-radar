#!/usr/bin/env node
/**
 * verify-manifest：断言三方 version 一致 + MV3 基本形态合规 + i18n 结构（src 与 zip）。
 *
 * 三方：根 package.json / packages/extension/src/manifest.json /
 * dist/word-radar-<version>-chrome.zip 内的 manifest.json（verify-zip 提供
 * 纯 Node zip 解析；zip 缺失时提示先 build/package，非零退出）。
 *
 * 断言逻辑全部抽纯函数 `verifyManifest(...)`——locale 载荷由调用方注入，
 * 函数本身不触文件系统——便于单测 fixture 覆盖失败路径。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChromeZip, readZipEntry } from "./verify-zip.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SRC_MANIFEST = resolve(REPO_ROOT, "packages/extension/src/manifest.json");
const OUT_DIR = resolve(REPO_ROOT, "dist");

const ICON_SIZES = ["16", "48", "128"];
const I18N_PLACEHOLDER_PATTERN = /^__MSG_(\w+)__$/;
const I18N_REQUIRED_LOCALES = ["en", "zh_CN", "zh_TW"];

/**
 * locale 装载结果：`{ messages }` 装载成功；`{ error }` 携带缺失/解析失败原因
 * （由调用方读 `_locales/<locale>/messages.json` 时生成）。
 * @typedef {{ messages: object } | { error: string }} LocaleLoadResult
 */

/**
 * 校验三方版本一致性 + MV3 形态 + i18n 结构（对 src 与 zip 内 manifest 各查一遍）。
 *
 * @param {{
 *   rootVersion: string,
 *   srcManifest: object | null,
 *   zipManifest: object | null,
 *   srcLocales: Record<string, LocaleLoadResult>,
 *   zipBuffer?: Buffer,
 * }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function verifyManifest({ rootVersion, srcManifest, zipManifest, srcLocales, zipBuffer }) {
  const errors = [];

  if (typeof rootVersion !== "string" || rootVersion.length === 0) {
    errors.push("root package.json version is empty or missing");
  }
  if (!srcManifest || typeof srcManifest !== "object") {
    errors.push("src manifest.json is missing or unreadable");
  }
  if (!zipManifest || typeof zipManifest !== "object") {
    errors.push("manifest.json in word-radar-<version>-chrome.zip is missing — run 'pnpm build && pnpm package' first");
  }
  if (errors.length > 0) return { ok: false, errors };

  const versions = [
    ["root package.json", rootVersion],
    ["src manifest.json", srcManifest.version],
    ["zip manifest.json", zipManifest.version],
  ];
  for (const [label, v] of versions) {
    if (typeof v !== "string" || v.length === 0) {
      errors.push(`${label} version is empty or missing`);
    }
  }
  const [r, s, z] = versions.map(([, v]) => v);
  if (r && s && r !== s) {
    errors.push(`version mismatch: root package.json is ${r} but src manifest.json is ${s}`);
  }
  if (r && z && r !== z) {
    errors.push(`version mismatch: root package.json is ${r} but zip manifest.json is ${z}`);
  }
  if (s && z && s !== z) {
    errors.push(`version mismatch: src manifest.json is ${s} but zip manifest.json is ${z}`);
  }

  errors.push(...checkMv3Shape(srcManifest, "src"));
  errors.push(...checkMv3Shape(zipManifest, "zip"));

  errors.push(...checkI18nStructureSrc(srcManifest, srcLocales));

  if (zipBuffer) {
    errors.push(...checkI18nInZip(zipBuffer, srcManifest));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 检查 src 侧 i18n：default_locale、占位符格式、locale 装载结果与 key 一致性。
 *
 * @param {object} manifest src manifest.json（已解析）
 * @param {Record<string, LocaleLoadResult>} srcLocales
 *   每个 locale 的装载结果（main() 读 `_locales/<locale>/messages.json` 生成）：
 *   `{ messages }` 成功；`{ error }` 携带缺失/解析失败原因；缺项视为文件缺失。
 */
function checkI18nStructureSrc(manifest, srcLocales) {
  const errors = [];

  if (manifest.default_locale !== "en") {
    errors.push(`src manifest: default_locale must be "en", got "${manifest.default_locale || ""}"`);
  }

  // src manifest 的 i18n 字段必须是占位符（报错式；key 提取见 extractManifestMessageKeys）
  for (const [field, exampleKey, value] of [
    ["name", "extName", manifest.name],
    ["description", "extDescription", manifest.description],
    ["action.default_title", "extTooltip", manifest.action?.default_title],
  ]) {
    if (typeof value !== "string" || !I18N_PLACEHOLDER_PATTERN.test(value)) {
      errors.push(`src manifest: ${field} must be an i18n placeholder like __MSG_${exampleKey}__, got "${value ?? ""}"`);
    }
  }

  const messageKeys = extractManifestMessageKeys(manifest);
  const localeData = {};
  for (const locale of I18N_REQUIRED_LOCALES) {
    const entry = srcLocales?.[locale];
    if (!entry || !entry.messages) {
      errors.push(`src _locales: ${entry?.error ?? `missing ${locale}/messages.json`}`);
      continue;
    }
    localeData[locale] = entry.messages;
    errors.push(...checkReferencedKeys(messageKeys, entry.messages, locale, "src"));
  }

  errors.push(...checkLocaleConsistency(messageKeys, localeData, "src"));
  return errors;
}

/**
 * 检查 zip 包内 i18n：_locales 条目装载与 key 一致性（readZipEntry 为内存解析，无 fs 访问）。
 */
function checkI18nInZip(zipBuffer, manifest) {
  const errors = [];
  const messageKeys = extractManifestMessageKeys(manifest);
  const localeData = {};

  for (const locale of I18N_REQUIRED_LOCALES) {
    try {
      const messages = JSON.parse(readZipEntry(zipBuffer, `_locales/${locale}/messages.json`).toString("utf8"));
      localeData[locale] = messages;
      errors.push(...checkReferencedKeys(messageKeys, messages, locale, "zip"));
    } catch (err) {
      errors.push(`zip _locales: ${locale}/messages.json error - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  errors.push(...checkLocaleConsistency(messageKeys, localeData, "zip"));
  return errors;
}

/**
 * 从 manifest 的 i18n 占位符字段静默提取 message key 集合；
 * 非占位符字段不产生 key（格式报错由 src 侧 checkI18nStructureSrc 负责）。
 */
function extractManifestMessageKeys(manifest) {
  const keys = new Set();
  for (const value of [manifest.name, manifest.description, manifest.action?.default_title]) {
    const match = typeof value === "string" ? value.match(I18N_PLACEHOLDER_PATTERN) : null;
    if (match) keys.add(match[1]);
  }
  return keys;
}

/**
 * 校验单个已装载 locale 覆盖 manifest 引用的全部 key（src/zip 共用）。
 */
function checkReferencedKeys(messageKeys, messages, locale, label) {
  const errors = [];
  for (const key of messageKeys) {
    if (!(key in messages)) {
      errors.push(`${label} _locales: ${locale}/messages.json missing key "${key}" referenced by manifest`);
    }
  }
  return errors;
}

/**
 * 校验三 locale 的 key 一致性（src/zip 共用，label 决定错误文案前缀）：
 * en 与 zh_CN/zh_TW 双向对齐，zh_CN 与 zh_TW 规模一致。仅当 manifest 引用了
 * key 且三方 locale 均装载成功时执行（与既有行为一致）。
 */
function checkLocaleConsistency(messageKeys, localeData, label) {
  const errors = [];
  if (!(messageKeys.size > 0 && localeData["en"] && localeData["zh_CN"] && localeData["zh_TW"])) {
    return errors;
  }

  const enKeys = new Set(Object.keys(localeData["en"]));
  const zhCnKeys = new Set(Object.keys(localeData["zh_CN"]));
  const zhTwKeys = new Set(Object.keys(localeData["zh_TW"]));

  for (const key of enKeys) {
    if (!zhCnKeys.has(key)) errors.push(`${label} _locales: key "${key}" exists in en but missing in zh_CN`);
    if (!zhTwKeys.has(key)) errors.push(`${label} _locales: key "${key}" exists in en but missing in zh_TW`);
  }
  for (const key of zhCnKeys) {
    if (!enKeys.has(key)) errors.push(`${label} _locales: key "${key}" exists in zh_CN but missing in en`);
  }
  for (const key of zhTwKeys) {
    if (!enKeys.has(key)) errors.push(`${label} _locales: key "${key}" exists in zh_TW but missing in en`);
  }
  if (zhCnKeys.size !== zhTwKeys.size) {
    errors.push(`${label} _locales: zh_CN has ${zhCnKeys.size} keys but zh_TW has ${zhTwKeys.size} keys`);
  }

  return errors;
}

/**
 * 断言 MV3 基本形态：manifest_version=3、name、version、action.default_popup、
 * background.service_worker、icons 三尺寸（16/48/128）。
 */
function checkMv3Shape(manifest, label) {
  const errors = [];
  if (manifest.manifest_version !== 3) {
    errors.push(`${label} manifest: manifest_version must be 3, got ${String(manifest.manifest_version)}`);
  }
  if (!manifest.name) errors.push(`${label} manifest: missing "name"`);
  if (!manifest.version) errors.push(`${label} manifest: missing "version"`);
  if (!manifest.action?.default_popup) errors.push(`${label} manifest: missing "action.default_popup"`);
  if (!manifest.background?.service_worker) {
    errors.push(`${label} manifest: missing "background.service_worker"`);
  }
  for (const size of ICON_SIZES) {
    if (!manifest.icons?.[size]) errors.push(`${label} manifest: missing icons["${size}"]`);
  }

  return errors;
}

/**
 * 读取 src `_locales` 三 locale 的 messages.json，构造 verifyManifest 的 srcLocales
 * 装载结果：缺失/解析失败不提前退出，作为 `{ error }` 汇入校验错误。
 */
function loadSrcLocales() {
  const extensionRoot = resolve(REPO_ROOT, "packages/extension");
  const srcLocales = {};
  for (const locale of I18N_REQUIRED_LOCALES) {
    const messagesPath = resolve(extensionRoot, "_locales", locale, "messages.json");
    if (!existsSync(messagesPath)) {
      srcLocales[locale] = { error: `missing ${locale}/messages.json at ${messagesPath}` };
      continue;
    }
    try {
      srcLocales[locale] = { messages: JSON.parse(readFileSync(messagesPath, "utf8")) };
    } catch (err) {
      srcLocales[locale] = { error: `failed to parse ${locale}/messages.json - ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return srcLocales;
}

function main() {
  const packageJsonPath = resolve(REPO_ROOT, "package.json");
  if (!existsSync(packageJsonPath)) {
    console.error("verify-manifest: package.json not found at", packageJsonPath);
    process.exit(1);
  }
  if (!existsSync(SRC_MANIFEST)) {
    console.error("verify-manifest: src manifest.json not found at", SRC_MANIFEST);
    process.exit(1);
  }

  let zipPath;
  try {
    zipPath = findChromeZip(OUT_DIR);
  } catch (err) {
    console.error("verify-manifest:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const rootVersion = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
  const srcManifest = JSON.parse(readFileSync(SRC_MANIFEST, "utf8"));
  let zipManifest = null;
  let zipBuffer = null;
  try {
    zipBuffer = readFileSync(zipPath);
    zipManifest = JSON.parse(readZipEntry(zipBuffer, "manifest.json").toString("utf8"));
  } catch (err) {
    console.error("verify-manifest: failed to read manifest.json from", zipPath, "-", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const result = verifyManifest({ rootVersion, srcManifest, zipManifest, srcLocales: loadSrcLocales(), zipBuffer });
  if (!result.ok) {
    console.error("verify-manifest: FAILED");
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log(`verify-manifest: OK — version ${rootVersion} consistent across package.json / src manifest / zip manifest (${zipPath}), MV3 shape valid, i18n structure valid (src + zip)`);
}

// 仅作为 CLI 直接执行时运行 main（被测试 import 时不执行）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error("verify-manifest:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
