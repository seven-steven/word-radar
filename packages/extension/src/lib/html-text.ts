/**
 * html/xml 上传预处理（issue #38 v1.1 决议 A2）：把 HTML/XML 文本先转成
 * 可见正文纯文本，再进提取管线。
 *
 * - 与网页采集同质：直接复用 collect.js 的 collectVisibleText（TreeWalker
 *   可见文本，天然剔除 script/style/nav 等非正文标签），并按与
 *   collectPageText 一致的 article → main → body 优先级选根。
 * - 不用 innerText：DOMParser 产出的 detached 文档上 innerText 退化为
 *   textContent，会把 script/style 的源码文本一并漏进来。
 * - xml 也按 "text/html" 解析：HTML parser 对 XML 宽容，未知标签当普通
 *   元素处理，正文文本落进 body。
 *
 * 预处理在 popup 侧做（csv-file.ts 的 readUploadFiles 调用本模块）：
 * DOMParser 是浏览器 API，SW 侧单测不 mock DOM（spec Testing Decisions）。
 * 本模块只 import collect.js（纯函数、无 core barrel 依赖），不触碰
 * popup bundle 体量守护（popup-bundle.test）的红线。
 */
import { collectBodyTextWithPreFallback } from "./collect.js";

export function htmlToVisibleText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
  if (root === null) return "";
  // 视图从解析文档派生（code-review Simplify #18）：去环境全局 window 耦合
  // （jsdom 的 detached 文档 defaultView 为 null → 回退全局，行为不变）；
  // 正文提取带 pre 回退（code-review P1 #8）：正文全在 <pre> 的 html 不再
  // 提取 0 词，与网页采集 collectPageText 同语义。
  return collectBodyTextWithPreFallback(
    root,
    root.ownerDocument.defaultView ?? window,
  );
}
