import { describe, expect, it } from "vitest";
import {
  assertPermissionJustifications,
  assertNoForbiddenClaims,
} from "../../../scripts/verify-claims.mjs";

const MANIFEST = {
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: ["https://bbdc.cn/*", "https://langeasy.com.cn/*"],
};

const GOOD_LISTING = `权限理由：
storage — 保存设置
activeTab — 当前标签页
scripting — 补注入
https://bbdc.cn/* — 不背单词 API
https://langeasy.com.cn/* — 释义接口
`;

describe("verify-claims: assertPermissionJustifications", () => {
  it("returns ok when every manifest permission token appears in listing", () => {
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

describe("verify-claims: assertNoForbiddenClaims", () => {
  it("returns ok for clean copy", () => {
    expect(assertNoForbiddenClaims("我们只把生词发送到 bbdc.cn。")).toEqual({ ok: true });
  });

  it("catches '不上传任何数据' style claims", () => {
    for (const claim of ["不上传任何数据", "绝不上传任何数据", "不会上传任何数据"]) {
      const result = assertNoForbiddenClaims(`本扩展${claim}。`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("forbidden");
      }
    }
  });

  it("catches absolute no-collection claims", () => {
    const result = assertNoForbiddenClaims("本扩展不收集任何用户数据。");
    expect(result.ok).toBe(false);
  });

  it("reports which phrase and where", () => {
    const text = "第一段。\n\n本扩展不上传任何数据。\n";
    const result = assertNoForbiddenClaims(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("不上传任何数据");
      expect(result.error).toContain("line 3");
    }
  });

  it("rejects empty text", () => {
    const result = assertNoForbiddenClaims("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("empty");
    }
  });
});
