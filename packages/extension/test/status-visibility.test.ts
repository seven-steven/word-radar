/**
 * 状态行可见性规则单测（D 互斥的 error 豁免，issue #35 重做返工锁定）。
 * 规则本体在 src/lib/status-visibility.ts（纯函数，popup.ts 消费）：
 * 确认卡可见时仅 info 态隐藏；error 态始终显示（确认/上传失败不能被吞）。
 */
import { describe, expect, it } from "vitest";
import { isStatusLineVisible } from "../src/lib/status-visibility.js";

describe("status line visibility (D 互斥的 error 豁免)", () => {
  it("确认卡收起：状态行恒可见（info / error / 未标记 tone）", () => {
    expect(isStatusLineVisible(false, undefined)).toBe(true);
    expect(isStatusLineVisible(false, "info")).toBe(true);
    expect(isStatusLineVisible(false, "error")).toBe(true);
  });

  it("确认卡可见：info 隐藏（互斥），error 豁免始终可见", () => {
    expect(isStatusLineVisible(true, undefined)).toBe(false);
    expect(isStatusLineVisible(true, "info")).toBe(false);
    expect(isStatusLineVisible(true, "error")).toBe(true);
  });
});
