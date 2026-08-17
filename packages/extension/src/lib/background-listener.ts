import { isWordsCollectedMessage } from "./messages.js";

/** background 记录的最近一次采集摘要（tracer bullet：先入 storage，T08 起改 IndexedDB）。 */
export interface LastCollection {
  count: number;
  at: string;
}

export interface BackgroundListenerDeps {
  recordCollection: (record: LastCollection) => void;
  /** 可注入时钟，默认 new Date()。 */
  now?: () => Date;
}

/**
 * service worker 的消息分发器：本张只消费 WORDS_COLLECTED（记一条摘要），
 * 不写 DB、不发 HTTP；其他消息一律忽略。
 */
export function createBackgroundListener(deps: BackgroundListenerDeps) {
  return (message: unknown, _sender: unknown, _sendResponse: unknown): boolean => {
    if (isWordsCollectedMessage(message)) {
      const at = (deps.now?.() ?? new Date()).toISOString();
      deps.recordCollection({ count: message.entries.length, at });
    }
    return false;
  };
}
