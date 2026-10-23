import assert from 'node:assert/strict';
import test from 'node:test';
import { probeAppletLogin } from './session.js';

test('小程序登录页判为过期', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response('<title>微信公众平台</title>登录超时,请重新登录');

  const probe = await probeAppletLogin({ token: 'token', cookieStr: 'cookie=value' });
  assert.equal(probe.state, 'expired');
  assert.equal(probe.loggedIn, false);
});

test('小程序探测网络失败不误判为过期', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error('fetch failed');
  };

  const probe = await probeAppletLogin({ token: 'token', cookieStr: 'cookie=value' });
  assert.equal(probe.state, 'unknown');
  assert.equal(probe.loggedIn, false);
});

test('小程序错误页即使包含 wxopen 资源也不误判为已登录', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response('<title>小程序</title><script src="/wxopen/assets/app.js"></script>发生错误，请返回首页');

  const probe = await probeAppletLogin({ token: 'token', cookieStr: 'cookie=value' });
  assert.equal(probe.state, 'unknown');
  assert.equal(probe.loggedIn, false);
  assert.equal(probe.reason, '小程序后台返回错误页');
});

test('小程序登录探测向实际网络请求传递取消信号', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const controller = new AbortController();
  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    assert.equal(signal.aborted, false);
    controller.abort(new Error('fixture cancellation'));
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason, controller.signal.reason);
    return new Response('<title>小程序</title>后台');
  };
  const probe = await probeAppletLogin({ token: 'token', cookieStr: 'cookie=value' }, undefined, controller.signal);
  assert.equal(probe.state, 'ok');
});
