import { describe, expect, it, vi } from "vitest";
import { createContentListener } from "../src/lib/content-listener.js";
import { COLLECT_WORDS, type CollectResponse } from "../src/lib/messages.js";

describe("createContentListener", () => {
  it("非 COLLECT_WORDS 消息不响应、不执行采集", () => {
    const runCollection = vi.fn(() => ({ ok: true, count: 1 }) as CollectResponse);
    const sendResponse = vi.fn();
    const listener = createContentListener(runCollection);

    const keepChannel = listener({ type: "OTHER" }, {}, sendResponse);

    expect(keepChannel).toBe(false);
    expect(runCollection).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("COLLECT_WORDS 触发采集并同步应答结果", () => {
    const runCollection = vi.fn(() => ({ ok: true, count: 7 }) as CollectResponse);
    const sendResponse = vi.fn();
    const listener = createContentListener(runCollection);

    const keepChannel = listener({ type: COLLECT_WORDS }, {}, sendResponse);

    expect(keepChannel).toBe(false); // 同步应答，不持有消息通道
    expect(runCollection).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, count: 7 });
  });

  it("采集抛异常时兜底为 {ok:false,error}", () => {
    const runCollection = vi.fn(() => {
      throw new Error("extract boom");
    });
    const sendResponse = vi.fn();
    const listener = createContentListener(runCollection);

    listener({ type: COLLECT_WORDS }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "extract boom",
    });
  });

  it("非 Error 异常也会序列化为字符串", () => {
    const runCollection = vi.fn(() => {
      throw "string failure";
    });
    const sendResponse = vi.fn();
    const listener = createContentListener(runCollection);

    listener({ type: COLLECT_WORDS }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "string failure",
    });
  });
});
