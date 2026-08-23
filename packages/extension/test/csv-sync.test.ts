/**
 * T11 集成测试：真 WordRepository（fake-indexeddb）+ createBackgroundListener，
 * 走完整消息路径验证验收标准：
 * - 导出 CSV 与 core 编解码同源（可被 CLI merge 消费）
 * - 导入含已推标志的 CSV 后原已推词不变回待推；新词按 CSV flags 值进库
 * - 坏 CSV 报错（含文件名 + 行号）且词库不被破坏
 * - 空 CSV 不抛错
 * - 导出 → 导入 全往返后词库一致
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseWordListCsv } from "@word-radar/core";
import { createBackgroundListener } from "../src/lib/background-listener.js";
import { CONFIRM_COLLECTED, EXPORT_CSV, IMPORT_CSV } from "../src/lib/messages.js";
import { DB_NAME, createWordRepository } from "../src/lib/word-repository.js";
import type { PushCoordinator } from "../src/lib/push-coordinator.js";

type Listener = ReturnType<typeof createBackgroundListener>;

async function resetDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function fakePushCoordinator(): PushCoordinator & {
  start: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(async () => ({
      phase: "idle" as const,
      total: 0,
      processed: 0,
      succeeded: 0,
      existing: 0,
      failed: 0,
      pending: 0,
    })),
    getStatus: vi.fn(() => ({
      phase: "idle" as const,
      total: 0,
      processed: 0,
      succeeded: 0,
      existing: 0,
      failed: 0,
      pending: 0,
    })),
  } as unknown as PushCoordinator & { start: ReturnType<typeof vi.fn> };
}

/** 发一条异步消息并等待应答。 */
function sendMessage(
  listener: Listener,
  message: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const keepChannel = listener(message, {}, resolve);
    if (!keepChannel) reject(new Error("listener 未持有消息通道"));
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("CSV 导出（EXPORT_CSV）", () => {
  it("导出的 CSV 带表头与已推位，可被 core parseWordListCsv 直接消费", async () => {
    const repository = createWordRepository();
    await repository.mergeCollected([
      { lemma: "run", flags: 0 },
      { lemma: "garden", flags: 0 },
    ]);
    await repository.markPushed(["run"]);
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: fakePushCoordinator(),
    });

    const response = (await sendMessage(listener, { type: EXPORT_CSV })) as {
      ok: true;
      csv: string;
    };

    expect(response.ok).toBe(true);
    expect(response.csv.startsWith("lemma,flags\n")).toBe(true);
    // 与 CLI merge 同源的解析器可直接消费（IndexedDB 按 key 升序返回，排序后断言）
    const parsed = parseWordListCsv(response.csv).sort((a, b) =>
      a.lemma.localeCompare(b.lemma),
    );
    expect(parsed).toEqual([
      { lemma: "garden", flags: 0 },
      { lemma: "run", flags: 1 },
    ]);
  });
});

describe("CSV 导入（IMPORT_CSV，review S-3 同过确认闸门）", () => {
  it("导入含已推词的 CSV：确认后原已推词状态不变，新词以 flags=0 进入待推", async () => {
    const repository = createWordRepository();
    await repository.mergeCollected([{ lemma: "run", flags: 0 }]);
    await repository.markPushed(["run"]);
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: fakePushCoordinator(),
    });

    // CSV 里 run 为 flags=0（试图洗回待推），newword 为新词
    const preview = (await sendMessage(listener, {
      type: IMPORT_CSV,
      csvText: "lemma,flags\nrun,0\nnewword,0\n",
      fileName: "in.csv",
    })) as { total: number; newCount: number };

    // 只驻留批次：预览新词数 = 与词库的 lemma diff（run 已在库，newword 不在）
    expect(preview).toEqual({ total: 2, newCount: 1 });
    // 确认前不落库
    expect(await repository.getAll()).toEqual([{ lemma: "run", flags: 1 }]);

    const counts = (await sendMessage(listener, { type: CONFIRM_COLLECTED })) as {
      total: number;
      pending: number;
    };
    expect(counts).toEqual({ total: 2, pending: 1 });

    const all = await repository.getAll();
    expect(all.find((e) => e.lemma === "run")?.flags).toBe(1); // 已推不变回待推
    expect(all.find((e) => e.lemma === "newword")?.flags).toBe(0);
  });

  it("CSV 里词自身带 flags 时按位或进库（而非覆盖）", async () => {
    const repository = createWordRepository();
    await repository.mergeCollected([{ lemma: "run", flags: 1 }]);
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: fakePushCoordinator(),
    });

    await sendMessage(listener, {
      type: IMPORT_CSV,
      csvText: "lemma,flags\nrun,2\nother,1\n",
      fileName: "in.csv",
    });
    await sendMessage(listener, { type: CONFIRM_COLLECTED });

    const all = await repository.getAll();
    expect(all.find((e) => e.lemma === "run")?.flags).toBe(3); // 1 | 2
    expect(all.find((e) => e.lemma === "other")?.flags).toBe(1); // 按 CSV 值进库
  });

  it("坏 CSV：报错含文件名与行号，且词库完全不被破坏", async () => {
    const repository = createWordRepository();
    await repository.mergeCollected([{ lemma: "run", flags: 0 }]);
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: fakePushCoordinator(),
    });

    const response = (await sendMessage(listener, {
      type: IMPORT_CSV,
      csvText: "lemma,flags\nnewword,0\n,xyz\n",
      fileName: "broken.csv",
    })) as { ok: false; error: string };

    expect(response.ok).toBe(false);
    expect(response.error).toContain("broken.csv");
    expect(response.error).toContain("line 3");
    // 库不变：连第一行的 newword 也不能落库
    expect(await repository.getAll()).toEqual([{ lemma: "run", flags: 0 }]);
  });

  it("空 CSV（仅表头 / 空文本）不抛错，词库不变", async () => {
    const repository = createWordRepository();
    await repository.mergeCollected([{ lemma: "run", flags: 0 }]);
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: fakePushCoordinator(),
    });

    const headerOnly = (await sendMessage(listener, {
      type: IMPORT_CSV,
      csvText: "lemma,flags\n",
      fileName: "empty.csv",
    })) as { total: number; newCount: number };
    const emptyText = (await sendMessage(listener, {
      type: IMPORT_CSV,
      csvText: "",
      fileName: "empty.csv",
    })) as { total: number; newCount: number };

    expect(headerOnly).toEqual({ total: 0, newCount: 0 });
    expect(emptyText).toEqual({ total: 0, newCount: 0 });
    // 确认空批次后词库仍不变
    await sendMessage(listener, { type: CONFIRM_COLLECTED });
    expect(await repository.getAll()).toEqual([{ lemma: "run", flags: 0 }]);
  });

  it("导出 → 导入 → 确认 全往返后词库一致（含已推位）", async () => {
    const repository = createWordRepository();
    await repository.mergeCollected([
      { lemma: "run", flags: 0 },
      { lemma: "garden", flags: 0 },
      { lemma: "serendipity", flags: 0 },
    ]);
    await repository.markPushed(["garden"]);
    const listener = createBackgroundListener({
      repository,
      pushCoordinator: fakePushCoordinator(),
    });

    const exported = (await sendMessage(listener, { type: EXPORT_CSV })) as {
      ok: true;
      csv: string;
    };

    // 清空后导入导出的 CSV 并确认，词库应完全恢复
    await repository.clear();
    const preview = (await sendMessage(listener, {
      type: IMPORT_CSV,
      csvText: exported.csv,
      fileName: "backup.csv",
    })) as { total: number; newCount: number };
    expect(preview).toEqual({ total: 3, newCount: 3 }); // 库已清空，全部为新词

    const counts = (await sendMessage(listener, { type: CONFIRM_COLLECTED })) as {
      total: number;
      pending: number;
    };
    expect(counts).toEqual({ total: 3, pending: 2 });

    const all = await repository.getAll();
    expect(all.find((e) => e.lemma === "garden")?.flags).toBe(1);
    expect(all.find((e) => e.lemma === "run")?.flags).toBe(0);
    expect(all.find((e) => e.lemma === "serendipity")?.flags).toBe(0);
  });
});
