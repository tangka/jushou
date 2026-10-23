import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveChannelVideoTitle } from './title.js';

test('视频正文描述优先于短标题', () => {
  assert.equal(
    resolveChannelVideoTitle({
      description: '  7月26日 Codex 动态  ',
      shortTitle: [{ shortTitle: '备用短标题' }],
    }),
    '7月26日 Codex 动态'
  );
});

test('正文为空时读取视频号 shortTitle 数组', () => {
  assert.equal(
    resolveChannelVideoTitle({
      description: '',
      shortTitle: [{ shortTitle: 'Codex周刊：Voice' }],
    }),
    'Codex周刊：Voice'
  );
});

test('支持直接读取数据库里的 short_title_json', () => {
  assert.equal(
    resolveChannelVideoTitle({
      description: '',
      shortTitle: '[{"shortTitle":"7月25Codex：登录代理"}]',
    }),
    '7月25Codex：登录代理'
  );
});

test('不把 export 路径当成标题', () => {
  assert.equal(
    resolveChannelVideoTitle({
      description: 'export/UzFfBgAAxPSHWDNbBkO7jMzT4DCaOG0SHzfQVs',
      shortTitle: [],
    }),
    '未命名视频'
  );
});

test('坏 JSON 不会泄漏内部视频标识', () => {
  assert.equal(
    resolveChannelVideoTitle({
      description: '',
      shortTitle: '[{"shortTitle":',
    }),
    '未命名视频'
  );
});
