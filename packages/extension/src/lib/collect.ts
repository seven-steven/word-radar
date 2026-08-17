/**
 * 网页正文可见文本采集（纯 DOM 逻辑，不触碰任何 chrome.* API）。
 *
 * 提取优先级（spec §扩展行为）：
 *   非空选区 → <article> → <main> → <body> 兜底
 *
 * 实现：TreeWalker 按文档序遍历容器内文本节点，
 * 祖先链上命中排除标签或不可见元素的文本一律丢弃；
 * 块级边界与 <br> 处补换行，避免跨块粘词。
 */

export type CollectSource = "selection" | "article" | "main" | "body";

export interface CollectResult {
  text: string;
  source: CollectSource;
}

/**
 * 不承载正文阅读文本的标签：
 * spec 列出的 script/style/nav/header/footer/aside/form/pre/code，
 * 加上同族的表单控件、代码内联标签与嵌入内容（均无正文文本）。
 */
const EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "NAV",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "FORM",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "DATALIST",
  "BUTTON",
  "PRE",
  "CODE",
  "KBD",
  "SAMP",
  "VAR",
  "SVG",
  "CANVAS",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "VIDEO",
  "AUDIO",
]);

/**
 * 块级边界标签：文本节点直接父元素属于此类时，在其后补一个换行，
 * 防止 `</p><p>` 这类无空白边界把两个词粘成一个候选。
 */
const BLOCK_BOUNDARY_TAGS: ReadonlySet<string> = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "DL",
  "DT",
  "DD",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TD",
  "TH",
  "CAPTION",
  "BLOCKQUOTE",
  "FIGURE",
  "FIGCAPTION",
  "ADDRESS",
  "DETAILS",
  "SUMMARY",
  "DIALOG",
]);

/** 元素可见性判定；可注入，便于测试与将来扩展（如 opacity、offscreen）。 */
export type VisibilityChecker = (el: Element) => boolean;

/**
 * 默认可见性：hidden 属性、aria-hidden="true"、
 * computed display:none / visibility:hidden|collapse 均判不可见。
 * （用 getAttribute 而非 el.hidden 属性，避免依赖 HTMLElement 具体类型。）
 */
export function createVisibilityChecker(win: Window): VisibilityChecker {
  return (el) => {
    if (el.getAttribute("hidden") !== null) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = win.getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }
    return true;
  };
}

export interface CollectOptions {
  isVisible?: VisibilityChecker;
}

/**
 * tagName 归一化为大写：HTML 元素在 HTML 文档里天然大写，
 * 但 foreign element（SVG/MathML，如 <svg>、<text>）保留原始大小写。
 */
function tagOf(el: Element): string {
  return el.tagName.toUpperCase();
}

/** 收集 root 子树内的可见文本（root 自身的可见性/标签也会被检查）。 */
export function collectVisibleText(
  root: Element,
  win: Window,
  options: CollectOptions = {},
): string {
  const isVisible = options.isVisible ?? createVisibilityChecker(win);
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (node.nodeType === 1) {
          // 元素节点：只关心 <br>（补换行），其余 SKIP（继续下钻子树）
          return tagOf(node as Element) === "BR"
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
        // 文本节点：祖先链（含 root、直到 documentElement）上有
        // 排除标签或不可见元素即拒绝
        for (
          let el = (node as Text).parentElement;
          el !== null;
          el = el.parentElement
        ) {
          if (EXCLUDED_TAGS.has(tagOf(el))) return NodeFilter.FILTER_REJECT;
          if (!isVisible(el)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const parts: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === 1) {
      parts.push("\n"); // <br>
      continue;
    }
    const text = node as Text;
    parts.push(text.data);
    const parent = text.parentElement;
    if (parent !== null && BLOCK_BOUNDARY_TAGS.has(tagOf(parent))) {
      parts.push("\n");
    }
  }
  return parts.join("");
}

/**
 * 按优先级采集页面文本：
 * 1. 非空选区（trim 后非空白）——直接用 Selection 文本，天然可见；
 * 2. 否则依次取 <article> / <main> / <body>（文档序第一个）做 TreeWalker。
 */
export function collectPageText(
  doc: Document,
  win: Window,
  options: CollectOptions = {},
): CollectResult {
  const selectionText = win.getSelection()?.toString() ?? "";
  if (selectionText.trim().length > 0) {
    return { text: selectionText, source: "selection" };
  }

  const article = doc.querySelector("article");
  if (article !== null) {
    return { text: collectVisibleText(article, win, options), source: "article" };
  }
  const main = doc.querySelector("main");
  if (main !== null) {
    return { text: collectVisibleText(main, win, options), source: "main" };
  }
  const body = doc.body;
  if (body === null) {
    return { text: "", source: "body" };
  }
  return { text: collectVisibleText(body, win, options), source: "body" };
}
