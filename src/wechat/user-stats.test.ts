import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUserAnalysisUrl, type RawFollowerDay, toFollowerDays } from './user-stats.js';

test('buildUserAnalysisUrl uses the frontend all-source parameter', () => {
  const url = buildUserAnalysisUrl('token-1', '2026-05-28', '2026-06-03');

  assert.equal(url.pathname, '/misc/useranalysis');
  assert.equal(url.searchParams.get('begin_date'), '2026-05-28');
  assert.equal(url.searchParams.get('end_date'), '2026-06-03');
  assert.equal(url.searchParams.get('source'), '99999999');
  assert.equal(url.searchParams.get('indicatorSelect'), 'new_user');
  assert.equal(url.searchParams.get('f'), 'json');
  assert.equal(url.searchParams.get('token'), 'token-1');
  assert.equal(url.searchParams.get('lang'), 'zh_CN');
});

function raw(date: string, n: number, c: number, net: number, cum: number): RawFollowerDay {
  return { date, new_user: n, cancel_user: c, netgain_user: net, cumulate_user: cum };
}

test('toFollowerDays: 净增以累计日差为准,纠正滞后的接口 netgain', () => {
  // 模拟「抓得太早」的滞后数据:近几天 netgain 偏小(2/1),但累计快照已是 122/148。
  const days = toFollowerDays([
    raw('2026-06-04', 27, 0, 27, 94),
    raw('2026-06-05', 2, 0, 2, 122), // 接口滞后:netgain 2,但累计 94→122=+28
    raw('2026-06-07', 1, 0, 1, 148), // 累计 122→148=+26
  ]);
  // 首日无前值 → 回落接口 netgain
  assert.equal(days[0]?.netgain_user, 27);
  // 后续以累计差为准,不再信滞后的 2 / 1
  assert.equal(days[1]?.netgain_user, 28);
  assert.equal(days[2]?.netgain_user, 26);
  // 累计原样保留
  assert.equal(days[2]?.cumulate_user, 148);
});

test('toFollowerDays: 乱序输入按日期升序,净增逐日累计自洽', () => {
  const days = toFollowerDays([raw('2026-06-08', 18, 0, 18, 166), raw('2026-06-07', 18, 2, 16, 148)]);
  assert.deepEqual(
    days.map(d => d.date),
    ['2026-06-07', '2026-06-08']
  );
  assert.equal(days[1]?.netgain_user, 18); // 148→166
});
