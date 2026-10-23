import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeDailyIncome } from './dashboard-income.js';

test('mergeDailyIncome aggregates every source by date and sorts ascending', () => {
  assert.deepEqual(
    mergeDailyIncome([
      { date: '2025-01-02', groupCents: 50 },
      { date: '2025-01-01', mpCents: 100 },
      { date: '2025-01-01', mpCents: 20 },
      { date: '2025-01-01', appletCents: 30 },
      { date: '2025-01-01', groupCents: 400 },
      { date: '2025-01-02', expenseCents: 80 },
    ]),
    [
      {
        date: '2025-01-01',
        groupCents: 400,
        mpCents: 120,
        appletCents: 30,
        appletMembershipCents: 0,
        channelCents: 0,
        expenseCents: 0,
        totalCents: 550,
        netCents: 550,
      },
      {
        date: '2025-01-02',
        groupCents: 50,
        mpCents: 0,
        appletCents: 0,
        appletMembershipCents: 0,
        channelCents: 0,
        expenseCents: 80,
        totalCents: 50,
        netCents: -30,
      },
    ]
  );
});

test('membership income is an independent source counted exactly once in daily and monthly sums', () => {
  const rows = mergeDailyIncome([
    { date: '2025-02-05', appletMembershipCents: 100 },
    { date: '2025-02-28', groupCents: 200, appletMembershipCents: 300 },
    { date: '2025-02-28', appletMembershipCents: 80 },
    { date: '2025-02-28', appletCents: 50, mpCents: 60, channelCents: 10, expenseCents: 20 },
    { date: '2025-03-01', groupCents: 50 },
  ]);
  const septemberLast = rows[1];
  const octoberFirst = rows[2];
  assert.ok(septemberLast);
  assert.ok(octoberFirst);
  assert.equal(septemberLast.groupCents, 200);
  assert.equal(septemberLast.appletMembershipCents, 380);
  assert.equal(septemberLast.appletCents, 50);
  assert.equal(septemberLast.totalCents, 700);
  assert.equal(septemberLast.netCents, 680);
  const september = rows.filter(row => row.date.startsWith('2025-02-'));
  assert.equal(
    september.reduce((total, row) => total + row.appletMembershipCents, 0),
    480
  );
  assert.equal(
    september.reduce((total, row) => total + row.totalCents, 0),
    800
  );
  assert.equal(octoberFirst.appletMembershipCents, 0);
});
