import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveXSeenFile } from './collect.js';

test('X collection waterline uses the stable official-account AppID across display-name changes', () => {
  assert.equal(
    resolveXSeenFile('/tmp/wechat-official-account', 'wx-stable-account-id'),
    '/tmp/wechat-official-account/.data/x-seen-wx-stable-account-id.json'
  );
  assert.throws(() => resolveXSeenFile('/tmp/wechat-official-account', '  '), /缺少公众号 AppID/u);
});
