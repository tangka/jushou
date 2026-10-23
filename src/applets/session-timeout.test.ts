import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAppletFrame, probeAppletLogin } from './session.js';

const session = { token: 'fixture-token', cookieStr: 'fixture-cookie' };
test('小程序登录探测即使未传 signal 也有总时限', async t => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response('<title>测试小程序</title>');
  };
  assert.equal(await fetchAppletFrame(session), '<title>测试小程序</title>');
});

test('小程序探测保留调用方取消，取消不误报登录过期', async t => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const controller = new AbortController();
  controller.abort(new Error('请求已取消'));
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.signal?.aborted, true);
    throw init?.signal?.reason;
  };
  const probe = await probeAppletLogin(session, undefined, controller.signal);
  assert.equal(probe.state, 'unknown');
  assert.equal(probe.loggedIn, false);
});
