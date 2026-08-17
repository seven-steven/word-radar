import { describe, expect, it } from "vitest";
import {
  mergeWordEntries,
  parseWordListCsv,
  stringifyWordListCsv,
  BBDC_PUSHED_FLAG,
  type WordEntry,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// mergeWordEntries
// ---------------------------------------------------------------------------

describe("mergeWordEntries", () => {
  it("returns empty array when given no lists", () => {
    expect(mergeWordEntries()).toEqual([]);
  });

  it("returns a shallow copy of a single list (no cross-mutation)", () => {
    const list: WordEntry[] = [{ lemma: "run", flags: 0 }];
    const result = mergeWordEntries(list);
    expect(result).toEqual([{ lemma: "run", flags: 0 }]);
    // mutating result must not affect original
    result[0].flags = 99;
    expect(list[0].flags).toBe(0);
  });

  it("merges two lists by lemma with flags OR", () => {
    const a: WordEntry[] = [
      { lemma: "run", flags: 0 },
      { lemma: "walk", flags: 1 },
    ];
    const b: WordEntry[] = [
      { lemma: "run", flags: 1 },
      { lemma: "jump", flags: 0 },
    ];
    const result = mergeWordEntries(a, b);
    // run: 0 | 1 = 1; walk stays 1; jump stays 0
    expect(result).toEqual([
      { lemma: "run", flags: 1 },
      { lemma: "walk", flags: 1 },
      { lemma: "jump", flags: 0 },
    ]);
  });

  it("acceptance: {run,0} + {run,1} → {run,1} (已推状态不丢)", () => {
    const a: WordEntry[] = [{ lemma: "run", flags: 0 }];
    const b: WordEntry[] = [{ lemma: "run", flags: 1 }];
    expect(mergeWordEntries(a, b)).toEqual([{ lemma: "run", flags: 1 }]);
  });

  it("ORs multi-bit flags correctly (5 = bit0 | bit2)", () => {
    const a: WordEntry[] = [{ lemma: "test", flags: 1 }]; // bit0
    const b: WordEntry[] = [{ lemma: "test", flags: 4 }]; // bit2
    expect(mergeWordEntries(a, b)).toEqual([{ lemma: "test", flags: 5 }]);
  });

  it("merges three+ lists", () => {
    const lists: WordEntry[][] = [
      [{ lemma: "a", flags: 1 }],
      [{ lemma: "a", flags: 2 }],
      [{ lemma: "a", flags: 4 }],
    ];
    expect(mergeWordEntries(...lists)).toEqual([{ lemma: "a", flags: 7 }]);
  });

  it("deduplicates within a single list", () => {
    const list: WordEntry[] = [
      { lemma: "run", flags: 1 },
      { lemma: "run", flags: 2 },
    ];
    expect(mergeWordEntries(list)).toEqual([{ lemma: "run", flags: 3 }]);
  });

  it("is case-insensitive on lemma", () => {
    const a: WordEntry[] = [{ lemma: "Run", flags: 1 }];
    const b: WordEntry[] = [{ lemma: "run", flags: 2 }];
    expect(mergeWordEntries(a, b)).toEqual([{ lemma: "run", flags: 3 }]);
  });
});

// ---------------------------------------------------------------------------
// parseWordListCsv
// ---------------------------------------------------------------------------

describe("parseWordListCsv", () => {
  it("returns empty array for empty input", () => {
    expect(parseWordListCsv("")).toEqual([]);
  });

  it("returns empty array for header-only input", () => {
    expect(parseWordListCsv("lemma,flags")).toEqual([]);
  });

  it("parses a simple two-row CSV", () => {
    const csv = "lemma,flags\nserendipity,0\nrun,1";
    expect(parseWordListCsv(csv)).toEqual([
      { lemma: "serendipity", flags: 0 },
      { lemma: "run", flags: 1 },
    ]);
  });

  it("handles CRLF line endings", () => {
    const csv = "lemma,flags\r\nhello,0\r\nworld,1";
    expect(parseWordListCsv(csv)).toEqual([
      { lemma: "hello", flags: 0 },
      { lemma: "world", flags: 1 },
    ]);
  });

  it("handles mixed LF/CRLF", () => {
    const csv = "lemma,flags\nfoo,0\r\nbar,1";
    expect(parseWordListCsv(csv)).toEqual([
      { lemma: "foo", flags: 0 },
      { lemma: "bar", flags: 1 },
    ]);
  });

  it("trims whitespace around fields", () => {
    const csv = "lemma,flags\n  hello  , 0 ";
    expect(parseWordListCsv(csv)).toEqual([{ lemma: "hello", flags: 0 }]);
  });

  it("parses multi-bit flags (5 = bit0+bit2)", () => {
    const csv = "lemma,flags\ntest,5";
    expect(parseWordListCsv(csv)).toEqual([{ lemma: "test", flags: 5 }]);
  });

  it("round-trips: stringify→parse is identity", () => {
    const entries: WordEntry[] = [
      { lemma: "serendipity", flags: 0 },
      { lemma: "run", flags: 1 },
      { lemma: "test", flags: 5 },
      { lemma: "multi", flags: 15 },
    ];
    const csv = stringifyWordListCsv(entries);
    expect(parseWordListCsv(csv)).toEqual(entries);
  });

  it("lowercases lemma on parse", () => {
    const csv = "lemma,flags\nRun,1";
    expect(parseWordListCsv(csv)).toEqual([{ lemma: "run", flags: 1 }]);
  });

  // --- RFC 4180 edge cases ---

  it("handles lemma with comma (RFC 4180 quoted)", () => {
    const csv = 'lemma,flags\n"hello,world",1';
    expect(parseWordListCsv(csv)).toEqual([{ lemma: "hello,world", flags: 1 }]);
  });

  it("handles lemma with double-quote (RFC 4180 escaped)", () => {
    const csv = 'lemma,flags\n"say ""hi""",1';
    expect(parseWordListCsv(csv)).toEqual([{ lemma: 'say "hi"', flags: 1 }]);
  });

  // --- Error cases with line numbers ---

  it("throws on row with too few columns (reports line number)", () => {
    const csv = "lemma,flags\nserendipity,0\nrun";
    expect(() => parseWordListCsv(csv)).toThrow(/line 3/i);
  });

  it("throws on row with too many columns (reports line number)", () => {
    const csv = "lemma,flags\nrun,1,extra";
    expect(() => parseWordListCsv(csv)).toThrow(/line 2/i);
  });

  it("throws on non-numeric flags (reports line number)", () => {
    const csv = "lemma,flags\nrun,abc";
    expect(() => parseWordListCsv(csv)).toThrow(/line 2/i);
  });

  it("throws on negative flags (reports line number)", () => {
    const csv = "lemma,flags\nrun,-1";
    expect(() => parseWordListCsv(csv)).toThrow(/line 2/i);
  });

  it("throws on fractional flags (reports line number)", () => {
    const csv = "lemma,flags\nrun,1.5";
    expect(() => parseWordListCsv(csv)).toThrow(/line 2/i);
  });

  it("throws on empty lemma (reports line number)", () => {
    const csv = "lemma,flags\n,1";
    expect(() => parseWordListCsv(csv)).toThrow(/line 2/i);
  });

  it("tolerates trailing newline", () => {
    const csv = "lemma,flags\nhello,0\n";
    expect(parseWordListCsv(csv)).toEqual([{ lemma: "hello", flags: 0 }]);
  });

  it("tolerates multiple trailing newlines", () => {
    const csv = "lemma,flags\nhello,0\n\n";
    expect(parseWordListCsv(csv)).toEqual([{ lemma: "hello", flags: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// stringifyWordListCsv
// ---------------------------------------------------------------------------

describe("stringifyWordListCsv", () => {
  it("returns header-only for empty input", () => {
    expect(stringifyWordListCsv([])).toBe("lemma,flags\n");
  });

  it("stringifies a simple list", () => {
    const csv = stringifyWordListCsv([
      { lemma: "serendipity", flags: 0 },
      { lemma: "run", flags: 1 },
    ]);
    expect(csv).toBe("lemma,flags\nserendipity,0\nrun,1\n");
  });

  it("encodes flags as decimal (including multi-bit)", () => {
    const csv = stringifyWordListCsv([{ lemma: "test", flags: 5 }]);
    expect(csv).toContain("test,5");
  });

  it("RFC 4180: quotes lemma containing comma", () => {
    const csv = stringifyWordListCsv([{ lemma: "hello,world", flags: 1 }]);
    expect(csv).toContain('"hello,world",1');
  });

  it("RFC 4180: quotes lemma containing double-quote and escapes it", () => {
    const csv = stringifyWordListCsv([{ lemma: 'say "hi"', flags: 1 }]);
    expect(csv).toContain('"say ""hi""",1');
  });

  it("RFC 4180: quotes lemma containing newline", () => {
    const csv = stringifyWordListCsv([{ lemma: "hello\nworld", flags: 0 }]);
    expect(csv).toContain('"hello\nworld",0');
  });

  it("round-trips: parse→stringify→parse is identity for complex entries", () => {
    const entries: WordEntry[] = [
      { lemma: "simple", flags: 0 },
      { lemma: "hello,world", flags: 3 },
      { lemma: 'say "hi"', flags: 5 },
      { lemma: "with\nnewline", flags: 7 },
      { lemma: "bbdc-pushed", flags: BBDC_PUSHED_FLAG },
    ];
    const csv = stringifyWordListCsv(entries);
    const parsed = parseWordListCsv(csv);
    expect(parsed).toEqual(entries);
  });
});
