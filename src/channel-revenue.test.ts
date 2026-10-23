import assert from 'node:assert/strict';
import test from 'node:test';
import { parseChannelRevenueSetArgs } from './channel-revenue.js';

test('parseChannelRevenueSetArgs parses an interval total in yuan', () => {
  assert.deepEqual(parseChannelRevenueSetArgs(['0.46', '2026-07-01', '2026-07-15', '微信后台']), {
    totalCents: 46,
    periodStart: '2026-07-01',
    periodEnd: '2026-07-15',
    note: '微信后台',
  });
});

test('parseChannelRevenueSetArgs requires amount and both dates', () => {
  assert.throws(() => parseChannelRevenueSetArgs(['0.001', '2026-07-01', '2026-07-15']), /金额非法/);
  assert.throws(() => parseChannelRevenueSetArgs(['0.46', '2026-07-01']), /缺收益区间/);
});
