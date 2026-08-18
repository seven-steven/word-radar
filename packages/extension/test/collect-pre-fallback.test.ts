// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { collectPageText } from "../src/lib/collect.js";

/**
 * BUG repro: raw.githubusercontent.com 渲染纯文本文件时,
 * 全部正文放在 <pre> 里,collect.ts 的 EXCLUDED_TAGS 排除 PRE,
 * 导致采集词条数为 0。
 */

describe("pre 回退:正文整体在 <pre> 的纯文本页", () => {
  it("pre 承载正文时不应采集到 0 个词", () => {
    document.body.innerHTML = `
      <pre>Grill the user relentlessly about a plan.
Ask follow-up questions and challenge assumptions.</pre>
    `;
    const result = collectPageText(document, window);
    expect(result.text).toContain("relentlessly");
    expect(result.text).toContain("challenge");
  });

  it("页面有正常正文时,<pre> 仍被排除(代码块不采集)", () => {
    document.body.innerHTML = `
      <p>prosetoken in normal paragraph</p>
      <pre>const codetoken = 1;</pre>
    `;
    const result = collectPageText(document, window);
    expect(result.text).toContain("prosetoken");
    expect(result.text).not.toContain("codetoken");
  });

  it("隐藏的 <pre> 不进回退结果", () => {
    document.body.innerHTML = `
      <pre hidden>hiddentoken</pre>
    `;
    const result = collectPageText(document, window);
    expect(result.text).not.toContain("hiddentoken");
  });
});
