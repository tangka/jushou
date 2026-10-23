import assert from 'node:assert/strict';
import test from 'node:test';
import { renderServerLaunchd } from './generate-server-launchd.mjs';

const fixture = {
  label: 'org.example.dashboard',
  root: '/tmp/test & space',
  node: '/tmp/node/bin/node',
  profile: '/tmp/operator.json',
};
test('看板常驻服务持久使用 Interactive，直接执行且不复制私有配置内容', () => {
  const xml = renderServerLaunchd(fixture);
  assert.match(xml, /<key>ProcessType<\/key><string>Interactive<\/string>/);
  assert.match(xml, /<key>KeepAlive<\/key><true\/>/);
  assert.match(xml, /test &amp; space\/dist\/server\/index.js/);
  assert.match(xml, /<string>3333<\/string>/);
  assert.match(xml, /WECHAT_OPERATOR_PROFILE/);
  assert.doesNotMatch(xml, /\/bin\/(?:zsh|bash)|APPSECRET|LowPriorityIO|Nice/);
});
test('服务目标和端口 fail closed', () => {
  assert.throws(() => renderServerLaunchd({ ...fixture, label: 'bad label' }), /label/);
  assert.throws(() => renderServerLaunchd({ ...fixture, port: 0 }), /端口/);
  assert.throws(() => renderServerLaunchd({ ...fixture, node: 'node' }), /绝对路径/);
});
