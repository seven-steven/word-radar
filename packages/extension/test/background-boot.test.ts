import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * background.ts 装配层测试（issue #40 复盘回归）。
 *
 * bug 模式：菜单注册只挂在 runtime.onInstalled 里——onInstalled 仅在
 * install / 版本 update / Chrome update 时触发；开发者「rebuild dist 但
 * manifest 版本号不变」的迭代流程（reload 扩展/重启浏览器让 SW 跑新代码）
 * 永远踩不中它 → 注册表为空 → 右键菜单不可见，而 popup 等其他功能正常
 * （不依赖 onInstalled）。
 *
 * seam 说明：Playwright 层没有可靠的「SW 重启且 onInstalled 不触发」手段
 * （--load-extension 每次启动都走注入安装、恒触发 onInstalled），故装配
 * 层用模块级测试锁：「模块加载（= SW 每次启动重放顶层代码）本身必须完成
 * 菜单注册，不依赖 onInstalled」。
 */

// 重依赖全 mock——本测试只关心装配时机，不关心实现。
vi.mock("../src/lib/background-listener.js", () => ({
  createBackgroundListener: vi.fn(() => vi.fn()),
}));
vi.mock("../src/lib/bbdc-client.js", () => ({
  createBbdcClient: vi.fn(() => ({})),
}));
vi.mock("../src/lib/word-repository.js", () => ({
  createWordRepository: vi.fn(() => ({})),
}));
vi.mock("../src/lib/settings.js", () => ({
  cleanupLegacyAutoPush: vi.fn(async () => undefined),
}));

interface FakeChrome {
  runtime: {
    onInstalled: { addListener: ReturnType<typeof vi.fn>; fire: () => void };
    onMessage: { addListener: ReturnType<typeof vi.fn> };
  };
  contextMenus: {
    removeAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    onClicked: { addListener: ReturnType<typeof vi.fn> };
  };
  i18n: { getMessage: ReturnType<typeof vi.fn> };
  storage: { local: { set: ReturnType<typeof vi.fn> } };
}

/** fake chrome：removeAll 同步回调（create 立即发生），fire 收集 onInstalled 监听器。 */
function installFakeChrome(): FakeChrome {
  const installedListeners: Array<() => void> = [];
  const fake: FakeChrome = {
    runtime: {
      onInstalled: {
        addListener: vi.fn((listener: () => void) => installedListeners.push(listener)),
        fire: () => installedListeners.forEach((l) => l()),
      },
      onMessage: { addListener: vi.fn() },
    },
    contextMenus: {
      removeAll: vi.fn((callback: () => void) => callback()),
      create: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    i18n: { getMessage: vi.fn((key: string) => `i18n:${key}`) },
    storage: { local: { set: vi.fn() } },
  };
  vi.stubGlobal("chrome", fake);
  return fake;
}

/** 动态 import 一份新鲜的 background.ts（顶层装配立即执行）。 */
async function importBackground(): Promise<void> {
  await import("../src/background.js");
}

describe("background 装配：菜单注册时机（issue #40 回归）", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("SW 冷启动（onInstalled 未触发——版本不变的文件更新/浏览器重启场景）也重放菜单注册", async () => {
    const fake = installFakeChrome();
    await importBackground();

    // 不 fire onInstalled——模块加载本身必须完成注册
    expect(fake.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(fake.contextMenus.create).toHaveBeenCalledTimes(2);
    expect(fake.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "collect-page" }),
    );
    expect(fake.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "upload-files" }),
    );
  });

  it("onInstalled 触发（首次安装/版本更新）时注册恰好一次、不重复叠加", async () => {
    const fake = installFakeChrome();
    await importBackground();
    fake.runtime.onInstalled.fire();

    expect(fake.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(fake.contextMenus.create).toHaveBeenCalledTimes(2);
    expect(fake.storage.local.set).toHaveBeenCalledWith({ "word-radar-installed": true });
  });

  it("onClicked 监听器在模块顶层同步注册（MV3 SW 事件监听时序约束）", async () => {
    const fake = installFakeChrome();
    await importBackground();

    expect(fake.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1);
    expect(fake.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });
});
