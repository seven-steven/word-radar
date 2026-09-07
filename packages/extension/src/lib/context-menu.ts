/**
 * chrome.contextMenus 边界模块（issue #40 v1.1-T3，决议 B1/B3/B4；
 * ADR 0001——openPopup 门槛把 minimum_chrome_version 抬到 127）。
 *
 * 两个右键菜单项（title 经 chrome.i18n.getMessage 显式解析——
 * contextMenus.create 的 title 对 __MSG_*__ 占位符没有文档保证的替换
 * 行为，且该替换（若存在）在 Chrome 128+ 才可用，低于本项目
 * minimum_chrome_version 127（ADR 0001）的版本上会得到字面占位符）。
 * contexts 三手势全覆盖（右键工具栏图标 action / 网页裸右键 page /
 * 选词后右键 selection——PAGE 是最弱 context，选区/链接/输入框上右键
 * 不匹配，背单词主手势必须靠 selection 兜住）：
 * - 「采集当前页」（collect-page）：documentUrlPatterns 限 http/https，
 *   chrome:// 等特殊页不出现；点击 = 写 "collect" 标记 + openPopup，
 *   popup 内自动执行采集并呈现待确认批次。
 * - 「上传文件采集生词」（upload-files）：不限页面（任何页面都能发起
 *   上传采集）；点击 = 写 "upload" 标记 + openPopup，popup 直达上传画布
 *   （焦点就位，issue #41）。
 *
 * 注册时序（issue #40 复盘两轮定型，两路并行）：
 * - background.ts 在 SW 顶层**同步**调 registerContextMenus（每次启动
 *   重放，duplicate id 由网关吞错——幂等）。同步是 action 菜单（右键
 *   工具栏图标）的硬要求：菜单显示发生在 SW 空闲时，异步注册链会留
 *   「菜单已显示而注册未落」的冷窗口。
 * - onInstalled（install/版本 update）时 refreshContextMenus 全量刷新
 *   （removeAll→create），替换旧参数注册。不能只挂 onInstalled：它对
 *   「文件更新但版本号不变」的迭代流程（reload/重启）不触发，注册表
 *   为空 → 菜单不可见（issue #40 实测症状，background-boot.test 回归
 *   锁定）。
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
  /** 同步 create，吞掉一切注册错误（duplicate id 等预期内）。 */
  create(properties: ContextMenuCreateProperties): unknown;
}

/** 默认 chrome.contextMenus 实现。 */
export const chromeContextMenus: ContextMenusRegistrar = {
  removeAll(callback) {
    chrome.contextMenus.removeAll(callback);
  },
  create(properties) {
    try {
      // 带 callback 并读取 lastError：127（回调时代）到最新（promise 时代）
      // 通用的错误消化方式——duplicate id 等 create 失败静默，注册表里
      // 已有的同名项即正确状态
      return chrome.contextMenus.create(
        properties as chrome.contextMenus.CreateProperties,
        () => void chrome.runtime.lastError,
      );
    } catch {
      // 同步抛错同样吞：注册幂等优先，不因重复注册崩 SW
      return undefined;
    }
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
 * 两菜单项的注册属性。contexts 三手势全覆盖（issue #40 复盘两轮）：
 * - "action"：右键工具栏图标菜单（用户主诉入口）——action 菜单要求 SW
 *   顶层同步注册（见 registerContextMenus）；
 * - "page"：网页裸右键（PAGE 是最弱 context，右键目标带链接/选区/输入
 *   框/媒体时不匹配——Chromium context_menu_helpers.cc）；
 * - "selection"：选中文本后右键（背单词的主手势，只注册 page 时全程隐形）。
 * 点击语义均不变：collect-page 整页采集（title 不带 %s，不随选区变），
 * upload-files 直达上传画布。
 * 网页右键下两项同时可见时 Chrome 自动折叠为「WordRadar ›」父项（API
 * 固有行为，无法关闭）；action 菜单内则平铺在扩展名区块下。
 * getMessage 为空串时（locale key 缺失——verify-manifest 已校验兜底）
 * 降级为 key 本身：可见的开发期错误优于空 title（空 title 项不可见）。
 */
function menuItems(getMessage: I18nGetMessage): ContextMenuCreateProperties[] {
  const title = (key: string): string => getMessage(key) || key;
  return [
    // 「采集当前页」只在 http/https 页面出现（chrome:// 等特殊页无从采集；
    // action 菜单场景同样按当前标签页 URL 匹配）
    {
      id: MENU_COLLECT_PAGE,
      title: title("menuCollectPage"),
      contexts: ["page", "selection", "action"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    },
    // 「上传文件采集生词」不限页面：上传采集不依赖当前页内容
    {
      id: MENU_UPLOAD_FILES,
      title: title("menuUploadFiles"),
      contexts: ["page", "selection", "action"],
    },
  ];
}

/**
 * SW 启动重放注册：**同步** create 两项，吞掉 duplicate id 等错误。
 * 同步是 action 菜单的硬要求——action 菜单显示发生在 SW 空闲时（从
 * 持久化注册表渲染），注册链路里任何异步环节（如 removeAll 回调）都会
 * 留下「菜单已显示而注册未落」的冷窗口；同步 create 已有同名项时报错
 * 吞掉即幂等。
 */
export function registerContextMenus(
  registrar: ContextMenusRegistrar = chromeContextMenus,
  getMessage: I18nGetMessage = chromeI18nGetMessage,
): void {
  for (const item of menuItems(getMessage)) {
    registrar.create(item);
  }
}

/**
 * 全量刷新（onInstalled：安装/版本更新时）：removeAll 清旧后 create，
 * 确保参数演进（如本轮加 selection/action）替换掉旧注册。removeAll→
 * create 的异步链只允许出现在刷新路径——action 菜单的冷窗口风险由
 * 启动时的同步 registerContextMenus 兜住。
 */
export function refreshContextMenus(
  registrar: ContextMenusRegistrar = chromeContextMenus,
  getMessage: I18nGetMessage = chromeI18nGetMessage,
): void {
  registrar.removeAll(() => {
    registerContextMenus(registrar, getMessage);
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
