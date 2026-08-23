/**
 * 采集目标菜单（issue #24）：右键扩展图标出现的 context menu。
 *
 * 分层（spec §扩展行为 采集入口）：
 * - 左键单击图标 = 打开 popup 采集当前网页（既有默认行为，不在本模块）
 * - 右键图标 = 采集目标菜单，当前唯一目标「上传文件」：
 *   点选后写一个 storage.local 标记（popup 打开时消费：跳过自动网页采集、
 *   直接触发文件选择器），并 best-effort 调 chrome.action.openPopup()
 *   （Chrome 127+；不可用时用户随后手动点开图标同样消费标记）。
 *
 * chrome.* 调用收在本模块并全部可注入，便于单测。
 * manifest 需要新增 "contextMenus" 权限（本工单允许的最小权限）。
 */

/** 菜单项 id：采集目标「上传文件」。 */
export const UPLOAD_TARGET_MENU_ID = "collect-target-upload-file";

/** popup 打开时消费的 storage.local 键：true 表示本次打开要走上传文件目标。 */
export const UPLOAD_TARGET_FLAG = "collectTargetUploadFile";

/** 菜单条目文案（右键图标可见）。 */
export const UPLOAD_TARGET_TITLE = "上传文件";

export type MenuContext = "action" | "all";

export interface ContextMenusApi {
  removeAll(): Promise<void>;
  create(properties: {
    id: string;
    title: string;
    /** chrome 类型要求非空元组（首个元素必填）。 */
    contexts: [MenuContext, ...MenuContext[]];
  }): string | number | undefined;
}

export interface CollectMenuDeps {
  menus: ContextMenusApi;
  /** chrome.storage.local（可注入）。 */
  storage: { set(items: Record<string, unknown>): Promise<void> };
  /** chrome.action（可注入；openPopup 可选——旧版本 Chrome 没有）。 */
  action: { openPopup?(): Promise<void> };
}

/**
 * 注册采集目标菜单（幂等）：先 removeAll 再 create。
 * 在 onInstalled / onStartup 时调用（context menu 跨 SW 重启持久，但
 * 重复 create 同 id 会抛错，removeAll 兜底）。
 */
export async function setupCollectMenu(menus: ContextMenusApi): Promise<void> {
  await menus.removeAll();
  menus.create({
    id: UPLOAD_TARGET_MENU_ID,
    title: UPLOAD_TARGET_TITLE,
    contexts: ["action"],
  });
}

export interface MenuItemInfo {
  menuItemId?: string | number;
}

/**
 * 菜单点击处理：仅响应「上传文件」目标——写标记 + best-effort 弹出 popup。
 * openPopup 失败（旧 Chrome / 无手势）静默：标记仍在，用户手动打开 popup
 * 时同样生效。
 */
export async function handleCollectMenuClick(
  info: MenuItemInfo,
  deps: CollectMenuDeps,
): Promise<void> {
  if (info.menuItemId !== UPLOAD_TARGET_MENU_ID) return;
  await deps.storage.set({ [UPLOAD_TARGET_FLAG]: true });
  if (typeof deps.action.openPopup === "function") {
    try {
      await deps.action.openPopup();
    } catch {
      // openPopup 不可用（版本 / 手势限制）：标记已写，静默降级
    }
  }
}
