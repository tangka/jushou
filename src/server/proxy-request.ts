import { wechatRequestSignal } from '../config/http.js';
import { USER_AGENT } from '../config/index.js';

interface ProxyOptions {
  method: 'GET' | 'POST';
  endpoint: string;
  query?: Record<string, string | number>;
  body?: Record<string, string | number>;
  /** 显式转发的 cookie 字符串(登录 uuid / 已存 cookie)。 */
  cookie?: string | null;
  signal?: AbortSignal;
  /** 覆盖本次请求的总时限，响应正文读取也受此限制。 */
  timeoutMs?: number;
}

function toStringRecord(input: Record<string, string | number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) out[key] = String(value);
  return out;
}

/**
 * 转发一个微信公众平台请求,返回原始 Web Response(set-cookie / body 由调用方处理)。
 * 固定带上 mp 需要的 Referer/Origin/UA,并禁用压缩避免 clone 问题。
 */
export function proxyMpRequest(options: ProxyOptions): Promise<Response> {
  const headers = new Headers({
    Referer: 'https://mp.weixin.qq.com/',
    Origin: 'https://mp.weixin.qq.com',
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'identity',
  });
  if (options.cookie) headers.set('Cookie', options.cookie);

  let endpoint = options.endpoint;
  if (options.query) endpoint += `?${new URLSearchParams(toStringRecord(options.query)).toString()}`;

  // 原生 timeout 不保持进程存活；无需应用自行维护定时器或取消监听器。
  // 保留 fetch 原始 Response，让同一 signal 持续覆盖 body，而不是收到 headers 就清除时限。
  const signal = wechatRequestSignal(options.signal, options.timeoutMs);
  const init: RequestInit = { method: options.method, headers, redirect: 'follow', signal };
  if (options.method === 'POST' && options.body) {
    init.body = new URLSearchParams(toStringRecord(options.body)).toString();
  }
  return fetch(endpoint, init);
}
