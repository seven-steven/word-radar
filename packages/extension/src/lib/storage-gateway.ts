/**
 * chrome.storage 可注入网关工厂（settings.ts / error-log.ts 共用）。
 *
 * 两模块原本各持一份同构三件套——chrome.storage 实现、读写丢弃的 fallback、
 * typeof chrome 探测三选一——收敛为这里的单一实现；storage area 以参数传入
 * （当前两处皆 local），统一产出含 remove 的最小面（TS 结构类型下多出的
 * remove 不违反 {get,set} 形状的接口）。chrome.* 调用收在可注入网关后面，
 * 便于单测（同 settings.ts / action-badge.ts 的边界模块约定）。
 *
 * open-reason.ts 的 session 网关形态不同（get 返回整袋、按键写入），不经
 * 本工厂。
 */

/** chrome.storage 的最小可注入网关面（统一含 remove）。 */
export interface StorageGateway {
  remove(key: string): Promise<void>;
  get(key: string): Promise<unknown>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** 网关绑定的 storage area（本仓库用 local；session 为 MV3 同族 area）。 */
export type StorageGatewayArea = "local" | "session";

/** 绑定指定 area 的 chrome.storage 实现（各方法调用时才触碰 chrome.*）。 */
export function chromeStorageGateway(area: StorageGatewayArea): StorageGateway {
  return {
    remove(key: string): Promise<void> {
      return chrome.storage[area].remove(key);
    },
    get(key: string): Promise<unknown> {
      return chrome.storage[area]
        .get(key)
        .then((items) => (items as Record<string, unknown>)[key]);
    },
    set(items: Record<string, unknown>): Promise<void> {
      return chrome.storage[area].set(items);
    },
  };
}

/** 测试等无 chrome 环境下的兜底（读写丢弃，移除操作同样丢弃，永不出错）。 */
export const fallbackStorageGateway: StorageGateway = {
  remove: async () => undefined,
  get: async () => undefined,
  set: async () => undefined,
};

/** typeof chrome 探测三选一：有对应 area 用真网关，否则兜底。 */
export function defaultStorageGateway(area: StorageGatewayArea): StorageGateway {
  return typeof chrome !== "undefined" && chrome.storage?.[area]
    ? chromeStorageGateway(area)
    : fallbackStorageGateway;
}
