/**
 * 右键菜单唤起标记（issue #40 v1.1-T3，决议 B1/B3/B4）。
 *
 * chrome.action.openPopup() 没有「为什么打开」的参数，两个右键菜单入口靠
 * SW 侧写入 chrome.storage.session 的 openReason 标记区分：
 * - SW（lib/context-menu.ts）：点击菜单项 → recordOpenReason → openPopup()；
 * - popup（consumeOpenReason）：boot 时读到即清（先清后执行，防采集/聚焦
 *   中断后残留、下次点图标误触发），"collect" → 自动采集，"upload" →
 *   直达上传画布。
 *
 * 点工具栏图标打开的 popup 不经过该路径——无标记 → 默认态（不采集，issue
 * #39 v1.1-T2），不受标记影响；标记只在右键菜单路径写入、popup 一次性消费。
 * 存 chrome.storage.session：SW 被杀标记仍在，浏览器会话结束自然失效。
 *
 * chrome.storage.session 调用收在可注入网关后面（同 settings.ts /
 * action-badge.ts 的边界模块约定），便于单测。
 */

/** chrome.storage.session 的标记键。 */
export const OPEN_REASON_KEY = "openReason";

/** 菜单入口 → popup 打开后的动作。 */
export type OpenReason = "collect" | "upload";

/** chrome.storage.session 的最小可注入面（SW 写标记 / popup 读 + 清）。 */
export interface OpenReasonSession {
  get(key: string): Promise<Record<string, unknown>>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** 默认 chrome.storage.session 实现。 */
export const chromeOpenReasonSession: OpenReasonSession = {
  get: (key) => chrome.storage.session.get(key),
  set: (key, value) => chrome.storage.session.set({ [key]: value }),
  remove: (key) => chrome.storage.session.remove(key),
};

/**
 * SW 侧写入唤起标记（context-menu.ts 的点击处理器调用）。尽力而为：写失败
 * 不阻断 openPopup——popup 将呈默认态，但仍有「弹窗打开了」的反馈。
 */
export async function recordOpenReason(
  session: OpenReasonSession,
  reason: OpenReason,
): Promise<void> {
  await session.set(OPEN_REASON_KEY, reason);
}

/**
 * popup 侧一次性消费：读到标记先清后返回（一次性语义，非法值同样清掉，
 * 不留脏数据）；键不存在返回 null（默认态，什么都不做）。
 */
export async function consumeOpenReason(
  session: OpenReasonSession,
): Promise<OpenReason | null> {
  const bag = await session.get(OPEN_REASON_KEY);
  if (!(OPEN_REASON_KEY in bag)) return null;
  const raw = bag[OPEN_REASON_KEY];
  await session.remove(OPEN_REASON_KEY);
  return raw === "collect" || raw === "upload" ? raw : null;
}
