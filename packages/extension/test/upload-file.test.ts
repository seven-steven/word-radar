/**
 * issue #24 上传文件采集单测（issue #38 v1.1-T1 改文件批）：
 * - background-listener 的 UPLOAD_FILE 分支：文件批整批 = 一次采集——文本
 *   合并后走同一提取管线 → 驻留待确认批次（不合并、不推送、零网络）；
 *   任一文件非法后缀 → 整批拒绝、零写入 + 错误日志 stage=upload；
 *   新批次覆盖旧批次（单驻留语义）；确认后与采集批次同语义合并。
 * - sw-channel 的 uploadFile 收窄（files 批形状）。
 * - background-listener 的 UPLOAD_TEXT 分支 + sw-channel 的 uploadText
 *   收窄（issue #42 v1.1-T5 粘贴文本通道：无后缀校验，直进提取管线）；
 *   sw-channel 收窄语义的直测在 sw-channel.test.ts（issue #54 Wave B 合层后）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createBackgroundListener,
  type BackgroundBbdcClient,
  type ActionBadgeGateway,
  type BackgroundRepository,
} from "../src/lib/background-listener.js";
import {
  CONFIRM_COLLECTED,
  UPLOAD_FILE,
  UPLOAD_TEXT,
  WORDS_COLLECTED,
  type PushStatus,
} from "../src/lib/messages.js";
import type { PushCoordinator } from "../src/lib/push-coordinator.js";
import type { ExtractResult, WordEntry } from "@word-radar/core";
import type { IntakeFilterSettings } from "../src/lib/settings.js";

function fakeRepository(): BackgroundRepository & {
  mergeCollected: ReturnType<typeof vi.fn>;
  countNew: ReturnType<typeof vi.fn>;
} {
  return {
    mergeCollected: vi.fn(async (entries: WordEntry[]) => ({
      total: entries.length,
      pending: entries.length,
    })),
    countNew: vi.fn(async (entries: WordEntry[]) => entries.length),
    getCounts: vi.fn(async () => ({ total: 0, pending: 0 })),
    markPushed: vi.fn(async () => ({ total: 0, pending: 0 })),
    listPending: vi.fn(async (): Promise<WordEntry[]> => []),
    getAll: vi.fn(async (): Promise<WordEntry[]> => []),
  };
}

function fakeBbdcClient(): BackgroundBbdcClient {
  return {
    checkLogin: vi.fn(async () => ({ loggedIn: true, resultCode: 200 })),
    listNewWords: vi.fn(async () => ({ result_code: 0, data_body: {} })),
    checkExisting: vi.fn(async () => ({ exists: false })),
    lookupDefinition: vi.fn(async () => null),
    addWord: vi.fn(async () => undefined),
  };
}

function fakeActionBadge(): ActionBadgeGateway & { set: ReturnType<typeof vi.fn> } {
  return { set: vi.fn(async () => undefined) };
}

function fakePushCoordinator(): PushCoordinator & {
  start: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
} {
  const idle: PushStatus = {
    phase: "idle",
    total: 0,
    processed: 0,
    succeeded: 0,
    existing: 0,
    failed: 0,
    pending: 0,
  };
  return {
    start: vi.fn(async () => idle),
    getStatus: vi.fn(() => idle),
  } as unknown as PushCoordinator & {
    start: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
  };
}

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("createBackgroundListener UPLOAD_FILE（issue #24；#38 文件批）", () => {
  /** 与网页采集同源的提取管线：注入确定性 extract 验证被调用与传参。 */
  const freshExtract = () =>
    vi.fn(
      (text: string): ExtractResult => ({
        entries: text
          .split(/\s+/)
          .filter(Boolean)
          .map((lemma) => ({ lemma, flags: 0 })),
        filteredCount: 0,
      }),
    );

  it("走同一提取管线只驻留待确认批次：countNew 算 diff、不合并、不推送，应答 {total,newCount}；持有通道", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    repository.countNew = vi.fn(async () => 1);
    const coordinator = fakePushCoordinator();
    const errorLogger = { log: vi.fn() };
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: coordinator,
      errorLogger,
      extract,
    });
    const sendResponse = vi.fn();

    const keep = listener(
      { type: UPLOAD_FILE, files: [{ name: "notes.txt", text: "run and jump" }] },
      {},
      sendResponse,
    );

    expect(keep).toBe(true);
    await flush();
    expect(extract).toHaveBeenCalledWith("run and jump", {
      filterAbbreviations: true,
      filterContractions: true,
    });
    expect(repository.countNew).toHaveBeenCalledTimes(1);
    // 确认闸门：上传不直接入库、不触发推送
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ total: 3, newCount: 1, filteredCount: 0 });
    expect(errorLogger.log).not.toHaveBeenCalled();
  });

  it("空批防御：files: [] 应答 {ok:false,error:'empty-upload-batch'}，零提取零驻留（code-review P1）", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger: { log: vi.fn() },
      extract,
    });
    const sendResponse = vi.fn();

    const keep = listener({ type: UPLOAD_FILE, files: [] }, {}, sendResponse);

    expect(keep).toBe(true);
    await flush();
    expect(extract).not.toHaveBeenCalled();
    expect(repository.countNew).not.toHaveBeenCalled();
    // 不驻留空批：后续 CONFIRM 拿不到 0 词批次（无 "?" badge、无 0 词确认卡）
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "empty-upload-batch",
    });
  });

  it("多文件整批 = 一次采集：文本以空行合并成单文本，只跑一次提取、一次 diff（issue #38）", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger: { log: vi.fn() },
      extract,
    });
    const sendResponse = vi.fn();

    listener(
      {
        type: UPLOAD_FILE,
        files: [
          { name: "a.txt", text: "run and" },
          { name: "b.md", text: "jump" },
        ],
      },
      {},
      sendResponse,
    );
    await flush();

    // 整批合并：extract 只收到一次合并文本（\n\n 连接），预览是合并后词数
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledWith("run and\n\njump", {
      filterAbbreviations: true,
      filterContractions: true,
    });
    expect(repository.countNew).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ total: 3, newCount: 3, filteredCount: 0 });
  });

  it("新批次覆盖旧批次：先 WORDS_COLLECTED 再 UPLOAD_FILE，CONFIRM 合并的是上传批次（issue #38）", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger: { log: vi.fn() },
      extract,
    });

    listener(
      {
        type: WORDS_COLLECTED,
        entries: [
          { lemma: "alphaword", flags: 0 },
          { lemma: "betaword", flags: 0 },
        ],
        filteredCount: 0,
      },
      {},
      vi.fn(),
    );
    await flush();
    listener(
      { type: UPLOAD_FILE, files: [{ name: "serendipity.txt", text: "serendipity" }] },
      {},
      vi.fn(),
    );
    await flush();

    const sendResponse = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);
    await flush();
    await flush();

    // 单驻留语义：上传批次覆盖了网页采集批次
    expect(repository.mergeCollected).toHaveBeenCalledWith([
      { lemma: "serendipity", flags: 0 },
    ]);
    expect(sendResponse).toHaveBeenCalledWith({ total: 1, pending: 1 });
  });

  it("确认（CONFIRM_COLLECTED）合并上传批次并触发推送：与采集批次同语义", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const coordinator = fakePushCoordinator();
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: coordinator,
      errorLogger: { log: vi.fn() },
      extract,
    });

    listener(
      { type: UPLOAD_FILE, files: [{ name: "words.md", text: "serendipity" }] },
      {},
      vi.fn(),
    );
    await flush();

    const sendResponse = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);
    await flush();
    await flush();

    expect(repository.mergeCollected).toHaveBeenCalledWith([
      { lemma: "serendipity", flags: 0 },
    ]);
    expect(coordinator.start).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ total: 1, pending: 1 });
  });

  it("验收修订：.csv / .markdown / .srt 等纯文本后缀合法——.csv 走自然语言提取管线（不是 IMPORT_CSV 的结构化解析）", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger: { log: vi.fn() },
      extract,
    });

    for (const fileName of ["notes.csv", "readme.markdown", "app.log", "dump.json", "a.text", "eps.srt", "lyrics.lrc"]) {
      const sendResponse = vi.fn();
      listener({ type: UPLOAD_FILE, files: [{ name: fileName, text: "run and jump" }] }, {}, sendResponse);
      await flush();
      expect(sendResponse).toHaveBeenCalledWith({ total: 3, newCount: 3, filteredCount: 0 });
    }
    // .csv 也只是被当纯文本提词：extract 收到原始文本
    expect(extract).toHaveBeenCalledWith("run and jump", {
      filterAbbreviations: true,
      filterContractions: true,
    });
  });

  it("非法后缀（如 .png）：零写入、零提取，应答错误并写错误日志 stage=upload", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const errorLogger = { log: vi.fn() };
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger,
      extract,
    });
    const sendResponse = vi.fn();

    const keep = listener(
      { type: UPLOAD_FILE, files: [{ name: "photo.png", text: "binary-ish" }] },
      {},
      sendResponse,
    );

    expect(keep).toBe(true);
    await flush();
    expect(extract).not.toHaveBeenCalled();
    expect(repository.countNew).not.toHaveBeenCalled();
    // Now the test mock does real substitution, so we can assert on the actual error message content
    expect(sendResponse.mock.calls[0]?.[0]).toEqual({
      ok: false,
      error: expect.stringContaining("photo.png"),
    });
    expect(errorLogger.log).toHaveBeenCalledTimes(1);
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string };
    expect(event.stage).toBe("upload"); // 与 IMPORT_CSV 的 import 阶段可区分
  });

  it("混入非法后缀 → 整批拒绝：零提取、零 diff，错误含非法文件名（issue #38）", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const errorLogger = { log: vi.fn() };
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger,
      extract,
    });
    const sendResponse = vi.fn();

    listener(
      {
        type: UPLOAD_FILE,
        files: [
          { name: "good.txt", text: "run and jump" },
          { name: "sketch.exe", text: "malformed" },
        ],
      },
      {},
      sendResponse,
    );
    await flush();

    expect(extract).not.toHaveBeenCalled();
    expect(repository.countNew).not.toHaveBeenCalled();
    expect(sendResponse.mock.calls[0]?.[0]).toEqual({
      ok: false,
      error: expect.stringContaining("sketch.exe"),
    });
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string };
    expect(event.stage).toBe("upload");
  });

  it("countNew 抛错：应答 upload-failed 并写错误日志 stage=upload", async () => {
    const repository = fakeRepository();
    repository.countNew = vi.fn(async () => {
      throw new Error("idb read failed");
    });
    const errorLogger = { log: vi.fn() };
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger,
      extract: freshExtract(),
    });
    const sendResponse = vi.fn();

    listener(
      { type: UPLOAD_FILE, files: [{ name: "a.txt", text: "run" }] },
      {},
      sendResponse,
    );
    await flush();

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "upload-failed" });
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string; summary: string };
    expect(event.stage).toBe("upload");
    expect(event.summary).toContain("idb read failed");
  });
  it("提取前读收词过滤开关并传给 extract：关闭后 options 透传 false（issue #43）", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const filterSettings: IntakeFilterSettings = {
      filterAbbreviations: false,
      filterContractions: false,
    };
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger: { log: vi.fn() },
      extract,
      getFilterSettings: async () => filterSettings,
    });
    const sendResponse = vi.fn();

    listener(
      { type: UPLOAD_FILE, files: [{ name: "notes.txt", text: "run" }] },
      {},
      sendResponse,
    );
    await flush();

    expect(extract).toHaveBeenCalledWith("run", {
      filterAbbreviations: false,
      filterContractions: false,
    });
    expect(sendResponse).toHaveBeenCalledWith({ total: 1, newCount: 1, filteredCount: 0 });
  });
});

describe("createBackgroundListener UPLOAD_TEXT（issue #42 v1.1-T5 粘贴文本）", () => {
  /** 与网页采集同源的提取管线：注入确定性 extract 验证被调用与传参。 */
  const freshExtract = () =>
    vi.fn(
      (text: string): ExtractResult => ({
        entries: text
          .split(/\s+/)
          .filter(Boolean)
          .map((lemma) => ({ lemma, flags: 0 })),
        filteredCount: 0,
      }),
    );

  it("text 直进同一提取管线：无后缀校验、countNew 算 diff、只驻留（不合并不推送）、应答 {total,newCount}；持有通道", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    repository.countNew = vi.fn(async () => 1);
    const coordinator = fakePushCoordinator();
    const errorLogger = { log: vi.fn() };
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: coordinator,
      errorLogger,
      extract,
    });
    const sendResponse = vi.fn();

    // 决议 A3：粘贴文本无文件名/后缀概念——即便文本长得像文件名
    // （"sketch.exe photo.png"）也当纯文本提词，不过 UPLOAD_TEXT_SUFFIXES
    // 白名单（对比：同内容走 UPLOAD_FILE 必须有合法后缀文件名才放行）
    const keep = listener(
      { type: UPLOAD_TEXT, text: "sketch.exe photo.png run and jump" },
      {},
      sendResponse,
    );

    expect(keep).toBe(true);
    await flush();
    expect(extract).toHaveBeenCalledWith("sketch.exe photo.png run and jump", {
      filterAbbreviations: true,
      filterContractions: true,
    });
    expect(repository.countNew).toHaveBeenCalledTimes(1);
    // 确认闸门：粘贴文本同样不直接入库、不触发推送
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ total: 5, newCount: 1, filteredCount: 0 });
    expect(errorLogger.log).not.toHaveBeenCalled();
  });

  it("空文本防御：全空白 text → {ok:false,error:'empty-upload-text'}，零提取零驻留（sweeper #26，与空批防御对称）", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const errorLogger = { log: vi.fn() };
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger,
      extract,
    });
    const sendResponse = vi.fn();

    const keep = listener({ type: UPLOAD_TEXT, text: "   \n\t " }, {}, sendResponse);

    expect(keep).toBe(true);
    await flush();
    expect(extract).not.toHaveBeenCalled();
    expect(repository.countNew).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "empty-upload-text" });
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string };
    expect(event.stage).toBe("upload");
  });

  it("新批次覆盖旧批次：先 WORDS_COLLECTED 再 UPLOAD_TEXT，CONFIRM 合并的是粘贴批次", async () => {
    const extract = freshExtract();
    const repository = fakeRepository();
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger: { log: vi.fn() },
      extract,
    });

    listener(
      {
        type: WORDS_COLLECTED,
        entries: [
          { lemma: "alphaword", flags: 0 },
          { lemma: "betaword", flags: 0 },
        ],
        filteredCount: 0,
      },
      {},
      vi.fn(),
    );
    await flush();
    listener({ type: UPLOAD_TEXT, text: "serendipity" }, {}, vi.fn());
    await flush();

    const sendResponse = vi.fn();
    listener({ type: CONFIRM_COLLECTED }, {}, sendResponse);
    await flush();
    await flush();

    // 单驻留语义：粘贴批次覆盖了网页采集批次
    expect(repository.mergeCollected).toHaveBeenCalledWith([
      { lemma: "serendipity", flags: 0 },
    ]);
    expect(sendResponse).toHaveBeenCalledWith({ total: 1, pending: 1 });
  });

  it("countNew 抛错：应答 upload-failed 并写错误日志 stage=upload（与 UPLOAD_FILE 同 stage）", async () => {
    const repository = fakeRepository();
    repository.countNew = vi.fn(async () => {
      throw new Error("idb read failed");
    });
    const errorLogger = { log: vi.fn() };
    const listener = createBackgroundListener({
      repository,
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      errorLogger,
      extract: freshExtract(),
    });
    const sendResponse = vi.fn();

    const keep = listener({ type: UPLOAD_TEXT, text: "run" }, {}, sendResponse);

    expect(keep).toBe(true);
    await flush();
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "upload-failed" });
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string; summary: string };
    expect(event.stage).toBe("upload");
    expect(event.summary).toContain("idb read failed");
  });
});
