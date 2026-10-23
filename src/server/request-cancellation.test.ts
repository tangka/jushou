import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import test from 'node:test';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { loginRoutes } from './routes/login.js';
import { publicRoutes } from './routes/public.js';

test('旧无有效期扫码端点本地终止，不再向微信发起请求', async t => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => {
    throw new Error('不应访问上游');
  };
  for (const endpoint of ['/scan', '/getqrcode']) {
    const response = await loginRoutes.request(endpoint);
    assert.equal(response.status, 410);
    assert.match(await response.text(), /刷新整个页面/u);
  }
});

test('真实 HTTP 客户端断开时，正文代理中止上游而非继续等待', { timeout: 5000 }, async t => {
  const original = globalThis.fetch;
  let observedSignal: AbortSignal | null = null;
  let announceStart: () => void = () => {};
  let announceAbort: () => void = () => {};
  const started = new Promise<void>(resolve => {
    announceStart = resolve;
  });
  const aborted = new Promise<void>(resolve => {
    announceAbort = resolve;
  });
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      observedSignal = signal;
      signal.addEventListener(
        'abort',
        () => {
          announceAbort();
          reject(new Error('上游已取消'));
        },
        { once: true }
      );
      announceStart();
    });
  const app = new Hono().route('/', publicRoutes);
  app.onError((_error, c) => c.json({ error: '上游请求已终止' }, 502));
  const server = createServer(getRequestListener(app.fetch));
  t.after(async () => {
    globalThis.fetch = original;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const request = get(`http://127.0.0.1:${address.port}/download?url=https://mp.weixin.qq.com/s/test`);
  request.on('error', () => {});
  await started;
  request.destroy();
  await aborted;
  assert.equal((observedSignal as AbortSignal | null)?.aborted, true);
});
