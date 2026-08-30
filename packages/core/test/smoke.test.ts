import { describe, expect, it } from "vitest";
import {
  BBDC_PUSHED_FLAG,
  CORE_VERSION,
  createWordEntry,
} from "../src/index.js";
import { CORE_VERSION as CORE_VERSION_FROM_SUBPATH } from "../src/version.js";
import pkg from "../package.json";

describe("@word-radar/core", () => {
  it("exports a version constant", () => {
    expect(CORE_VERSION).toBeTypeOf("string");
    expect(CORE_VERSION.length).toBeGreaterThan(0);
  });

  it("CORE_VERSION 与 package.json version 一致（防 bump 漂移）", () => {
    expect(CORE_VERSION).toBe(pkg.version);
    // barrel 与 version 子路径两个入口必须同值（单一来源：src/version.ts）
    expect(CORE_VERSION_FROM_SUBPATH).toBe(CORE_VERSION);
  });

  it("exports the BBDC flag constant at bit0", () => {
    expect(BBDC_PUSHED_FLAG).toBe(1);
  });

  it("createWordEntry lowercases and trims lemma", () => {
    const entry = createWordEntry("  Run  ");
    expect(entry).toEqual({ lemma: "run", flags: 0 });
  });

  it("createWordEntry accepts custom flags", () => {
    const entry = createWordEntry("serendipity", BBDC_PUSHED_FLAG);
    expect(entry.flags).toBe(1);
  });

  it("createWordEntry rejects empty lemma", () => {
    expect(() => createWordEntry("   ")).toThrow(/empty/i);
  });
});