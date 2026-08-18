import { isCollectWordsMessage, type CollectResponse } from "./messages.js";

export type SendResponse = (response: CollectResponse) => void;

/**
 * content script 的消息分发器：只响应 COLLECT_WORDS。
 * 采集编排异步化（await SW 的 WORDS_COLLECTED ack → 入库完成后才应答），
 * 所以 listener 持有消息通道（return true）。
 */
export function createContentListener(
  runCollection: () => Promise<CollectResponse>,
) {
  return (
    message: unknown,
    _sender: unknown,
    sendResponse: SendResponse,
  ): boolean => {
    if (!isCollectWordsMessage(message)) return false;
    // runCollection 签名已保证返回 Promise；尾 catch 吞掉 sendResponse
    // 在断开端口上抛出的错误，避免 unhandled rejection。
    runCollection()
      .then(sendResponse, (error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      .catch(() => undefined);
    return true;
  };
}
