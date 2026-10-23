import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config/index.js';
import {
  getAppletRevenueDays,
  getAppletRevenueOverviewBefore,
  openAppletDb,
  upsertAppletRevenueDaily,
  upsertAppletRevenueOverview,
  upsertAppletUserSnapshot,
} from './applets.js';
import { getDb, reopenDb } from './core.js';

test('applet revenue finds the closing total before a new month', () => {
  const dbPath = path.join(os.tmpdir(), `woa-applet-revenue-${process.pid}-${Date.now()}.db`);
  openAppletDb(dbPath);
  try {
    upsertAppletRevenueOverview(
      {
        capturedDay: '2026-08-01',
        appid: 'test-applet',
        totalCents: 978,
        yesterdayCents: 11,
        weekCents: 142,
        dateRangeStart: '2026-07-01',
        dateRangeEnd: '2026-07-31',
      },
      1
    );
    upsertAppletRevenueOverview(
      {
        capturedDay: '2026-08-02',
        appid: 'test-applet',
        totalCents: 49,
        yesterdayCents: 50,
        weekCents: 49,
        dateRangeStart: '2026-08-01',
        dateRangeEnd: '2026-08-01',
      },
      2
    );

    assert.equal(getAppletRevenueOverviewBefore('2026-08-01')?.total_cents, 978);
    assert.equal(getAppletRevenueOverviewBefore('2026-07-01'), null);
  } finally {
    reopenDb(config.dbPath);
  }
});

test('applet upserts reject blank appids before writing', () => {
  const dbPath = path.join(os.tmpdir(), `woa-applet-appid-${process.pid}-${Date.now()}.db`);
  openAppletDb(dbPath);
  try {
    assert.throws(
      () =>
        upsertAppletRevenueDaily(
          [
            { date: '2026-08-01', appid: 'test-applet', incomeCents: 1 },
            { date: '2026-08-02', appid: '   ', incomeCents: 2 },
          ],
          1
        ),
      /appid 不能为空/
    );
    assert.equal(getAppletRevenueDays().length, 0);

    assert.throws(
      () =>
        upsertAppletRevenueOverview(
          {
            capturedDay: '2026-08-01',
            appid: '',
            totalCents: 1,
            yesterdayCents: 1,
            weekCents: 1,
          },
          1
        ),
      /appid 不能为空/
    );
    assert.throws(
      () => upsertAppletUserSnapshot({ dataDate: '2026-08-01', appid: '\t', cumulativeUsers: 1 }, 1),
      /appid 不能为空/
    );
  } finally {
    reopenDb(config.dbPath);
  }
});

test('new applet tables reject blank appids at the schema boundary', () => {
  const dbPath = path.join(os.tmpdir(), `woa-applet-schema-${process.pid}-${Date.now()}.db`);
  openAppletDb(dbPath);
  try {
    assert.throws(
      () =>
        getDb()
          .prepare('INSERT INTO applet_revenue_daily (date, appid, income_cents, captured_at) VALUES (?, ?, ?, ?)')
          .run('2026-08-01', ' ', 1, 1),
      /CHECK constraint failed/
    );
    assert.throws(
      () =>
        getDb()
          .prepare(
            'INSERT INTO applet_revenue_overview (captured_day, appid, yesterday_cents, week_cents, total_cents, captured_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run('2026-08-01', '', 1, 1, 1, 1),
      /CHECK constraint failed/
    );
    assert.throws(
      () =>
        getDb()
          .prepare(
            'INSERT INTO applet_user_snapshots (data_date, appid, cumulative_users, captured_at) VALUES (?, ?, ?, ?)'
          )
          .run('2026-08-01', '\t', 1, 1),
      /CHECK constraint failed/
    );
  } finally {
    reopenDb(config.dbPath);
  }
});
