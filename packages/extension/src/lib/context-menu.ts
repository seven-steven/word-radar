/**
 * chrome.contextMenus 边界模块（issue #40 v1.1-T3，决议 B1/B3/B4；
 * ADR 0001——openPopup 门槛把 minimum_chrome_version 抬到 127）。
 *
 * 两个右键菜单项（title 走 __MSG_*__ 占位符，Chrome 对 contextMenus.create
 * 的 title 原生做 i18n 替换，无需 chrome.i18n 调用）：
 * - 「采集当前页」（collect-page）：documentUrlPatterns 限 http/https，
 *   chrome:// 等特殊页不出现；点击 = 写 "collect" 标记 + openPopup，
 *   popup 内自动执行采集并呈现待确认批次。
 * - 「上传文件采集生词」（upload-files）：不限页面（任何页面都能发起
 *   上传采集）；点击 = 写 "upload" 标记 + openPopup，popup 直达上传画布
 *   （焦点就位，issue #41）。
 *
 * 注册时序：onInstalled 在扩展更新时会再次触发，先 removeAll 再 create，
 * 避免菜单 id 重复注册报错（removeAll 回调里 create）。
 *
 * 点击侧：openPopup 无「打开原因」参数，先写 storage.session 的 openReason
 * 标记再 openPopup；标记由 popup boot 一次性消费（lib/open-reason.ts）。
 * openPopup 可能因策略/焦点竞争失败（reject），捕获后静默——入口点击不产
 * 生错误噪声。collect 标记的自动采集只是 popup 内 void collect() 复用按钮
 * 路径，无独立链路。
 *
 * chrome.contextMenus / chrome.action.openPopup 全部收在可注入网关后面
 * （同 background-listener.ts 的注入风格），SW 集成测试注入 mock 网关。
 */
import {
  recordOpenReason,
  type OpenReason,
  type OpenReasonSession,
} from "./open-reason.js";

/** 菜单 id（onClicked 的 menuItemId 匹配用）。 */
export const MENU_COLLECT_PAGE = "collect-page";
export const MENU_UPLOAD_FILES = "upload-files";

/** create 的参数面（只列本项目用到的字段）。 */
export interface ContextMenuCreateProperties {
  id: string;
  title: string;
  contexts: string[];
  documentUrlPatterns?: string[];
}

/** chrome.contextMenus 的最小可注入面（注册半边）。 */
export interface ContextMenusRegistrar {
  removeAll(callback: () => void): void;
  create(properties: ContextMenuCreateProperties): unknown;
}

/** 默认 chrome.contextMenus 实现。 */
export const chromeContextMenus: ContextMenusRegistrar = {
  removeAll(callback) {
    chrome.contextMenus.removeAll(callback);
  },
  create(properties) {
    return chrome.contextMenus.create(
      properties as chrome.contextMenus.CreateProperties,
    );
  },
};

/** openPopup 网关（chrome.action.openPopup，ADR 0001 的 127 门槛 API）。 */
export interface OpenPopupGateway {
  openPopup(): Promise<void> | void;
}

/** 默认 chrome.action.openPopup 实现。 */
export const chromeOpenPopup: OpenPopupGateway = {
  openPopup: () => chrome.action.openPopup(),
};

/** 注册两菜单项：removeAll 清旧（onInstalled 更新时再触发）后 create 两项。 */
export function registerContextMenus(
  registrar: ContextMenusRegistrar = chromeContextMenus,
): void {
  registrar.removeAll(() => {
    // 「采集当前页」只在 http/https 页面出现（chrome:// 等特殊页无从采集）
    registrar.create({
      id: MENU_COLLECT_PAGE,
      title: "__MSG_menuCollectPage__",
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
    // 「上传文件采集生词」不限页面：上传采集不依赖当前页内容
    registrar.create({
      id: MENU_UPLOAD_FILES,
      title: "__MSG_menuUploadFiles__",
      contexts: ["page"],
    });
  });
}

/** onClicked 事件的 info 面（只消费 menuItemId）。 */
export interface MenuItemClickInfo {
  menuItemId: string | number;
}

/** 菜单 id → 唤起标记；未知 id（其他来源的菜单项）返回 null 忽略。 */
function openReasonForMenu(menuItemId: string | number): OpenReason | null {
  if (menuItemId === MENU_COLLECT_PAGE) return "collect";
  if (menuItemId === MENU_UPLOAD_FILES) return "upload";
  return null;
}

export interface ContextMenuListenerDeps {
  /** 唤起标记存储（默认 chrome.storage.session，见 lib/open-reason.ts）。 */
  session?: OpenReasonSession;
  /** openPopup 网关（默认 chrome.action.openPopup）。 */
  openPopup?: OpenPopupGateway;
}

/**
 * 构造 contextMenus.onClicked 处理器：匹配两菜单 id → 写唤起标记 →
 * openPopup（reject 静默）；未知 menuItemId 忽略（不写标记、不开弹窗）。
 */
export function createContextMenuListener(
  deps: ContextMenuListenerDeps = {},
): (info: MenuItemClickInfo) => void {
  const session = deps.session ?? {
    get: (key) => chrome.storage.session.get(key),
    set: (key, value) => chrome.storage.session.set({ [key]: value }),
    remove: (key) => chrome.storage.session.remove(key),
  };
  const openPopup = deps.openPopup ?? chromeOpenPopup;
  return (info: MenuItemClickInfo) => {
    const reason = openReasonForMenu(info.menuItemId);
    if (!reason) return;
    void (async () => {
      // 先写标记再开弹窗：popup boot 读标记分流（标记写失败不阻断——popup
      // 呈默认态，仍有打开反馈）
      try {
        await recordOpenReason(session, reason);
      } catch {
        // storage.session 写失败：降级为默认态弹窗
      }
      try {
        await openPopup.openPopup();
      } catch {
        // openPopup 可能因策略/焦点竞争失败：静默
      }
    })();
  };
}
