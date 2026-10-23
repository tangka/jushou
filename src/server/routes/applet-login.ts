import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { probeAppletLogin } from '../../applets/session.js';
import { config } from '../../config/index.js';
import { AccountCookie } from '../cookie-store.js';
import { proxyMpRequest } from '../proxy-request.js';

const MP = 'https://mp.weixin.qq.com';

const bizLoginRespSchema = z.object({ redirect_url: z.string().optional() }).passthrough();
type AppletLoginTarget = (typeof config.appletRegistry)[number];

const inlineLoginSessions = new Map<string, { cookie: string; createdAt: number; target: AppletLoginTarget }>();
const INLINE_LOGIN_TTL_MS = 10 * 60 * 1000;

function upstreamCookieHeader(setCookies: string[]): string {
  return setCookies
    .map(item => item.split(';')[0]?.trim() ?? '')
    .filter(Boolean)
    .join('; ');
}

function pruneInlineSessions(): void {
  const now = Date.now();
  for (const [sid, value] of inlineLoginSessions) {
    if (now - value.createdAt > INLINE_LOGIN_TTL_MS) inlineLoginSessions.delete(sid);
  }
}

function readInlineSession(sid: string): { cookie: string; createdAt: number; target: AppletLoginTarget } | null {
  pruneInlineSessions();
  return inlineLoginSessions.get(sid) ?? null;
}

function resolveAppletTarget(appletId: string | undefined): AppletLoginTarget | null {
  const effectiveId = appletId ?? config.appletRegistry[0]?.id;
  return config.appletRegistry.find(applet => applet.id === effectiveId) ?? null;
}

async function writeAppletCookie(
  target: AppletLoginTarget,
  authKey: string,
  token: string,
  cookies: string[]
): Promise<void> {
  const stored = new AccountCookie(token, cookies);
  const file = path.join(target.kvBase, 'cookie', authKey);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(stored.toJSON()));
}

async function writeAppletLoginState(target: AppletLoginTarget, authKey: string): Promise<void> {
  const state = {
    authKey,
    loginAccount: {
      nickname: target.name,
      avatar: '',
      expires: new Date(Date.now() + 4 * 24 * 3600 * 1000).toUTCString(),
    },
    savedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(target.loginStatePath), { recursive: true });
  await fs.writeFile(target.loginStatePath, JSON.stringify(state, null, 2));
}

export const appletLoginRoutes = new Hono();

appletLoginRoutes.post('/session/:sid', async c => {
  const sid = c.req.param('sid');
  const target = resolveAppletTarget(c.req.query('applet'));
  if (!target) return c.json({ err: '小程序配置不存在' }, 404);
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
    inlineLoginSessions.set(sid, { cookie, createdAt: Date.now(), target });
  }
  return new Response(text, { status: resp.status, headers: { 'Content-Type': 'application/json' } });
});

appletLoginRoutes.get('/getqrcode/:sid', async c => {
  const session = readInlineSession(c.req.param('sid'));
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

appletLoginRoutes.get('/scan/:sid', async c => {
  const session = readInlineSession(c.req.param('sid'));
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

appletLoginRoutes.post('/bizlogin/:sid', async c => {
  const sid = c.req.param('sid');
  const session = readInlineSession(sid);
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
  const probe = await probeAppletLogin(
    { token, cookieStr: new AccountCookie(token, setCookies).toString() },
    undefined,
    c.req.raw.signal
  );
  if (!probe.loggedIn) {
    return c.json({ err: `小程序后台校验失败:${probe.reason}。请刷新后重新扫码,手机端选择小程序账号。` });
  }

  await writeAppletCookie(session.target, authKey, token, setCookies);
  await writeAppletLoginState(session.target, authKey);
  inlineLoginSessions.delete(sid);
  return c.json({
    nickname: session.target.name,
    appletId: session.target.id,
    title: probe.title,
    expires: new Date(Date.now() + 4 * 24 * 3600 * 1000).toUTCString(),
  });
});
