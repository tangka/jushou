import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config/index.js';
import { getChannelRevenueDays, getChannelRevenueSummary, reopenDb, setChannelRevenueSnapshot } from './index.js';

test('channel interval snapshots become non-duplicated totals and daily deltas', () => {
  const dbPath = path.join(os.tmpdir(), `woa-channel-revenue-${process.pid}-${Date.now()}.db`);
  reopenDb(dbPath);
  try {
    setChannelRevenueSnapshot({ periodStart: '2026-07-01', periodEnd: '2026-07-15', totalCents: 46 });
    setChannelRevenueSnapshot({ periodStart: '2026-07-01', periodEnd: '2026-07-31', totalCents: 100 });
    setChannelRevenueSnapshot({ periodStart: '2026-08-01', periodEnd: '2026-08-15', totalCents: 30 });
    setChannelRevenueSnapshot({ periodStart: '2026-07-01', periodEnd: '2026-07-15', totalCents: 46 });

    assert.deepEqual(getChannelRevenueSummary(), {
      snapshotCount: 3,
      periodCount: 2,
      totalCents: 130,
      latestPeriodEnd: '2026-08-15',
    });
    assert.deepEqual(getChannelRevenueDays(), [
      { date: '2026-08-15', amount_cents: 30 },
      { date: '2026-07-31', amount_cents: 54 },
      { date: '2026-07-15', amount_cents: 46 },
    ]);
    assert.throws(
      () => setChannelRevenueSnapshot({ periodStart: '2026-07-20', periodEnd: '2026-07-19', totalCents: 1 }),
      /区间非法/
    );
  } finally {
    reopenDb(config.dbPath);
  }
});
