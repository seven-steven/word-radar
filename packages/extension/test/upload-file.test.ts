/**
 * issue #24 上传文件采集单测：
 * - background-listener 的 UPLOAD_FILE 分支：文本走同一提取管线 → 驻留待确认
 *   批次（不合并、不推送、零网络）；非 .txt/.md 后缀零写入 + 错误日志
 *   stage=upload；确认后与采集批次同语义合并。
 * - sw-channel 的 uploadFile 收窄。
 * - collect-menu 的菜单注册与点击接线（标记 + best-effort openPopup）。
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
  CONSUME_UPLOAD_TARGET,
  UPLOAD_FILE,
  type PushStatus,
} from "../src/lib/messages.js";
import type { PushCoordinator } from "../src/lib/push-coordinator.js";
import type { WordEntry } from "@word-radar/core";
import {
  setupCollectMenu,
  handleCollectMenuClick,
  UPLOAD_TARGET_FLAG,
  UPLOAD_TARGET_MENU_ID,
} from "../src/lib/collect-menu.js";
import { uploadFile, consumeUploadTargetFlag } from "../src/lib/sw-channel.js";

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

describe("createBackgroundListener UPLOAD_FILE（issue #24）", () => {
  /** 与网页采集同源的提取管线：注入确定性 extract 验证被调用与传参。 */
  const freshExtract = () =>
    vi.fn((text: string): WordEntry[] =>
      text.split(/\s+/).filter(Boolean).map((lemma) => ({ lemma, flags: 0 })));

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
      { type: UPLOAD_FILE, text: "run and jump", fileName: "notes.txt" },
      {},
      sendResponse,
    );

    expect(keep).toBe(true);
    await flush();
    expect(extract).toHaveBeenCalledWith("run and jump");
    expect(repository.countNew).toHaveBeenCalledTimes(1);
    // 确认闸门：上传不直接入库、不触发推送
    expect(repository.mergeCollected).not.toHaveBeenCalled();
    expect(coordinator.start).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ total: 3, newCount: 1 });
    expect(errorLogger.log).not.toHaveBeenCalled();
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
      { type: UPLOAD_FILE, text: "serendipity", fileName: "words.md" },
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

  it("验收修订：.csv / .markdown 等纯文本后缀合法——.csv 走自然语言提取管线（不是 IMPORT_CSV 的结构化解析）", async () => {
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

    for (const fileName of ["notes.csv", "readme.markdown", "app.log", "dump.json", "a.text"]) {
      const sendResponse = vi.fn();
      listener({ type: UPLOAD_FILE, text: "run and jump", fileName }, {}, sendResponse);
      await flush();
      expect(sendResponse).toHaveBeenCalledWith({ total: 3, newCount: 3 });
    }
    // .csv 也只是被当纯文本提词：extract 收到原始文本
    expect(extract).toHaveBeenCalledWith("run and jump");
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
      { type: UPLOAD_FILE, text: "binary-ish", fileName: "photo.png" },
      {},
      sendResponse,
    );

    expect(keep).toBe(true);
    await flush();
    expect(extract).not.toHaveBeenCalled();
    expect(repository.countNew).not.toHaveBeenCalled();
    expect(sendResponse.mock.calls[0]?.[0]).toEqual({
      ok: false,
      error: expect.stringContaining("photo.png"),
    });
    expect(errorLogger.log).toHaveBeenCalledTimes(1);
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string };
    expect(event.stage).toBe("upload"); // 与 IMPORT_CSV 的 import 阶段可区分
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
      { type: UPLOAD_FILE, text: "run", fileName: "a.txt" },
      {},
      sendResponse,
    );
    await flush();

    expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: "upload-failed" });
    const event = errorLogger.log.mock.calls[0]?.[0] as { stage: string; summary: string };
    expect(event.stage).toBe("upload");
    expect(event.summary).toContain("idb read failed");
  });
});

describe("sw-channel uploadFile 收窄（issue #24）", () => {
  it("BatchPreview → {ok:true,total,newCount}", async () => {
    const channel = {
      uploadFile: vi.fn(async () => ({ total: 4, newCount: 2 })),
    };
    await expect(
      uploadFile(channel, "some text", "a.txt"),
    ).resolves.toEqual({ ok: true, total: 4, newCount: 2 });
    expect(channel.uploadFile).toHaveBeenCalledWith("some text", "a.txt");
  });

  it("错误应答原样透传；异常应答/抛错归一为 upload-unavailable", async () => {
    await expect(
      uploadFile(
        { uploadFile: vi.fn(async () => ({ ok: false, error: "a.csv: 仅支持" })) },
        "x",
        "a.csv",
      ),
    ).resolves.toEqual({ ok: false, error: "a.csv: 仅支持" });
    await expect(
      uploadFile({ uploadFile: vi.fn(async () => "garbage") }, "x", "a.txt"),
    ).resolves.toEqual({ ok: false, error: "upload-unavailable" });
    await expect(
      uploadFile(
        {
          uploadFile: vi.fn(async () => {
            throw new Error("sw gone");
          }),
        },
        "x",
        "a.txt",
      ),
    ).resolves.toEqual({ ok: false, error: "upload-unavailable" });
  });
});

describe("createBackgroundListener CONSUME_UPLOAD_TARGET（issue #24 验收缺陷修复）", () => {
  function fakeUploadTargetStorage(items: Record<string, unknown> = {}) {
    return {
      items,
      get: vi.fn(async (key: string) => ({ [key]: items[key] })),
      remove: vi.fn(async (key: string) => {
        delete items[key];
      }),
    };
  }

  function listenerWithStorage(storage: ReturnType<typeof fakeUploadTargetStorage>) {
    return createBackgroundListener({
      repository: fakeRepository(),
      bbdcClient: fakeBbdcClient(),
      actionBadge: fakeActionBadge(),
      pushCoordinator: fakePushCoordinator(),
      uploadTargetStorage: storage,
    });
  }

  it("标记为 true：SW 读并清掉（同一上下文，严格有序），应答 {ok:true,uploadRequested:true}", async () => {
    const storage = fakeUploadTargetStorage({ [UPLOAD_TARGET_FLAG]: true });
    const listener = listenerWithStorage(storage);
    const sendResponse = vi.fn();

    const keep = listener({ type: CONSUME_UPLOAD_TARGET }, {}, sendResponse);
    expect(keep).toBe(true);
    await flush();

    expect(storage.get).toHaveBeenCalledWith(UPLOAD_TARGET_FLAG);
    expect(storage.remove).toHaveBeenCalledWith(UPLOAD_TARGET_FLAG);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, uploadRequested: true });
  });

  it("无标记：不清 storage，应答 {ok:true,uploadRequested:false}", async () => {
    const storage = fakeUploadTargetStorage();
    const listener = listenerWithStorage(storage);
    const sendResponse = vi.fn();

    listener({ type: CONSUME_UPLOAD_TARGET }, {}, sendResponse);
    await flush();

    expect(storage.remove).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, uploadRequested: false });
  });

  it("storage 抛错：应答 {ok:false,error}（popup 收窄为 false，回退默认采集）", async () => {
    const storage = fakeUploadTargetStorage();
    storage.get = vi.fn(async () => {
      throw new Error("storage gone");
    });
    const listener = listenerWithStorage(storage);
    const sendResponse = vi.fn();

    listener({ type: CONSUME_UPLOAD_TARGET }, {}, sendResponse);
    await flush();

    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: "consume-upload-target-failed",
    });
  });
});

describe("sw-channel consumeUploadTargetFlag 收窄（issue #24）", () => {
  it("{ok:true,uploadRequested:true} → true", async () => {
    const channel = { consumeUploadTarget: vi.fn(async () => ({ ok: true, uploadRequested: true })) };
    await expect(consumeUploadTargetFlag(channel)).resolves.toBe(true);
    expect(channel.consumeUploadTarget).toHaveBeenCalledTimes(1);
  });

  it("uploadRequested:false / 异常应答 / 抛错 → false（回退默认网页采集）", async () => {
    await expect(
      consumeUploadTargetFlag({
        consumeUploadTarget: vi.fn(async () => ({ ok: true, uploadRequested: false })),
      }),
    ).resolves.toBe(false);
    await expect(
      consumeUploadTargetFlag({ consumeUploadTarget: vi.fn(async () => "garbage") }),
    ).resolves.toBe(false);
    await expect(
      consumeUploadTargetFlag({
        consumeUploadTarget: vi.fn(async () => {
          throw new Error("sw gone");
        }),
      }),
    ).resolves.toBe(false);
  });
});

describe("collect-menu（issue #24 右键采集目标菜单）", () => {
  it("setupCollectMenu：removeAll 后注册「上传文件」目标，contexts 含 action", async () => {
    const menus = {
      removeAll: vi.fn(async () => undefined),
      create: vi.fn(),
    };
    await setupCollectMenu(menus);
    expect(menus.removeAll).toHaveBeenCalledTimes(1);
    expect(menus.create).toHaveBeenCalledWith({
      id: UPLOAD_TARGET_MENU_ID,
      title: "上传文件",
      contexts: ["action"],
    });
  });

  it("点「上传文件」：写 storage 标记 + best-effort openPopup", async () => {
    const storage = { set: vi.fn(async () => undefined) };
    const openPopup = vi.fn(async () => undefined);
    await handleCollectMenuClick(
      { menuItemId: UPLOAD_TARGET_MENU_ID },
      { menus: { removeAll: vi.fn(), create: vi.fn() }, storage, action: { openPopup } },
    );
    expect(storage.set).toHaveBeenCalledWith({ collectTargetUploadFile: true });
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it("openPopup 严格等 storage.set 写入完成后才调用（防 popup 打开赶在提交落地前）", async () => {
    let resolveSet: () => void = () => undefined;
    const storage = {
      set: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          resolveSet = resolve;
        });
      }),
    };
    const openPopup = vi.fn(async () => undefined);
    const pending = handleCollectMenuClick(
      { menuItemId: UPLOAD_TARGET_MENU_ID },
      { menus: { removeAll: vi.fn(), create: vi.fn() }, storage, action: { openPopup } },
    );

    // 写入未落地：popup 不得被打开
    await flush();
    expect(openPopup).not.toHaveBeenCalled();

    resolveSet();
    await pending;
    expect(openPopup).toHaveBeenCalledTimes(1);
  });

  it("openPopup 抛错时静默降级：标记已写，不向上抛", async () => {
    const storage = { set: vi.fn(async () => undefined) };
    const openPopup = vi.fn(async () => {
      throw new Error("no user gesture");
    });
    await expect(
      handleCollectMenuClick(
        { menuItemId: UPLOAD_TARGET_MENU_ID },
        { menus: { removeAll: vi.fn(), create: vi.fn() }, storage, action: { openPopup } },
      ),
    ).resolves.toBeUndefined();
    expect(storage.set).toHaveBeenCalled();
  });

  it("无 openPopup（旧 Chrome）或点其他菜单项：只写标记 / 什么都不做", async () => {
    const storage = { set: vi.fn(async () => undefined) };
    await handleCollectMenuClick(
      { menuItemId: UPLOAD_TARGET_MENU_ID },
      { menus: { removeAll: vi.fn(), create: vi.fn() }, storage, action: {} },
    );
    expect(storage.set).toHaveBeenCalledTimes(1);

    storage.set.mockClear();
    await handleCollectMenuClick(
      { menuItemId: "other-item" },
      { menus: { removeAll: vi.fn(), create: vi.fn() }, storage, action: {} },
    );
    expect(storage.set).not.toHaveBeenCalled();
  });
});
