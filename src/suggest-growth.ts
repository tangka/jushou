import { z } from 'zod';
import { accountPolicy } from './config/account-policy.js';
import type { ContentGrowthData, GrowthArticle, GrowthSnapshot } from './db/content-growth.js';

// 经验性证据门槛集中管理；它们不是显著性检验，也不代表最优策略。
export const DEFAULT_GROWTH_POLICY = {
  lookbackDays: 60,
  recentDays: 30,
  minLabelCoverage: 0.8,
  minSnapshotCoverage: 0.8,
  minMetricCoverage: 0.8,
  minGroupArticles: 5,
  minGroupReads: 1000,
  minGroupDates: 3,
  maxDataAgeDays: 2,
  exampleLimit: 12,
} as const;

const policySchema = z.object({
  lookbackDays: z.coerce.number().int().min(30).max(60),
  recentDays: z.coerce.number().int().min(1).max(30),
  minLabelCoverage: z.coerce.number().min(0).max(1),
  minSnapshotCoverage: z.coerce.number().min(0).max(1),
  minMetricCoverage: z.coerce.number().min(0).max(1),
  minGroupArticles: z.coerce.number().int().min(2),
  minGroupReads: z.coerce.number().int().positive(),
  minGroupDates: z.coerce.number().int().min(2),
  maxDataAgeDays: z.coerce.number().int().nonnegative(),
  exampleLimit: z.coerce.number().int().min(1).max(30),
});
export type GrowthPolicy = z.infer<typeof policySchema>;

export function growthPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): GrowthPolicy {
  const fields: Record<keyof GrowthPolicy, string> = {
    lookbackDays: 'SUGGEST_LOOKBACK_DAYS',
    recentDays: 'SUGGEST_RECENT_DAYS',
    minLabelCoverage: 'SUGGEST_MIN_LABEL_COVERAGE',
    minSnapshotCoverage: 'SUGGEST_MIN_SNAPSHOT_COVERAGE',
    minMetricCoverage: 'SUGGEST_MIN_METRIC_COVERAGE',
    minGroupArticles: 'SUGGEST_MIN_GROUP_ARTICLES',
    minGroupReads: 'SUGGEST_MIN_GROUP_READS',
    minGroupDates: 'SUGGEST_MIN_GROUP_DATES',
    maxDataAgeDays: 'SUGGEST_MAX_DATA_AGE_DAYS',
    exampleLimit: 'SUGGEST_EXAMPLE_LIMIT',
  };
  return policySchema.parse(
    Object.fromEntries(
      Object.entries(fields).map(([key, name]) => [
        key,
        env[name]?.trim() || DEFAULT_GROWTH_POLICY[key as keyof GrowthPolicy],
      ])
    )
  );
}

export function beijingDay(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
}

export function shiftDay(day: string, offset: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export type GrowthMetric = 'read' | 'follow' | 'share' | 'collection';
export interface MetricSummary {
  known: number;
  total: number;
  sum: number | null;
  observedSum: number | null;
  median: number | null;
  rate: number | null;
  paired: number;
}

export interface CohortArticle extends GrowthArticle {
  snapshot: GrowthSnapshot | null;
}

export interface GrowthCohort {
  days: 3 | 7;
  fromDay: string;
  throughDay: string;
  rows: CohortArticle[];
  snapshotCount: number;
  metrics: Record<GrowthMetric, MetricSummary>;
  readConcentration: {
    knownMean: number | null;
    highestArticle: { id: number; title: string | null; read: number } | null;
    highestShare: number | null;
  };
}

export interface ImmatureArticle {
  id: number;
  title: string | null;
  publishDay: string;
  observationDay: string;
}

export interface LabelCoverage {
  total: number;
  complete: number;
  rate: number | null;
}

export interface GrowthAnalysis {
  account: string;
  asOfDay: string;
  latestSnapshotDay: string | null;
  latestPublishDay: string | null;
  recentFromDay: string;
  globalLabels: LabelCoverage;
  recentLabels: LabelCoverage;
  unknownPublishCount: number;
  excludedMediaCount: number;
  newsOnly: boolean;
  immatureArticles: ImmatureArticle[];
  cohorts: [GrowthCohort, GrowthCohort];
  rankingBlocks: string[];
  policy: GrowthPolicy;
}

function knownLabel(value: string | null): boolean {
  return !!value?.trim();
}

export function labelCoverage(rows: GrowthArticle[]): LabelCoverage {
  const complete = rows.filter(r => knownLabel(r.contentType) && knownLabel(r.subject)).length;
  return { total: rows.length, complete, rate: rows.length ? complete / rows.length : null };
}

function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor((sorted.length - 1) / 2)];
  const hi = sorted[Math.floor(sorted.length / 2)];
  return lo === undefined || hi === undefined ? null : (lo + hi) / 2;
}

/** 总量缺字段时为未知；部分已知量与成对分母另列，绝不把缺失补成零。 */
export function summarizeMetric(rows: CohortArticle[], metric: GrowthMetric): MetricSummary {
  const values = rows.flatMap(r => (r.snapshot?.[metric] == null ? [] : [r.snapshot[metric]]));
  const paired = rows.flatMap(r => {
    const point = r.snapshot;
    return point?.[metric] != null && point.read != null ? [{ value: point[metric], read: point.read }] : [];
  });
  const observedSum = values.length ? values.reduce((a, b) => a + b, 0) : null;
  const denominator = paired.reduce((sum, point) => sum + point.read, 0);
  return {
    known: values.length,
    total: rows.length,
    sum: values.length === rows.length ? observedSum : null,
    observedSum,
    median: median(values),
    rate:
      metric !== 'read' && denominator > 0 ? paired.reduce((sum, point) => sum + point.value, 0) / denominator : null,
    paired: paired.length,
  };
}

export function summarizeCohort(rows: CohortArticle[]): Record<GrowthMetric, MetricSummary> {
  return {
    read: summarizeMetric(rows, 'read'),
    follow: summarizeMetric(rows, 'follow'),
    share: summarizeMetric(rows, 'share'),
    collection: summarizeMetric(rows, 'collection'),
  };
}

/** 集中度只描述已知阅读；缺快照时不外推整组，也不据此推荐最高篇题材。 */
function readConcentration(rows: CohortArticle[], summary: MetricSummary): GrowthCohort['readConcentration'] {
  let highestArticle: GrowthCohort['readConcentration']['highestArticle'] = null;
  for (const row of rows) {
    const read = row.snapshot?.read;
    if (read != null && (highestArticle === null || read > highestArticle.read))
      highestArticle = { id: row.id, title: row.title, read };
  }
  return {
    knownMean: summary.observedSum !== null && summary.known > 0 ? summary.observedSum / summary.known : null,
    highestArticle,
    highestShare:
      highestArticle !== null && summary.observedSum !== null && summary.observedSum > 0
        ? highestArticle.read / summary.observedSum
        : null,
  };
}

export function analyzeContentGrowth(
  data: ContentGrowthData,
  account: string,
  asOfDay: string,
  policy: GrowthPolicy = DEFAULT_GROWTH_POLICY
): GrowthAnalysis {
  const newsOnly = accountPolicy(account).newsOnly;
  const available = data.articles.filter(a => a.publishDay === null || a.publishDay <= asOfDay);
  const scoped = available.filter(a => !newsOnly || a.mediaType === '文章');
  const recentFromDay = shiftDay(asOfDay, 1 - policy.recentDays);
  const fromDay = shiftDay(asOfDay, 1 - policy.lookbackDays);
  const globalLabels = labelCoverage(scoped);
  const recentLabels = labelCoverage(scoped.filter(a => a.publishDay !== null && a.publishDay >= recentFromDay));
  const points = new Map<string, GrowthSnapshot>();
  for (const snapshot of data.snapshots) {
    if (snapshot.capturedDay > asOfDay) continue;
    const key = `${snapshot.articleId}:${snapshot.capturedDay}`;
    const old = points.get(key);
    if (!old || snapshot.capturedAt > old.capturedAt) points.set(key, snapshot);
  }
  const makeCohort = (days: 3 | 7): GrowthCohort => {
    const throughDay = shiftDay(asOfDay, -days);
    const rows = scoped
      .filter(a => a.publishDay !== null && a.publishDay >= fromDay && a.publishDay <= throughDay)
      .map(a => ({ ...a, snapshot: points.get(`${a.id}:${shiftDay(a.publishDay ?? asOfDay, days)}`) ?? null }));
    const metrics = summarizeCohort(rows);
    return {
      days,
      fromDay,
      throughDay,
      rows,
      snapshotCount: rows.filter(r => r.snapshot).length,
      metrics,
      readConcentration: readConcentration(rows, metrics.read),
    };
  };
  const cohorts: [GrowthCohort, GrowthCohort] = [makeCohort(3), makeCohort(7)];
  const rankingBlocks: string[] = [];
  if (globalLabels.rate === null || globalLabels.rate < policy.minLabelCoverage) rankingBlocks.push('全体标签覆盖不足');
  if (recentLabels.rate === null || recentLabels.rate < policy.minLabelCoverage) rankingBlocks.push('近期标签覆盖不足');
  const primary = cohorts[0];
  if (!primary.rows.length || primary.snapshotCount / primary.rows.length < policy.minSnapshotCoverage)
    rankingBlocks.push('D+3精确日快照覆盖不足');
  for (const metric of ['read', 'follow', 'share', 'collection'] as const) {
    const summary = primary.metrics[metric];
    const count = metric === 'read' ? summary.known : summary.paired;
    if (!summary.total || count / summary.total < policy.minMetricCoverage)
      rankingBlocks.push(`D+3 ${metric}字段覆盖不足`);
  }
  if (!data.latestSnapshotDay || data.latestSnapshotDay < shiftDay(asOfDay, -policy.maxDataAgeDays))
    rankingBlocks.push('数据过旧或没有快照');
  return {
    account,
    asOfDay,
    latestSnapshotDay: data.latestSnapshotDay,
    latestPublishDay:
      available
        .flatMap(a => a.publishDay ?? [])
        .sort()
        .at(-1) ?? null,
    recentFromDay,
    globalLabels,
    recentLabels,
    unknownPublishCount: scoped.filter(a => a.publishDay === null).length,
    newsOnly,
    excludedMediaCount: available.length - scoped.length,
    immatureArticles: scoped
      .flatMap(a =>
        a.publishDay !== null && a.publishDay > primary.throughDay
          ? [{ id: a.id, title: a.title, publishDay: a.publishDay, observationDay: shiftDay(a.publishDay, 3) }]
          : []
      )
      .sort((a, b) => b.publishDay.localeCompare(a.publishDay) || b.id - a.id),
    cohorts,
    rankingBlocks,
    policy,
  };
}

export interface GrowthGroup {
  media: string;
  label: string;
  count: number;
  publishDates: number;
  metrics: Record<GrowthMetric, MetricSummary>;
  blockers: string[];
}

/** 分层观察；不将不同维度的高分组拼成组合建议。 */
export function growthGroups(analysis: GrowthAnalysis, axis: 'contentType' | 'subject'): GrowthGroup[] {
  const buckets = new Map<string, CohortArticle[]>();
  for (const row of analysis.cohorts[0].rows) {
    const key = JSON.stringify([row.mediaType?.trim() || '未知载体', row[axis]?.trim() || '未打标']);
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  const groups = [...buckets.values()].map(rows => {
    const sample = rows[0];
    const media = sample?.mediaType?.trim() || '未知载体';
    const label = sample?.[axis]?.trim() || '未打标';
    const metrics = summarizeCohort(rows);
    const publishDates = new Set(rows.map(r => r.publishDay)).size;
    const blockers: string[] = [];
    if (label === '未打标' || media === '未知载体') blockers.push('标签未知');
    if (rows.length < analysis.policy.minGroupArticles) blockers.push('篇数少');
    if (publishDates < analysis.policy.minGroupDates) blockers.push('发布日少');
    if (metrics.read.observedSum === null || metrics.read.observedSum < analysis.policy.minGroupReads)
      blockers.push('阅读样本少');
    if (rows.filter(r => r.snapshot).length / rows.length < analysis.policy.minSnapshotCoverage)
      blockers.push('快照覆盖不足');
    for (const [metric, summary] of Object.entries(metrics)) {
      const count = metric === 'read' ? summary.known : summary.paired;
      if (count / rows.length < analysis.policy.minMetricCoverage) {
        blockers.push('字段覆盖不足');
        break;
      }
    }
    return { media, label, count: rows.length, publishDates, metrics, blockers };
  });
  return groups.sort((a, b) => {
    const mediaOrder = a.media.localeCompare(b.media, 'zh-CN');
    if (mediaOrder) return mediaOrder;
    if (analysis.rankingBlocks.length === 0) {
      const eligibility = Number(a.blockers.length > 0) - Number(b.blockers.length > 0);
      if (eligibility) return eligibility;
      if (a.blockers.length === 0 && b.blockers.length === 0)
        return (b.metrics.read.median ?? 0) - (a.metrics.read.median ?? 0) || a.label.localeCompare(b.label, 'zh-CN');
    }
    return a.label.localeCompare(b.label, 'zh-CN');
  });
}
