import { MP_BASE_URL, USER_AGENT } from '../config/index.js';
import type { FollowerDay } from '../db/index.js';
import { RateLimitError } from '../errors.js';
import { userAnalysisSchema } from '../types/wechat.js';
import type { MpSession } from './session.js';

export interface UserAnalysis {
  account: string;
  /** 按日期升序的每日数据。 */
  days: FollowerDay[];
}

/** 「用户分析」原始每日项(微信接口字段)。 */
export interface RawFollowerDay {
  date: string;
  new_user: number;
  cancel_user: number;
  netgain_user: number;
  cumulate_user: number;
}

/**
 * 原始每日列表 → FollowerDay(按日期升序)。
 * 净增以**累计快照日差**为准:cumulate_user 是已结算的总粉丝数,会先稳定下来;
 * 而 new/cancel/netgain 这些「流量分量」对最近几天有滞后(T-1 当天可能还在累计,
 * 返回偏小的非零值)。两者打架时信累计差,避免存进「净增 1 但累计 +18」的自相矛盾。
 * 只有窗口首日没有前一天可比时,才回落接口给的 netgain_user。
 */
export function toFollowerDays(list: RawFollowerDay[]): FollowerDay[] {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((item, i) => {
    const prev = i > 0 ? sorted[i - 1]?.cumulate_user : undefined;
    const netgain = prev === undefined ? item.netgain_user : item.cumulate_user - prev;
    return {
      date: item.date,
      new_user: item.new_user,
      cancel_user: item.cancel_user,
      netgain_user: netgain,
      cumulate_user: item.cumulate_user,
    };
  });
}

const ALL_SOURCE = '99999999';
const USER_ANALYSIS_INDICATOR = 'new_user';

export function buildUserAnalysisUrl(token: string, beginDate: string, endDate: string): URL {
  const url = new URL(`${MP_BASE_URL}/misc/useranalysis`);
  url.searchParams.set('begin_date', beginDate);
  url.searchParams.set('end_date', endDate);
  // 微信前端 broadcastTags 的「全部来源」是 99999999;source=0 是「其他合计」,会导致新增/取消为 0。
  url.searchParams.set('source', ALL_SOURCE);
  // 带任一指标后会返回四列每日数据;前端默认 new_user。
  url.searchParams.set('indicatorSelect', USER_ANALYSIS_INDICATOR);
  url.searchParams.set('f', 'json');
  url.searchParams.set('token', token);
  url.searchParams.set('lang', 'zh_CN');
  return url;
}

/**
 * 抓公众号「数据分析 → 用户分析」:累计关注(总粉丝)+ 每日新增/取消/净增。
 * 数据源 `/misc/useranalysis?f=json`(不带 f=json 会返回 SPA 页面)。T-1 口径。
 * 净增以累计快照日差为准(见 toFollowerDays)。
 */
export async function fetchUserAnalysis(session: MpSession, beginDate: string, endDate: string): Promise<UserAnalysis> {
  const url = buildUserAnalysisUrl(session.token, beginDate, endDate);

  const resp = await fetch(url, {
    headers: {
      Cookie: session.cookieStr,
      Referer: `${MP_BASE_URL}/misc/useranalysis?token=${session.token}&lang=zh_CN`,
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'identity',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // 返回 HTML 而非 JSON:多半限流或登录态问题
    throw new RateLimitError('用户分析返回非 JSON(多半限流或登录态失效),停 1~2 分钟再试');
  }
  const json = userAnalysisSchema.parse(raw);
  if (json.base_resp?.ret !== undefined && json.base_resp.ret !== 0) {
    throw new Error(`用户分析 base_resp ret=${json.base_resp.ret} ${json.base_resp.err_msg ?? ''}`);
  }

  const days = toFollowerDays(json.category_list?.[0]?.list ?? []);

  // 限流保护:所有天 new_user/cancel_user 全 0、却 cumulate 有增长 = 自相矛盾,多半是后台限流或 T-1 数据未产出。
  // 此时抛错不返回,避免上层把一堆 0 幂等覆盖掉已有好数据(CLAUDE.md 坑 1;凌晨自动 sync 时尤其会踩)。
  const totalNew = days.reduce((sum, d) => sum + d.new_user, 0);
  const totalCancel = days.reduce((sum, d) => sum + d.cancel_user, 0);
  const cumulates = days.map(d => d.cumulate_user);
  const cumulateGrew = Math.max(...cumulates) > Math.min(...cumulates);
  if (days.length > 1 && totalNew === 0 && totalCancel === 0 && cumulateGrew) {
    throw new RateLimitError(
      '用户分析 new_user/cancel_user 全 0 但累计有增长(多半限流或 T-1 数据未产出),停 1~2 分钟再试;本次不写入以保住已有数据'
    );
  }

  return { account: json.user_info?.nick_name ?? '', days };
}
