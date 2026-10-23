/** 微信请求总时限包含建立连接、响应头和响应正文；个别调用可显式缩短。 */
export const WECHAT_REQUEST_TIMEOUT_MS = 30_000;

export function wechatRequestSignal(signal?: AbortSignal, timeoutMs = WECHAT_REQUEST_TIMEOUT_MS): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}
