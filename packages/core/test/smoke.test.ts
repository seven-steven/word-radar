import { describe, expect, it } from "vitest";
import {
  BBDC_PUSHED_FLAG,
  CORE_VERSION,
  createWordEntry,
} from "../src/index.js";

describe("@word-radar/core", () => {
  it("exports a version constant", () => {
    expect(CORE_VERSION).toBeTypeOf("string");
    expect(CORE_VERSION.length).toBeGreaterThan(0);
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