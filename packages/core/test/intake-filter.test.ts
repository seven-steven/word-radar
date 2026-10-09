import { describe, expect, it } from "vitest";
import {
  createIntakeFilter,
  type IntakeFilterOptions,
} from "../src/intake-filter.js";

/** 测试注入的固定黑名单（机制测试与 blacklist.ts 真实数据隔离）。 */
const TEST_BLACKLIST = new Set(["md", "doc"]);

describe("createIntakeFilter", () => {
  it("rejects a contraction (apostrophe after possessive strip) and counts it", () => {
    const intake = createIntakeFilter({ abbreviationBlacklist: TEST_BLACKLIST });
    expect(intake.rejectsContraction("don't")).toBe(true);
    expect(intake.filteredCount).toBe(1);
  });

  it("lets apostrophe-free tokens through the contraction criterion", () => {
    const intake = createIntakeFilter({ abbreviationBlacklist: TEST_BLACKLIST });
    expect(intake.rejectsContraction("dog")).toBe(false);
    expect(intake.rejectsContraction("well-known")).toBe(false);
    expect(intake.filteredCount).toBe(0);
  });

  it("rejects a blacklisted lemma and counts it", () => {
    const intake = createIntakeFilter({ abbreviationBlacklist: TEST_BLACKLIST });
    expect(intake.rejectsAbbreviation("doc")).toBe(true);
    expect(intake.filteredCount).toBe(1);
  });

  it("matches the blacklist exactly: derived forms and case variants pass", () => {
    const intake = createIntakeFilter({ abbreviationBlacklist: TEST_BLACKLIST });
    expect(intake.rejectsAbbreviation("docs")).toBe(false);
    expect(intake.rejectsAbbreviation("Doc")).toBe(false); // 精确命中，不内部归一
    expect(intake.filteredCount).toBe(0);
  });

  it("filterContractions:false releases contractions and never counts them", () => {
    const intake = createIntakeFilter({
      filterContractions: false,
      abbreviationBlacklist: TEST_BLACKLIST,
    });
    expect(intake.rejectsContraction("aren't")).toBe(false);
    expect(intake.filteredCount).toBe(0);
  });

  it("filterAbbreviations:false releases blacklist hits and never counts them", () => {
    const intake = createIntakeFilter({
      filterAbbreviations: false,
      abbreviationBlacklist: TEST_BLACKLIST,
    });
    expect(intake.rejectsAbbreviation("md")).toBe(false);
    expect(intake.filteredCount).toBe(0);
  });

  it("with both switches off filteredCount stays 0 no matter the input", () => {
    const intake = createIntakeFilter({
      filterAbbreviations: false,
      filterContractions: false,
      abbreviationBlacklist: TEST_BLACKLIST,
    });
    expect(intake.rejectsContraction("you've")).toBe(false);
    expect(intake.rejectsAbbreviation("md")).toBe(false);
    expect(intake.filteredCount).toBe(0);
  });

  it("counts the same word only once (Set accounting)", () => {
    const intake = createIntakeFilter({ abbreviationBlacklist: TEST_BLACKLIST });
    expect(intake.rejectsContraction("you've")).toBe(true);
    expect(intake.rejectsContraction("you've")).toBe(true);
    expect(intake.rejectsAbbreviation("md")).toBe(true);
    expect(intake.rejectsAbbreviation("md")).toBe(true);
    expect(intake.filteredCount).toBe(2); // {you've} + {md}，各自去重
  });

  it("shares one dedup space across both criteria", () => {
    const intake = createIntakeFilter({
      abbreviationBlacklist: new Set(["you've"]),
    });
    expect(intake.rejectsContraction("you've")).toBe(true);
    // 同一 key 已由缩合判据记账，黑名单判据不重复计数
    expect(intake.rejectsAbbreviation("you've")).toBe(true);
    expect(intake.filteredCount).toBe(1);
  });

  it("defaults: switches on, blacklist is the built-in ABBREVIATION_BLACKLIST", () => {
    const intake = createIntakeFilter();
    expect(intake.rejectsContraction("o'clock")).toBe(true);
    expect(intake.rejectsAbbreviation("md")).toBe(true); // 种子词，构建脚本硬编码
    expect(intake.rejectsAbbreviation("serendipity")).toBe(false);
    expect(intake.filteredCount).toBe(2);
  });

  it("accepts an injected replacement blacklist", () => {
    const intake = createIntakeFilter({
      abbreviationBlacklist: new Set(["zzzfake"]),
    });
    expect(intake.rejectsAbbreviation("zzzfake")).toBe(true);
    expect(intake.rejectsAbbreviation("md")).toBe(false); // 内置成员不在注入名单
    expect(intake.filteredCount).toBe(1);
  });

  it("exposes the options shape via IntakeFilterOptions (compile-time)", () => {
    const options: IntakeFilterOptions = {
      filterAbbreviations: true,
      filterContractions: true,
      abbreviationBlacklist: TEST_BLACKLIST,
    };
    const intake = createIntakeFilter(options);
    expect(intake.filteredCount).toBe(0);
  });
});
