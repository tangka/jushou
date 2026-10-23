import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { z } from 'zod';
import { config } from '../config/index.js';
import { getAccountStatuses, probeMp, resolveAccount } from './account-registry.js';
import { buildApp } from './index.js';
import { checkLogin, loginRoutes } from './routes/login.js';

const targetName = 'ExampleDev';
const targetId = 'exampledev';
const loginResponseSchema = z.object({ err: z.string().optional(), nickname: z.string().optional() });
const savedStateSchema = z.object({
  authKey: z.string(),
  loginAccount: z.object({ nickname: z.string() }),
});

function loginFixture(t: TestContext, observedNickname = targetName) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-relogin-'));
  const loginStatePath = path.join(directory, 'login-state.json');
  const kvBase = path.join(directory, 'kv');
  const cookieDirectory = path.join(kvBase, 'cookie');
  const original = {
    envDir: config.envDir,
    fetch: globalThis.fetch,
    operatorProfile: process.env.WECHAT_OPERATOR_PROFILE,
  };
  const profilePath = path.join(directory, 'operator.local.json');
  fs.writeFileSync(profilePath, JSON.stringify({ version: 1, accounts: [] }));
  process.env.WECHAT_OPERATOR_PROFILE = profilePath;
  const initialState = JSON.stringify({
    authKey: 'existing-session',
    loginAccount: { nickname: targetName, avatar: '', expires: 'fixture' },
    savedAt: '2026-10-01T00:00:00.000Z',
  });
  fs.mkdirSync(cookieDirectory, { recursive: true });
  fs.writeFileSync(loginStatePath, initialState);
  fs.writeFileSync(
    path.join(cookieDirectory, 'existing-session'),
    JSON.stringify({ token: 'fixture-old-token', cookies: [{ name: 'session', value: 'fixture-old-cookie' }] })
  );
  fs.writeFileSync(
    path.join(directory, `.env.${targetId}`),
    `WECHAT_ACCOUNT_EXACT=${targetName}\nWECHAT_LOGIN_STATE=${loginStatePath}\nNITRO_KV_BASE=${kvBase}\n`
  );
  Object.assign(config, { envDir: directory });
  const account = resolveAccount(targetId);
  assert.ok(account);
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, 'https://mp.weixin.qq.com');
    requests.push(`${url.pathname}?${url.searchParams.get('action') ?? ''}`);
    if (url.pathname === '/cgi-bin/home') {
      return new Response(`wx.cgiData.nick_name = "${observedNickname}"; wx.cgiData.head_img = "";`);
    }
    if (url.pathname === '/cgi-bin/bizlogin' && url.searchParams.get('action') === 'startlogin') {
      return Response.json({ base_resp: { ret: 0 } }, { headers: { 'set-cookie': 'uuid=fixture-qr; Path=/' } });
    }
    if (url.pathname === '/cgi-bin/bizlogin' && url.searchParams.get('action') === 'login') {
      return Response.json(
        { redirect_url: '/cgi-bin/home?token=fixture-new-token' },
        { headers: { 'set-cookie': 'session=fixture-new-cookie; Path=/' } }
      );
    }
    throw new Error(`测试不允许其他上游请求:${url.pathname}`);
  };
  t.after(() => {
    Object.assign(config, { envDir: original.envDir });
    if (original.operatorProfile === undefined) delete process.env.WECHAT_OPERATOR_PROFILE;
    else process.env.WECHAT_OPERATOR_PROFILE = original.operatorProfile;
    globalThis.fetch = original.fetch;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { account, initialState, loginStatePath, requests };
}

test('账号中心重扫有效公众号会显示二维码，普通登录入口仍跳看板', async t => {
  const fixture = loginFixture(t);
  const accounts = await getAccountStatuses(targetId);
  for (const key of ['dbPath', 'loginStatePath', 'kvBase', 'chromePath'])
    assert.equal(key in (accounts[0] ?? {}), false);
  assert.equal(JSON.stringify(accounts).includes(path.dirname(fixture.loginStatePath)), false);
  const platform = accounts[0]?.platforms.find(item => item.key === 'mp');
  assert.ok(platform?.loginUrl);
  const loginUrl = new URL(platform.loginUrl, 'http://localhost');
  assert.equal(loginUrl.searchParams.get('account'), targetId);
  assert.equal(loginUrl.searchParams.get('relogin'), '1');

  const app = buildApp();
  const normal = await app.request(`http://localhost/?account=${targetId}`);
  assert.equal(normal.status, 302);
  assert.equal(normal.headers.get('Location'), `/dashboard/?account=${targetId}`);
  const requestsBeforeRescan = fixture.requests.length;
  const rescan = await app.request(loginUrl.href);
  assert.equal(rescan.status, 200);
  const html = await rescan.text();
  assert.match(html, /<title>ExampleDev<\/title>/u);
  assert.match(html, /<img id="qr"/u);
  assert.match(html, /微信公众号扫码登录/u);
  assert.equal(fixture.requests.length, requestsBeforeRescan);
  assert.equal(fs.readFileSync(fixture.loginStatePath, 'utf8'), fixture.initialState);
});

test('当前会话属于其他公众号时，登录检查与卡片状态都不能判有效', async t => {
  const fixture = loginFixture(t, 'ExampleNews');
  assert.equal((await checkLogin(fixture.account)).loggedIn, false);
  assert.notEqual(await probeMp(fixture.account), 'ok');
  const response = await buildApp().request(`http://localhost/?account=${targetId}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<img id="qr"/u);
  assert.equal(fs.readFileSync(fixture.loginStatePath, 'utf8'), fixture.initialState);
});

for (const inline of [false, true]) {
  const mode = inline ? '卡片内扫码' : '独立扫码页';
  test(`${mode}选错公众号时保留原登录态，不回种新认证Cookie`, async t => {
    const fixture = loginFixture(t, 'ExampleNews');
    const sid = `wrong-${inline}`;
    if (inline) {
      const session = await loginRoutes.request(`/inline/session/${sid}?account=${targetId}`, { method: 'POST' });
      assert.equal(session.status, 200);
    }
    const endpoint = inline ? `/inline/bizlogin/${sid}` : '/bizlogin';
    const response = await loginRoutes.request(`${endpoint}?account=${targetId}`, {
      method: 'POST',
      headers: { cookie: 'uuid=fixture-qr' },
    });
    const result = loginResponseSchema.parse(await response.json());
    assert.ok(result.err);
    assert.match(result.err, /ExampleDev/u);
    assert.match(result.err, /ExampleNews/u);
    assert.equal(result.nickname, undefined);
    assert.doesNotMatch(response.headers.get('set-cookie') ?? '', /auth-key=/u);
    assert.equal(fs.readFileSync(fixture.loginStatePath, 'utf8'), fixture.initialState);
  });

  test(`${mode}同号确认成功后才替换登录态`, async t => {
    const fixture = loginFixture(t);
    const sid = `correct-${inline}`;
    if (inline) {
      const session = await loginRoutes.request(`/inline/session/${sid}?account=${targetId}`, { method: 'POST' });
      assert.equal(session.status, 200);
    }
    const endpoint = inline ? `/inline/bizlogin/${sid}` : '/bizlogin';
    const response = await loginRoutes.request(`${endpoint}?account=${targetId}`, {
      method: 'POST',
      headers: { cookie: 'uuid=fixture-qr' },
    });
    const result = loginResponseSchema.parse(await response.json());
    assert.equal(result.err, undefined);
    assert.equal(result.nickname, targetName);
    assert.match(response.headers.get('set-cookie') ?? '', /auth-key=/u);
    const state = savedStateSchema.parse(JSON.parse(fs.readFileSync(fixture.loginStatePath, 'utf8')));
    assert.equal(state.loginAccount.nickname, targetName);
    assert.notEqual(state.authKey, 'existing-session');
    assert.equal((await checkLogin(fixture.account)).loggedIn, true);
  });
}
