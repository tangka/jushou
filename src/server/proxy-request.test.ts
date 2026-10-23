import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { proxyMpRequest } from './proxy-request.js';

const TEST_TIMEOUT_MS = 100;
let server: Server;
let baseUrl = '';
const closedPaths = new Set<string>();

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.once('close', () => closedPaths.add(url.pathname));
    if (url.pathname === '/headers-stalled') return;
    if (url.pathname.startsWith('/body-')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('正文未结束');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.writeHead(201, {
      'Content-Type': 'application/json',
      'Set-Cookie': ['first=one; Path=/', 'second=two; Path=/'],
    });
    res.end(
      JSON.stringify({
        query: url.searchParams.get('count'),
        cookie: req.headers.cookie,
        encoding: req.headers['accept-encoding'],
        body: Buffer.concat(chunks).toString(),
      })
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
});

function isAbort(error: unknown): boolean {
  return error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
}

async function assertConnectionClosed(path: string): Promise<void> {
  const end = Date.now() + 1000;
  while (!closedPaths.has(path) && Date.now() < end) {
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.ok(closedPaths.has(path), `${path} 的上游连接应已释放`);
}

test('默认时限下保留请求内容、原始响应和多个 Set-Cookie', async () => {
  const response = await proxyMpRequest({
    method: 'POST',
    endpoint: `${baseUrl}/normal`,
    query: { count: 3 },
    body: { text: '中文', count: 2 },
    cookie: 'session=test',
  });
  assert.equal(response.status, 201);
  assert.deepEqual(response.headers.getSetCookie(), ['first=one; Path=/', 'second=two; Path=/']);
  assert.deepEqual(await response.json(), {
    query: '3',
    cookie: 'session=test',
    encoding: 'identity',
    body: 'text=%E4%B8%AD%E6%96%87&count=2',
  });
});

test('响应头一直未返回时，总时限中止并释放上游连接', async () => {
  await assert.rejects(
    proxyMpRequest({ method: 'GET', endpoint: `${baseUrl}/headers-stalled`, timeoutMs: TEST_TIMEOUT_MS }),
    isAbort
  );
  await assertConnectionClosed('/headers-stalled');
});

test('已经收到响应头但正文停滞时，总时限仍生效', async () => {
  const response = await proxyMpRequest({
    method: 'GET',
    endpoint: `${baseUrl}/body-deadline`,
    timeoutMs: TEST_TIMEOUT_MS,
  });
  assert.equal(response.status, 200);
  await assert.rejects(response.text(), isAbort);
  await assertConnectionClosed('/body-deadline');
});

test('调用方在读取正文期间取消，不必等待默认时限', async () => {
  const controller = new AbortController();
  const response = await proxyMpRequest({
    method: 'GET',
    endpoint: `${baseUrl}/body-caller`,
    signal: controller.signal,
  });
  const reading = response.text();
  controller.abort();
  await assert.rejects(reading, isAbort);
  await assertConnectionClosed('/body-caller');
});

test('调用前已经取消时，保持调用方的取消原因', async () => {
  const reason = new Error('调用方已结束');
  await assert.rejects(
    proxyMpRequest({ method: 'GET', endpoint: `${baseUrl}/pre-aborted`, signal: AbortSignal.abort(reason) }),
    error => error === reason
  );
  assert.equal(closedPaths.has('/pre-aborted'), false);
});

test('调用方放弃响应正文时，cancel 立即释放上游连接', async () => {
  const response = await proxyMpRequest({ method: 'GET', endpoint: `${baseUrl}/body-cancel` });
  await response.body?.cancel();
  await assertConnectionClosed('/body-cancel');
});
