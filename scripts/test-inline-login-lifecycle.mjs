import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { InlineLoginLifecycle } from '../web/src/inline-login-lifecycle.ts';

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('卸载时中止未完成的 session 请求，迟到的返回不能更新或再排轮询', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lifecycle = new InlineLoginLifecycle();
  const run = lifecycle.restart();
  const response = deferred();
  let updates = 0;
  let polls = 0;
  const loading = (async () => {
    await response.promise;
    if (!run.active) return;
    updates += 1;
    run.schedule(() => polls++, 10);
  })();
  lifecycle.stop();
  assert.equal(run.signal.aborted, true);
  response.resolve({ status: 0 });
  await loading;
  // 即使旧代码直接尝试重排，生命周期自身仍拒绝旧 timer。
  run.schedule(() => polls++, 10);
  t.mock.timers.tick(100);
  assert.equal(updates, 0);
  assert.equal(polls, 0);
});

test('刷新二维码隔离新旧请求，旧 scan 成功也不能触发 bizlogin', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lifecycle = new InlineLoginLifecycle();
  const oldRun = lifecycle.restart();
  const response = deferred();
  const actions = [];
  const scanning = (async () => {
    const result = await response.promise;
    if (!oldRun.active) return;
    actions.push(result.status === 1 ? 'old-bizlogin' : 'old-poll');
  })();
  const current = lifecycle.restart();
  assert.equal(oldRun.signal.aborted, true);
  assert.equal(current.signal.aborted, false);
  current.schedule(() => actions.push('current-poll'), 10);
  response.resolve({ status: 1 });
  await scanning;
  t.mock.timers.tick(10);
  assert.deepEqual(actions, ['current-poll']);
  lifecycle.stop();
});

test('停止会中止在途 fetch，不把 AbortError 当成新的 UI 错误', async () => {
  const lifecycle = new InlineLoginLifecycle();
  const run = lifecycle.restart();
  let pending = 1;
  let errors = 0;
  const request = new Promise((_, reject) => {
    run.signal.addEventListener(
      'abort',
      () => {
        pending -= 1;
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true }
    );
  }).catch(() => {
    if (run.active) errors += 1;
  });
  lifecycle.stop();
  await request;
  assert.equal(pending, 0);
  assert.equal(errors, 0);
});

test('每轮只有一个 timer，运行中的异步轮询也不能在 stop 后复活', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lifecycle = new InlineLoginLifecycle();
  const run = lifecycle.restart();
  const response = deferred();
  let polls = 0;
  let finished;
  run.schedule(() => polls++, 10);
  run.schedule(() => {
    finished = response.promise.then(() => run.schedule(() => polls++, 10));
  }, 10);
  t.mock.timers.tick(10);
  assert.equal(polls, 0);
  lifecycle.stop();
  response.resolve();
  await finished;
  t.mock.timers.tick(100);
  assert.equal(polls, 0);
});

test('pagehide 与 effect cleanup 都停止请求和 timer，cleanup 移除监听', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lifecycle = new InlineLoginLifecycle();
  const page = new EventTarget();
  const cleanup = lifecycle.bindPageHide(page);
  const run = lifecycle.restart();
  let polls = 0;
  run.schedule(() => polls++, 10);
  page.dispatchEvent(new Event('pagehide'));
  assert.equal(run.signal.aborted, true);
  t.mock.timers.tick(100);
  assert.equal(polls, 0);
  const next = lifecycle.restart();
  cleanup();
  assert.equal(next.signal.aborted, true);
  const detached = lifecycle.restart();
  page.dispatchEvent(new Event('pagehide'));
  assert.equal(detached.active, true);
  lifecycle.stop();
});

test('成功后的延迟 reload 同样属于会话，卸载后不意外刷新其他页面', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lifecycle = new InlineLoginLifecycle();
  let reloads = 0;
  lifecycle.restart().schedule(() => reloads++, 800);
  lifecycle.stop();
  t.mock.timers.tick(1000);
  assert.equal(reloads, 0);
});

for (const file of ['inline-mp-login.tsx', 'inline-applet-login.tsx']) {
  test(`${file} pagehide 恢复可手动刷新，即使原状态为 confirming/success`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const source = readFileSync(new URL(`../web/src/${file}`, import.meta.url), 'utf8');
    // 执行组件真实的暂停回调，避免只验证 helper 而遗漏按钮状态恢复。
    const callback = source.match(/bindPageHide\(window, \(\) => \{([\s\S]*?)\}\)/)?.[1];
    assert.ok(callback);
    for (const initial of ['confirming', 'success']) {
      let phase = initial;
      let message = '';
      const pause = vm.runInNewContext(`() => {${callback}}`, {
        setPhase: value => {
          phase = value;
        },
        setMessage: value => {
          message = value;
        },
      });
      const lifecycle = new InlineLoginLifecycle();
      const page = new EventTarget();
      const cleanup = lifecycle.bindPageHide(page, pause);
      const run = lifecycle.restart();
      let requests = 0;
      run.schedule(() => requests++, 800);
      page.dispatchEvent(new Event('pagehide'));
      assert.equal(run.signal.aborted, true);
      assert.equal(phase === 'confirming' || phase === 'success', false);
      assert.match(message, /刷新二维码/);
      t.mock.timers.tick(1000);
      assert.equal(requests, 0);
      phase = 'loading';
      cleanup();
      assert.equal(phase, 'loading', '卸载 cleanup 不应调用更新状态的暂停回调');
    }
  });
}
