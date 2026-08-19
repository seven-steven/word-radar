import { describe, expect, it, vi } from "vitest";
import { openBbdcHome, requestCollection, type TabsGateway } from "../src/lib/active-tab.js";
import { COLLECT_WORDS } from "../src/lib/messages.js";

function fakeGateway(overrides: Partial<TabsGateway> = {}): TabsGateway {
  return {
    queryActiveTabId: vi.fn(async () => 42),
    sendToTab: vi.fn(async () => ({ ok: true, count: 5 })),
    injectIntoTab: vi.fn(async () => undefined),
    openUrl: vi.fn(async () => undefined),
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

  it("sendMessage 抛错时先补注入再重试，重试成功则采集成功", async () => {
    // 场景：扩展（重）加载后旧标签无 content script
    const sendToTab = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("Could not establish connection"))
      .mockResolvedValueOnce({ ok: true, count: 3 });
    const injectIntoTab = vi.fn(async () => undefined);
    const gateway = fakeGateway({ sendToTab, injectIntoTab });

    const outcome = await requestCollection(gateway);

    expect(injectIntoTab).toHaveBeenCalledWith(42);
    expect(sendToTab).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ ok: true, count: 3 });
  });

  it("补注入也失败（chrome:// 等不可注入页）时归一为错误", async () => {
    const gateway = fakeGateway({
      sendToTab: vi.fn(async () => {
        throw new Error("Could not establish connection");
      }),
      injectIntoTab: vi.fn(async () => {
        throw new Error("cannot access contents of the page");
      }),
    });

    const outcome = await requestCollection(gateway);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("请刷新页面后重试");
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

describe("openBbdcHome（popup 引导）", () => {
  it("调用 gateway.openUrl 打开不背单词首页（不固化深层 login URL）", async () => {
    const gateway = fakeGateway();

    await openBbdcHome(gateway, "https://bbdc.cn/");

    expect(gateway.openUrl).toHaveBeenCalledTimes(1);
    expect(gateway.openUrl).toHaveBeenCalledWith("https://bbdc.cn/");
  });

  it("openUrl 抛错时原样向上抛（popup 可选择性降级）", async () => {
    const gateway = fakeGateway({
      openUrl: vi.fn(async () => {
        throw new Error("tabs boom");
      }),
    });

    await expect(openBbdcHome(gateway, "https://bbdc.cn/")).rejects.toThrow("tabs boom");
  });
});
