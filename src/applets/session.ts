import fs from 'node:fs/promises';
import path from 'node:path';
import { wechatRequestSignal } from '../config/http.js';
import { config, USER_AGENT } from '../config/index.js';
import { kvCookieSchema, loginStateSchema } from '../types/wechat.js';

const WXOPEN_FRAME = 'https://mp.weixin.qq.com/wxopen/frame';

export interface AppletSession {
  token: string;
  cookieStr: string;
}

export interface AppletLoginProbe {
  state: 'ok' | 'expired' | 'unknown';
  loggedIn: boolean;
  reason: string;
  title: string;
}

export interface AppletSessionStorage {
  loginStatePath: string;
  kvBase: string;
}

function cookieString(cookies: { name: string; value?: string }[]): string {
  return cookies
    .filter(c => c.value && c.value !== 'EXPIRED')
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

export async function loadAppletAuthKey(storage: AppletSessionStorage = config.applets): Promise<string> {
  const raw: unknown = JSON.parse(await fs.readFile(storage.loginStatePath, 'utf8'));
  return loginStateSchema.parse(raw).authKey;
}

export async function loadAppletSession(
  authKey?: string,
  storage: AppletSessionStorage = config.applets
): Promise<AppletSession> {
  const effectiveAuthKey = authKey ?? (await loadAppletAuthKey(storage));
  const kvFile = path.join(storage.kvBase, 'cookie', effectiveAuthKey);
  const raw = await fs.readFile(kvFile, 'utf8').catch(() => null);
  if (!raw) {
    throw new Error(`小程序 Cookie 文件不存在:${kvFile}\n请先打开 /applet-login 扫码登录。`);
  }
  const { token, cookies } = kvCookieSchema.parse(JSON.parse(raw));
  return { token, cookieStr: cookieString(cookies) };
}

export function appletFrameUrl(token: string, page = 'applet/data_stat'): string {
  const url = new URL(WXOPEN_FRAME);
  url.searchParams.set('t', 'promotion/promotion_frame');
  url.searchParams.set('page', page);
  url.searchParams.set('token', token);
  url.searchParams.set('lang', 'zh_CN');
  return url.toString();
}

export async function fetchAppletFrame(
  session: AppletSession,
  page = 'applet/data_stat',
  signal?: AbortSignal
): Promise<string> {
  const resp = await fetch(appletFrameUrl(session.token, page), {
    headers: {
      Cookie: session.cookieStr,
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'identity',
    },
    redirect: 'follow',
    signal: wechatRequestSignal(signal),
  });
  const html = await resp.text();
  if (!resp.ok) throw new Error(`小程序后台返回 ${resp.status}: ${html.slice(0, 200)}`);
  return html;
}

export async function probeAppletLogin(
  session?: AppletSession,
  storage: AppletSessionStorage = config.applets,
  signal?: AbortSignal
): Promise<AppletLoginProbe> {
  try {
    const effectiveSession = session ?? (await loadAppletSession(undefined, storage));
    const html = await fetchAppletFrame(effectiveSession, undefined, signal);
    const title = html.match(/<title>(?<title>[^<]*)<\/title>/i)?.groups?.title?.trim() ?? '';
    if (/登录超时|重新\s*登录|扫码登录/.test(html)) {
      return { state: 'expired', loggedIn: false, reason: '登录超时', title };
    }
    if (/发生错误/.test(html)) {
      return { state: 'unknown', loggedIn: false, reason: '小程序后台返回错误页', title };
    }
    return { state: 'ok', loggedIn: true, reason: 'ok', title };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const state = /Cookie 文件不存在|ENOENT|no such file|登录状态/i.test(reason) ? 'expired' : 'unknown';
    return { state, loggedIn: false, reason, title: '' };
  }
}
