/**
 * Content script 占位：仅挂载一个标记，验证扩展脚手架可加载到网页。
 * 后续工单会在这里实现 TreeWalker 提取 + 发 WORDS_COLLECTED 消息。
 */

const MARK_ID = "word-radar-content-mounted";

if (!document.getElementById(MARK_ID)) {
  const marker = document.createElement("div");
  marker.id = MARK_ID;
  marker.setAttribute("data-word-radar-version", "0.1.0");
  marker.style.display = "none";
  document.documentElement.appendChild(marker);
}

export {};