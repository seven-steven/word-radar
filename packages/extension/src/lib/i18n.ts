/**
 * i18n 辅助函数：包装 chrome.i18n.getMessage，提供参数化插值语法糖。
 *
 * Chrome i18n 使用 $1, $2, $3... 作为占位符， substitutions 数组按顺序替换。
 * 本模块提供类型安全的辅助函数，简化调用。
 *
 * 单测环境兼容：当 chrome.i18n 不可用时（Node.js 环境），返回 key 本身或
 * 回退到中文字符串，避免测试失败。
 */

/** 检查是否在 Chrome 扩展环境中 */
function isChromeI18nAvailable(): boolean {
  return typeof chrome !== "undefined" && chrome.i18n !== undefined;
}

/**
 * 获取本地化消息（变参，code-review Simplify：t1/t2/t3/t4 曾是四份逐字拷贝
 * 的 arity 特化——统一为本实现，t1…t4 退化为薄别名保留调用点与 arity 检查）。
 * @param key messages.json 中的 key，消息中可含 $1, $2… 占位符
 * @param args 按序替换 $1, $2… 的参数（String() 后传给 getMessage）
 */
export function t(key: string, ...args: Array<string | number>): string {
  if (isChromeI18nAvailable()) {
    return chrome.i18n.getMessage(key, args.map(String)) || key;
  }
  // 单测环境回退：返回 key（测试环境应 mock chrome.i18n 或接受 key 作为返回值）
  return key;
}

/** 单参数薄别名（保持调用点 arity 检查，零改动）。 */
export function t1(key: string, arg1: string | number): string {
  return t(key, arg1);
}

/** 双参数薄别名。 */
export function t2(key: string, arg1: string | number, arg2: string | number): string {
  return t(key, arg1, arg2);
}

/** 三参数薄别名。 */
export function t3(
  key: string,
  arg1: string | number,
  arg2: string | number,
  arg3: string | number,
): string {
  return t(key, arg1, arg2, arg3);
}

/** 四参数薄别名（issue #41 上传超限文案）。 */
export function t4(
  key: string,
  arg1: string | number,
  arg2: string | number,
  arg3: string | number,
  arg4: string | number,
): string {
  return t(key, arg1, arg2, arg3, arg4);
}

/**
 * 静态文本回填（issue #30/#28）：popup 启动时把所有 [data-i18n] 元素回填为
 * 当前 locale 的消息，并设置 <html lang>。
 *
 * chrome.* 直调收在本模块——popup 的 chrome.i18n 边界（与 active-tab.ts 之于
 * chrome.tabs、sw-channel.ts 之于 chrome.runtime 同构），popup.ts 只调用一次。
 *
 * lang 推导：消息解析策略是「UI 语言 zh 系列命中 zh_CN，其余回退
 * default_locale(en)」，而 getUILanguage() 只反映 UI 语言——直接写入会让
 * ja/fr 用户拿到 lang="ja" 却渲染英文文案（WCAG 3.1.1 语言声明失真）。
 * 故按同一策略映射：zh* → "zh-CN"（zh_CN/zh_TW 文案相同），其余 → "en"。
 */
export function applyStaticI18n(doc: Document): void {
  const uiLanguage = chrome.i18n.getUILanguage?.() ?? "en";
  const lang = uiLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  doc.documentElement.setAttribute("lang", lang);

  const elements = doc.querySelectorAll<HTMLElement>("[data-i18n]");
  for (const element of elements) {
    const key = element.getAttribute("data-i18n");
    if (key) {
      const message = chrome.i18n.getMessage(key);
      if (message) {
        element.textContent = message;
      }
    }
  }
}

