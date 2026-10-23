import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { renderAppletLoginPage } from './applet-login-page.js';
import { LOGIN_PAGE } from './login-page.js';
import { LOGIN_PAGE_REQUEST_TIMEOUT_MS, LOGIN_PAGE_SESSION_TTL_MS } from './login-page-script.js';

class Element extends EventTarget {
  style: Record<string, string> = {};
  textContent = '';
  className = '';
  src = '';
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
}

interface FetchCall {
  url: string;
  signal: AbortSignal;
  method: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function pendingResponse() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

function harness(kind: 'mp' | 'applet', respond: (call: FetchCall) => Promise<Response>) {
  const target = 'account/a & b';
  const html = kind === 'mp' ? LOGIN_PAGE : renderAppletLoginPage(target, '小程序');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const elements = { qr: new Element(), msg: new Element(), refresh: new Element() };
  const page = Object.assign(new EventTarget(), {
    location: { search: `?account=${encodeURIComponent(target)}`, href: '' },
  });
  const calls: FetchCall[] = [];
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  vm.runInNewContext(script, {
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    window: page,
    URLSearchParams,
    AbortController,
    Error,
    Date: { now: () => now },
    Math,
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    fetch: (url: string, options: { signal: AbortSignal; method: string }) => {
      const call = { url, ...options };
      calls.push(call);
      return respond(call);
    },
  });
  return {
    target,
    calls,
    elements,
    page,
    timers,
    refresh: () => elements.refresh.dispatchEvent(new Event('click')),
    async advance(delay: number) {
      const end = now + delay;
      for (;;) {
        const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!first || first[1].at > end) break;
        now = first[1].at;
        timers.delete(first[0]);
        first[1].callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

const success = () => json({ base_resp: { ret: 0 }, status: 0 });

for (const kind of ['mp', 'applet'] as const) {
  test(`${kind} 独立页使用实际生成 script，所有步骤携带相同 sid 和正确账号`, async () => {
    const page = harness(kind, async call => {
      if (call.url.includes('/scan/')) return json({ base_resp: { ret: 0 }, status: 1 });
      if (call.url.includes('/bizlogin/')) return json({ nickname: '正确账号' });
      return success();
    });
    await flush();
    await page.advance(2000);
    const urls = [...page.calls.map(call => call.url), page.elements.qr.src].map(
      url => new URL(url, 'http://localhost')
    );
    const sid = urls[0]?.pathname.split('/').at(-1);
    assert.ok(sid);
    for (const url of urls) {
      assert.equal(url.searchParams.get(kind === 'mp' ? 'account' : 'applet'), page.target);
      assert.equal(url.pathname.split('/').at(-1), sid);
      assert.ok(url.pathname.startsWith(kind === 'mp' ? '/api/web/login/inline/' : '/api/web/applet-login/'));
    }
    assert.equal(page.calls.length, 3);
    await page.advance(600);
    assert.equal(
      new URL(page.page.location.href, 'http://localhost').searchParams.get(kind === 'mp' ? 'account' : 'applet'),
      page.target
    );
    assert.equal(page.timers.size, 0);
  });

  test(`${kind} pending session 刷新会 abort，旧响应不能覆盖新二维码或再排 timer`, async () => {
    const old = pendingResponse();
    let sessions = 0;
    const page = harness(kind, async () => (++sessions === 1 ? old.promise : success()));
    page.refresh();
    await flush();
    const qr = page.elements.qr.src;
    const timers = page.timers.size;
    assert.equal(page.calls[0]?.signal.aborted, true);
    assert.notEqual(page.calls[0]?.url, page.calls[1]?.url);
    old.resolve(success());
    await flush();
    assert.equal(page.elements.qr.src, qr);
    assert.equal(page.timers.size, timers);
    page.page.dispatchEvent(new Event('pagehide'));
    assert.equal(page.timers.size, 0);
  });

  test(`${kind} pending scan 后刷新，旧扫码成功不得触发 bizlogin`, async () => {
    const old = pendingResponse();
    const page = harness(kind, async call => (call.url.includes('/scan/') ? old.promise : success()));
    await flush();
    await page.advance(2000);
    const scan = page.calls.find(call => call.url.includes('/scan/'));
    assert.ok(scan);
    page.refresh();
    await flush();
    old.resolve(json({ base_resp: { ret: 0 }, status: 1 }));
    await flush();
    assert.equal(scan.signal.aborted, true);
    assert.equal(
      page.calls.some(call => call.url.includes('/bizlogin/')),
      false
    );
    page.page.dispatchEvent(new Event('pagehide'));
    assert.equal(page.timers.size, 0);
  });

  test(`${kind} pagehide 中止 pending 请求且晚到的返回不复活`, async () => {
    const old = pendingResponse();
    const page = harness(kind, async () => old.promise);
    page.page.dispatchEvent(new Event('pagehide'));
    assert.equal(page.calls[0]?.signal.aborted, true);
    assert.equal(page.elements.refresh.style.display, 'inline-block');
    assert.equal(page.timers.size, 0);
    old.resolve(success());
    await flush();
    await page.advance(LOGIN_PAGE_SESSION_TTL_MS);
    assert.equal(page.calls.length, 1);
    assert.equal(page.elements.qr.src, '');
    assert.equal(page.timers.size, 0);
  });

  test(`${kind} pending bizlogin 在离开页面后不能更新状态或跳转`, async () => {
    const old = pendingResponse();
    const page = harness(kind, async call => {
      if (call.url.includes('/bizlogin/')) return old.promise;
      if (call.url.includes('/scan/')) return json({ base_resp: { ret: 0 }, status: 1 });
      return success();
    });
    await flush();
    await page.advance(2000);
    const confirmingMessage = page.elements.msg.textContent;
    page.page.dispatchEvent(new Event('pagehide'));
    assert.equal(page.calls.at(-1)?.signal.aborted, true);
    old.resolve(json({ nickname: '正确账号' }));
    await flush();
    await page.advance(600);
    assert.equal(page.page.location.href, '');
    assert.equal(page.elements.msg.textContent, confirmingMessage);
    assert.equal(page.timers.size, 0);
  });

  test(`${kind} 410/非零返回/二维码过期/网络错误都终止，不无限重试`, async () => {
    for (const result of [
      () => json({ err: '过期' }, 410),
      () => json({ base_resp: { ret: 200003 } }),
      () => json({ base_resp: { ret: 0 }, status: 2 }),
      () => {
        throw new Error('网络失败');
      },
    ]) {
      const page = harness(kind, async call => (call.url.includes('/scan/') ? result() : success()));
      await flush();
      await page.advance(2000);
      assert.equal(page.timers.size, 0);
      assert.equal(page.elements.refresh.style.display, 'inline-block');
      await page.advance(LOGIN_PAGE_SESSION_TTL_MS);
      assert.equal(page.calls.length, 2);
    }
  });

  test(`${kind} 本地 10 分钟 TTL 到期停止，不能永久轮询`, async () => {
    const page = harness(kind, async () => success());
    await flush();
    await page.advance(LOGIN_PAGE_SESSION_TTL_MS);
    assert.match(page.elements.msg.textContent, /会话已过期/);
    assert.equal(page.timers.size, 0);
    assert.equal(page.calls.at(-1)?.signal.aborted, true);
    const count = page.calls.length;
    await page.advance(LOGIN_PAGE_SESSION_TTL_MS);
    assert.equal(page.calls.length, count);
  });

  test(`${kind} 网络挂住有短超时，abort 并清空 TTL/poll timer`, async () => {
    const page = harness(kind, async () => new Promise<Response>(() => {}));
    await page.advance(LOGIN_PAGE_REQUEST_TIMEOUT_MS);
    assert.equal(page.calls[0]?.signal.aborted, true);
    assert.match(page.elements.msg.textContent, /请求超时/);
    assert.equal(page.timers.size, 0);
  });
}

test('小程序标识不会逃逸脚本标签', () => {
  const html = renderAppletLoginPage('</script><script>alert(1)</script>', '<群>');
  assert.equal((html.match(/<script>/g) ?? []).length, 1);
  assert.match(html, /&lt;群&gt;/);
});
