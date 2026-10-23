import assert from 'node:assert/strict';
import test from 'node:test';
import { DashboardLoginCache } from './dashboard-login-status.js';

test('冷缓存读取立即返回 unknown，不发起网络请求', () => {
  const cache = new DashboardLoginCache();
  assert.equal(cache.read('mp:one', 'version-1'), 'unknown');
  assert.equal(cache.read('applet:one', 'version-1'), 'unknown');
});

test('并发检查复用同一请求，短期结果命中缓存', async () => {
  const cache = new DashboardLoginCache();
  let calls = 0;
  let complete: (value: 'ok') => void = () => {};
  const probe = async () => {
    calls += 1;
    return new Promise<'ok'>(resolve => {
      complete = resolve;
    });
  };
  const first = cache.refresh('mp:one', 'v1', probe);
  const second = cache.refresh('mp:one', 'v1', probe);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(cache.read('mp:one', 'v1'), 'unknown');
  complete('ok');
  assert.equal(await first, 'ok');
  assert.equal(await cache.refresh('mp:one', 'v1', probe), 'ok');
  assert.equal(calls, 1);
  assert.equal(cache.read('mp:one', 'v1'), 'ok');
});

test('缓存过期和显式刷新重新探测，旧状态不当实时状态', async () => {
  let now = 0;
  const cache = new DashboardLoginCache(100, 1000, () => now);
  let calls = 0;
  const probe = async () => {
    calls += 1;
    return 'ok' as const;
  };
  await cache.refresh('mp:one', 'v1', probe);
  await cache.refresh('mp:one', 'v1', probe, true);
  assert.equal(calls, 2);
  now = 100;
  assert.equal(cache.read('mp:one', 'v1'), 'unknown');
  await cache.refresh('mp:one', 'v1', probe);
  assert.equal(calls, 3);
});

test('扫码更新版本立即失效，旧请求不会覆盖新登录结果', async () => {
  const cache = new DashboardLoginCache();
  let finishOld: (value: 'expired') => void = () => {};
  const old = cache.refresh(
    'mp:one',
    'v1',
    async () =>
      new Promise<'expired'>(resolve => {
        finishOld = resolve;
      })
  );
  await Promise.resolve();
  await cache.refresh('mp:one', 'v2', async () => 'ok');
  assert.equal(cache.read('mp:one', 'v1'), 'unknown');
  assert.equal(cache.read('mp:one', 'v2'), 'ok');
  finishOld('expired');
  await old;
  assert.equal(cache.read('mp:one', 'v2'), 'ok');
});

test('超时会中止网络，并返回 unknown 而不是 expired', async () => {
  const cache = new DashboardLoginCache(100, 10);
  let signal: AbortSignal | undefined;
  const result = await cache.refresh('applet:one', 'v1', async provided => {
    signal = provided;
    return new Promise<never>(() => {});
  });
  assert.equal(result, 'unknown');
  assert.equal(signal?.aborted, true);
});

test('单个平台失败不污染其他账号与小程序的独立状态', async () => {
  const cache = new DashboardLoginCache();
  const results = await Promise.all([
    cache.refresh('mp:one', 'v1', async () => {
      throw new Error('网络失败');
    }),
    cache.refresh('mp:two', 'v1', async () => 'ok'),
    cache.refresh('applet:one', 'v1', async () => 'expired'),
  ]);
  assert.deepEqual(results, ['unknown', 'ok', 'expired']);
  assert.equal(cache.read('mp:one', 'v1'), 'unknown');
  assert.equal(cache.read('mp:two', 'v1'), 'ok');
  assert.equal(cache.read('applet:one', 'v1'), 'expired');
});
