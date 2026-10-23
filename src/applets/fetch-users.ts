import { config, USER_AGENT } from '../config/index.js';
import { toDate } from '../utils/date.js';
import { sleep } from '../utils/retry.js';
import { type AppletSession, loadAppletSession } from './session.js';

type AppletTarget = (typeof config.appletRegistry)[number];

interface IndexCardDynamicField {
  fieldId?: string;
  fieldValue?: string;
}

interface IndexCardValueLine {
  columnValue?: string[];
}

export interface AppletUserMetricResponse {
  ret?: number;
  respCode?: number;
  respMessage?: string;
  dynamicResps?: IndexCardDynamicField[];
  objects?: {
    tableValueLine?: IndexCardValueLine[];
  };
  [key: string]: unknown;
}

export interface AppletUserMetric {
  cumulativeUsers: number;
  dataDate: string;
  raw: AppletUserMetricResponse;
}

const CUMULATIVE_USERS_CHART_ID = 10100;

function yesterdayRange(now = new Date()): { beginDate: number; endDate: number } {
  const date = new Date(now);
  date.setDate(date.getDate() - 1);
  date.setHours(0, 0, 0, 0);
  const beginDate = Math.floor(date.getTime() / 1000);
  date.setHours(23, 59, 59, 999);
  return { beginDate, endDate: Math.floor(date.getTime() / 1000) };
}

function exactDateRange(date: string): { beginDate: number; endDate: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`小程序累计用户日期格式非法:${date}`);
  const beginDate = Math.floor(Date.parse(`${date}T00:00:00+08:00`) / 1000);
  if (!Number.isFinite(beginDate)) throw new Error(`小程序累计用户日期非法:${date}`);
  return { beginDate, endDate: beginDate + 86_399 };
}

export function parseAppletUserMetric(response: AppletUserMetricResponse, fallbackDateUnix: number): AppletUserMetric {
  const ret = response.ret ?? response.respCode ?? -1;
  if (ret !== 0) {
    throw new Error(`小程序累计用户接口 ret=${ret}: ${response.respMessage ?? 'unknown error'}`);
  }

  const isDelayed = response.dynamicResps?.find(field => field.fieldId === 'is_delay')?.fieldValue === '1';
  if (isDelayed) {
    throw new Error('小程序累计用户数据尚未结算(is_delay=1),跳过延迟占位值');
  }

  const rawValue = response.objects?.tableValueLine?.[0]?.columnValue?.[0];
  const cumulativeUsers = Number(rawValue);
  if (!Number.isInteger(cumulativeUsers) || cumulativeUsers < 0) {
    throw new Error(`小程序累计用户字段非法:${rawValue ?? 'missing'}`);
  }

  const dataTimeValue = response.dynamicResps?.find(field => field.fieldId === 'data_time')?.fieldValue;
  const dataTime = Number(dataTimeValue);
  const dataDate = toDate(Number.isFinite(dataTime) && dataTime > 0 ? dataTime : fallbackDateUnix);
  if (!dataDate) throw new Error('小程序累计用户数据日期缺失');

  return { cumulativeUsers, dataDate, raw: response };
}

async function fetchAppletUserMetricWithSession(session: AppletSession, date?: string): Promise<AppletUserMetric> {
  const { beginDate, endDate } = date ? exactDateRange(date) : yesterdayRange();
  const url = new URL('https://mp.weixin.qq.com/wxamp/cgi/wedata/GetIndexCard_v2');
  url.searchParams.set('token', session.token);
  url.searchParams.set('lang', 'zh_CN');
  url.searchParams.set('f', 'json');
  url.searchParams.set('ajax', '1');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: session.cookieStr,
      Referer: 'https://mp.weixin.qq.com/wxamp/index/index',
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/plain, */*',
      'Accept-Encoding': 'identity',
    },
    body: new URLSearchParams({
      beginDate: String(beginDate),
      endDate: String(endDate),
      chartId: String(CUMULATIVE_USERS_CHART_ID),
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`小程序累计用户接口 HTTP ${response.status}: ${text.slice(0, 200)}`);

  let json: AppletUserMetricResponse;
  try {
    json = JSON.parse(text) as AppletUserMetricResponse;
  } catch {
    throw new Error(`小程序累计用户接口返回非 JSON:${text.slice(0, 200)}`);
  }
  return parseAppletUserMetric(json, endDate);
}

export async function fetchAppletUserMetric(target: AppletTarget, date?: string): Promise<AppletUserMetric> {
  const session = await loadAppletSession(undefined, target);
  return fetchAppletUserMetricWithSession(session, date);
}

export async function* fetchAppletUserMetrics(
  target: AppletTarget,
  dates: readonly string[]
): AsyncGenerator<AppletUserMetric> {
  const session = await loadAppletSession(undefined, target);
  for (let index = 0; index < dates.length; index++) {
    if (index > 0) await sleep(config.requestIntervalMs);
    yield await fetchAppletUserMetricWithSession(session, dates[index]);
  }
}
