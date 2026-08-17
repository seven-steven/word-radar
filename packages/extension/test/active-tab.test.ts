import { describe, expect, it, vi } from "vitest";
import { requestCollection, type TabsGateway } from "../src/lib/active-tab.js";
import { COLLECT_WORDS } from "../src/lib/messages.js";

function fakeGateway(overrides: Partial<TabsGateway> = {}): TabsGateway {
  return {
    queryActiveTabId: vi.fn(async () => 42),
    sendToTab: vi.fn(async () => ({ ok: true, count: 5 })),
    ...overrides,
  };
}

describe("requestCollection（popup 侧）", () => {
  it("向活动标签页发 COLLECT_WORDS 并透传词数", async () => {
    const gateway = fakeGateway();

    const outcome = await requestCollection(gateway);

    expect(gateway.queryActiveTabId).toHaveBeenCalledTimes(1);
    expect(gateway.sendToTab).toHaveBeenCalledWith(42, { type: COLLECT_WORDS });
    expect(outcome).toEqual({ ok: true, count: 5 });
  });

  it("无活动标签页时不发消息，返回错误", async () => {
    const gateway = fakeGateway({
      queryActiveTabId: vi.fn(async () => undefined),
    });

    const outcome = await requestCollection(gateway);

    expect(gateway.sendToTab).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("活动标签页");
  });

  it("content script 未注入（sendMessage 抛错）时归一为错误", async () => {
    const gateway = fakeGateway({
      sendToTab: vi.fn(async () => {
        throw new Error("Could not establish connection");
      }),
    });

    const outcome = await requestCollection(gateway);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("无法采集");
  });

  it("应答形态非法时归一为错误", async () => {
    const gateway = fakeGateway({
      sendToTab: vi.fn(async () => "garbage"),
    });

    const outcome = await requestCollection(gateway);

    expect(outcome.ok).toBe(false);
  });

  it("content 端 {ok:false} 应答原样透传", async () => {
    const gateway = fakeGateway({
      sendToTab: vi.fn(async () => ({ ok: false, error: "extract boom" })),
    });

    const outcome = await requestCollection(gateway);

    expect(outcome).toEqual({ ok: false, error: "extract boom" });
  });
});
