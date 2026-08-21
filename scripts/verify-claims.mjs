#!/usr/bin/env node
/**
 * verify-claims：断言上架文案与生产 manifest / 隐私口径一致。
 *
 * 1. assertPermissionJustifications(listing, manifest)：
 *    锚定 STORE-LISTING「权限理由」标题后的第一个 fenced text 块，逐 token 覆盖
 *    生产 manifest 的 permissions 与 host_permissions（权限增删任一方漂移、
 *    或 token 只出现在块外无关段落，都会被抓住）。
 * 2. parseForbiddenClaims(factsMd)：
 *    从 docs/chrome-web-store/FACTS.md 的 ```text forbidden-claims 机器解析块
 *    读入禁词正则表（单一来源；FACTS 人读优先，块内每行一个 /regex/）。
 * 3. assertNoForbiddenClaims(text, forbidden)：
 *    STORE-LISTING / PRIVACY 不得含禁词表中的不可辩护措辞。
 *
 * 断言逻辑抽纯函数导出，便于单测 fixture 覆盖。
 * CLI 入口读仓库根 packages/extension/src/manifest.json 与
 * docs/chrome-web-store/{STORE-LISTING,PRIVACY,FACTS}.md，失败非零退出。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const FORBIDDEN_CLAIMS_BLOCK_RE = /^```text[ \t]+forbidden-claims[^\n]*\n([\s\S]*?)^```/m;

/**
 * 从 FACTS.md 解析禁词正则表（单一来源）。
 *
 * 约定：FACTS 中一个 info string 含 forbidden-claims 的 fenced 块，
 * 块内每行一个 `/正则/`（前后必须包斜杠）。块缺失 / 行格式错 / 正则非法即失败。
 *
 * @param {string} factsMd - FACTS.md 全文
 * @returns {{ ok: true, patterns: RegExp[] } | { ok: false, error: string }}
 */
export function parseForbiddenClaims(factsMd) {
  if (typeof factsMd !== "string" || factsMd.length === 0) {
    return { ok: false, error: "FACTS is empty or not a string" };
  }
  const match = factsMd.match(FORBIDDEN_CLAIMS_BLOCK_RE);
  if (!match) {
    return {
      ok: false,
      error: "FACTS.md missing machine-parsable forbidden-claims block ('```text forbidden-claims' fenced block)",
    };
  }
  const lines = match[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { ok: false, error: "forbidden-claims block is empty" };
  }
  const patterns = [];
  for (const line of lines) {
    const m = line.match(/^\/(.+)\/$/);
    if (!m) {
      return { ok: false, error: `invalid forbidden-claims line (expected /regex/): ${line}` };
    }
    try {
      patterns.push(new RegExp(m[1]));
    } catch (err) {
      return {
        ok: false,
        error: `invalid regex in forbidden-claims block: ${line} (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  }
  return { ok: true, patterns };
}

/**
 * 从 STORE-LISTING 提取「权限理由」标题后的第一个 fenced 块。
 *
 * @param {string} listing
 * @returns {{ ok: true, block: string } | { ok: false, error: string }}
 */
function extractPermissionJustificationBlock(listing) {
  const lines = listing.split("\n");
  const headingIdx = lines.findIndex((l) => /权限理由/.test(l));
  if (headingIdx < 0) {
    return { ok: false, error: 'STORE-LISTING missing "权限理由" section heading' };
  }
  const openIdx = lines.findIndex((l, i) => i > headingIdx && l.trimStart().startsWith("```"));
  if (openIdx < 0) {
    return { ok: false, error: 'STORE-LISTING "权限理由" section has no fenced block' };
  }
  const closeIdx = lines.findIndex((l, i) => i > openIdx && l.trim() === "```");
  if (closeIdx < 0) {
    return { ok: false, error: 'STORE-LISTING "权限理由" fenced block is not closed' };
  }
  return { ok: true, block: lines.slice(openIdx + 1, closeIdx).join("\n") };
}

/**
 * 断言 listing「权限理由」fenced 块逐 token 覆盖 manifest 权限清单。
 *
 * @param {string} listing - STORE-LISTING 全文
 * @param {{ permissions?: string[], host_permissions?: string[] }} manifest - 生产 manifest 对象
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertPermissionJustifications(listing, manifest) {
  if (typeof listing !== "string" || listing.length === 0) {
    return { ok: false, error: "listing is empty or not a string" };
  }
  const tokens = [
    ...(Array.isArray(manifest?.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest?.host_permissions) ? manifest.host_permissions : []),
  ];
  if (tokens.length === 0) {
    return { ok: false, error: "manifest has no permissions to verify" };
  }
  const blockResult = extractPermissionJustificationBlock(listing);
  if (!blockResult.ok) {
    return { ok: false, error: `permission justification block: ${blockResult.error}` };
  }
  const missing = tokens.filter((token) => !blockResult.block.includes(token));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `STORE-LISTING permission justification missing tokens: ${missing.join(", ")}`,
    };
  }
  return { ok: true };
}

/**
 * 断言文案不含禁词表中的不可辩护措辞（禁词由调用方从 FACTS.md 解析后传入）。
 *
 * @param {string} text - STORE-LISTING 或 PRIVACY 全文
 * @param {RegExp[]} forbidden - 禁词正则表（parseForbiddenClaims 产物）
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertNoForbiddenClaims(text, forbidden) {
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, error: "text is empty or not a string" };
  }
  if (!Array.isArray(forbidden) || forbidden.length === 0) {
    return { ok: false, error: "forbidden claims list is empty or not an array" };
  }
  const lines = text.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    for (const claim of forbidden) {
      if (claim.test(line)) {
        hits.push(`"${line.trim()}" at line ${i + 1}`);
      }
    }
  });
  if (hits.length > 0) {
    return { ok: false, error: `forbidden privacy claim(s) found: ${hits.join("; ")}` };
  }
  return { ok: true };
}

function main() {
  const manifestPath = resolve(REPO_ROOT, "packages/extension/src/manifest.json");
  const listingPath = resolve(REPO_ROOT, "docs/chrome-web-store/STORE-LISTING.md");
  const privacyPath = resolve(REPO_ROOT, "docs/chrome-web-store/PRIVACY.md");
  const factsPath = resolve(REPO_ROOT, "docs/chrome-web-store/FACTS.md");

  for (const p of [manifestPath, listingPath, privacyPath, factsPath]) {
    if (!existsSync(p)) {
      console.error("verify-claims: file not found at", p);
      process.exit(1);
    }
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const listing = readFileSync(listingPath, "utf8");
  const privacy = readFileSync(privacyPath, "utf8");
  const facts = readFileSync(factsPath, "utf8");

  const claimsResult = parseForbiddenClaims(facts);
  if (!claimsResult.ok) {
    console.error("verify-claims [forbidden-claims]:", claimsResult.error);
    process.exit(1);
  }

  const failures = [
    ["permission justifications", assertPermissionJustifications(listing, manifest)],
    ["STORE-LISTING forbidden claims", assertNoForbiddenClaims(listing, claimsResult.patterns)],
    ["PRIVACY forbidden claims", assertNoForbiddenClaims(privacy, claimsResult.patterns)],
  ].filter(([, result]) => !result.ok);

  if (failures.length > 0) {
    for (const entry of failures) {
      const result = entry[1];
      console.error(`verify-claims [${entry[0]}]:`, result.error);
    }
    process.exit(1);
  }

  console.log("verify-claims: OK — listing covers all manifest permissions; no forbidden claims");
}

// 仅作为 CLI 直接执行时运行 main（被测试 import 时不执行）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error("verify-claims:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
