import { config } from '../config/index.js';
import { getDb, jsonString, reopenDb } from './core.js';

export interface AppletRevenueDaily {
  date: string;
  appid: string;
  income_cents: number;
  pull_count: number;
  exposure_count: number;
  click_count: number;
  ecpm_yuan: number | null;
  captured_at: number;
}

export interface AppletRevenueOverview {
  captured_day: string;
  appid: string;
  name: string | null;
  yesterday_cents: number;
  week_cents: number;
  total_cents: number;
  date_range_start: string | null;
  date_range_end: string | null;
  captured_at: number;
}

export interface AppletUserSnapshot {
  data_date: string;
  appid: string;
  name: string | null;
  cumulative_users: number;
  captured_at: number;
}

export interface UpsertAppletRevenueDaily {
  date: string;
  appid: string;
  incomeCents: number;
  pullCount?: number;
  exposureCount?: number;
  clickCount?: number;
  ecpmYuan?: number | null;
  raw?: unknown;
}

export interface UpsertAppletRevenueOverview {
  capturedDay: string;
  appid: string;
  name?: string;
  yesterdayCents: number;
  weekCents: number;
  totalCents: number;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
  raw?: unknown;
}

export interface UpsertAppletUserSnapshot {
  dataDate: string;
  appid: string;
  name?: string;
  cumulativeUsers: number;
  raw?: unknown;
}

export function openAppletDb(dbPath = config.applets.dbPath): void {
  reopenDb(dbPath);
}

function requireAppletId(appid: string): string {
  const normalized = appid.trim();
  if (!normalized) throw new Error('小程序 appid 不能为空');
  return normalized;
}

export function upsertAppletRevenueDaily(rows: readonly UpsertAppletRevenueDaily[], capturedAt: number): void {
  if (rows.length === 0) return;
  const normalizedRows = rows.map(row => ({ ...row, appid: requireAppletId(row.appid) }));
  const stmt = getDb().prepare(`
    INSERT INTO applet_revenue_daily (
      date, appid, income_cents, pull_count, exposure_count, click_count, ecpm_yuan, raw_json, captured_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, appid) DO UPDATE SET
      income_cents = excluded.income_cents,
      pull_count = excluded.pull_count,
      exposure_count = excluded.exposure_count,
      click_count = excluded.click_count,
      ecpm_yuan = excluded.ecpm_yuan,
      raw_json = excluded.raw_json,
      captured_at = excluded.captured_at;
  `);
  for (const row of normalizedRows) {
    stmt.run(
      row.date,
      row.appid,
      row.incomeCents,
      row.pullCount ?? 0,
      row.exposureCount ?? 0,
      row.clickCount ?? 0,
      row.ecpmYuan ?? null,
      jsonString(row.raw ?? null),
      capturedAt
    );
  }
}

export function upsertAppletRevenueOverview(row: UpsertAppletRevenueOverview, capturedAt: number): void {
  const appid = requireAppletId(row.appid);
  getDb()
    .prepare(`
      INSERT INTO applet_revenue_overview (
        captured_day, appid, name, yesterday_cents, week_cents, total_cents,
        date_range_start, date_range_end, raw_json, captured_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(captured_day, appid) DO UPDATE SET
        name = excluded.name,
        yesterday_cents = excluded.yesterday_cents,
        week_cents = excluded.week_cents,
        total_cents = excluded.total_cents,
        date_range_start = excluded.date_range_start,
        date_range_end = excluded.date_range_end,
        raw_json = excluded.raw_json,
        captured_at = excluded.captured_at;
    `)
    .run(
      row.capturedDay,
      appid,
      row.name ?? null,
      row.yesterdayCents,
      row.weekCents,
      row.totalCents,
      row.dateRangeStart ?? null,
      row.dateRangeEnd ?? null,
      jsonString(row.raw ?? null),
      capturedAt
    );
}

export function getAppletRevenueOverview(): AppletRevenueOverview | null {
  const row = getDb()
    .prepare(`
      SELECT captured_day, appid, name, yesterday_cents, week_cents, total_cents,
             date_range_start, date_range_end, captured_at
      FROM applet_revenue_overview
      ORDER BY captured_day DESC, captured_at DESC
      LIMIT 1
    `)
    .get() as unknown as AppletRevenueOverview | undefined;
  return row ?? null;
}

export function getAppletRevenueOverviewBefore(date: string): AppletRevenueOverview | null {
  const row = getDb()
    .prepare(`
      SELECT captured_day, appid, name, yesterday_cents, week_cents, total_cents,
             date_range_start, date_range_end, captured_at
      FROM applet_revenue_overview
      WHERE date_range_end < ?
      ORDER BY date_range_end DESC, captured_at DESC
      LIMIT 1
    `)
    .get(date) as unknown as AppletRevenueOverview | undefined;
  return row ?? null;
}

export function getAppletRevenueDays(limit = 90): AppletRevenueDaily[] {
  return getDb()
    .prepare(`
      SELECT date, appid, income_cents, pull_count, exposure_count, click_count, ecpm_yuan, captured_at
      FROM applet_revenue_daily
      WHERE date IN (
        SELECT DISTINCT date FROM applet_revenue_daily ORDER BY date DESC LIMIT ?
      )
      ORDER BY date ASC, appid ASC
    `)
    .all(limit) as unknown as AppletRevenueDaily[];
}

export function upsertAppletUserSnapshot(row: UpsertAppletUserSnapshot, capturedAt: number): void {
  const appid = requireAppletId(row.appid);
  getDb()
    .prepare(`
      INSERT INTO applet_user_snapshots (
        data_date, appid, name, cumulative_users, raw_json, captured_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(data_date, appid) DO UPDATE SET
        name = excluded.name,
        cumulative_users = excluded.cumulative_users,
        raw_json = excluded.raw_json,
        captured_at = excluded.captured_at;
    `)
    .run(row.dataDate, appid, row.name ?? null, row.cumulativeUsers, jsonString(row.raw ?? null), capturedAt);
}

export function getAppletUserLatest(): AppletUserSnapshot | null {
  const row = getDb()
    .prepare(`
      SELECT data_date, appid, name, cumulative_users, captured_at
      FROM applet_user_snapshots
      ORDER BY data_date DESC, captured_at DESC
      LIMIT 1
    `)
    .get() as unknown as AppletUserSnapshot | undefined;
  return row ?? null;
}

export function getAppletUserDays(limit = 90): AppletUserSnapshot[] {
  return getDb()
    .prepare(`
      SELECT data_date, appid, name, cumulative_users, captured_at
      FROM applet_user_snapshots
      WHERE data_date IN (
        SELECT DISTINCT data_date FROM applet_user_snapshots ORDER BY data_date DESC LIMIT ?
      )
      ORDER BY data_date ASC, appid ASC
    `)
    .all(limit) as unknown as AppletUserSnapshot[];
}

export function getAppletUserSnapshotDates(start: string, end: string): string[] {
  const rows = getDb()
    .prepare(`
      SELECT DISTINCT data_date
      FROM applet_user_snapshots
      WHERE data_date BETWEEN ? AND ?
      ORDER BY data_date ASC
    `)
    .all(start, end) as unknown as { data_date: string }[];
  return rows.map(row => row.data_date);
}
