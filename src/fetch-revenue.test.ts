import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateSlotIncomeDays } from './fetch-revenue.js';

test('overview 缺广告位时按 income 明细聚合每日收益并限制日期范围', () => {
  const rows = aggregateSlotIncomeDays(
    [
      { date: '2026-07-01', slotid: 'a', income_cents: 10 },
      { date: '2026-07-01', slotid: 'b', income_cents: 20 },
      { date: '2026-07-02', slotid: 'a', income_cents: 30 },
      { date: '2026-08-01', slotid: 'a', income_cents: 99 },
    ],
    '2026-07-01',
    '2026-07-31'
  );

  assert.deepEqual(rows, [
    { date: '2026-07-01', income_cents: 30 },
    { date: '2026-07-02', income_cents: 30 },
  ]);
});
