/**
 * `chrome.action` 边界模块：把 badge 文本写入的 chrome.* 调用收在这里。
 *
 * 登录引导（spec §扩展行为）：未登录时 action badge 提示用户。
 * 当前第一版用 badge 文本承载状态字（"!" / ""），未来可扩展图标/颜色。
 *
 * 上层依赖可注入的 `ActionBadge` 接口，便于单测；生产由 SW 持有 `chromeActionBadge`。
 *
 * 权限说明：`chrome.action` 由 manifest action 默认提供，不需要额外权限声明。
 */
export interface ActionBadge {
  /**
   * 设置 badge 文本：
   * - 非空字符串：显示该文本（如 "!"）
   * - 空字符串或 null：清空 badge
   *
   * service worker 可在登录失败时调用 `set("!")`，登录成功 / 无状态时 `set(null)`。
   */
  set(text: string | null): Promise<void>;
}

export const chromeActionBadge: ActionBadge = {
  async set(text: string | null) {
    await chrome.action.setBadgeText({ text: text ?? "" });
  },
};