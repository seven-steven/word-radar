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
 * 获取本地化消息（无参数）。
 * @param key messages.json 中的 key
 * @returns 本地化后的字符串，key 不存在时返回 key 本身
 */
export function t(key: string): string {
  if (isChromeI18nAvailable()) {
    return chrome.i18n.getMessage(key) || key;
  }
  // 单测环境回退：返回 key（测试环境应 mock chrome.i18n 或接受 key 作为返回值）
  return key;
}

/**
 * 获取本地化消息（单个参数）。
 * @param key messages.json 中的 key，消息中应包含 $1 占位符
 * @param arg1 替换 $1 的参数
 * @returns 本地化后的字符串
 */
export function t1(key: string, arg1: string | number): string {
  if (isChromeI18nAvailable()) {
    return chrome.i18n.getMessage(key, String(arg1)) || key;
  }
  // 单测环境回退：无法插值时返回 key
  return key;
}

/**
 * 获取本地化消息（两个参数）。
 * @param key messages.json 中的 key，消息中应包含 $1 和 $2 占位符
 * @param arg1 替换 $1 的参数
 * @param arg2 替换 $2 的参数
 * @returns 本地化后的字符串
 */
export function t2(key: string, arg1: string | number, arg2: string | number): string {
  if (isChromeI18nAvailable()) {
    return chrome.i18n.getMessage(key, [String(arg1), String(arg2)]) || key;
  }
  return key;
}

/**
 * 获取本地化消息（三个参数）。
 * @param key messages.json 中的 key，消息中应包含 $1, $2, $3 占位符
 * @param arg1 替换 $1 的参数
 * @param arg2 替换 $2 的参数
 * @param arg3 替换 $3 的参数
 * @returns 本地化后的字符串
 */
export function t3(
  key: string,
  arg1: string | number,
  arg2: string | number,
  arg3: string | number,
): string {
  if (isChromeI18nAvailable()) {
    return chrome.i18n.getMessage(key, [String(arg1), String(arg2), String(arg3)]) || key;
  }
  return key;
}

/**
 * 获取本地化消息（四个参数）。
 * 用于「本次共计 ${source} ${total} 个单词，其中新词 ${newCount} 个」等模板。
 */
export function t4(
  key: string,
  arg1: string | number,
  arg2: string | number,
  arg3: string | number,
  arg4: string | number,
): string {
  if (isChromeI18nAvailable()) {
    return chrome.i18n.getMessage(key, [
      String(arg1),
      String(arg2),
      String(arg3),
      String(arg4),
    ]) || key;
  }
  return key;
}
