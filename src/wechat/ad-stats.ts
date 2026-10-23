import { MP_BASE_URL, USER_AGENT } from '../config/index.js';
import type { ArticleRevenue, RevenueDay, RevenueOverviewValues, RevenueSlotDaily } from '../db/index.js';
import { RateLimitError } from '../errors.js';
import type { AdOverviewResp } from '../types/wechat.js';
import { adIncomeSchema, adOverviewSchema, adStatSchema, articleRevenueSchema } from '../types/wechat.js';
import type { MpSession } from './session.js';

// 抓「流量主 → 数据统计 → 文章收入」的每日收益。
// 用普通 mp 登录态直连(服务端基于 slave_sid 鉴权,无需 publisher_session)。
// 思路:overview 拿全部广告位 slot_id → 逐个 biz_ads_stat 取每日 → 按日期把所有广告位 income 求和。
// income 原始单位是「分」,这里保留分;展示层再 /100 转元。T-1 口径(昨日数据约次日中午产出)。RevenueDay 定义见 db。

/** 逐篇/逐广告位打后台的间隔,避免触发限流(同 enrich 的约定)。 */
const SLOT_INTERVAL_MS = 400;

export interface AdOverviewData {
  slotIds: string[];
  revenueOverview: RevenueOverviewValues;
}

export interface AdRevenueReport {
  days: RevenueDay[];
  revenueOverview: RevenueOverviewValues;
  slotIds: string[];
}

function publisherHeaders(session: MpSession): Record<string, string> {
  return {
    Cookie: session.cookieStr,
    Referer: `${MP_BASE_URL}/cgi-bin/frame?t=ad_system/common_frame&t1=publisher/publisher_report&token=${session.token}&lang=zh_CN`,
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'identity',
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/javascript, */*; q=0.01',
  };
}

async function fetchPublisherJson(session: MpSession, search: Record<string, string>): Promise<unknown> {
  const url = new URL(`${MP_BASE_URL}/promotion/publisher/publisher_stat`);
  for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  url.searchParams.set('token', session.token);
  url.searchParams.set('appid', '');
  url.searchParams.set('spid', '');

  const resp = await fetch(url, { headers: publisherHeaders(session) });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    // 返回 HTML 而非 JSON:多半限流或登录态失效
    throw new RateLimitError('流量主接口返回非 JSON(多半限流或登录态失效),停 1~2 分钟再试');
  }
}

function assertOk(ret: number | undefined, errMsg: string | undefined, where: string): void {
  if (ret !== undefined && ret !== 0) throw new Error(`流量主 ${where} base_resp ret=${ret} ${errMsg ?? ''}`);
}

function toRevenueOverviewValues(json: AdOverviewResp): RevenueOverviewValues {
  return {
    total_cents: json.total_income,
    programmatic_cents: json.total_programmatic_ad_income,
    freetrade_cents: json.total_freetrade_income,
    cps_cents: json.total_cps_income,
    yesterday_cents: json.yesterday_income,
    week_cents: json.last_week_income,
    month_cents: json.last_month_income,
    day_ratio: json.day_cycle_ratio,
    week_ratio: json.week_cycle_ratio,
  };
}

/** overview 拿账号收入构成 + 全部广告位 slot_id(昨日总览里 ads_stat 列出所有已开通广告位)。 */
export async function fetchAdOverview(session: MpSession): Promise<AdOverviewData> {
  const raw = await fetchPublisherJson(session, { action: 'overview', result_type: '1', version: 'v2' });
  const json = adOverviewSchema.parse(raw);
  assertOk(json.base_resp?.ret, json.base_resp?.err_msg, 'overview');
  const slotIds = (json.yesterday_overview?.ads_stat ?? []).map(a => String(a.slot_id)).filter(Boolean);
  return {
    slotIds: [...new Set(slotIds)],
    revenueOverview: toRevenueOverviewValues(json),
  };
}

/** overview 拿账号全部广告位 slot_id(昨日总览里 ads_stat 列出所有已开通广告位)。 */
export async function fetchAdSlotIds(session: MpSession): Promise<string[]> {
  const overview = await fetchAdOverview(session);
  return overview.slotIds;
}

/**
 * 抓 [begin, end] 区间每日总收益(全部广告位合计)+ overview 收入构成。
 * 任一广告位无数据则跳过;所有广告位都查不到日期数据时返回空数组(多半限流或当日数据未产出)。
 */
export async function fetchAdRevenueReport(session: MpSession, begin: string, end: string): Promise<AdRevenueReport> {
  const overview = await fetchAdOverview(session);
  const byDate = new Map<string, RevenueDay>();

  for (const slot of overview.slotIds) {
    const raw = await fetchPublisherJson(session, {
      action: 'biz_ads_stat',
      page: '1',
      page_size: '40',
      start_date: begin,
      end_date: end,
      slot_id: slot,
    });
    const json = adStatSchema.parse(raw);
    assertOk(json.base_resp?.ret, json.base_resp?.err_msg, 'biz_ads_stat');
    for (const d of json.list ?? []) {
      const cur = byDate.get(d.date) ?? { date: d.date, income_cents: 0, exposure: 0, click: 0, req_succ: 0 };
      cur.income_cents += d.income;
      cur.exposure += d.exposure_count;
      cur.click += d.click_count;
      cur.req_succ += d.req_succ_count;
      byDate.set(d.date, cur);
    }
    await new Promise(r => setTimeout(r, SLOT_INTERVAL_MS));
  }

  return {
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    revenueOverview: overview.revenueOverview,
    slotIds: overview.slotIds,
  };
}

/**
 * 抓 [begin, end] 区间每日总收益(全部广告位合计)。
 * 任一广告位无数据则跳过;所有广告位都查不到日期数据时返回空数组(多半限流或当日数据未产出)。
 */
export async function fetchAdRevenue(session: MpSession, begin: string, end: string): Promise<RevenueDay[]> {
  const report = await fetchAdRevenueReport(session, begin, end);
  return report.days;
}

/** 抓 [begin, end] 区间内每日 × 广告位收入(income 接口);income 单位分。 */
export async function fetchAdSlotDailyIncome(
  session: MpSession,
  begin: string,
  end: string
): Promise<RevenueSlotDaily[]> {
  const raw = await fetchPublisherJson(session, {
    action: 'income',
    page: '1',
    page_size: '100',
    cont_type: '0',
    start_date: begin,
    end_date: end,
    lang: 'zh_CN',
    f: 'json',
  });
  const json = adIncomeSchema.parse(raw);
  assertOk(json.base_resp?.ret, json.base_resp?.err_msg, 'income');

  const rows: RevenueSlotDaily[] = [];
  for (const day of json.income_list) {
    for (const slot of day.income_slotid) {
      rows.push({
        date: day.date,
        slotid: slot.slotid,
        income_cents: Math.round(slot.income),
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.slotid.localeCompare(b.slotid));
}

/**
 * 抓 [begin, end] 区间内**每篇文章**的广告收益(article_list,翻页拿全)。
 * total_income 单位分;按 send_date+title 去重(翻页时 total_num 偶有抖动),收益降序返回。
 */
export async function fetchArticleRevenue(session: MpSession, begin: string, end: string): Promise<ArticleRevenue[]> {
  const PAGE_SIZE = 20;
  const seen = new Map<string, ArticleRevenue>();

  for (let page = 1; page <= 50; page++) {
    const raw = await fetchPublisherJson(session, {
      action: 'article_list',
      page: String(page),
      page_size: String(PAGE_SIZE),
      start_date: begin,
      end_date: end,
      result_type: '1',
    });
    const json = articleRevenueSchema.parse(raw);
    assertOk(json.base_resp?.ret, json.base_resp?.err_msg, 'article_list');
    const list = json.article_stat ?? [];
    for (const a of list) {
      seen.set(`${a.send_date}__${a.title}`, {
        title: a.title,
        send_date: a.send_date,
        orig_status: a.orig_status,
        income_cents: a.total_income,
      });
    }
    const total = json.total_num ?? seen.size;
    if (list.length === 0 || seen.size >= total) break;
    await new Promise(r => setTimeout(r, SLOT_INTERVAL_MS));
  }

  return [...seen.values()].sort((a, b) => b.income_cents - a.income_cents);
}
