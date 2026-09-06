/**
 * chrome.contextMenus 边界模块（issue #40 v1.1-T3，决议 B1/B3/B4；
 * ADR 0001——openPopup 门槛把 minimum_chrome_version 抬到 127）。
 *
 * 两个右键菜单项（title 经 chrome.i18n.getMessage 显式解析——
 * contextMenus.create 的 title 对 __MSG_*__ 占位符没有文档保证的替换
 * 行为，且该替换（若存在）在 Chrome 128+ 才可用，低于本项目
 * minimum_chrome_version 127（ADR 0001）的版本上会得到字面占位符）：
 * - 「采集当前页」（collect-page）：documentUrlPatterns 限 http/https，
 *   chrome:// 等特殊页不出现；点击 = 写 "collect" 标记 + openPopup，
 *   popup 内自动执行采集并呈现待确认批次。
 * - 「上传文件采集生词」（upload-files）：不限页面（任何页面都能发起
 *   上传采集）；点击 = 写 "upload" 标记 + openPopup，popup 直达上传画布
 *   （焦点就位，issue #41）。
 *
 * 注册时序：background.ts 在 SW 顶层调用（每次 SW 启动重放，MV3 幂等）。
 * 先 removeAll 再 create，避免菜单 id 重复注册报错（removeAll 回调里
 * create）。不能只挂 runtime.onInstalled：它仅在 install/版本 update/
 * Chrome update 时触发，「文件更新但版本号不变」的迭代流程踩不中，
 * 注册表为空 → 菜单不可见（issue #40 实测症状，background-boot.test
 * 回归锁定）。
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
  chromeOpenReasonSession,
  OPEN_REASON_KEY,
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

/** i18n 网关（title 解析用，SW 内无需权限）。 */
export type I18nGetMessage = (key: string) => string;

/** 默认 chrome.i18n.getMessage 实现。 */
export const chromeI18nGetMessage: I18nGetMessage = (key) =>
  chrome.i18n.getMessage(key);

/**
 * 注册两菜单项：removeAll 清旧（SW 顶层重放幂等）后 create 两项。
 * getMessage 为空串时（locale key 缺失——verify-manifest 已校验兜底）
 * 降级为 key 本身：可见的开发期错误优于空 title（空 title 菜单项不可见）。
 */
export function registerContextMenus(
  registrar: ContextMenusRegistrar = chromeContextMenus,
  getMessage: I18nGetMessage = chromeI18nGetMessage,
): void {
  const title = (key: string): string => getMessage(key) || key;
  registrar.removeAll(() => {
    // 「采集当前页」只在 http/https 页面出现（chrome:// 等特殊页无从采集）
    registrar.create({
      id: MENU_COLLECT_PAGE,
      title: title("menuCollectPage"),
      contexts: ["page"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
    // 「上传文件采集生词」不限页面：上传采集不依赖当前页内容
    registrar.create({
      id: MENU_UPLOAD_FILES,
      title: title("menuUploadFiles"),
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
  const session = deps.session ?? chromeOpenReasonSession;
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
        // openPopup 可能因策略/焦点竞争失败：静默。但已写入的标记必须尽力
        // 回收（code-review P1）：reject 意味着 popup 没开、没人消费标记，
        // 残留会让下次点工具栏图标误触发自动采集/聚焦。回收自身失败同样静默。
        try {
          await session.remove(OPEN_REASON_KEY);
        } catch {
          // 回收失败：标记随浏览器会话结束自然失效
        }
      }
    })();
  };
}
