import { z } from 'zod';
import { cgiDataSchema } from '../types/wechat.js';
import { parseCgiData } from '../utils/cgidata.js';
import { fetchMpHtml, type MpSession } from './session.js';

/** 一篇文章归一化后的互动数据(本项目内部结构,非微信原样)。 */
export const articleStatsSchema = z.object({
  title: z.string(),
  appmsgid: z.union([z.string(), z.number()]),
  itemidx: z.union([z.string(), z.number()]),
  publish_date: z.string(),
  read_uv: z.number(),
  like_cnt: z.number(),
  zaikan_cnt: z.number(),
  comment_cnt: z.number(),
  share_uv: z.number(),
  collection_uv: z.number(),
  avg_article_read_time_seconds: z.number(),
  avg_article_read_time_minutes: z.number(),
  finished_read_pv_ratio: z.number(),
  follow_after_read_uv: z.number(),
});
export type ArticleStats = z.infer<typeof articleStatsSchema>;

interface StatsQuery {
  appmsgid: string | number;
  itemidx: string | number;
  publishDate: string;
  fallbackTitle: string;
}

/** 全 0 的占位数据:单篇抓取失败(限流/当天未出数据)时用,保证产物字段齐全。 */
export function makeEmptyStats(q: StatsQuery): ArticleStats {
  return {
    title: q.fallbackTitle,
    appmsgid: q.appmsgid,
    itemidx: q.itemidx,
    publish_date: q.publishDate,
    read_uv: 0,
    like_cnt: 0,
    zaikan_cnt: 0,
    comment_cnt: 0,
    share_uv: 0,
    collection_uv: 0,
    avg_article_read_time_seconds: 0,
    avg_article_read_time_minutes: 0,
    finished_read_pv_ratio: 0,
    follow_after_read_uv: 0,
  };
}

/**
 * 抓一篇文章的后台互动数据。缺 cgiData 时抛 {@link CgiDataNotFoundError}(调用方决定回退/计数)。
 */
export async function fetchArticleStats(session: MpSession, q: StatsQuery): Promise<ArticleStats> {
  const html = await fetchMpHtml(session, '/misc/appmsganalysis', {
    action: 'detailpage',
    msgid: `${q.appmsgid}_${q.itemidx}`,
    publish_date: q.publishDate,
    type: 'int',
    pageVersion: 1,
  });
  const cgiData = cgiDataSchema.parse(parseCgiData(html));
  const articleData = cgiData.articleData ?? {};
  const s = articleData.article_data_new ?? {};
  const avgSeconds = s.avg_article_read_time ?? 0;
  return {
    title: articleData.title || q.fallbackTitle,
    appmsgid: q.appmsgid,
    itemidx: q.itemidx,
    publish_date: q.publishDate,
    read_uv: s.read_uv ?? 0,
    like_cnt: s.like_cnt ?? 0,
    zaikan_cnt: s.zaikan_cnt ?? 0,
    comment_cnt: s.comment_cnt ?? 0,
    share_uv: s.share_uv ?? 0,
    collection_uv: s.collection_uv ?? 0,
    avg_article_read_time_seconds: avgSeconds,
    avg_article_read_time_minutes: avgSeconds ? Number((avgSeconds / 60).toFixed(2)) : 0,
    finished_read_pv_ratio: s.finished_read_pv_ratio ?? 0,
    follow_after_read_uv: s.follow_after_read_uv ?? 0,
  };
}
