import { describe, expect, it } from "vitest";
import { assertVersionEntry } from "../../../scripts/verify-changelog.mjs";

describe("verify-changelog: assertVersionEntry", () => {
  describe("success path", () => {
    it("returns ok when changelog contains exact version entry", () => {
      const changelog = `# Changelog\n\n## [0.1.0] - 2026-08-20\n\n- First release\n`;
      const result = assertVersionEntry(changelog, "0.1.0");
      expect(result).toEqual({ ok: true });
    });

    it("returns ok when entry has no date suffix", () => {
      const changelog = `# Changelog\n\n## [1.2.3]\n\n- Some release\n`;
      const result = assertVersionEntry(changelog, "1.2.3");
      expect(result).toEqual({ ok: true });
    });

    it("matches version at the start of a line only", () => {
      const changelog = `# Changelog\n\nMention of [0.1.0] in text\n\n## [0.1.0] - 2026-08-20\n\n- First release\n`;
      const result = assertVersionEntry(changelog, "0.1.0");
      expect(result).toEqual({ ok: true });
    });

    it("handles multiple version entries and finds the correct one", () => {
      const changelog = `# Changelog\n\n## [0.2.0] - 2026-09-01\n\n- Next release\n\n## [0.1.0] - 2026-08-20\n\n- First release\n`;
      expect(assertVersionEntry(changelog, "0.2.0")).toEqual({ ok: true });
      expect(assertVersionEntry(changelog, "0.1.0")).toEqual({ ok: true });
    });
  });

  describe("failure path", () => {
    it("returns error when changelog is empty", () => {
      const result = assertVersionEntry("", "0.1.0");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("empty");
      }
    });

    it("returns error when changelog has no matching version", () => {
      const changelog = `# Changelog\n\n## [0.2.0] - 2026-09-01\n\n- Next release\n`;
      const result = assertVersionEntry(changelog, "0.1.0");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("missing entry");
        expect(result.error).toContain("0.1.0");
      }
    });

    it("returns error when version entry is in wrong format (no brackets)", () => {
      const changelog = `# Changelog\n\n## 0.1.0 - 2026-08-20\n\n- First release\n`;
      const result = assertVersionEntry(changelog, "0.1.0");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("missing entry");
      }
    });

    it("returns error when version is empty", () => {
      const changelog = `# Changelog\n\n## [0.1.0]\n\n- First release\n`;
      const result = assertVersionEntry(changelog, "");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("version is empty");
      }
    });

    it("does not match partial version numbers", () => {
      const changelog = `# Changelog\n\n## [0.1.0]\n\n- First release\n`;
      const result = assertVersionEntry(changelog, "0.1");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("missing entry");
      }
    });

    it("escapes regex special characters in version", () => {
      const changelog = `# Changelog\n\n## [1.0.0+build.123]\n\n- First release\n`;
      const result = assertVersionEntry(changelog, "1.0.0+build.123");
      expect(result).toEqual({ ok: true });
    });
  });
});
