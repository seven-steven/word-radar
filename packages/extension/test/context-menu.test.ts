import { describe, expect, it, vi } from "vitest";
import {
  createContextMenuListener,
  registerContextMenus,
  type ContextMenuCreateProperties,
  type ContextMenusRegistrar,
  type MenuItemClickInfo,
  type OpenPopupGateway,
} from "../src/lib/context-menu.js";
import { OPEN_REASON_KEY, type OpenReasonSession } from "../src/lib/open-reason.js";

// mock 风格同 background-listener.test.ts：结构化 fake 工厂 + vi.fn 断言。

function fakeSession(): OpenReasonSession & {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(async (key: string) => ({})),
    set: vi.fn(async (_key: string, _value: string) => undefined),
    remove: vi.fn(async (_key: string) => undefined),
  };
}

function fakeOpenPopup(overrides: { reject?: boolean } = {}): OpenPopupGateway & {
  openPopup: ReturnType<typeof vi.fn>;
} {
  return {
    openPopup: overrides.reject
      ? vi.fn(async () => {
          throw new Error("openPopup rejected (策略/焦点竞争)");
        })
      : vi.fn(async () => undefined),
  };
}

/** 等 listener 内部 void async 链落定（set / openPopup 均已 resolve/reject）。 */
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("createContextMenuListener", () => {
  it("「采集当前页」点击：写 openReason=collect 标记后调 openPopup（先标记后弹窗）", async () => {
    const session = fakeSession();
    const openPopup = fakeOpenPopup();
    const order: string[] = [];
    session.set.mockImplementation(async () => {
      order.push("set");
    });
    openPopup.openPopup.mockImplementation(async () => {
      order.push("openPopup");
    });
    const listener = createContextMenuListener({ session, openPopup });

    listener({ menuItemId: "collect-page" } as MenuItemClickInfo);
    await flushAsync();

    expect(session.set).toHaveBeenCalledWith(OPEN_REASON_KEY, "collect");
    expect(openPopup.openPopup).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["set", "openPopup"]);
  });

  it("「上传文件采集生词」点击：写 openReason=upload 标记后调 openPopup", async () => {
    const session = fakeSession();
    const openPopup = fakeOpenPopup();
    const listener = createContextMenuListener({ session, openPopup });

    listener({ menuItemId: "upload-files" } as MenuItemClickInfo);
    await flushAsync();

    expect(session.set).toHaveBeenCalledWith(OPEN_REASON_KEY, "upload");
    expect(openPopup.openPopup).toHaveBeenCalledTimes(1);
  });

  it("openPopup reject 时静默：不抛错、标记已写入", async () => {
    const session = fakeSession();
    const openPopup = fakeOpenPopup({ reject: true });
    const listener = createContextMenuListener({ session, openPopup });

    expect(() => listener({ menuItemId: "collect-page" } as MenuItemClickInfo)).not.toThrow();
    await flushAsync();

    expect(session.set).toHaveBeenCalledTimes(1);
    expect(openPopup.openPopup).toHaveBeenCalledTimes(1); // 调过但 rejected，被捕获
  });

  it("openPopup reject 时尽力回收标记：remove 被调（防残留误触发，code-review P1）", async () => {
    const session = fakeSession();
    const openPopup = fakeOpenPopup({ reject: true });
    const listener = createContextMenuListener({ session, openPopup });

    listener({ menuItemId: "upload-files" } as MenuItemClickInfo);
    await flushAsync();

    expect(session.remove).toHaveBeenCalledWith(OPEN_REASON_KEY);
  });

  it("openPopup reject 且回收也失败：依旧静默不抛", async () => {
    const session = fakeSession();
    session.remove.mockRejectedValue(new Error("storage.session unavailable"));
    const openPopup = fakeOpenPopup({ reject: true });
    const listener = createContextMenuListener({ session, openPopup });

    expect(() => listener({ menuItemId: "collect-page" } as MenuItemClickInfo)).not.toThrow();
    await flushAsync();

    expect(session.remove).toHaveBeenCalledTimes(1);
  });

  it("标记写入失败不阻断 openPopup（尽力而为：popup 降级为默认态）", async () => {
    const session = fakeSession();
    session.set.mockRejectedValue(new Error("storage.session unavailable"));
    const openPopup = fakeOpenPopup();
    const listener = createContextMenuListener({ session, openPopup });

    listener({ menuItemId: "upload-files" } as MenuItemClickInfo);
    await flushAsync();

    expect(openPopup.openPopup).toHaveBeenCalledTimes(1);
  });

  it("未知 menuItemId 忽略：不写标记、不开弹窗", async () => {
    const session = fakeSession();
    const openPopup = fakeOpenPopup();
    const listener = createContextMenuListener({ session, openPopup });

    listener({ menuItemId: "some-other-extension-menu" } as MenuItemClickInfo);
    await flushAsync();

    expect(session.set).not.toHaveBeenCalled();
    expect(openPopup.openPopup).not.toHaveBeenCalled();
  });
});

describe("registerContextMenus", () => {
  /** 记录调用顺序的 registrar fake：create 仅在 removeAll 回调里发生。 */
  function fakeRegistrar(): ContextMenusRegistrar & {
    created: ContextMenuCreateProperties[];
    removeAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  } {
    const created: ContextMenuCreateProperties[] = [];
    return {
      created,
      removeAll: vi.fn((callback: () => void) => callback()),
      create: vi.fn((properties: ContextMenuCreateProperties) => {
        created.push(properties);
        return properties.id;
      }),
    };
  }

  it("先 removeAll 再 create 两项（onInstalled 更新再触发时幂等，不因 id 重复报错）", () => {
    const registrar = fakeRegistrar();
    registerContextMenus(registrar);

    expect(registrar.removeAll).toHaveBeenCalledTimes(1);
    expect(registrar.create).toHaveBeenCalledTimes(2);
    expect(registrar.created.map((p) => p.id)).toEqual(["collect-page", "upload-files"]);
  });

  it("title 经 getMessage 显式解析（chrome.i18n 无文档保证 create 占位符替换，127 门槛下更不可依赖）；contexts 均为 page", () => {
    const registrar = fakeRegistrar();
    const messages: Record<string, string> = {
      menuCollectPage: "采集当前页",
      menuUploadFiles: "上传文件采集生词",
    };
    registerContextMenus(registrar, (key) => messages[key] ?? "");

    for (const properties of registrar.created) {
      expect(properties.title).not.toMatch(/^__MSG_/);
      expect(properties.contexts).toEqual(["page"]);
    }
    expect(registrar.created[0]?.title).toBe("采集当前页");
    expect(registrar.created[1]?.title).toBe("上传文件采集生词");
  });

  it("getMessage 返回空串（locale key 缺失）时降级为 key 本身：可见的开发期错误优于空 title", () => {
    const registrar = fakeRegistrar();
    registerContextMenus(registrar, () => "");

    expect(registrar.created[0]?.title).toBe("menuCollectPage");
    expect(registrar.created[1]?.title).toBe("menuUploadFiles");
  });

  it("documentUrlPatterns 只在 collect-page 上（http/https 限定）；upload-files 不限页面", () => {
    const registrar = fakeRegistrar();
    registerContextMenus(registrar);

    expect(registrar.created[0]?.documentUrlPatterns).toEqual(["http://*/*", "https://*/*"]);
    expect(registrar.created[1]?.documentUrlPatterns).toBeUndefined();
  });
});
