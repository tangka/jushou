import { z } from 'zod';
import { config } from '../config/index.js';
import type { ArticleListItem } from '../types/wechat.js';
import { fetchMpHtml, type MpSession } from './session.js';
import type { ArticleStats } from './stats.js';

// 已发表列表页口径:页面提示「发表相关数据均为实时人数」,与后台列表 UI 的图标数字一致。

const PAGE_SIZE = 10;
const numOrStr = z.union([z.number(), z.string()]);

const publishedArticleSchema = z
  .object({
    appmsgid: numOrStr.optional(),
    itemidx: numOrStr.optional(),
    title: z.string().optional(),
    read_num: z.coerce.number().optional().default(0),
    old_like_num: z.coerce.number().optional().default(0),
    like_num: z.coerce.number().optional().default(0),
    comment_num: z.coerce.number().optional().default(0),
    total_comment_count_contains_reply: z.coerce.number().optional(),
    comment_id: numOrStr.optional(),
    share_num: z.coerce.number().optional().default(0),
    content_url: z.string().optional(),
    cover: z.string().optional(),
    digest: z.string().optional(),
    author: z.string().optional(),
    item_show_type: numOrStr.optional(),
    is_deleted: z.unknown().optional(),
    is_pay_subscribe: z.unknown().optional(),
  })
  .passthrough();

const publishMetadataSchema = z
  .object({
    create_time: numOrStr.optional(),
    update_time: numOrStr.optional(),
  })
  .passthrough();

const publishInfoSchema = z
  .object({
    appmsg_info: z.array(publishedArticleSchema).optional(),
    publish_info: z.preprocess(parseMaybeJsonObject, publishMetadataSchema).optional(),
  })
  .passthrough();

const publishPageSchema = z
  .object({
    total_count: z.coerce.number().optional().default(0),
    publish_list: z
      .array(z.object({ publish_info: z.string().optional() }).passthrough())
      .optional()
      .default([]),
  })
  .passthrough();

function parseMaybeJsonObject(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return {};
  return JSON.parse(trimmed) as unknown;
}

const latestCommentAppMsgSchema = z
  .object({
    id: numOrStr.optional(),
    item: z
      .object({
        comment_id: numOrStr.optional(),
        seq: numOrStr.optional(),
        total_comment_cnt: z.coerce.number().optional().default(0),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const latestCommentRespSchema = z
  .object({
    app_msg_list: z.preprocess(
      parseMaybeJsonObject,
      z
        .object({
          app_msg: z.array(latestCommentAppMsgSchema).optional().default([]),
        })
        .passthrough()
    ),
  })
  .passthrough();

export interface PublishedArticleStats {
  appmsgid: string;
  itemidx: number;
  title: string;
  read_num: number;
  old_like_num: number;
  like_num: number;
  comment_num: number;
  total_comment_count_contains_reply: number;
  comment_id: string;
  share_num: number;
}

export function publishedStatsKey(appmsgid: string | number, itemidx: string | number): string {
  return `${String(appmsgid)}:${Number(itemidx) || 1}`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parsePublishPage(html: string): z.infer<typeof publishPageSchema> {
  const match = html.match(/publish_page\s*=\s*({[\s\S]*?});\s*isPublishPageNoEncode\s*=/);
  if (!match?.[1]) throw new Error('已发表列表页未找到 publish_page 数据');
  return publishPageSchema.parse(JSON.parse(match[1]));
}

/** 新版已发表 DOM 中的当前登录公众号名；用于多账号 fail closed。 */
export function parsePublishedAccountNameFromHtml(html: string): string {
  const match = html.match(/\bnick_name\s*:\s*["']([^"']+)["']/);
  return match?.[1] ? decodeHtmlEntities(match[1]).trim() : '';
}

/** 新版已发表 DOM → 文章列表项，供增量正文采集复用。 */
export function parsePublishedArticleItemsFromHtml(html: string): ArticleListItem[] {
  const page = parsePublishPage(html);
  const articles: ArticleListItem[] = [];
  for (const item of page.publish_list) {
    if (!item.publish_info) continue;
    const info = publishInfoSchema.parse(JSON.parse(decodeHtmlEntities(item.publish_info)));
    const createTime = info.publish_info?.create_time ?? info.publish_info?.update_time;
    for (const article of info.appmsg_info ?? []) {
      const link = article.content_url?.trim();
      if (!link) continue;
      articles.push({
        aid: article.appmsgid,
        appmsgid: article.appmsgid,
        itemidx: article.itemidx,
        idx: article.itemidx,
        link,
        title: article.title,
        author: article.author,
        digest: article.digest,
        cover: article.cover,
        create_time: createTime,
        item_show_type: article.item_show_type,
        is_deleted: article.is_deleted,
        is_pay_subscribe: article.is_pay_subscribe,
      });
    }
  }
  return articles;
}

function collectPublishedArticleStats(page: z.infer<typeof publishPageSchema>): Map<string, PublishedArticleStats> {
  const result = new Map<string, PublishedArticleStats>();
  for (const item of page.publish_list) {
    if (!item.publish_info) continue;
    const info = publishInfoSchema.parse(JSON.parse(decodeHtmlEntities(item.publish_info)));
    for (const article of info.appmsg_info ?? []) {
      if (article.appmsgid === undefined) continue;
      const appmsgid = String(article.appmsgid);
      const itemidx = Number(article.itemidx ?? 1) || 1;
      result.set(publishedStatsKey(appmsgid, itemidx), {
        appmsgid,
        itemidx,
        title: article.title ?? '',
        read_num: article.read_num,
        old_like_num: article.old_like_num,
        like_num: article.like_num,
        comment_num: article.comment_num,
        total_comment_count_contains_reply: article.total_comment_count_contains_reply ?? article.comment_num,
        comment_id: article.comment_id === undefined ? '' : String(article.comment_id),
        share_num: article.share_num,
      });
    }
  }
  return result;
}

export function parsePublishedArticleStatsFromHtml(html: string): Map<string, PublishedArticleStats> {
  return collectPublishedArticleStats(parsePublishPage(html));
}

async function fetchPublishPage(session: MpSession, begin: number): Promise<z.infer<typeof publishPageSchema>> {
  const html = await fetchMpHtml(session, '/cgi-bin/appmsgpublish', {
    sub: 'list',
    begin,
    count: PAGE_SIZE,
  });
  return parsePublishPage(html);
}

async function fetchLatestCommentIds(session: MpSession): Promise<Map<string, string>> {
  const text = await fetchMpHtml(session, '/misc/appmsgcomment', {
    action: 'list_latest_comment',
    begin: 0,
    count: config.comments.latestCount,
    sendtype: 'MASSSEND',
    scene: 1,
    f: 'json',
    ajax: 1,
  });
  const raw: unknown = JSON.parse(text);
  const parsed = latestCommentRespSchema.parse(raw);
  const result = new Map<string, string>();
  for (const msg of parsed.app_msg_list.app_msg) {
    if (msg.id === undefined || msg.item?.comment_id === undefined) continue;
    const commentId = String(msg.item.comment_id).trim();
    if (!commentId) continue;
    result.set(publishedStatsKey(msg.id, msg.item.seq ?? 1), commentId);
  }
  return result;
}

async function fillMissingCommentIds(session: MpSession, result: Map<string, PublishedArticleStats>): Promise<void> {
  const needsFallback = [...result.values()].some(
    stats => stats.total_comment_count_contains_reply > 0 && !stats.comment_id.trim()
  );
  if (!needsFallback) return;
  try {
    const ids = await fetchLatestCommentIds(session);
    for (const [key, stats] of result) {
      if (stats.comment_id.trim()) continue;
      const commentId = ids.get(key);
      if (commentId) result.set(key, { ...stats, comment_id: commentId });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`最新评论 comment_id 兜底获取失败,继续使用 appmsgpublish: ${msg}`);
  }
}

/**
 * 抓「已发表」列表页里的实时人数统计。
 * 字段映射:
 * - read_num → 阅读
 * - old_like_num → 点赞
 * - like_num → 在看/喜欢
 * - share_num → 分享
 * - total_comment_count_contains_reply/comment_num → 评论
 */
export async function fetchPublishedArticleStats(session: MpSession): Promise<Map<string, PublishedArticleStats>> {
  const result = new Map<string, PublishedArticleStats>();
  let begin = 0;
  let total = Number.POSITIVE_INFINITY;

  while (begin < total) {
    const page = await fetchPublishPage(session, begin);
    total = page.total_count;
    const list = page.publish_list;
    if (list.length === 0) break;

    for (const [key, stats] of collectPublishedArticleStats(page)) result.set(key, stats);

    begin += list.length;
  }

  await fillMissingCommentIds(session, result);
  return result;
}

/** 用已发表列表的实时口径覆盖详情页统计的基础指标,保留收藏/读后关注/完读率等详情页独有字段。 */
export function applyPublishedStats(stats: ArticleStats, published: PublishedArticleStats | undefined): ArticleStats {
  if (!published) return stats;
  return {
    ...stats,
    read_uv: published.read_num,
    like_cnt: published.old_like_num,
    zaikan_cnt: published.like_num,
    comment_cnt: published.total_comment_count_contains_reply,
    share_uv: published.share_num,
  };
}
