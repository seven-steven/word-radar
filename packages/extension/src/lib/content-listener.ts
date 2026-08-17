import { isCollectWordsMessage, type CollectResponse } from "./messages.js";

export type SendResponse = (response: CollectResponse) => void;

/**
 * content script 的消息分发器：只响应 COLLECT_WORDS，
 * 同步执行采集编排并 sendResponse；异常兜底为 {ok:false}。
 * 其他消息一律不响应（返回 false，不持有消息通道）。
 */
export function createContentListener(runCollection: () => CollectResponse) {
  return (
    message: unknown,
    _sender: unknown,
    sendResponse: SendResponse,
  ): boolean => {
    if (!isCollectWordsMessage(message)) return false;
    try {
      sendResponse(runCollection());
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  };
}
