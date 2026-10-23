import fs from 'node:fs/promises';
import path from 'node:path';
import { config, MP_BASE_URL, USER_AGENT } from '../config/index.js';
import { UpstreamError } from '../errors.js';
import { kvCookieSchema, loginStateSchema } from '../types/wechat.js';

export interface MpSession {
  token: string;
  cookieStr: string;
}

/** 读 login-state.json,校验并返回 authKey。 */
export async function loadAuthKey(): Promise<string> {
  const raw: unknown = JSON.parse(await fs.readFile(config.loginStatePath, 'utf8'));
  return loginStateSchema.parse(raw).authKey;
}

/**
 * 从 KV(`<NITRO_KV_BASE>/cookie/<authKey>`)读出同一 session 的 cookie + token。
 * cookie 与 token 必须同源,混用会被微信拒(uin=0,见 CLAUDE.md)。
 */
export async function loadMpSession(authKey: string): Promise<MpSession> {
  const kvFile = path.join(config.kvBase, 'cookie', authKey);
  const raw = await fs.readFile(kvFile, 'utf8').catch(() => null);
  if (!raw) {
    throw new Error(`Cookie 文件不存在:${kvFile}\n请先起服务、扫码登录后重试。`);
  }
  const { token, cookies } = kvCookieSchema.parse(JSON.parse(raw));
  const cookieStr = cookies
    .filter(c => c.value && c.value !== 'EXPIRED')
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
  return { token, cookieStr };
}

type MpParams = Record<string, string | number | null | undefined>;

/** 用 session 直连公众号后台,返回 HTML 文本(token/lang 自动补全)。 */
export async function fetchMpHtml(session: MpSession, pathname: string, params: MpParams): Promise<string> {
  const url = new URL(`${MP_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  if (!url.searchParams.has('token')) url.searchParams.set('token', session.token);
  if (!url.searchParams.has('lang')) url.searchParams.set('lang', 'zh_CN');

  const resp = await fetch(url, {
    headers: {
      Cookie: session.cookieStr,
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'identity',
    },
  });
  const text = await resp.text();
  if (!resp.ok) throw new UpstreamError(resp.status, `${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`);
  return text;
}
