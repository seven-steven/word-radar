// @vitest-environment jsdom
/**
 * htmlToVisibleText 单测（issue #38 v1.1 决议 A2）：html/xml 上传预处理。
 *
 * DOMParser 解析 + collectVisibleText（与网页采集同质）：
 * - script/style 等非正文文本被剔除（不用 innerText——detached 文档上
 *   innerText 退化为 textContent，会漏进源码文本）
 * - 选根优先级 article → main → body，与 collectPageText 一致
 * - xml 按 text/html 宽容解析，正文落 body
 */
import { describe, expect, it } from "vitest";
import { htmlToVisibleText } from "../src/lib/html-text.js";

describe("htmlToVisibleText（issue #38）", () => {
  it("script 与 style 的文本被剔除，正文保留", () => {
    const html = [
      "<html><head><title>忽略</title><style>.x { color: red }</style></head>",
      "<body><p>alpha bravo</p><script>var ghostToken = 'ghost';</script>",
      "<p>charlie delta</p></body></html>",
    ].join("");

    const text = htmlToVisibleText(html);

    expect(text).toContain("alpha bravo");
    expect(text).toContain("charlie delta");
    expect(text).not.toContain("ghostToken");
    expect(text).not.toContain("color: red");
  });

  it("article 优先于 body：只取 article 子树", () => {
    const html = [
      "<body>",
      "<article><p>articletoken visible</p></article>",
      "<p>outsidetoken ignored</p>",
      "</body>",
    ].join("");

    const text = htmlToVisibleText(html);

    expect(text).toContain("articletoken");
    expect(text).not.toContain("outsidetoken");
  });

  it("无 article/main 时回退 body", () => {
    const html = "<body><p>plainbodytoken</p></body>";

    expect(htmlToVisibleText(html)).toContain("plainbodytoken");
  });

  it("正文全在 pre：pre 回退兜底，不再提取 0 词（code-review P1，与网页采集同语义）", () => {
    const html = "<body><pre>preticket gravitated through silent fjords</pre></body>";

    const text = htmlToVisibleText(html);
    expect(text).toContain("preticket");
    expect(text).toContain("gravitated");
  });

  it("正文非空时 pre 仍被排除（代码块不采集，回退不改变正常路径）", () => {
    const html = "<body><p>prosetoken visible</p><pre>codetoken ignored</pre></body>";

    const text = htmlToVisibleText(html);
    expect(text).toContain("prosetoken");
    expect(text).not.toContain("codetoken");
  });

  it("xml 字符串按 text/html 宽容解析：正文被提取、标签不残留", () => {
    const xml = "<note><to>xmltoken alpha</to><from>xmltoken bravo</from></note>";

    const text = htmlToVisibleText(xml);

    expect(text).toContain("xmltoken alpha");
    expect(text).toContain("xmltoken bravo");
    expect(text).not.toContain("<note>");
  });

  it("空串安全：返回空文本", () => {
    expect(htmlToVisibleText("")).toBe("");
  });
});
