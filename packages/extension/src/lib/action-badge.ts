/**
 * `chrome.action` 边界模块：把 badge 文本/颜色写入的 chrome.* 调用收在这里。
 *
 * badge 状态字（issue #23，spec §扩展行为）：
 * - 推送期间：`x/y` 数字进度（蓝）
 * - 推送完成：`✓` 变色回执（绿）
 * - 推送暂停（失败/登录失效）：`!` 变色回执（红）
 * - 有待确认批次：`?` 提示（灰）
 * - 未登录不背单词：`!`（红，登录引导）
 *
 * 上层依赖可注入的 `ActionBadge` 接口，便于单测；生产由 SW 持有 `chromeActionBadge`。
 * 状态优先级合成的纯逻辑在 `composeBadge`，与 chrome.* 解耦、可单测。
 *
 * 权限说明：`chrome.action` 由 manifest action 默认提供，不需要额外权限声明。
 */
import type { PushProgress } from "./push-coordinator.js";

export const BADGE_COLOR_PROGRESS = "#4285f4";
export const BADGE_COLOR_OK = "#0a7d2c";
export const BADGE_COLOR_ERROR = "#b00000";
export const BADGE_COLOR_HINT = "#888888";

export interface BadgeSpec {
  text: string;
  color: string;
}

export interface ActionBadge {
  /**
   * 设置 badge：
   * - 非空字符串：显示该文本（如 "1/5" / "✓" / "!"）
   * - 空字符串或 null：清空 badge
   * - color：badge 背景色（变色回执）；省略时沿用浏览器默认色
   */
  set(text: string | null, color?: string): Promise<void>;
}

export const chromeActionBadge: ActionBadge = {
  async set(text: string | null, color?: string) {
    await chrome.action.setBadgeText({ text: text ?? "" });
    if (color !== undefined) {
      await chrome.action.setBadgeBackgroundColor({ color });
    }
  },
};

export interface ComposeBadgeInput {
  /** 当前推送进度快照（ getStatus() ）；idle 视为无推送状态。 */
  push?: PushProgress;
  /** SW 内存中是否存在待确认批次。 */
  hasPendingBatch?: boolean;
  /** 上次 checkLogin 是否失败（登录引导）。 */
  loggedOut?: boolean;
}

/**
 * 合成 badge 应显示的状态（纯函数，优先级从高到低）：
 * 推送运行 x/y > 暂停回执 ! > 完成回执 ✓ > 待确认批次 ? > 未登录 ! > 无。
 */
export function composeBadge(input: ComposeBadgeInput): BadgeSpec | null {
  const phase = input.push?.phase ?? "idle";
  if (phase === "running") {
    return { text: `${input.push?.processed ?? 0}/${input.push?.total ?? 0}`, color: BADGE_COLOR_PROGRESS };
  }
  if (phase === "paused") {
    return { text: "!", color: BADGE_COLOR_ERROR };
  }
  if (phase === "completed") {
    return { text: "✓", color: BADGE_COLOR_OK };
  }
  if (input.hasPendingBatch) {
    return { text: "?", color: BADGE_COLOR_HINT };
  }
  if (input.loggedOut) {
    return { text: "!", color: BADGE_COLOR_ERROR };
  }
  return null;
}
