import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromeSwChannel } from "../src/lib/sw-channel.js";
import {
  CHECK_LOGIN,
  CONFIRM_COLLECTED,
  DISCARD_COLLECTED,
  EXPORT_CSV,
  GET_BATCH_STATE,
  GET_COUNTS,
  GET_PUSH_STATUS,
  RETRY_PUSH,
  IMPORT_CSV,
  UPLOAD_FILE,
  UPLOAD_TEXT,
} from "../src/lib/messages.js";

/**
 * chromeSwChannel 直测（issue #54 Wave B）。
 *
 * 原 narrow 层（fetchCounts / fetchLoginStatus / fetchExportCsv / importCsv /
 * uploadFile / uploadPastedText）已并入 SwChannel 方法（透传层与收窄层合一），
 * 新 seam = SwChannel 接口 + chromeSwChannel 的收窄行为：mock
 * chrome.runtime.sendMessage，分别验证——
 * - 合法应答 → outcome 透传
 * - 畸形应答 → 各自降级值
 * - sendMessage 抛错（SW 未启动）→ 同降级值（retryPush 例外：原样传播）
 */

const sendMessage = vi.fn<(message: unknown) => Promise<unknown>>();

beforeEach(() => {
  sendMessage.mockReset();
  (chrome.runtime as unknown as { sendMessage: typeof sendMessage }).sendMessage =
    sendMessage;
});

function resolveWith(value: unknown): void {
  sendMessage.mockImplementation(async () => value);
}

function rejectWith(error: unknown): void {
  sendMessage.mockImplementation(async () => {
    throw error;
  });
}

describe("chromeSwChannel.getCounts（原 fetchCounts 语义迁移）", () => {
  it("发 GET_COUNTS 并透传合法 Counts", async () => {
    resolveWith({ total: 7, pending: 4 });

    await expect(chromeSwChannel.getCounts()).resolves.toEqual({
      total: 7,
      pending: 4,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: GET_COUNTS });
  });

  it("畸形应答归一为 null（缺字段 / 非对象）", async () => {
    resolveWith({ total: 1 });
    await expect(chromeSwChannel.getCounts()).resolves.toBeNull();

    resolveWith("garbage");
    await expect(chromeSwChannel.getCounts()).resolves.toBeNull();
  });

  it("sendMessage 抛错归一为 null，不传播", async () => {
    rejectWith(new Error("Could not establish connection"));
    await expect(chromeSwChannel.getCounts()).resolves.toBeNull();
  });
});

describe("chromeSwChannel.checkLogin（原 fetchLoginStatus 语义迁移）", () => {
  it("发 CHECK_LOGIN 并透传 loggedIn=true", async () => {
    resolveWith({ loggedIn: true });

    await expect(chromeSwChannel.checkLogin()).resolves.toEqual({
      loggedIn: true,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: CHECK_LOGIN });
  });

  it("loggedIn=false 原样返回（保守视为未登录）", async () => {
    resolveWith({ loggedIn: false });
    await expect(chromeSwChannel.checkLogin()).resolves.toEqual({
      loggedIn: false,
    });
  });

  it("畸形应答归一为 {loggedIn:false}", async () => {
    resolveWith({ ok: true, count: 1 });
    await expect(chromeSwChannel.checkLogin()).resolves.toEqual({
      loggedIn: false,
    });

    resolveWith("yes");
    await expect(chromeSwChannel.checkLogin()).resolves.toEqual({
      loggedIn: false,
    });
  });

  it("sendMessage 抛错归一为 {loggedIn:false}，不传播", async () => {
    rejectWith(new Error("Could not establish connection"));
    await expect(chromeSwChannel.checkLogin()).resolves.toEqual({
      loggedIn: false,
    });
  });
});

describe("chromeSwChannel.getPushStatus（原 fetchPushStatus 语义迁移）", () => {
  it("发 GET_PUSH_STATUS 并透传合法快照", async () => {
    resolveWith({
      phase: "idle",
      total: 0,
      processed: 0,
      succeeded: 0,
      existing: 0,
      failed: 0,
      pending: 0,
    });

    await expect(chromeSwChannel.getPushStatus()).resolves.toEqual({
      phase: "idle",
      total: 0,
      processed: 0,
      succeeded: 0,
      existing: 0,
      failed: 0,
      pending: 0,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: GET_PUSH_STATUS });
  });

  it("畸形应答归一为 null（缺计数字段 / phase 非法）", async () => {
    resolveWith({ phase: "idle" });
    await expect(chromeSwChannel.getPushStatus()).resolves.toBeNull();

    resolveWith({ phase: "warp", total: 0, processed: 0, succeeded: 0, existing: 0, failed: 0, pending: 0 });
    await expect(chromeSwChannel.getPushStatus()).resolves.toBeNull();
  });

  it("sendMessage 抛错归一为 null，不传播", async () => {
    rejectWith(new Error("Could not establish connection"));
    await expect(chromeSwChannel.getPushStatus()).resolves.toBeNull();
  });
});

describe("chromeSwChannel.retryPush（保持透传，不收窄）", () => {
  it("发 RETRY_PUSH，应答被丢弃（resolve void）", async () => {
    resolveWith(undefined);

    await expect(chromeSwChannel.retryPush()).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: RETRY_PUSH });
  });

  it("sendMessage 抛错时原样传播（popup 侧 try/finally 自决）", async () => {
    const boom = new Error("Could not establish connection");
    rejectWith(boom);

    await expect(chromeSwChannel.retryPush()).rejects.toThrow(
      "Could not establish connection",
    );
  });
});

describe("chromeSwChannel.exportCsv（原 fetchExportCsv 语义迁移）", () => {
  it("发 EXPORT_CSV 并透传 {ok:true,csv}", async () => {
    resolveWith({ ok: true, csv: "lemma,flags\nrun,0\n" });

    await expect(chromeSwChannel.exportCsv()).resolves.toEqual({
      ok: true,
      csv: "lemma,flags\nrun,0\n",
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: EXPORT_CSV });
  });

  it("{ok:false,error} 原样透传", async () => {
    resolveWith({ ok: false, error: "export-failed" });
    await expect(chromeSwChannel.exportCsv()).resolves.toEqual({
      ok: false,
      error: "export-failed",
    });
  });

  it("畸形应答归一为 {ok:false,export-unavailable}", async () => {
    resolveWith("garbage");
    await expect(chromeSwChannel.exportCsv()).resolves.toEqual({
      ok: false,
      error: "export-unavailable",
    });
  });

  it("sendMessage 抛错归一为 {ok:false,export-unavailable}，不传播", async () => {
    rejectWith(new Error("Could not establish connection"));
    await expect(chromeSwChannel.exportCsv()).resolves.toEqual({
      ok: false,
      error: "export-unavailable",
    });
  });
});

describe("chromeSwChannel.importCsv（原 importCsv 语义迁移）", () => {
  it("发 IMPORT_CSV（带文本与文件名），BatchPreview 包成 {ok:true,total,newCount}", async () => {
    resolveWith({ total: 8, newCount: 5 });

    await expect(
      chromeSwChannel.importCsv("lemma,flags\nrun,0\n", "words.csv"),
    ).resolves.toEqual({ ok: true, total: 8, newCount: 5 });
    expect(sendMessage).toHaveBeenCalledWith({
      type: IMPORT_CSV,
      csvText: "lemma,flags\nrun,0\n",
      fileName: "words.csv",
    });
  });

  it("CSV 豁免（issue #43）：SW 应答带 filteredCount 也不透传（导入不经提取管线）", async () => {
    resolveWith({ total: 8, newCount: 5, filteredCount: 9 });

    await expect(
      chromeSwChannel.importCsv("lemma,flags\nrun,0\n", "words.csv"),
    ).resolves.toEqual({ ok: true, total: 8, newCount: 5 });
  });

  it("{ok:false,error}（坏 CSV）原样透传", async () => {
    resolveWith({
      ok: false,
      error: "bad.csv: CSV parse error at line 3: empty lemma",
    });

    await expect(
      chromeSwChannel.importCsv("garbage", "bad.csv"),
    ).resolves.toEqual({
      ok: false,
      error: "bad.csv: CSV parse error at line 3: empty lemma",
    });
  });

  it("畸形应答 / sendMessage 抛错归一为 {ok:false,import-unavailable}", async () => {
    resolveWith({ total: "x" });
    await expect(
      chromeSwChannel.importCsv("lemma,flags\n", "a.csv"),
    ).resolves.toEqual({ ok: false, error: "import-unavailable" });

    rejectWith(new Error("Could not establish connection"));
    await expect(
      chromeSwChannel.importCsv("lemma,flags\n", "a.csv"),
    ).resolves.toEqual({ ok: false, error: "import-unavailable" });
  });
});

describe("chromeSwChannel.uploadFile（原 uploadFile 语义迁移）", () => {
  it("发 UPLOAD_FILE（带文件批），BatchPreview 包成 {ok:true,...}，filteredCount 透传", async () => {
    resolveWith({ total: 4, newCount: 2, filteredCount: 1 });
    const files = [{ name: "a.txt", text: "some text" }];

    await expect(chromeSwChannel.uploadFile(files)).resolves.toEqual({
      ok: true,
      total: 4,
      newCount: 2,
      filteredCount: 1,
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: UPLOAD_FILE, files });
  });

  it("SW 应答缺 filteredCount 时 outcome 保持缺省", async () => {
    resolveWith({ total: 4, newCount: 2 });

    await expect(chromeSwChannel.uploadFile([{ name: "a.txt", text: "x" }]))
      .resolves.toEqual({ ok: true, total: 4, newCount: 2 });
  });

  it("{ok:false,error} 原样透传；畸形应答 / 抛错归一为 upload-unavailable", async () => {
    resolveWith({ ok: false, error: "a.exe: 仅支持纯文本" });
    await expect(
      chromeSwChannel.uploadFile([{ name: "a.exe", text: "x" }]),
    ).resolves.toEqual({ ok: false, error: "a.exe: 仅支持纯文本" });

    resolveWith("garbage");
    await expect(
      chromeSwChannel.uploadFile([{ name: "a.txt", text: "x" }]),
    ).resolves.toEqual({ ok: false, error: "upload-unavailable" });

    rejectWith(new Error("Could not establish connection"));
    await expect(
      chromeSwChannel.uploadFile([{ name: "a.txt", text: "x" }]),
    ).resolves.toEqual({ ok: false, error: "upload-unavailable" });
  });
});

describe("chromeSwChannel.uploadText（原 uploadPastedText 语义迁移）", () => {
  it("发 UPLOAD_TEXT（带粘贴文本），BatchPreview 包成 {ok:true,...}，filteredCount 透传", async () => {
    resolveWith({ total: 5, newCount: 3, filteredCount: 2 });

    await expect(chromeSwChannel.uploadText("run and jump")).resolves.toEqual({
      ok: true,
      total: 5,
      newCount: 3,
      filteredCount: 2,
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: UPLOAD_TEXT,
      text: "run and jump",
    });
  });

  it("SW 应答缺 filteredCount 时 outcome 保持缺省", async () => {
    resolveWith({ total: 5, newCount: 3 });

    await expect(chromeSwChannel.uploadText("run and jump")).resolves.toEqual({
      ok: true,
      total: 5,
      newCount: 3,
    });
  });

  it("{ok:false,error} 原样透传；畸形应答 / 抛错归一为 upload-unavailable", async () => {
    resolveWith({ ok: false, error: "upload-failed" });
    await expect(chromeSwChannel.uploadText("run")).resolves.toEqual({
      ok: false,
      error: "upload-failed",
    });

    resolveWith("garbage");
    await expect(chromeSwChannel.uploadText("run")).resolves.toEqual({
      ok: false,
      error: "upload-unavailable",
    });

    rejectWith(new Error("Could not establish connection"));
    await expect(chromeSwChannel.uploadText("run")).resolves.toEqual({
      ok: false,
      error: "upload-unavailable",
    });
  });
});

describe("chromeSwChannel.confirmCollected（原 confirmCollected 语义迁移）", () => {
  it("发 CONFIRM_COLLECTED，Counts 包成 {ok:true,counts}", async () => {
    resolveWith({ total: 7, pending: 4 });

    await expect(chromeSwChannel.confirmCollected()).resolves.toEqual({
      ok: true,
      counts: { total: 7, pending: 4 },
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: CONFIRM_COLLECTED });
  });

  it("{ok:false,error}（无待确认批次 / 合并失败）原样透传", async () => {
    resolveWith({ ok: false, error: "no-pending-batch" });
    await expect(chromeSwChannel.confirmCollected()).resolves.toEqual({
      ok: false,
      error: "no-pending-batch",
    });
  });

  it("畸形应答 / sendMessage 抛错归一为 {ok:false,confirm-unavailable}", async () => {
    resolveWith("garbage");
    await expect(chromeSwChannel.confirmCollected()).resolves.toEqual({
      ok: false,
      error: "confirm-unavailable",
    });

    rejectWith(new Error("Could not establish connection"));
    await expect(chromeSwChannel.confirmCollected()).resolves.toEqual({
      ok: false,
      error: "confirm-unavailable",
    });
  });
});

describe("chromeSwChannel.discardCollected（原 discardCollected 语义迁移）", () => {
  it("发 DISCARD_COLLECTED，静默吞掉 sendMessage 抛错（fire-and-forget）", async () => {
    resolveWith(undefined);
    await expect(chromeSwChannel.discardCollected()).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith({ type: DISCARD_COLLECTED });

    rejectWith(new Error("Could not establish connection"));
    await expect(chromeSwChannel.discardCollected()).resolves.toBeUndefined();
  });
});

describe("chromeSwChannel.getBatchState（issue #54 Wave D：覆盖闸门真相查询）", () => {
  it("发 GET_BATCH_STATE 并透传三来源字面量", async () => {
    resolveWith({ source: "collect" });
    await expect(chromeSwChannel.getBatchState()).resolves.toBe("collect");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: GET_BATCH_STATE });

    resolveWith({ source: "import" });
    await expect(chromeSwChannel.getBatchState()).resolves.toBe("import");

    resolveWith({ source: "upload" });
    await expect(chromeSwChannel.getBatchState()).resolves.toBe("upload");
  });

  it("无驻留批（source=null）原样返回 null", async () => {
    resolveWith({ source: null });
    await expect(chromeSwChannel.getBatchState()).resolves.toBeNull();
  });

  it("畸形应答降级 null（缺 source 字段 / 未知来源值 / 非对象）", async () => {
    resolveWith({});
    await expect(chromeSwChannel.getBatchState()).resolves.toBeNull();

    resolveWith({ source: "warp" });
    await expect(chromeSwChannel.getBatchState()).resolves.toBeNull();

    resolveWith("garbage");
    await expect(chromeSwChannel.getBatchState()).resolves.toBeNull();
  });

  it("sendMessage 抛错降级 null，不传播（视同无驻留批，同影子失忆时代）", async () => {
    rejectWith(new Error("Could not establish connection"));
    await expect(chromeSwChannel.getBatchState()).resolves.toBeNull();
  });
});
