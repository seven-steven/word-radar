// @vitest-environment jsdom
import { extractWordEntries } from "@word-radar/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  collectPageText,
  collectVisibleText,
  createVisibilityChecker,
} from "../src/lib/collect.js";

/**
 * DOM 提取测试：夹具 HTML 注入 document.body，
 * 用特征 token（如 navtoken）断言哪些文本进了结果、哪些被排除。
 */

function setFixture(html: string): void {
  document.body.innerHTML = html;
  window.getSelection()?.removeAllRanges();
}

function selectContents(selector: string): void {
  const target = document.querySelector(selector);
  expect(target).not.toBeNull();
  const range = document.createRange();
  range.selectNodeContents(target as Element);
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  selection!.removeAllRanges();
  selection!.addRange(range);
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("collectPageText 提取优先级", () => {
  it("非空选区优先于 article，只取选区内容", () => {
    setFixture(`
      <article><p>articletoken should not appear</p></article>
      <p>outside <span id="sel">selectedtoken inside selection</span></p>
    `);
    selectContents("#sel");

    const result = collectPageText(document, window);

    expect(result.source).toBe("selection");
    expect(result.text).toContain("selectedtoken");
    expect(result.text).not.toContain("articletoken");
    expect(result.text).not.toContain("outside");
  });

  it("纯空白选区视为无选区，回落到 article", () => {
    setFixture(`
      <article><p>articletoken here</p></article>
      <p id="sel">   </p>
    `);
    selectContents("#sel");

    const result = collectPageText(document, window);

    expect(result.source).toBe("article");
    expect(result.text).toContain("articletoken");
  });

  it("无选区时 article 优先于 main", () => {
    setFixture(`
      <article><p>articletoken wins</p></article>
      <main><p>maintoken should not appear</p></main>
    `);

    const result = collectPageText(document, window);

    expect(result.source).toBe("article");
    expect(result.text).toContain("articletoken");
    expect(result.text).not.toContain("maintoken");
  });

  it("无 article 时取 main，body 其余文本不进入结果", () => {
    setFixture(`
      <p>bodyonlytoken should not appear</p>
      <main><p>maintoken wins</p></main>
    `);

    const result = collectPageText(document, window);

    expect(result.source).toBe("main");
    expect(result.text).toContain("maintoken");
    expect(result.text).not.toContain("bodyonlytoken");
  });

  it("无 article/main 时 body 兜底", () => {
    setFixture(`<div><p>bodytoken fallback</p></div>`);

    const result = collectPageText(document, window);

    expect(result.source).toBe("body");
    expect(result.text).toContain("bodytoken");
  });
});

describe("collectVisibleText 排除规则", () => {
  it("排除导航/代码/表单/脚本样式等标签内的文本", () => {
    setFixture(`
      <div id="root">
        <p>prosetoken stays</p>
        <nav>navtoken</nav>
        <header>headertoken</header>
        <footer>footertoken</footer>
        <aside>asidetoken</aside>
        <form>formtoken<button>buttontoken</button></form>
        <pre>pretoken</pre>
        <code>codetoken</code>
        <script>scripttoken</script>
        <style>styletoken</style>
        <noscript>noscripttoken</noscript>
        <template>templatetoken</template>
        <textarea>textareatoken</textarea>
        <select><option>optiontoken</option></select>
        <svg><text>svgtoken</text></svg>
        <iframe>iframetoken</iframe>
      </div>
    `);
    const root = document.querySelector("#root") as Element;

    const text = collectVisibleText(root, window);

    expect(text).toContain("prosetoken");
    for (const token of [
      "navtoken",
      "headertoken",
      "footertoken",
      "asidetoken",
      "formtoken",
      "buttontoken",
      "pretoken",
      "codetoken",
      "scripttoken",
      "styletoken",
      "noscripttoken",
      "templatetoken",
      "textareatoken",
      "optiontoken",
      "svgtoken",
      "iframetoken",
    ]) {
      expect(text).not.toContain(token);
    }
  });

  it("排除 hidden 属性、aria-hidden、display:none、visibility:hidden 的子孙文本", () => {
    setFixture(`
      <div id="root">
        <p>visibletoken stays</p>
        <p hidden>hiddenattrtoken</p>
        <p aria-hidden="true">ariahiddentoken</p>
        <p style="display:none">displaynonetoken</p>
        <p style="visibility:hidden">visibilityhiddentoken</p>
        <div style="display:none"><p>nestedinvisibletoken</p></div>
      </div>
    `);
    const root = document.querySelector("#root") as Element;

    const text = collectVisibleText(root, window);

    expect(text).toContain("visibletoken");
    expect(text).not.toContain("hiddenattrtoken");
    expect(text).not.toContain("ariahiddentoken");
    expect(text).not.toContain("displaynonetoken");
    expect(text).not.toContain("visibilityhiddentoken");
    expect(text).not.toContain("nestedinvisibletoken");
  });

  it("块级元素之间补分隔，跨块不粘词", () => {
    setFixture(`<div id="root"><p>alphatoken</p><p>betatoken</p></div>`);
    const root = document.querySelector("#root") as Element;

    const text = collectVisibleText(root, window);

    expect(text).toMatch(/alphatoken\s+betatoken/);
  });

  it("<br> 处换行，行内元素文本保持连续", () => {
    setFixture(
      `<div id="root"><p>foo <b>inlinebold</b> bar<br>afterbrtoken</p></div>`,
    );
    const root = document.querySelector("#root") as Element;

    const text = collectVisibleText(root, window);

    expect(text).toMatch(/foo\s+inlinebold\s+bar/);
    expect(text).toMatch(/bar\s+afterbrtoken/);
  });
});

describe("createVisibilityChecker", () => {
  it("可见元素返回 true，不可见元素返回 false", () => {
    setFixture(`
      <p id="visible">x</p>
      <p id="hidden" hidden>x</p>
      <p id="aria" aria-hidden="true">x</p>
      <p id="none" style="display:none">x</p>
    `);
    const isVisible = createVisibilityChecker(window);

    expect(isVisible(document.querySelector("#visible") as Element)).toBe(true);
    expect(isVisible(document.querySelector("#hidden") as Element)).toBe(false);
    expect(isVisible(document.querySelector("#aria") as Element)).toBe(false);
    expect(isVisible(document.querySelector("#none") as Element)).toBe(false);
  });
});

describe("端到端：夹具页面 → collectPageText → extractWordEntries", () => {
  it("导航/代码/隐藏元素里的词不进词条，正文词被提取还原", () => {
    setFixture(`
      <header><nav>navigation hamburger menu</nav></header>
      <article>
        <h1>Serendipity</h1>
        <p>The runners were running through gardens.</p>
        <pre><code>const authenticationToken = fetchData()</code></pre>
        <p style="display:none">invisible conspiracy</p>
      </article>
      <footer>footer copyright sitemap</footer>
    `);

    const { text, source } = collectPageText(document, window);
    const entries = extractWordEntries(text);
    const lemmas = entries.map((e) => e.lemma);

    expect(source).toBe("article");
    // 正文词进入结果（含词形还原）
    expect(lemmas).toContain("serendipity");
    expect(lemmas).toContain("run");
    expect(lemmas).toContain("garden");
    // 导航 / 代码 / 隐藏元素 / 页脚词不出现
    for (const bad of [
      "navigation",
      "hamburger",
      "menu",
      "authentication",
      "const",
      "invisible",
      "conspiracy",
      "footer",
      "copyright",
      "sitemap",
    ]) {
      expect(lemmas).not.toContain(bad);
    }
  });
});
