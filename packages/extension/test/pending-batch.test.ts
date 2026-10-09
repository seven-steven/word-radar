import { describe, expect, it, vi } from "vitest";
import { createPendingBatch } from "../src/lib/pending-batch.js";
import type { WordEntry } from "@word-radar/core";

const makeEntry = (lemma: string): WordEntry => ({ lemma, flags: 0 });

describe("createPendingBatch", () => {
  it("初始无驻留批：peek() 与 source() 均为 null", () => {
    const pending = createPendingBatch();
    expect(pending.peek()).toBeNull();
    expect(pending.source()).toBeNull();
  });

  it("set 后 peek/source 可见，返回条目与来源一致", () => {
    const pending = createPendingBatch();
    pending.set([makeEntry("run")], "collect");
    expect(pending.peek()).toEqual({ entries: [makeEntry("run")], source: "collect" });
    expect(pending.source()).toBe("collect");
  });

  it("set 覆盖旧批（单驻留语义）：新批整体替换，source 跟随新来源", () => {
    const pending = createPendingBatch();
    pending.set([makeEntry("run")], "collect");
    pending.set([makeEntry("garden"), makeEntry("serendipity")], "upload");
    expect(pending.peek()).toEqual({
      entries: [makeEntry("garden"), makeEntry("serendipity")],
      source: "upload",
    });
    expect(pending.source()).toBe("upload");
  });

  it("clear 后 peek/source 均为 null；可再次 set 重新驻留", () => {
    const pending = createPendingBatch();
    pending.set([makeEntry("run")], "import");
    pending.clear();
    expect(pending.peek()).toBeNull();
    expect(pending.source()).toBeNull();
    pending.set([makeEntry("walk")], "collect");
    expect(pending.peek()).toEqual({ entries: [makeEntry("walk")], source: "collect" });
  });

  it("peek 不消费批次：重复 peek 等值（确认失败保留重试的前提）", () => {
    const pending = createPendingBatch();
    pending.set([makeEntry("run")], "collect");
    const first = pending.peek();
    const second = pending.peek();
    expect(first).toEqual(second);
    expect(pending.peek()).toEqual({ entries: [makeEntry("run")], source: "collect" });
    expect(pending.source()).toBe("collect");
  });

  it("onChange 在 set 触发（含覆盖旧批）与 clear 触发；peek 不触发", () => {
    const pending = createPendingBatch();
    const listener = vi.fn();
    pending.onChange(listener);

    pending.set([makeEntry("run")], "collect"); // 驻留 → 触发
    expect(listener).toHaveBeenCalledTimes(1);

    pending.set([makeEntry("walk")], "upload"); // 覆盖 → 同样触发
    expect(listener).toHaveBeenCalledTimes(2);

    pending.peek(); // 查看 → 不触发
    pending.peek();
    expect(listener).toHaveBeenCalledTimes(2);

    pending.clear(); // 清空 → 触发
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("多个 listener 按注册序调用", () => {
    const pending = createPendingBatch();
    const order: string[] = [];
    pending.onChange(() => order.push("first"));
    pending.onChange(() => order.push("second"));
    pending.onChange(() => order.push("third"));

    pending.set([makeEntry("run")], "collect");
    expect(order).toEqual(["first", "second", "third"]);

    pending.clear();
    expect(order).toEqual(["first", "second", "third", "first", "second", "third"]);
  });
});
