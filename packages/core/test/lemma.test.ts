import { describe, expect, it } from "vitest";
import { extractWordEntries, isProperNoun, lemmatizeWord } from "../src/index.js";

function lemmas(text: string): string[] {
  return extractWordEntries(text).map((e) => e.lemma);
}

describe("lemmatizeWord", () => {
  it("aggregates running/ran/runs into run", () => {
    expect(lemmas("Running ran runs")).toEqual(["run"]);
  });

  it("lemmatizes regular verbs to infinitive", () => {
    expect(lemmatizeWord("walked")).toBe("walk");
    expect(lemmatizeWord("walking")).toBe("walk");
    expect(lemmatizeWord("studies")).toBe("study");
  });

  it("covers common irregular verbs", () => {
    expect(lemmatizeWord("went")).toBe("go");
    expect(lemmatizeWord("took")).toBe("take");
    expect(lemmatizeWord("saw")).toBe("see");
    expect(lemmatizeWord("was")).toBe("be");
    expect(lemmatizeWord("had")).toBe("have");
    expect(lemmatizeWord("made")).toBe("make");
    expect(lemmatizeWord("thought")).toBe("think");
    expect(lemmatizeWord("knew")).toBe("know");
  });

  it("singularizes plural nouns", () => {
    expect(lemmatizeWord("cats")).toBe("cat");
    expect(lemmatizeWord("boxes")).toBe("box");
    expect(lemmatizeWord("knives")).toBe("knife");
    expect(lemmatizeWord("studies")).toBe("study");
  });

  it("keeps contractions and hyphenated words as-is (lowercased)", () => {
    expect(lemmatizeWord("don't")).toBe("don't");
    expect(lemmatizeWord("well-known")).toBe("well-known");
  });

  it("falls back to the lowercased word when no reliable lemma is found", () => {
    expect(lemmatizeWord("xylophone")).toBe("xylophone");
  });
});

describe("proper noun exclusion", () => {
  it("excludes proper nouns by default", () => {
    expect(isProperNoun("Alice")).toBe(true);
    expect(isProperNoun("London")).toBe(true);
    const out = lemmas("Alice and Bob visited London yesterday");
    expect(out).not.toContain("alice");
    expect(out).not.toContain("bob");
    expect(out).not.toContain("london");
    expect(out).toContain("visit");
    expect(out).toContain("yesterday");
  });

  it("keeps proper nouns when excludeProperNouns is false", () => {
    const out = extractWordEntries("Alice visited London", {
      excludeProperNouns: false,
    }).map((e) => e.lemma);
    expect(out).toContain("alice");
    expect(out).toContain("london");
    expect(out).toContain("visit");
  });

  it("does not treat sentence-initial common words as proper nouns", () => {
    const out = lemmas("Running is fun. Cats are cute.");
    expect(out).toContain("run");
    expect(out).toContain("cat");
  });
});

describe("T02 filter regression (URL/email/identifiers still rejected)", () => {
  it("still rejects URL, email, path, snake/camel/Pascal, $scope, v2", () => {
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
    expect(out).toContain("detail");
  });
});
