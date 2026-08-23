/** composeBadge 纯逻辑单测（issue #23）：x/y 进度、✓/! 回执、待确认提示、优先级。 */
import { describe, expect, it } from "vitest";
import {
  BADGE_COLOR_ERROR,
  BADGE_COLOR_HINT,
  BADGE_COLOR_OK,
  BADGE_COLOR_PROGRESS,
  composeBadge,
} from "../src/lib/action-badge.js";
import type { PushProgress } from "../src/lib/push-coordinator.js";

function progress(overrides: Partial<PushProgress>): PushProgress {
  return {
    phase: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    existing: 0,
    failed: 0,
    pending: 0,
    ...overrides,
  };
}

describe("composeBadge（issue #23）", () => {
  it("推送中 → x/y 数字进度（蓝），与更低优先级状态互斥", () => {
    expect(composeBadge({ push: progress({ phase: "running", total: 5, processed: 2 }) }))
      .toEqual({ text: "2/5", color: BADGE_COLOR_PROGRESS });
    // 即便有待确认批次/未登录，running 优先
    expect(composeBadge({
      push: progress({ phase: "running", total: 5, processed: 2 }),
      hasPendingBatch: true,
      loggedOut: true,
    })).toEqual({ text: "2/5", color: BADGE_COLOR_PROGRESS });
  });

  it("推送暂停（失败/登录失效）→ \"!\" 回执（红），优先于待确认提示", () => {
    expect(composeBadge({ push: progress({ phase: "paused", error: "401" }) }))
      .toEqual({ text: "!", color: BADGE_COLOR_ERROR });
    expect(composeBadge({ push: progress({ phase: "paused" }), hasPendingBatch: true }))
      .toEqual({ text: "!", color: BADGE_COLOR_ERROR });
  });

  it("推送完成 → \"✓\" 回执（绿）", () => {
    expect(composeBadge({ push: progress({ phase: "completed", total: 3, processed: 3 }) }))
      .toEqual({ text: "✓", color: BADGE_COLOR_OK });
  });

  it("idle 但有待确认批次 → \"?\" 提示（灰）", () => {
    expect(composeBadge({ hasPendingBatch: true }))
      .toEqual({ text: "?", color: BADGE_COLOR_HINT });
  });

  it("idle + 未登录 → \"!\"（红，登录引导）；待确认提示优先于登录引导", () => {
    expect(composeBadge({ loggedOut: true }))
      .toEqual({ text: "!", color: BADGE_COLOR_ERROR });
    expect(composeBadge({ hasPendingBatch: true, loggedOut: true }))
      .toEqual({ text: "?", color: BADGE_COLOR_HINT });
  });

  it("无任何状态 → null（清空 badge）", () => {
    expect(composeBadge({})).toBeNull();
    expect(composeBadge({ push: progress({}) })).toBeNull();
  });
});
