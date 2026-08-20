import { describe, expect, it } from "vitest";
import { verifyManifest } from "../../../scripts/verify-manifest.mjs";

const validManifest = {
  manifest_version: 3,
  name: "WordRadar",
  version: "0.1.0",
  action: { default_popup: "src/popup.html" },
  background: { service_worker: "src/background.ts" },
  icons: {
    "16": "src/assets/icons/icon-16.png",
    "48": "src/assets/icons/icon-48.png",
    "128": "src/assets/icons/icon-128.png",
  },
};

describe("verify-manifest: verifyManifest", () => {
  describe("success path", () => {
    it("returns ok when all three versions agree and manifest is MV3-shaped", () => {
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        distManifest: validManifest,
      });
      expect(result).toEqual({ ok: true, errors: [] });
    });

    it("returns ok when dist manifest is null-ish only if flagged", () => {
      // dist 缺失时 CLI 层提示先 build；纯函数层显式拒绝 null
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: validManifest,
        distManifest: null,
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /build/i.test(e))).toBe(true);
    });
  });

  describe("version mismatch", () => {
    it("fails when root package.json version differs from src manifest", () => {
      const result = verifyManifest({
        rootVersion: "0.2.0",
        srcManifest: { ...validManifest, version: "0.1.0" },
        distManifest: { ...validManifest, version: "0.1.0" },
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /package\.json.*0\.2\.0.*manifest.*0\.1\.0|0\.2\.0.*0\.1\.0/.test(e))).toBe(true);
    });

    it("fails when src and dist manifest versions differ", () => {
      const result = verifyManifest({
        rootVersion: "0.1.0",
        srcManifest: { ...validManifest, version: "0.1.0" },
        distManifest: { ...validManifest, version: "0.3.0" },
      });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("0.1.0") && e.includes("0.3.0"))).toBe(true);
    });
  });

  describe("MV3 shape failures", () => {
    it("fails when manifest_version is not 3", () => {
      const m = { ...validManifest, manifest_version: 2 };
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: m, distManifest: m });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /manifest_version/.test(e))).toBe(true);
    });

    it("fails when name is missing", () => {
      const m = { ...validManifest } as Record<string, unknown>;
      delete m.name;
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: m, distManifest: validManifest });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /name/.test(e))).toBe(true);
    });

    it("fails when action.default_popup is missing", () => {
      const m = { ...validManifest, action: {} };
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: validManifest, distManifest: m });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /default_popup/.test(e))).toBe(true);
    });

    it("fails when background.service_worker is missing", () => {
      const m = { ...validManifest, background: {} };
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: validManifest, distManifest: m });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /service_worker/.test(e))).toBe(true);
    });

    it("fails when an icon size is missing", () => {
      const m = { ...validManifest, icons: { "16": "a.png", "48": "b.png" } };
      const result = verifyManifest({ rootVersion: "0.1.0", srcManifest: validManifest, distManifest: m });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => /128/.test(e))).toBe(true);
    });
  });
});
