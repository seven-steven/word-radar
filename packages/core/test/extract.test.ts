import { describe, expect, it } from "vitest";
import {
  extractWordEntries,
  isEnglishWord,
  tokenize,
} from "../src/index.js";

/** 便捷：只取 lemma 列表。 */
function lemmas(text: string): string[] {
  return extractWordEntries(text).map((e) => e.lemma);
}

describe("tokenize", () => {
  it("keeps URL as one candidate, not three words", () => {
    expect(tokenize("see https://example.com/foo now")).toEqual([
      "see",
      "https://example.com/foo",
      "now",
    ]);
  });

  it("keeps email, path and identifiers as single candidates", () => {
    expect(tokenize("a foo@example.com b src/components/App.tsx c")).toEqual([
      "a",
      "foo@example.com",
      "b",
      "src/components/App.tsx",
      "c",
    ]);
  });

  it("trims trailing punctuation like sentence periods", () => {
    expect(tokenize("word. don't' well-known--")).toEqual([
      "word",
      "don't",
      "well-known",
    ]);
  });
});

describe("isEnglishWord", () => {
  it.each([
    ["don't", true],
    ["well-known", true],
    ["mother-in-law", true],
    ["https://example.com/foo", false],
    ["foo@example.com", false],
    ["src/components/App.tsx", false],
    ["snake_case", false],
    ["camelCase", false],
    ["PascalCase", false],
    ["$scope", false],
    ["v2", false],
    ["42", false],
    ["XMLHttpRequest", false],
  ])("%s → %s", (token, expected) => {
    expect(isEnglishWord(token)).toBe(expected);
  });
});

describe("extractWordEntries", () => {
  it("recognizes don't and well-known as single words", () => {
    expect(lemmas("He said don't panic; it's a well-known fact.")).toEqual([
      "he",
      "said",
      "don't",
      "panic",
      "it's",
      "a",
      "well-known",
      "fact",
    ]);
  });

  it("rejects URL, email, path, snake/camel/Pascal, $scope, v2", () => {
    const out = lemmas(
      "Visit https://example.com/foo or mail foo@example.com; " +
        "see src/components/App.tsx, snake_case, camelCase, PascalCase, " +
        "$scope and v2 for details.",
    );
    for (const bad of [
      "https://example.com/foo",
      "https",
      "example",
      "com",
      "foo@example.com",
      "src/components/app.tsx",
      "src",
      "tsx",
      "snake_case",
      "camelcase",
      "pascalcase",
      "$scope",
      "scope",
      "v2",
    ]) {
      expect(out).not.toContain(bad);
    }
    expect(out).toContain("visit");
    expect(out).toContain("details");
  });

  it("NFKC normalizes curly quotes and unicode hyphens", () => {
    const curly = extractWordEntries("It’s a well–known “fact”.");
    const straight = extractWordEntries("It's a well-known \"fact\".");
    expect(curly).toEqual(straight);
    expect(curly.map((e) => e.lemma)).toContain("it's");
    expect(curly.map((e) => e.lemma)).toContain("well-known");
  });

  it("returns {lemma, flags:0} entries deduplicated by lowercase lemma", () => {
    const entries = extractWordEntries("Run run RUN Runs runs");
    expect(entries).toEqual([
      { lemma: "run", flags: 0 },
      { lemma: "runs", flags: 0 },
    ]);
  });

  it("does no lemmatization in v1 (running vs runs stay separate)", () => {
    expect(lemmas("running runs")).toEqual(["running", "runs"]);
  });

  it("handles empty input", () => {
    expect(extractWordEntries("")).toEqual([]);
    expect(extractWordEntries("12345 !!! ...")).toEqual([]);
  });

  it("dirty mixed-text end-to-end case", () => {
    const dirty =
      "The React app (v2) renders <div/> via https://react.dev/learn — " +
      "contact jane.doe@corp.io or edit src/utils/parse.ts. " +
      "Watch out for NULL_PTR in fetchData($scope), " +
      "but don't worry: it’s a well-known issue affecting 3000 users. " +
      "Visit www.example.com for more.";
    const out = extractWordEntries(dirty);
    const words = out.map((e) => e.lemma);
    for (const bad of [
      "v2",
      "https://react.dev/learn",
      "www.example.com",
      "jane.doe@corp.io",
      "src/utils/parse.ts",
      "null_ptr",
      "fetchdata",
      "$scope",
      "scope",
      "3000",
    ]) {
      expect(words).not.toContain(bad);
    }
    expect(words).toContain("the");
    expect(words).toContain("don't");
    expect(words).toContain("well-known");
    expect(words).toContain("users");
    // all flags zero
    expect(out.every((e) => e.flags === 0)).toBe(true);
    // deduplicated
    expect(new Set(words).size).toBe(words.length);
  });
});
