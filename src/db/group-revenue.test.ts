import '../test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeTestOperatorProfile } from '../test-support/operator-profile-fixture.js';
import { reopenDb } from './core.js';
import { addGroupOrder, getGroupRevenueDays, getGroupRevenueSummary } from './group-revenue.js';

test('membership fees require both the exact service and its platform import marker', () => {
  reopenDb(':memory:');
  try {
    assert.deepEqual(getGroupRevenueSummary(), {
      entryCount: 0,
      entryCents: 0,
      serviceCount: 0,
      serviceCents: 0,
      totalCount: 0,
      totalCents: 0,
      groupCount: 0,
      groupCents: 0,
      appletMembershipCount: 0,
      appletMembershipCents: 0,
    });
    assert.deepEqual(getGroupRevenueDays(), []);

    const rows = [
      { date: '2025-08-31', kind: 'entry', amountCents: 100 },
      { date: '2025-09-12', kind: 'service', amountCents: 400, service: '示例工具会员' },
      {
        date: '2025-09-30',
        kind: 'service',
        amountCents: 1200,
        service: '示例工具会员',
        note: '平台净收入；SAMPLEVIP:wx1111111111111111:stable-order-hash',
      },
      {
        date: '2025-09-30',
        kind: 'service',
        amountCents: 350,
        service: '示例资料会员',
        note: 'DEMOIMPORT:2025-09:synthetic-order:1',
      },
      { date: '2025-09-30', kind: 'service', amountCents: 800, service: '社群升级' },
      { date: '2025-09-30', kind: 'service', amountCents: 400, service: '咨询费' },
      // 同金额、提及会员或备注命中都不是会员分类依据。
      { date: '2025-09-30', kind: 'service', amountCents: 400, service: '示例工具会员咨询' },
      { date: '2025-09-30', kind: 'entry', amountCents: 100, service: '示例工具会员' },
      { date: '2025-09-30', kind: 'service', amountCents: 500, note: '示例资料会员' },
    ] as const;
    for (const row of rows) addGroupOrder({ ...row, account: 'Example News' });

    const summary = getGroupRevenueSummary();
    assert.equal(summary.appletMembershipCount, 2);
    assert.equal(summary.appletMembershipCents, 1550);
    assert.equal(summary.groupCount, 7);
    assert.equal(summary.groupCents, 2700);
    assert.equal(summary.entryCents, 200);
    assert.equal(summary.serviceCents, 4050);
    assert.equal(summary.totalCount, rows.length);
    assert.equal(
      summary.totalCents,
      rows.reduce((total, row) => total + row.amountCents, 0)
    );
    assert.equal(summary.groupCount + summary.appletMembershipCount, summary.totalCount);
    assert.equal(summary.groupCents + summary.appletMembershipCents, summary.totalCents);

    const days = getGroupRevenueDays();
    assert.deepEqual(days, [
      { date: '2025-09-30', amount_cents: 3750, groupCents: 2200, appletMembershipCents: 1550 },
      { date: '2025-09-12', amount_cents: 400, groupCents: 400, appletMembershipCents: 0 },
      { date: '2025-08-31', amount_cents: 100, groupCents: 100, appletMembershipCents: 0 },
    ]);
    assert.deepEqual(getGroupRevenueDays(1), [days[0]]);
    assert.equal(
      days.reduce((sum, day) => sum + day.groupCents + day.appletMembershipCents, 0),
      summary.totalCents
    );
  } finally {
    reopenDb(':memory:');
  }
});

test('missing, mismatched or partial import markers keep manual fees in their original category', () => {
  reopenDb(':memory:');
  try {
    const rows = [
      { service: '示例工具会员', note: null },
      { service: '示例工具会员', note: 'DEMOIMPORT:2025-09:order-1' },
      { service: '示例资料会员', note: 'SAMPLEVIP:appid:order-1' },
      { service: '示例工具会员咨询', note: 'SAMPLEVIP:appid:order-1' },
      { service: '示例工具会员', note: '参考SAMPLEVIP:appid:order-1' },
      { service: '示例工具会员', note: 'SAMPLEVIP:' },
      { service: '示例资料会员', note: '平台收入；DEMOIMPORT:' },
    ];
    for (const row of rows) {
      addGroupOrder({
        date: '2025-09-12',
        account: 'Example News',
        kind: 'service',
        amountCents: 400,
        service: row.service,
        note: row.note ?? undefined,
      });
    }
    const summary = getGroupRevenueSummary();
    assert.equal(summary.appletMembershipCount, 0);
    assert.equal(summary.appletMembershipCents, 0);
    assert.equal(summary.groupCount, rows.length);
    assert.equal(summary.groupCents, summary.totalCents);
    assert.deepEqual(getGroupRevenueDays(), [
      {
        date: '2025-09-12',
        amount_cents: rows.length * 400,
        groupCents: rows.length * 400,
        appletMembershipCents: 0,
      },
    ]);
  } finally {
    reopenDb(':memory:');
  }
});

test('without configured membership rules even a marker-like note remains ordinary revenue', () => {
  writeTestOperatorProfile({ version: 1 });
  reopenDb(':memory:');
  try {
    addGroupOrder({
      date: '2025-01-01',
      account: 'example',
      kind: 'service',
      amountCents: 123,
      service: '示例工具会员',
      note: 'SAMPLEVIP:example:order-1',
    });
    assert.equal(getGroupRevenueSummary().appletMembershipCents, 0);
    assert.equal(getGroupRevenueDays()[0]?.groupCents, 123);
  } finally {
    writeTestOperatorProfile();
    reopenDb(':memory:');
  }
});
