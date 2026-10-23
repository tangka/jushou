import assert from 'node:assert/strict';
import test from 'node:test';
import { assertChannelAccountIdentity, channelAccountNames } from './account-identity.js';

function capture(names: string[]): { json: unknown } {
  return {
    json: {
      data: {
        bindInfo: names.map(name => ({ type: 1, bizInfo: { name } })),
      },
    },
  };
}

test('从 post_list.bindInfo 提取当前视频号绑定账号', () => {
  assert.deepEqual(channelAccountNames([capture(['ExampleDev'])]), ['ExampleDev']);
});

test('账号匹配时允许继续', () => {
  assert.equal(assertChannelAccountIdentity([capture(['ExampleDev'])], 'ExampleDev'), 'ExampleDev');
});

test('扫到另一个账号时在写入前硬失败', () => {
  assert.throws(
    () => assertChannelAccountIdentity([capture(['ExampleNews'])], 'ExampleDev'),
    /视频号账号不匹配:期望 ExampleDev,实际 ExampleNews;拒绝写入/
  );
});

test('缺少账号身份或返回多个绑定账号时 fail closed', () => {
  assert.throws(() => assertChannelAccountIdentity([{ json: { data: {} } }], 'ExampleDev'), /无法核对视频号账号/);
  assert.throws(
    () => assertChannelAccountIdentity([capture(['ExampleDev', 'ExampleNews'])], 'ExampleDev'),
    /视频号账号不匹配/
  );
});
