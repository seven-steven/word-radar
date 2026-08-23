/**
 * `chrome.action` 边界模块：把 badge 文本/颜色写入的 chrome.* 调用收在这里。
 *
 * badge 状态字（issue #23，issue #26 修订，spec §扩展行为）：
 * - 推送期间：`x/y` 数字进度（蓝）
 * - 推送完成：`✓` 变色回执（绿）
 * - 推送暂停（auth 失败/顶层异常，需用户关注）：`!` 变色回执（红）
 * - 有待确认批次：`?` 提示（灰）
 * - 未登录不亮 badge（issue #26 修订）：推送已自动化，未登录只在导致
 *   推送 paused 时经 `!` 表达；单词级重试耗尽也安静（留待推下轮重试）
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
}

/**
 * 合成 badge 应显示的状态（纯函数，优先级从高到低）：
 * 推送运行 x/y > 暂停回执 ! > 待确认批次 ? > 完成回执 ✓ > 无。
 *
 * ? 高于 ✓ 的原因（issue #23 验收缺陷修复）：completed/paused 不会自动回到
 * idle——popup 打开时的 CHECK_LOGIN 会触发一轮推送（哪怕待推为空也会瞬间
 * completed），之后 ✓ 会永久驻留。若 ✓ 优先于 ?，待确认批次在任何一次
 * 推送之后都永远显示不出来（真机验收 #22/#23：? 从未出现）。
 * 待确认批次是最需要用户当下注意的状态，故压过完成回执。
 */
export function composeBadge(input: ComposeBadgeInput): BadgeSpec | null {
  const phase = input.push?.phase ?? "idle";
  if (phase === "running") {
    return { text: `${input.push?.processed ?? 0}/${input.push?.total ?? 0}`, color: BADGE_COLOR_PROGRESS };
  }
  if (phase === "paused") {
    return { text: "!", color: BADGE_COLOR_ERROR };
  }
  if (input.hasPendingBatch) {
    return { text: "?", color: BADGE_COLOR_HINT };
  }
  if (phase === "completed") {
    return { text: "✓", color: BADGE_COLOR_OK };
  }
  return null;
}
