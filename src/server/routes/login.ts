import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { loginStateSchema } from '../../types/wechat.js';
import { type AccountEnv, resolveAccount } from '../account-registry.js';
import { AccountCookie } from '../cookie-store.js';
import { proxyMpRequest } from '../proxy-request.js';

const MP = 'https://mp.weixin.qq.com';

const bizLoginRespSchema = z.object({ redirect_url: z.string().optional() }).passthrough();
const inlineLoginSessions = new Map<string, { cookie: string; createdAt: number }>();
const INLINE_LOGIN_TTL_MS = 10 * 60 * 1000;

interface AccountInfo {
  nick_name: string;
  head_img: string;
}

function inlineSessionKey(account: AccountEnv, sid: string): string {
  return `${account.id}:${sid}`;
}

function upstreamCookieHeader(setCookies: string[]): string {
  return setCookies
    .map(item => item.split(';')[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ');
}

function pruneInlineSessions(): void {
  const now = Date.now();
  for (const [key, value] of inlineLoginSessions) {
    if (now - value.createdAt > INLINE_LOGIN_TTL_MS) inlineLoginSessions.delete(key);
  }
}

function readInlineSession(account: AccountEnv, sid: string): { cookie: string; createdAt: number } | null {
  pruneInlineSessions();
  return inlineLoginSessions.get(inlineSessionKey(account, sid)) ?? null;
}

async function readAccountCookie(authKey: string, account?: AccountEnv): Promise<AccountCookie | null> {
  if (!account) {
    return null;
  }

  try {
    const raw = JSON.parse(await fs.readFile(path.join(account.kvBase, 'cookie', authKey), 'utf8')) as {
      token: string;
      cookies: Parameters<typeof AccountCookie.create>[1];
    };
    return AccountCookie.create(raw.token, raw.cookies);
  } catch {
    return null;
  }
}

async function writeAccountCookie(
  account: AccountEnv,
  authKey: string,
  token: string,
  cookies: string[]
): Promise<boolean> {
  try {
    const stored = new AccountCookie(token, cookies);
    const file = path.join(account.kvBase, 'cookie', authKey);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(stored.toJSON()));
    return true;
  } catch {
    return false;
  }
}

function routeAccount(queryValue: string | undefined): AccountEnv | null {
  return resolveAccount(queryValue);
}

async function readAuthKey(account: AccountEnv): Promise<string> {
  const raw = JSON.parse(await fs.readFile(account.loginStatePath, 'utf8')) as unknown;
  return loginStateSchema.parse(raw).authKey;
}

/** 登录成功后取公众号昵称/头像(读首页内联的 wx.cgiData)。 */
async function getAccountInfo(authKey: string, account?: AccountEnv, signal?: AbortSignal): Promise<AccountInfo> {
  const stored = await readAccountCookie(authKey, account);
  const token = stored?.token ?? null;
  const cookie = stored?.toString() ?? null;
  if (!token || !cookie) return { nick_name: '', head_img: '' };

  const html = await proxyMpRequest({
    signal,
    method: 'GET',
    endpoint: `${MP}/cgi-bin/home`,
    query: { t: 'home/index', token, lang: 'zh_CN' },
    cookie,
  }).then(r => r.text());

  const nick = html.match(/wx\.cgiData\.nick_name\s*?=\s*?"(?<v>[^"]+)"/)?.groups?.v ?? '';
  const img = html.match(/wx\.cgiData\.head_img\s*?=\s*?"(?<v>[^"]+)"/)?.groups?.v ?? '';
  return { nick_name: nick, head_img: img };
}

/** 检查当前登录态是否有效(读存储的 authKey → 打 home 看有无 nick_name)。给 `/` 自动跳转用。 */
export async function checkLogin(
  account?: AccountEnv | null,
  signal?: AbortSignal
): Promise<{ loggedIn: boolean; nickname: string; avatar: string }> {
  try {
    const picked = account ?? resolveAccount(undefined);
    if (!picked) return { loggedIn: false, nickname: '', avatar: '' };
    const authKey = await readAuthKey(picked);
    const info = await getAccountInfo(authKey, picked, signal);
    return { loggedIn: info.nick_name === picked.account, nickname: info.nick_name, avatar: info.head_img };
  } catch {
    return { loggedIn: false, nickname: '', avatar: '' };
  }
}

/** 把 authKey + 账号信息写入 login-state.json(采集脚本据此找 KV cookie)。 */
async function writeLoginState(
  target: AccountEnv | null,
  authKey: string,
  loginAccount: { nickname: string; avatar: string; expires: string }
): Promise<void> {
  const state = { authKey, loginAccount, savedAt: new Date().toISOString() };
  const loginStatePath = target ? target.loginStatePath : config.loginStatePath;
  await fs.mkdir(path.dirname(loginStatePath), { recursive: true });
  await fs.writeFile(loginStatePath, JSON.stringify(state, null, 2));
}

export const loginRoutes = new Hono();

// 新建登录会话:微信下发 uuid(set-cookie),透传给浏览器供后续扫码用
loginRoutes.post('/session/:sid', async c => {
  const sid = c.req.param('sid');
  const resp = await proxyMpRequest({
    signal: c.req.raw.signal,
    method: 'POST',
    endpoint: `${MP}/cgi-bin/bizlogin`,
    query: { action: 'startlogin' },
    body: {
      userlang: 'zh_CN',
      redirect_url: '',
      login_type: 3,
      sessionid: sid,
      token: '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
  });
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const sc of resp.headers.getSetCookie()) {
    if (sc.startsWith('uuid=')) headers.append('set-cookie', sc);
  }
  return new Response(await resp.text(), { status: resp.status, headers });
});

// 卡片内公众号扫码:服务端保存微信下发的 uuid cookie,避免多账号二维码互相覆盖。
loginRoutes.post('/inline/session/:sid', async c => {
  const account = routeAccount(c.req.query('account'));
  if (!account) return c.json({ err: '账号不存在' }, 404);
  const sid = c.req.param('sid');
  const resp = await proxyMpRequest({
    signal: c.req.raw.signal,
    method: 'POST',
    endpoint: `${MP}/cgi-bin/bizlogin`,
    query: { action: 'startlogin' },
    body: {
      userlang: 'zh_CN',
      redirect_url: '',
      login_type: 3,
      sessionid: sid,
      token: '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
  });
  const text = await resp.text();
  const cookie = upstreamCookieHeader(resp.headers.getSetCookie());
  if (cookie) {
    pruneInlineSessions();
    inlineLoginSessions.set(inlineSessionKey(account, sid), { cookie, createdAt: Date.now() });
  }
  return new Response(text, { status: resp.status, headers: { 'Content-Type': 'application/json' } });
});

loginRoutes.get('/inline/getqrcode/:sid', async c => {
  const account = routeAccount(c.req.query('account'));
  if (!account) return c.json({ err: '账号不存在' }, 404);
  const session = readInlineSession(account, c.req.param('sid'));
  if (!session) return c.json({ err: '登录会话已过期,请刷新二维码' }, 410);
  const resp = await proxyMpRequest({
    signal: c.req.raw.signal,
    method: 'GET',
    endpoint: `${MP}/cgi-bin/scanloginqrcode`,
    query: { action: 'getqrcode', random: Date.now() },
    cookie: session.cookie,
  });
  return new Response(await resp.arrayBuffer(), {
    status: resp.status,
    headers: { 'Content-Type': resp.headers.get('content-type') || 'image/png' },
  });
});

loginRoutes.get('/inline/scan/:sid', async c => {
  const account = routeAccount(c.req.query('account'));
  if (!account) return c.json({ err: '账号不存在' }, 404);
  const session = readInlineSession(account, c.req.param('sid'));
  if (!session) return c.json({ err: '登录会话已过期,请刷新二维码' }, 410);
  const resp = await proxyMpRequest({
    signal: c.req.raw.signal,
    method: 'GET',
    endpoint: `${MP}/cgi-bin/scanloginqrcode`,
    query: { action: 'ask', token: '', lang: 'zh_CN', f: 'json', ajax: 1 },
    cookie: session.cookie,
  });
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { 'Content-Type': 'application/json' },
  });
});

loginRoutes.post('/inline/bizlogin/:sid', async c => {
  const account = routeAccount(c.req.query('account'));
  if (!account) return c.json({ err: '账号不存在' }, 404);
  const sid = c.req.param('sid');
  const session = readInlineSession(account, sid);
  if (!session) return c.json({ err: '登录会话已过期,请刷新二维码' }, 410);
  const resp = await proxyMpRequest({
    signal: c.req.raw.signal,
    method: 'POST',
    endpoint: `${MP}/cgi-bin/bizlogin`,
    query: { action: 'login' },
    body: {
      userlang: 'zh_CN',
      redirect_url: '',
      cookie_forbidden: 0,
      cookie_cleaned: 0,
      plugin_used: 0,
      login_type: 3,
      token: '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    cookie: session.cookie,
  });
  const setCookies = resp.headers.getSetCookie();
  const parsed = bizLoginRespSchema.safeParse(JSON.parse(await resp.text()));
  const redirectUrl = parsed.success ? parsed.data.redirect_url : undefined;
  if (!redirectUrl) return c.json({ err: '登录失败,请稍后重试' });

  const token = new URL(`http://localhost${redirectUrl}`).searchParams.get('token');
  if (!token) return c.json({ err: '登录失败:redirect_url 中未取到 token' });

  const authKey = randomUUID().replaceAll('-', '');
  if (!(await writeAccountCookie(account, authKey, token, setCookies))) {
    return c.json({ err: 'cookie 写入 KV 失败' });
  }

  const info = await getAccountInfo(authKey, account, c.req.raw.signal);
  if (!info.nick_name) return c.json({ err: '获取公众号昵称失败,请稍后重试' });
  if (info.nick_name !== account.account) {
    return c.json(
      { err: `扫码账号不匹配：需要 ${account.account}，实际为 ${info.nick_name}。请重新扫码选择正确账号。` },
      409
    );
  }

  const expires = new Date(Date.now() + 4 * 24 * 3600 * 1000).toUTCString();
  await writeLoginState(account, authKey, { nickname: info.nick_name, avatar: info.head_img, expires });
  inlineLoginSessions.delete(inlineSessionKey(account, sid));

  c.header('Set-Cookie', `auth-key=${authKey}; Path=/; HttpOnly`, { append: true });
  return c.json({ nickname: info.nick_name, avatar: info.head_img, expires });
});

// 独立页也已改用有账号隔离和 TTL 的 inline 会话。旧标签不得无限向微信轮询。
for (const route of ['/getqrcode', '/scan']) {
  loginRoutes.get(route, c => c.json({ err: '旧登录页面已失效，请刷新整个页面后重新扫码' }, 410));
}

// 确认登录:取 token、存 cookie、写 login-state.json、回种 auth-key
loginRoutes.post('/bizlogin', async c => {
  const account = routeAccount(c.req.query('account'));
  if (!account) return c.json({ err: '账号不存在' });
  const cookie = c.req.header('cookie') ?? null;
  const resp = await proxyMpRequest({
    signal: c.req.raw.signal,
    method: 'POST',
    endpoint: `${MP}/cgi-bin/bizlogin`,
    query: { action: 'login' },
    body: {
      userlang: 'zh_CN',
      redirect_url: '',
      cookie_forbidden: 0,
      cookie_cleaned: 0,
      plugin_used: 0,
      login_type: 3,
      token: '',
      lang: 'zh_CN',
      f: 'json',
      ajax: 1,
    },
    cookie,
  });
  const setCookies = resp.headers.getSetCookie();

  const parsed = bizLoginRespSchema.safeParse(JSON.parse(await resp.text()));
  const redirectUrl = parsed.success ? parsed.data.redirect_url : undefined;
  if (!redirectUrl) return c.json({ err: '登录失败,请稍后重试' });

  const token = new URL(`http://localhost${redirectUrl}`).searchParams.get('token');
  if (!token) return c.json({ err: '登录失败:redirect_url 中未取到 token' });

  const authKey = randomUUID().replaceAll('-', '');
  if (!(await writeAccountCookie(account, authKey, token, setCookies))) {
    return c.json({ err: 'cookie 写入 KV 失败' });
  }

  const info = await getAccountInfo(authKey, account, c.req.raw.signal);
  if (!info.nick_name) return c.json({ err: '获取公众号昵称失败,请稍后重试' });
  if (info.nick_name !== account.account) {
    return c.json(
      { err: `扫码账号不匹配：需要 ${account.account}，实际为 ${info.nick_name}。请重新扫码选择正确账号。` },
      409
    );
  }

  const expires = new Date(Date.now() + 4 * 24 * 3600 * 1000).toUTCString();
  await writeLoginState(account, authKey, { nickname: info.nick_name, avatar: info.head_img, expires });

  c.header('Set-Cookie', `auth-key=${authKey}; Path=/; HttpOnly`, { append: true });
  return c.json({ nickname: info.nick_name, avatar: info.head_img, expires });
});
