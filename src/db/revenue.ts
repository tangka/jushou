import { getDb } from './core.js';

export interface RevenueDay {
  date: string;
  income_cents: number;
  exposure: number;
  click: number;
  req_succ: number;
}

/** upsert 流量主某天总收益(全部广告位合计,按 date 幂等)。 */
export function upsertRevenueDay(day: RevenueDay, capturedAt: number): void {
  getDb()
    .prepare(`
      INSERT INTO revenue_snapshots (date, income_cents, exposure, click, req_succ, captured_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        income_cents = excluded.income_cents, exposure = excluded.exposure,
        click = excluded.click, req_succ = excluded.req_succ, captured_at = excluded.captured_at;
    `)
    .run(day.date, day.income_cents, day.exposure, day.click, day.req_succ, capturedAt);
}

/** overview 不再给广告位时只刷新 income，保留旧的曝光/点击/请求数。 */
export function upsertRevenueIncomeDay(date: string, incomeCents: number, capturedAt: number): void {
  getDb()
    .prepare(`
      INSERT INTO revenue_snapshots (date, income_cents, exposure, click, req_succ, captured_at)
      VALUES (?, ?, 0, 0, 0, ?)
      ON CONFLICT(date) DO UPDATE SET
        income_cents = excluded.income_cents,
        captured_at = excluded.captured_at;
    `)
    .run(date, incomeCents, capturedAt);
}

/** 取最近 N 天收益(按日期倒序)。 */
export function getRevenueDays(limit = 30): RevenueDay[] {
  return getDb()
    .prepare('SELECT date, income_cents, exposure, click, req_succ FROM revenue_snapshots ORDER BY date DESC LIMIT ?')
    .all(limit) as unknown as RevenueDay[];
}

export interface RevenueSlotDaily {
  date: string;
  slotid: string;
  income_cents: number;
}

/** upsert 流量主按广告位逐日收入(按 date + slotid 幂等)。 */
export function upsertRevenueSlotDaily(rows: readonly RevenueSlotDaily[], capturedAt: number): void {
  if (rows.length === 0) return;
  const stmt = getDb().prepare(`
    INSERT INTO revenue_slot_daily (date, slotid, income_cents, captured_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, slotid) DO UPDATE SET
      income_cents = excluded.income_cents,
      captured_at = excluded.captured_at;
  `);
  for (const row of rows) stmt.run(row.date, row.slotid, row.income_cents, capturedAt);
}

/** 取最近 N 天按广告位逐日收入;返回日期正序,同日按 slotid 稳定排序。 */
export function getSlotDailyIncome(days = 30): RevenueSlotDaily[] {
  return getDb()
    .prepare(`
      SELECT date, slotid, income_cents
      FROM revenue_slot_daily
      WHERE date IN (
        SELECT DISTINCT date FROM revenue_slot_daily ORDER BY date DESC LIMIT ?
      )
      ORDER BY date ASC, slotid ASC
    `)
    .all(days) as unknown as RevenueSlotDaily[];
}

export interface RevenueOverview {
  date: string;
  total_cents: number;
  programmatic_cents: number;
  freetrade_cents: number;
  cps_cents: number;
  yesterday_cents: number;
  week_cents: number;
  month_cents: number;
  day_ratio: number;
  week_ratio: number;
  captured_at: number;
}

export type RevenueOverviewValues = Omit<RevenueOverview, 'date' | 'captured_at'>;

/** upsert 流量主收入构成总览(按抓取日幂等覆盖)。 */
export function upsertRevenueOverview(row: RevenueOverview): void {
  getDb()
    .prepare(`
      INSERT INTO revenue_overview (
        date, total_cents, programmatic_cents, freetrade_cents, cps_cents,
        yesterday_cents, week_cents, month_cents, day_ratio, week_ratio, captured_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_cents = excluded.total_cents,
        programmatic_cents = excluded.programmatic_cents,
        freetrade_cents = excluded.freetrade_cents,
        cps_cents = excluded.cps_cents,
        yesterday_cents = excluded.yesterday_cents,
        week_cents = excluded.week_cents,
        month_cents = excluded.month_cents,
        day_ratio = excluded.day_ratio,
        week_ratio = excluded.week_ratio,
        captured_at = excluded.captured_at;
    `)
    .run(
      row.date,
      row.total_cents,
      row.programmatic_cents,
      row.freetrade_cents,
      row.cps_cents,
      row.yesterday_cents,
      row.week_cents,
      row.month_cents,
      row.day_ratio,
      row.week_ratio,
      row.captured_at
    );
}

/** 取最新一次流量主收入构成总览。 */
export function getRevenueOverview(): RevenueOverview | null {
  const row = getDb()
    .prepare(`
      SELECT date, total_cents, programmatic_cents, freetrade_cents, cps_cents,
             yesterday_cents, week_cents, month_cents, day_ratio, week_ratio, captured_at
      FROM revenue_overview
      ORDER BY date DESC
      LIMIT 1
    `)
    .get() as unknown as RevenueOverview | undefined;
  return row ?? null;
}

export interface ArticleIncome {
  appmsgid: string;
  itemidx: number;
  income_cents: number;
}

/** 每篇文章的累计广告收益(经 article_id 关联);未关联的文章不在结果里。 */
export function getArticleIncomes(): ArticleIncome[] {
  return getDb()
    .prepare(`
      SELECT a.appmsgid, a.itemidx, ar.income_cents
      FROM article_revenue ar
      JOIN articles a ON ar.article_id = a.id
      WHERE ar.income_cents IS NOT NULL
    `)
    .all() as unknown as ArticleIncome[];
}

export interface ArticleRevenueRow {
  title: string;
  send_date: string;
  income_cents: number;
  appmsgid: string | null; // 经 article_id 关联到的文章;未关联为 null
  itemidx: number | null;
}

/** 文章收益榜(按收益降序);带稳定的 appmsgid+itemidx(经 article_id 关联,绕开标题文本差异)。 */
export function getArticleRevenueRanking(): ArticleRevenueRow[] {
  return getDb()
    .prepare(`
      SELECT ar.title, ar.send_date, ar.income_cents, a.appmsgid, a.itemidx
      FROM article_revenue ar
      LEFT JOIN articles a ON ar.article_id = a.id
      ORDER BY ar.income_cents DESC
    `)
    .all() as unknown as ArticleRevenueRow[];
}

export interface DailyMetric {
  date: string;
  cumulate_user: number;
  income_cents: number;
  per_follower_cents: number;
}

/** 刷新每日人均收益(当天收益 ÷ 当天累计粉丝):join 收益+粉丝快照全量重算 upsert。每次 sync 调。 */
export function refreshDailyMetrics(capturedAt: number): void {
  getDb()
    .prepare(`
      INSERT OR REPLACE INTO daily_metrics (date, cumulate_user, income_cents, per_follower_cents, captured_at)
      SELECT r.date, f.cumulate_user, r.income_cents,
             ROUND(r.income_cents * 1.0 / f.cumulate_user, 3), ?
      FROM revenue_snapshots r JOIN follower_snapshots f ON r.date = f.date
      WHERE f.cumulate_user > 0
    `)
    .run(capturedAt);
}

export function getDailyMetrics(limit = 30): DailyMetric[] {
  return getDb()
    .prepare(
      'SELECT date, cumulate_user, income_cents, per_follower_cents FROM daily_metrics ORDER BY date DESC LIMIT ?'
    )
    .all(limit) as unknown as DailyMetric[];
}

export interface ArticleReadSeries {
  id: number;
  title: string;
  publish_time: number | null;
  points: { day: string; read: number }[];
}

/** 每篇文章的逐日阅读序列(stat_snapshots 多日快照)。只返回 ≥minDays 天快照的篇,用于看「发布后阅读怎么变 / 老文有没有被二次推荐翻红」。 */
export function getArticleReadSeries(minDays = 3): ArticleReadSeries[] {
  const rows = getDb()
    .prepare(`
      SELECT a.id, a.title, a.publish_time, s.captured_day AS day, s.read_uv AS read
      FROM articles a JOIN stat_snapshots s ON s.article_id = a.id
      ORDER BY a.id, s.captured_day
    `)
    .all() as unknown as { id: number; title: string; publish_time: number | null; day: string; read: number }[];
  const map = new Map<number, ArticleReadSeries>();
  for (const r of rows) {
    let e = map.get(r.id);
    if (!e) {
      e = { id: r.id, title: r.title, publish_time: r.publish_time, points: [] };
      map.set(r.id, e);
    }
    e.points.push({ day: r.day, read: r.read });
  }
  return [...map.values()].filter(e => e.points.length >= minDays);
}
