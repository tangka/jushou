import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdSlotNamesConfig } from './ad-slot-names.js';

const OFTEN_VIEW_LIST_SLOT_ID = '7325953122329732';

test('未配置名称时常看列表广告使用已核实的中文名', () => {
  for (const value of [undefined, '', '  ', '{}']) {
    assert.equal(parseAdSlotNamesConfig(value)[OFTEN_VIEW_LIST_SLOT_ID], '常看列表广告');
  }
});

test('分号及换行配置保留原广告位名称并补齐常看列表广告', () => {
  const names = parseAdSlotNamesConfig('5156210557287366=留言区广告;9020229299926746=文中广告\ncustom=自定义广告');
  assert.equal(names[OFTEN_VIEW_LIST_SLOT_ID], '常看列表广告');
  assert.equal(names['5156210557287366'], '留言区广告');
  assert.equal(names['9020229299926746'], '文中广告');
  assert.equal(names.custom, '自定义广告');
});

test('JSON配置保留原广告位名称并补齐常看列表广告', () => {
  const names = parseAdSlotNamesConfig('{"72058780271891663":"底部广告"}');
  assert.equal(names[OFTEN_VIEW_LIST_SLOT_ID], '常看列表广告');
  assert.equal(names['72058780271891663'], '底部广告');
});

test('账号显式配置优先且不污染其他账号', () => {
  for (const value of [
    `${OFTEN_VIEW_LIST_SLOT_ID}=本号名称`,
    JSON.stringify({ [OFTEN_VIEW_LIST_SLOT_ID]: '本号名称' }),
  ]) {
    assert.equal(parseAdSlotNamesConfig(value)[OFTEN_VIEW_LIST_SLOT_ID], '本号名称');
    assert.equal(parseAdSlotNamesConfig(undefined)[OFTEN_VIEW_LIST_SLOT_ID], '常看列表广告');
  }
  assert.notEqual(parseAdSlotNamesConfig(undefined), parseAdSlotNamesConfig(undefined));
});

test('不为未核实的广告位编造名称', () => {
  assert.equal(parseAdSlotNamesConfig(undefined).unverified, undefined);
});

test('无效名称配置继续明确报错', () => {
  for (const value of ['invalid', '=缺少编号', 'id=', '{bad json}', '{"id":""}', '{"id":1}']) {
    assert.throws(() => parseAdSlotNamesConfig(value), /WECHAT_AD_SLOT_NAMES 配置无效/);
  }
});
