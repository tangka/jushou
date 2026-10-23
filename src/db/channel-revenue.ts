import { getDb } from './core.js';

export interface ChannelRevenueSnapshotInput {
  periodStart: string;
  periodEnd: string;
  totalCents: number;
  source?: string;
  note?: string;
}

export interface ChannelRevenueSnapshot {
  period_start: string;
  period_end: string;
  total_cents: number;
  source: string;
  note: string | null;
  captured_at: number;
}

export interface ChannelRevenueSummary {
  snapshotCount: number;
  periodCount: number;
  totalCents: number;
  latestPeriodEnd: string | null;
}

export interface ChannelRevenueDay {
  date: string;
  amount_cents: number;
}

function normalizeDate(value: string, label: string): string {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`${label}非法:${value}`);
  }
  return date;
}

/** 写入或覆盖同一区间快照；重复执行不会叠加收益。 */
export function setChannelRevenueSnapshot(input: ChannelRevenueSnapshotInput): void {
  const periodStart = normalizeDate(input.periodStart, '区间开始日期');
  const periodEnd = normalizeDate(input.periodEnd, '区间结束日期');
  if (periodStart > periodEnd) throw new Error(`视频号收益区间非法:${periodStart} 晚于 ${periodEnd}`);
  if (!Number.isSafeInteger(input.totalCents) || input.totalCents < 0) {
    throw new Error(`视频号收益必须是非负整数分:${input.totalCents}`);
  }

  getDb()
    .prepare(`
      INSERT INTO channel_revenue_snapshots
        (period_start, period_end, total_cents, source, note, captured_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(period_start, period_end) DO UPDATE SET
        total_cents = excluded.total_cents,
        source = excluded.source,
        note = excluded.note,
        captured_at = excluded.captured_at
    `)
    .run(
      periodStart,
      periodEnd,
      input.totalCents,
      input.source?.trim() || 'manual',
      input.note?.trim() || null,
      Math.floor(Date.now() / 1000)
    );
}

export function getChannelRevenueSnapshots(limit = 50): ChannelRevenueSnapshot[] {
  return getDb()
    .prepare(`
      SELECT period_start, period_end, total_cents, source, note, captured_at
      FROM channel_revenue_snapshots
      ORDER BY period_end DESC, period_start DESC
      LIMIT ?
    `)
    .all(limit) as unknown as ChannelRevenueSnapshot[];
}

/** 每个 period_start 只取最新累计值，再跨不同时段求和。 */
export function getChannelRevenueSummary(): ChannelRevenueSummary {
  const row = getDb()
    .prepare(`
      WITH latest AS (
        SELECT period_start, MAX(period_end) AS latest_end
        FROM channel_revenue_snapshots
        GROUP BY period_start
      ), selected AS (
        SELECT snapshots.period_end, snapshots.total_cents
        FROM channel_revenue_snapshots snapshots
        JOIN latest
          ON latest.period_start = snapshots.period_start
         AND latest.latest_end = snapshots.period_end
      )
      SELECT
        (SELECT COUNT(*) FROM channel_revenue_snapshots) AS snapshotCount,
        COUNT(*) AS periodCount,
        COALESCE(SUM(total_cents), 0) AS totalCents,
        MAX(period_end) AS latestPeriodEnd
      FROM selected
    `)
    .get() as unknown as ChannelRevenueSummary;
  return {
    snapshotCount: Number(row.snapshotCount),
    periodCount: Number(row.periodCount),
    totalCents: Number(row.totalCents),
    latestPeriodEnd: row.latestPeriodEnd ?? null,
  };
}

/** 同一开始日的累计快照转为增量；首个快照全部记在其 period_end。 */
export function getChannelRevenueDays(limit = 90): ChannelRevenueDay[] {
  const rows = getDb()
    .prepare(`
      WITH deltas AS (
        SELECT
          period_end AS date,
          total_cents - LAG(total_cents, 1, 0) OVER (
            PARTITION BY period_start ORDER BY period_end
          ) AS amount_cents
        FROM channel_revenue_snapshots
      )
      SELECT date, COALESCE(SUM(amount_cents), 0) AS amount_cents
      FROM deltas
      GROUP BY date
      ORDER BY date DESC
      LIMIT ?
    `)
    .all(limit) as unknown as ChannelRevenueDay[];
  return rows.map(row => ({ date: row.date, amount_cents: Number(row.amount_cents) }));
}
