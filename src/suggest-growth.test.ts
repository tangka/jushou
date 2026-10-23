import './test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ContentGrowthData, GrowthArticle, GrowthSnapshot } from './db/content-growth.js';
import {
  analyzeContentGrowth,
  beijingDay,
  DEFAULT_GROWTH_POLICY,
  growthGroups,
  growthPolicyFromEnv,
  shiftDay,
  summarizeMetric,
} from './suggest-growth.js';
import { renderGrowthReport } from './suggest-report.js';

function article(id: number, overrides: Partial<GrowthArticle> = {}): GrowthArticle {
  return {
    id,
    title: `文章${id}`,
    url: null,
    publishDay: '2026-09-20',
    mediaType: '文章',
    contentType: '教程',
    subject: 'Codex',
    ...overrides,
  };
}

function point(id: number, day: string, overrides: Partial<GrowthSnapshot> = {}): GrowthSnapshot {
  return {
    articleId: id,
    capturedDay: day,
    capturedAt: 100,
    read: 100,
    follow: 5,
    share: 8,
    collection: 3,
    ...overrides,
  };
}

function data(articles: GrowthArticle[], snapshots: GrowthSnapshot[]): ContentGrowthData {
  return { articles, snapshots, latestSnapshotDay: '2026-10-10' };
}

test('时间窗只使用精确日历日快照，邻近与最新累计不能替代', () => {
  const rows = [article(1), article(2, { publishDay: '2026-10-09' }), article(3, { publishDay: '2026-07-01' })];
  const result = analyzeContentGrowth(
    data(rows, [
      point(1, '2026-09-22', { read: 10000 }),
      point(1, '2026-09-24', { read: 20000 }),
      point(1, '2026-09-27', { read: 300 }),
      point(1, '2026-10-10', { read: 30000 }),
    ]),
    'Example News',
    '2026-10-10'
  );
  assert.equal(result.cohorts[0].rows.length, 1);
  assert.equal(result.cohorts[0].metrics.read.sum, null);
  assert.equal(result.cohorts[0].metrics.read.median, null);
  assert.equal(result.cohorts[1].metrics.read.sum, 300);
  assert.equal(result.cohorts[0].fromDay, '2026-08-12');
  assert.equal(result.cohorts[0].throughDay, '2026-10-07');
  assert.equal(result.cohorts[1].throughDay, '2026-10-03');
});

test('缺失与真实0区分，关注率仅用同篇成对分母', () => {
  const rows = [
    { ...article(1), snapshot: point(1, '2026-09-23', { read: 100, follow: 10 }) },
    { ...article(2), snapshot: point(2, '2026-09-23', { read: 900, follow: null }) },
    { ...article(3), snapshot: point(3, '2026-09-23', { read: 0, follow: 0 }) },
    { ...article(4), snapshot: null },
  ];
  const follow = summarizeMetric(rows, 'follow');
  assert.equal(follow.sum, null);
  assert.equal(follow.observedSum, 10);
  assert.equal(follow.known, 2);
  assert.equal(follow.paired, 2);
  assert.equal(follow.rate, 0.1);
  assert.equal(summarizeMetric(rows, 'read').median, 100);
  const zero = summarizeMetric([rows[2] as NonNullable<(typeof rows)[2]>], 'follow');
  assert.equal(zero.sum, 0);
  assert.equal(zero.rate, null);
  assert.equal(summarizeMetric([], 'read').sum, null);
});

test('新近标签缺失时禁止排名，不能由全历史标签率掩盖', () => {
  const old = Array.from({ length: 90 }, (_, index) => article(index, { publishDay: '2026-07-01' }));
  const recent = Array.from({ length: 10 }, (_, index) => article(index + 100, { contentType: null, subject: null }));
  const result = analyzeContentGrowth(
    data(
      [...old, ...recent],
      recent.map(a => point(a.id, '2026-09-23'))
    ),
    'Example News',
    '2026-10-10'
  );
  assert.equal(result.globalLabels.rate, 0.9);
  assert.equal(result.recentLabels.rate, 0);
  assert.deepEqual(result.rankingBlocks, ['近期标签覆盖不足']);
  const md = renderGrowthReport(result, '2026-10-10 20:00');
  assert.match(md, /仅观察，不作优先级排名/);
  assert.doesNotMatch(md, /涨粉甜区|涨粉优先|\*\*贴图 · 教程/);
});

test('全体覆盖低时也停止排名；空数据和陈旧数据不会伪装成正常', () => {
  const old = Array.from({ length: 10 }, (_, id) => article(id, { publishDay: '2026-07-01', contentType: null }));
  const recent = article(100);
  const result = analyzeContentGrowth(data([...old, recent], [point(100, '2026-09-23')]), 'Example News', '2026-10-10');
  assert.ok(result.rankingBlocks.includes('全体标签覆盖不足'));
  const empty = analyzeContentGrowth(
    { articles: [], snapshots: [], latestSnapshotDay: null },
    'Example News',
    '2026-10-10'
  );
  assert.equal(empty.globalLabels.rate, null);
  assert.ok(empty.rankingBlocks.includes('数据过旧或没有快照'));
  assert.equal(empty.cohorts[0].metrics.read.median, null);
});

test('Example News主统计只含文章，历史高关注贴图不能生成默认载体建议', () => {
  const rows = [article(1), article(2, { mediaType: '贴图', subject: 'Anthropic' }), article(3, { mediaType: null })];
  const result = analyzeContentGrowth(
    data(rows, [point(1, '2026-09-23'), point(2, '2026-09-23', { follow: 80 })]),
    'Example News',
    '2026-10-10'
  );
  assert.equal(result.excludedMediaCount, 2);
  assert.equal(result.cohorts[0].rows.length, 1);
  assert.equal(result.globalLabels.total, 1);
  assert.equal(growthGroups(result, 'subject').length, 1);
  assert.match(renderGrowthReport(result, '2026-10-10 20:00'), /默认只写news文章/);
});

test('小样本高率组标记不足；合格组同时展示中位阅读与关注绝对数', () => {
  const tutorials = Array.from({ length: 6 }, (_, i) => article(i, { publishDay: `2026-09-${20 + i}` }));
  const rare = [article(10, { subject: 'Anthropic' }), article(11, { subject: 'Anthropic' })];
  const rows = [...tutorials, ...rare];
  const snapshots = rows.map(a =>
    point(a.id, shiftDay(a.publishDay ?? '', 3), {
      read: a.id < 6 ? (a.id === 0 ? 10000 : 200) : 20,
      follow: a.id < 6 ? 2 : 1,
    })
  );
  const result = analyzeContentGrowth(data(rows, snapshots), 'Example News', '2026-10-10');
  assert.deepEqual(result.rankingBlocks, []);
  const groups = growthGroups(result, 'subject');
  const small = groups.find(g => g.label === 'Anthropic');
  assert.ok(small?.blockers.includes('篇数少'));
  assert.ok(small?.blockers.includes('阅读样本少'));
  assert.equal(groups[0]?.label, 'Codex');
  assert.equal(groups[0]?.metrics.read.median, 200);
  assert.equal(groups[0]?.metrics.follow.sum, 12);
  assert.equal(small?.metrics.follow.sum, 2);
  const md = renderGrowthReport(result, '2026-10-10 20:00');
  assert.match(md, /关注绝对数/);
  assert.match(md, /分享UV/);
  assert.match(md, /收藏UV/);
  assert.doesNotMatch(md, /时段 \*\*18:00|涨粉甜区/);
});

test('缺失率字段采用成对覆盖，避免各80%却仅60%成对仍判合格', () => {
  const rows = Array.from({ length: 5 }, (_, i) => article(i));
  const points = rows.map(a =>
    point(a.id, '2026-09-23', { read: a.id === 0 ? null : 100, follow: a.id === 1 ? null : 1 })
  );
  const result = analyzeContentGrowth(data(rows, points), 'Example News', '2026-10-10');
  assert.ok(result.rankingBlocks.includes('D+3 follow字段覆盖不足'));
});

test('政策集中可配且校验；北京时间与进程时区无关', () => {
  assert.equal(growthPolicyFromEnv({ SUGGEST_LOOKBACK_DAYS: '30' }).lookbackDays, 30);
  assert.equal(growthPolicyFromEnv({}).lookbackDays, DEFAULT_GROWTH_POLICY.lookbackDays);
  assert.throws(() => growthPolicyFromEnv({ SUGGEST_LOOKBACK_DAYS: '300' }));
  assert.throws(() => growthPolicyFromEnv({ SUGGEST_MIN_LABEL_COVERAGE: '2' }));
  assert.equal(beijingDay(new Date('2026-10-09T16:30:00Z')), '2026-10-10');
  assert.equal(shiftDay('2026-09-30', 3), '2026-10-03');
});

test('未到D+3新稿单列观察日，不展示最新累计量或补零', () => {
  const rows = [
    article(1, { publishDay: '2026-10-07' }),
    article(2, { publishDay: '2026-10-08' }),
    article(3, { publishDay: '2026-10-09' }),
    article(4, { publishDay: '2026-10-10' }),
    article(5, { publishDay: '2026-10-11' }),
    article(6, { publishDay: null }),
    article(7, { publishDay: '2026-10-10', mediaType: '贴图' }),
  ];
  const result = analyzeContentGrowth(
    data(rows, [point(4, '2026-10-10', { read: 12345 })]),
    'Example News',
    '2026-10-10'
  );
  assert.deepEqual(
    result.immatureArticles.map(a => [a.id, a.observationDay]),
    [
      [4, '2026-10-13'],
      [3, '2026-10-12'],
      [2, '2026-10-11'],
    ]
  );
  assert.deepEqual(
    result.cohorts[0].rows.map(a => a.id),
    [1]
  );
  assert.equal(result.unknownPublishCount, 1);
  const md = renderGrowthReport(result, '2026-10-10 20:00');
  const section = md.split('## 新稿等待同龄观察')[1]?.split('## 同龄成熟内容')[0] ?? '';
  assert.match(section, /2026-10-10 \| 文章4 \| 2026-10-13/);
  assert.doesNotMatch(section, /12345|\| 0 \|/);
  assert.match(section, /未知绩效不补零/);
});

test('各观察窗分别计算已知均值和最高篇占比，缺失不进入分母', () => {
  const rows = [article(1), article(2), article(3), article(4)];
  const result = analyzeContentGrowth(
    data(rows, [
      point(1, '2026-09-23', { read: 100 }),
      point(2, '2026-09-23', { read: 900 }),
      point(3, '2026-09-23', { read: 0 }),
      point(1, '2026-09-27', { read: 500 }),
      point(2, '2026-09-27', { read: null }),
    ]),
    'Example News',
    '2026-10-10'
  );
  const [d3, d7] = result.cohorts;
  assert.equal(d3.metrics.read.sum, null);
  assert.equal(d3.readConcentration.knownMean, 1000 / 3);
  assert.deepEqual(d3.readConcentration.highestArticle, { id: 2, title: '文章2', read: 900 });
  assert.equal(d3.readConcentration.highestShare, 0.9);
  assert.equal(d7.readConcentration.knownMean, 500);
  assert.equal(d7.readConcentration.highestShare, 1);
  const md = renderGrowthReport(result, '2026-10-10 20:00');
  assert.match(md, /D\+3 \| 3\/4 \| 333\.33 \| 文章2 \| 900 \| 90\.00%/);
  assert.match(md, /缺快照\/字段时不代表整组/);
});

test('零阅读与没有已知阅读的集中度保持不同状态', () => {
  const result = analyzeContentGrowth(
    data([article(1)], [point(1, '2026-09-23', { read: 0 })]),
    'Example News',
    '2026-10-10'
  );
  assert.equal(result.cohorts[0].readConcentration.knownMean, 0);
  assert.equal(result.cohorts[0].readConcentration.highestArticle?.read, 0);
  assert.equal(result.cohorts[0].readConcentration.highestShare, null);
  assert.deepEqual(result.cohorts[1].readConcentration, { knownMean: null, highestArticle: null, highestShare: null });
});
