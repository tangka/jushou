import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incomeChartSeries, monthlyIncome, sevenDayIncomeAverage } from '../web/src/home-income.ts';
import { refreshHomeLoginStatus } from '../web/src/home-login-status.ts';

function day(date, membership = 0) {
  const totalCents = 1000 + 2000 + 3000 + membership + 100;
  return {
    date,
    groupCents: 1000,
    mpCents: 2000,
    appletCents: 3000,
    appletMembershipCents: membership,
    channelCents: 100,
    expenseCents: 500,
    totalCents,
    netCents: totalCents - 500,
  };
}

test('日/月均单列小程序会员费，汇总不重复计入且不修改源数据', () => {
  const rows = [day('2026-09-29', 1000), day('2026-09-30', 1460), day('2026-10-01')];
  const snapshot = structuredClone(rows);
  const months = monthlyIncome(rows);
  assert.equal(months.length, 2);
  assert.equal(months[0].appletMembershipCents, 2460);
  assert.equal(months[0].groupCents, 2000);
  assert.equal(months[0].totalCents, 14660);
  assert.equal(months[0].netCents, 13660);
  for (const [data, period] of [
    [rows, 'day'],
    [months, 'month'],
  ]) {
    const series = incomeChartSeries(data, period);
    assert.equal(series.filter(line => line.name === '小程序会员费').length, 1);
    assert.deepEqual(
      series.find(line => line.name === '小程序会员费').data,
      data.map(row => row.appletMembershipCents / 100)
    );
    assert.deepEqual(
      series.find(line => line.name === '总收入').data,
      data.map(row => row.totalCents / 100)
    );
    assert.ok(series.some(line => line.name === '小程序广告'));
  }
  assert.deepEqual(rows, snapshot);
});

test('7日均线保持原始总收入口径，缺少历史不补零', () => {
  const rows = Array.from({ length: 7 }, (_, i) => day(`2026-09-${String(20 + i)}`, 100));
  assert.deepEqual(sevenDayIncomeAverage(rows), [null, null, null, null, null, null, 62]);
});

test('后台登录检查按账号ID合并且失败不清空财务数据', async t => {
  let home = {
    accounts: [
      { id: 'example-one', mp: 'unknown' },
      { id: 'example-two', mp: 'unknown' },
    ],
    applets: [{ id: 'example-app', login: 'unknown' }],
    totals: { totalCents: 12300 },
  };
  const setHome = update => {
    home = update(home);
  };
  const controller = new AbortController();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({
      accounts: [
        { id: 'example-two', mp: 'expired' },
        { id: 'example-one', mp: 'ok' },
      ],
      applets: [{ id: 'example-app', login: 'ok' }],
    }),
  }));
  await refreshHomeLoginStatus(setHome, controller.signal);
  assert.equal(home.accounts[0].mp, 'ok');
  assert.equal(home.accounts[1].mp, 'expired');
  assert.equal(home.applets[0].login, 'ok');
  const loaded = home;
  fetchMock.mock.mockImplementation(async () => {
    throw new Error('timeout');
  });
  await refreshHomeLoginStatus(setHome, controller.signal);
  assert.equal(home, loaded);
  assert.equal(home.totals.totalCents, 12300);
});

test('切换页面后取消的登录检查不能覆盖现有页面', async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => {
    controller.abort();
    return { ok: true, json: async () => ({ accounts: [], applets: [] }) };
  });
  let updated = false;
  await refreshHomeLoginStatus(() => {
    updated = true;
  }, controller.signal);
  assert.equal(updated, false);
});
