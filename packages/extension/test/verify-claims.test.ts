import { describe, expect, it, vi } from "vitest";
import {
  assertPermissionJustifications,
  assertNoForbiddenClaims,
  parseForbiddenClaims,
} from "../../../scripts/verify-claims.mjs";

const MANIFEST = {
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: ["https://bbdc.cn/*", "https://langeasy.com.cn/*"],
};

const GOOD_LISTING = `# WordRadar

简介段落。

## 权限理由（逐条，与生产 manifest 一一对应）

\`\`\`text
storage — 保存设置
activeTab — 当前标签页
scripting — 补注入
https://bbdc.cn/* — 不背单词 API
https://langeasy.com.cn/* — 释义接口
\`\`\`

## 其他章节
`;

const GOOD_FACTS = `# FACTS.md

## 隐私口径与禁词表

禁词表（唯一执行来源，机器解析块）：

\`\`\`text forbidden-claims
/不(会)?上传任何(用户)?(数据|信息)/
/不(会)?收集任何(用户)?(数据|信息)/
/不向任何(第三方)?服务器发送/
/无需任何权限/
\`\`\`
`;

const PARSED_CLAIMS = parseForbiddenClaims(GOOD_FACTS);
const CLAIMS = PARSED_CLAIMS.ok ? PARSED_CLAIMS.patterns : [];

describe("verify-claims: parseForbiddenClaims (FACTS.md 单一来源)", () => {
  it("parses regex lines from the forbidden-claims fenced block", () => {
    expect(PARSED_CLAIMS.ok).toBe(true);
    if (PARSED_CLAIMS.ok) {
      expect(PARSED_CLAIMS.patterns).toHaveLength(4);
      expect(PARSED_CLAIMS.patterns[0]).toBeInstanceOf(RegExp);
      expect(PARSED_CLAIMS.patterns[0].source).toBe("不(会)?上传任何(用户)?(数据|信息)");
    }
  });

  it("fails when the forbidden-claims block is missing", () => {
    const result = parseForbiddenClaims("# FACTS\n\n没有禁词块\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("forbidden-claims");
    }
  });

  it("fails on a malformed regex line inside the block", () => {
    const bad = GOOD_FACTS.replace("/无需任何权限/", "/未闭合正则(/");
    const result = parseForbiddenClaims(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("invalid");
    }
  });

  it("fails when a line is not wrapped in slashes", () => {
    const bad = GOOD_FACTS.replace("/无需任何权限/", "无需任何权限");
    const result = parseForbiddenClaims(bad);
    expect(result.ok).toBe(false);
  });

  it("fails on empty / non-string input", () => {
    expect(parseForbiddenClaims("").ok).toBe(false);
  });
});

describe("verify-claims: assertPermissionJustifications (锚定权限理由 text 块)", () => {
  it("returns ok when every token appears in the permission justification block", () => {
    const result = assertPermissionJustifications(GOOD_LISTING, MANIFEST);
    expect(result).toEqual({ ok: true });
  });

  it("returns error listing missing permission tokens", () => {
    const listing = GOOD_LISTING.replace("activeTab — 当前标签页\n", "");
    const result = assertPermissionJustifications(listing, MANIFEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("activeTab");
      expect(result.error).toContain("missing");
    }
  });

  it("returns error listing missing host permission token", () => {
    const listing = GOOD_LISTING.replace("https://langeasy.com.cn/*", "");
    const result = assertPermissionJustifications(listing, MANIFEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("https://langeasy.com.cn/*");
    }
  });

  it("fails when tokens only appear outside the permission block (弱断言修复)", () => {
    const listing = `## 权限理由

\`\`\`text
storage — 保存设置
\`\`\`

## 常见问题

activeTab、scripting、https://bbdc.cn/*、https://langeasy.com.cn/* 在这里提到也没用。
`;
    const result = assertPermissionJustifications(listing, MANIFEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("activeTab");
    }
  });

  it("fails when no permission justification block exists at all", () => {
    const result = assertPermissionJustifications("# 只有标题\n\n正文无块", MANIFEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("权限理由");
    }
  });

  it("rejects empty listing", () => {
    const result = assertPermissionJustifications("", MANIFEST);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("empty");
    }
  });

  it("catches permissions newly added to manifest (drift guard)", () => {
    const manifestWithCookies = {
      ...MANIFEST,
      permissions: [...MANIFEST.permissions, "cookies"],
    };
    const result = assertPermissionJustifications(GOOD_LISTING, manifestWithCookies);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("cookies");
    }
  });
});

describe("verify-claims: assertNoForbiddenClaims (禁词由调用方传入)", () => {
  it("returns ok for clean copy", () => {
    expect(assertNoForbiddenClaims("我们只把生词发送到 bbdc.cn。", CLAIMS)).toEqual({ ok: true });
  });

  it("catches '不上传任何数据' style claims", () => {
    for (const claim of ["不上传任何数据", "绝不上传任何数据", "不会上传任何数据", "不向任何服务器发送数据", "无需任何权限"]) {
      const result = assertNoForbiddenClaims(`本扩展${claim}。`, CLAIMS);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("forbidden");
      }
    }
  });

  it("catches absolute no-collection claims", () => {
    const result = assertNoForbiddenClaims("本扩展不收集任何用户数据。", CLAIMS);
    expect(result.ok).toBe(false);
  });

  it("reports which phrase and where", () => {
    const text = "第一段。\n\n本扩展不上传任何数据。\n";
    const result = assertNoForbiddenClaims(text, CLAIMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("不上传任何数据");
      expect(result.error).toContain("line 3");
    }
  });

  it("rejects empty text", () => {
    const result = assertNoForbiddenClaims("", CLAIMS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("empty");
    }
  });

  it("rejects an empty forbidden list", () => {
    const result = assertNoForbiddenClaims("任意文案", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("forbidden");
    }
  });
});

describe("verify-claims: CLI 直跑守卫（import 不触发 main）", () => {
  it("importing the module does not call process.exit", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit must not be called on import");
    }) as never);
    try {
      await import("../../../scripts/verify-claims.mjs");
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });
});
