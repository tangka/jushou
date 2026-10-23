import { config, USER_AGENT } from '../config/index.js';
import {
  getAppletRevenueOverviewBefore,
  getAppletUserLatest,
  getAppletUserSnapshotDates,
  openAppletDb,
  upsertAppletRevenueDaily,
  upsertAppletRevenueOverview,
  upsertAppletUserSnapshot,
} from '../db/index.js';
import { isMain, runCli } from '../utils/cli.js';
import { toDate } from '../utils/date.js';
import { fetchAppletUserMetrics } from './fetch-users.js';
import { loadAppletSession, probeAppletLogin } from './session.js';

type AppletTarget = (typeof config.appletRegistry)[number];

interface CliOptions {
  start: string;
  end: string;
  pageSize: number;
}

interface PublisherStatRow {
  date: string;
  req_succ_count?: number;
  exposure_count?: number;
  click_count?: number;
  income?: number;
  [key: string]: unknown;
}

interface PublisherStatResp {
  base_resp?: { ret?: number; err_msg?: string };
  ret?: number;
  err_msg?: string;
  list?: PublisherStatRow[];
  summary?: {
    click_count?: number;
    exposure_count?: number;
    income?: number;
    req_succ_count?: number;
    [key: string]: unknown;
  };
  total_num?: number;
}

interface DailyAggregate {
  date: string;
  incomeCents: number;
  pullCount: number;
  exposureCount: number;
  clickCount: number;
  rows: PublisherStatRow[];
}

class PublisherStatsError extends Error {
  constructor(
    readonly ret: number,
    message: string
  ) {
    super(message);
    this.name = 'PublisherStatsError';
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function parseCli(argv: readonly string[]): CliOptions {
  const today = localDate(new Date());
  let start = `${today.slice(0, 8)}01`;
  let end = addDays(today, -1);
  let pageSize = 200;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--start') {
      const value = argv[++i];
      if (!value) throw new Error('--start 需要 YYYY-MM-DD');
      start = value;
    } else if (arg === '--end') {
      const value = argv[++i];
      if (!value) throw new Error('--end 需要 YYYY-MM-DD');
      end = value;
    } else if (arg === '--page-size') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) throw new Error('--page-size 需要正整数');
      pageSize = value;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`用法:
  pnpm applet:fetch
  pnpm applet:fetch -- --start 2026-07-01 --end 2026-07-12`);
      process.exit(0);
    } else {
      throw new Error(`未知参数:${arg}`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('日期格式必须是 YYYY-MM-DD');
  }
  return { start, end, pageSize };
}

function responseRet(resp: PublisherStatResp): number {
  return resp.ret ?? resp.base_resp?.ret ?? 0;
}

async function fetchPage(options: CliOptions, page: number, target: AppletTarget): Promise<PublisherStatResp> {
  const session = await loadAppletSession(undefined, target);
  const url = new URL('https://mp.weixin.qq.com/wxopen/weapp_publisher_stat');
  const params = {
    action: 'stat',
    version: 'v2',
    start_date: options.start,
    end_date: options.end,
    page,
    page_size: options.pageSize,
    token: session.token,
    lang: 'zh_CN',
    f: 'json',
    ajax: 1,
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const resp = await fetch(url, {
    headers: {
      Cookie: session.cookieStr,
      Referer: 'https://mp.weixin.qq.com/wxopen/frame',
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Accept-Encoding': 'identity',
    },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`小程序收益接口 HTTP ${resp.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as PublisherStatResp;
  const ret = responseRet(json);
  if (ret !== 0)
    throw new PublisherStatsError(
      ret,
      `小程序收益接口 ret=${ret}: ${json.err_msg ?? json.base_resp?.err_msg ?? text.slice(0, 200)}`
    );
  return json;
}

async function fetchAll(options: CliOptions, target: AppletTarget): Promise<PublisherStatResp> {
  const first = await fetchPage(options, 1, target);
  const rows = [...(first.list ?? [])];
  const total = first.total_num ?? rows.length;
  for (let page = 2; rows.length < total; page++) {
    const next = await fetchPage(options, page, target);
    rows.push(...(next.list ?? []));
    if (!next.list?.length) break;
  }
  return { ...first, list: rows };
}

function aggregateRows(rows: readonly PublisherStatRow[]): DailyAggregate[] {
  const map = new Map<string, DailyAggregate>();
  for (const row of rows) {
    if (!row.date) continue;
    const item = map.get(row.date) ?? {
      date: row.date,
      incomeCents: 0,
      pullCount: 0,
      exposureCount: 0,
      clickCount: 0,
      rows: [],
    };
    item.incomeCents += Number(row.income ?? 0);
    item.pullCount += Number(row.req_succ_count ?? 0);
    item.exposureCount += Number(row.exposure_count ?? 0);
    item.clickCount += Number(row.click_count ?? 0);
    item.rows.push(row);
    map.set(row.date, item);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sumBetween(rows: readonly DailyAggregate[], start: string, end: string): number {
  return rows.filter(row => row.date >= start && row.date <= end).reduce((sum, row) => sum + row.incomeCents, 0);
}

export async function runForApplet(
  target: AppletTarget,
  argv: readonly string[] = process.argv.slice(2)
): Promise<void> {
  const options = parseCli(argv);
  const capturedAt = Math.floor(Date.now() / 1000);
  const capturedDay = toDate(capturedAt);
  const failures: Error[] = [];

  try {
    openAppletDb(target.dbPath);
    const existingDates = new Set(getAppletUserSnapshotDates(options.start, options.end));
    const missingDates = datesBetween(options.start, options.end).filter(date => !existingDates.has(date));
    let pulled = 0;
    for await (const users of fetchAppletUserMetrics(target, missingDates)) {
      upsertAppletUserSnapshot(
        {
          dataDate: users.dataDate,
          appid: target.id,
          name: target.name,
          cumulativeUsers: users.cumulativeUsers,
          raw: users.raw,
        },
        capturedAt
      );
      pulled++;
    }
    const latestUsers = getAppletUserLatest();
    if (pulled > 0 && latestUsers) {
      console.log(
        `小程序累计用户曲线:${target.name} · 新增 ${pulled} 天 · ${latestUsers.cumulative_users} 人(截至 ${latestUsers.data_date})`
      );
    } else {
      console.log(`小程序累计用户曲线:${target.name} · ${options.start} ~ ${options.end} 已完整,无需重复抓取`);
    }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failures.push(failure);
    console.warn(`[applets] ${target.name} 累计用户抓取失败:${failure.message}`);
  }

  try {
    openAppletDb(target.dbPath);
    const previousPeriod = getAppletRevenueOverviewBefore(options.start);
    const resp = await fetchAll(options, target);
    const rows = aggregateRows(resp.list ?? []);
    const weekStart = addDays(options.end, -6);
    const yesterdayCents = rows.find(row => row.date === options.end)?.incomeCents ?? 0;
    const periodCents = Number(resp.summary?.income ?? rows.reduce((sum, row) => sum + row.incomeCents, 0));
    const totalCents = (previousPeriod?.total_cents ?? 0) + periodCents;
    const weekOptions = { ...options, start: weekStart };
    const weekResp =
      weekOptions.start === options.start && weekOptions.end === options.end
        ? resp
        : await fetchAll(weekOptions, target);
    const weekRows = weekResp === resp ? rows : aggregateRows(weekResp.list ?? []);
    const weekCents = Number(weekResp.summary?.income ?? sumBetween(weekRows, weekOptions.start, weekOptions.end));

    openAppletDb(target.dbPath);
    upsertAppletRevenueOverview(
      {
        capturedDay,
        appid: target.id,
        name: target.name,
        yesterdayCents,
        weekCents,
        totalCents,
        dateRangeStart: previousPeriod?.date_range_start ?? options.start,
        dateRangeEnd: options.end,
        raw: resp.summary ?? null,
      },
      capturedAt
    );
    upsertAppletRevenueDaily(
      rows.map(row => ({
        date: row.date,
        appid: target.id,
        incomeCents: row.incomeCents,
        pullCount: row.pullCount,
        exposureCount: row.exposureCount,
        clickCount: row.clickCount,
        ecpmYuan: row.exposureCount > 0 ? (row.incomeCents / 100 / row.exposureCount) * 1000 : null,
        raw: row.rows,
      })),
      capturedAt
    );

    console.log(`小程序收益抓取完成:${target.name} · ${options.start} ~ ${options.end}`);
    console.log(`概览 ¥${(totalCents / 100).toFixed(2)}, 每日 ${rows.length} 天`);
    for (const row of rows) {
      const exposureRate = row.pullCount > 0 ? row.exposureCount / row.pullCount : 0;
      const clickRate = row.exposureCount > 0 ? row.clickCount / row.exposureCount : 0;
      const ecpm = row.exposureCount > 0 ? (row.incomeCents / 100 / row.exposureCount) * 1000 : 0;
      console.log(
        `${row.date} 收入 ¥${(row.incomeCents / 100).toFixed(2)} 拉取 ${row.pullCount} 曝光 ${row.exposureCount} 曝光率 ${(exposureRate * 100).toFixed(2)}% 点击 ${row.clickCount} 点击率 ${(clickRate * 100).toFixed(2)}% eCPM ¥${ecpm.toFixed(2)}`
      );
    }
  } catch (error) {
    if (error instanceof PublisherStatsError && error.ret === 2009) {
      console.warn(`[applets] ${target.name} 流量主收益接口当前不可用(ret=2009),保留累计用户数据`);
    } else {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  console.log(`DB ${target.dbPath}`);
  if (failures.length > 0) throw new AggregateError(failures, `${target.name} 小程序数据抓取不完整`);
}

export async function runAllApplets(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const failures: Error[] = [];
  for (const target of config.appletRegistry) {
    const probe = await probeAppletLogin(undefined, target);
    if (!probe.loggedIn) {
      console.warn(`[applets] 跳过 ${target.name}:${probe.reason}`);
      continue;
    }
    try {
      await runForApplet(target, argv);
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} 个小程序收益抓取失败`);
  }
}

export async function run(): Promise<void> {
  await runForApplet(config.applets);
}

if (isMain(import.meta.url)) runCli(run);
