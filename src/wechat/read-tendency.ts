import { MP_BASE_URL, USER_AGENT } from '../config/index.js';
import { RateLimitError } from '../errors.js';
import { readTendencySchema } from '../types/wechat.js';
import type { MpSession } from './session.js';

// 后台「图文分析 → 阅读趋势」:逐日 × 渠道的阅读人数(read_uv)。
// 这是后台权威口径(与导出 xls 一字不差),替代我们早期用快照日差自算的「净阅读量」
// ——自算会把多日增量挤到某一格(快照不按自然日切),日期归属错乱(见 BUGS.md)。
// 接口 T-1:当天行 read_uv=0(未结算)。

/** 渠道(scene)→ 中文名。9999=全部,6=推荐(看一看/算法,破圈主力)。 */
export const SCENE_LABELS: Record<number, string> = {
  0: '公众号消息',
  1: '聊天会话',
  2: '朋友圈',
  4: '公众号主页',
  5: '其他',
  6: '推荐',
  7: '搜一搜',
  9999: '全部',
};

export const SCENE_ALL = 9999;
export const SCENE_RECOMMEND = 6;

export interface ReadTendencyRow {
  /** YYYY-MM-DD(北京时区归日) */
  date: string;
  /** 渠道 scene(见 SCENE_LABELS) */
  scene: number;
  read_uv: number;
  share_uv: number;
}

/** unix 秒 → 北京时区(Asia/Shanghai)自然日 YYYY-MM-DD。后台 date 用此口径才与导出对齐。 */
function toBeijingDay(unixSec: number): string {
  // en-CA 输出即 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(unixSec * 1000));
}

/**
 * 抓阅读趋势(begin/end 为北京自然日,接口按 unix 秒收 begin_timestamp/end_timestamp)。
 * 返回逐日 × 渠道行(已按北京日归并);非 JSON 多半限流。
 */
export async function fetchReadTendency(
  session: MpSession,
  beginDay: string,
  endDay: string
): Promise<ReadTendencyRow[]> {
  const beginTs = Math.floor(new Date(`${beginDay}T00:00:00+08:00`).getTime() / 1000);
  const endTs = Math.floor(new Date(`${endDay}T23:59:59+08:00`).getTime() / 1000);

  const url = new URL(`${MP_BASE_URL}/misc/appmsganalysis`);
  url.searchParams.set('action', 'get_article_stat_tendency_and_source');
  url.searchParams.set('begin_timestamp', String(beginTs));
  url.searchParams.set('end_timestamp', String(endTs));
  url.searchParams.set('f', 'json');
  url.searchParams.set('token', session.token);
  url.searchParams.set('lang', 'zh_CN');

  const resp = await fetch(url, {
    headers: {
      Cookie: session.cookieStr,
      Referer: `${MP_BASE_URL}/misc/appmsganalysis?action=report&type=daily_v2&token=${session.token}&lang=zh_CN`,
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
    throw new RateLimitError('阅读趋势返回非 JSON(多半限流或登录态失效),停 1~2 分钟再试');
  }
  const json = readTendencySchema.parse(raw);
  if (json.base_resp?.ret !== undefined && json.base_resp.ret !== 0) {
    throw new Error(`阅读趋势 base_resp ret=${json.base_resp.ret} ${json.base_resp.err_msg ?? ''}`);
  }

  const list = json.all_article_stat_tendency?.list ?? [];
  return list.map(r => ({ date: toBeijingDay(r.date), scene: r.scene, read_uv: r.read_uv, share_uv: r.share_uv }));
}
