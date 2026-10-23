import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWechatContentLinks, validateWechatLinkText } from './link-policy.js';

test('API event names are not partial domain matches', () => {
  for (const identifier of ['user.message', 'user.tool_confirmation', 'config.app_id', 'store.commerce']) {
    assert.doesNotThrow(() => validateWechatLinkText(`发送 ${identifier} 事件。`));
    assert.doesNotThrow(() => validateWechatContentLinks(`<p>发送 <code>${identifier}</code> 事件。</p>`));
  }
});

test('real external domains and links still fail closed', () => {
  for (const text of ['user.me', '访问user.me。', 'example.com/path', 'example.com.cn', 'https://user.message']) {
    assert.throws(() => validateWechatLinkText(text), /公众号链接白名单/u);
  }
  assert.throws(() => validateWechatContentLinks('<p><code>user.me</code></p>'), /公众号链接白名单/u);
  assert.throws(() => validateWechatContentLinks('<a href="https://user.message">事件</a>'), /公众号链接白名单/u);
  assert.doesNotThrow(() => validateWechatContentLinks('<a href="https://mp.weixin.qq.com/s/story">上一集</a>'));
});
