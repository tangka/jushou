import { z } from 'zod';
import { config } from '../config/index.js';
import { fetchMpHtml, type MpSession } from './session.js';

const numOrStr = z.union([z.number(), z.string()]);
// 公众号后台留言管理新版前端的筛选值:
// 1=精选,2=全部留言,3=置顶,4=已屏蔽,5=有更新。
const COMMENT_LIST_TYPE_ALL = 2;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * comment_list 实测是 JSON **字符串**,parse 后是**对象** `{ comment: [...], total_count, ... }`,
 * 评论在 `.comment`(不是裸数组)。这里统一取出评论数组。
 */
function extractCommentArray(value: unknown): unknown {
  let v: unknown = value;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    v = trimmed ? (JSON.parse(trimmed) as unknown) : [];
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.comment)) return o.comment;
    if (Array.isArray(o.normal_comment)) return o.normal_comment;
  }
  return [];
}

/** 留言正文偶尔带原始 HTML(如 @某人 的 `<a class="js_mention_...">`);剥标签 + 解常见实体。 */
function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function booleanish(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  return false;
}

const commentReplyItemSchema = z
  .object({
    content: z.preprocess(stripHtml, z.string()).optional().default(''),
    nick_name: z.string().optional().default(''),
    reply_id: numOrStr.optional(),
    reply_like_num: z.coerce.number().optional(),
    reply_is_elected: z.preprocess(booleanish, z.boolean()).optional(),
    reply_del_flag: z.coerce.number().optional(),
    shield_status: z.coerce.number().optional(),
    reply_time: z.coerce.number().optional(),
    create_time: z.coerce.number().optional(),
  })
  .passthrough();

const commentReplySchema = z
  .object({
    reply_list: z.array(commentReplyItemSchema).optional().default([]),
    reply_count: z.coerce.number().optional(),
    max_reply_id: z.coerce.number().optional(),
    shield_reply_cnt: z.coerce.number().optional(),
    elected_reply_cnt: z.coerce.number().optional(),
  })
  .passthrough();

const commentNewReplySchema = z
  .object({
    reply_list: z.array(commentReplyItemSchema).optional().default([]),
    reply_total_cnt: z.coerce.number().optional(),
    max_reply_id: z.coerce.number().optional(),
    shield_reply_cnt: z.coerce.number().optional(),
    elected_reply_cnt: z.coerce.number().optional(),
  })
  .passthrough();

export const articleCommentSchema = z
  .object({
    content_id: numOrStr.transform(String).pipe(z.string().min(1)),
    nick_name: z.string().optional().default(''),
    content: z.preprocess(stripHtml, z.string()).optional().default(''),
    like_num: z.coerce.number().optional().default(0),
    is_elected: z.preprocess(booleanish, z.boolean()).optional().default(false),
    ip_wording: z.string().optional().default(''),
    post_time: z.coerce.number().optional().default(0),
    reply: commentReplySchema.optional(),
    new_reply: commentNewReplySchema.optional(),
  })
  .passthrough();
export type ArticleComment = z.infer<typeof articleCommentSchema>;

const commentListSchema = z.preprocess(extractCommentArray, z.array(articleCommentSchema));

const commentRespSchema = z
  .object({
    base_resp: z
      .object({
        ret: z.coerce.number().optional(),
        err_msg: z.string().optional(),
      })
      .passthrough()
      .optional(),
    comment_list: commentListSchema.optional().default([]),
    // comment_list_count 实测是空对象 {} 而非数字,不用它(别 coerce,否则解析崩)
    comment_list_count: z.unknown().optional(),
    title: z.string().optional().default(''),
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
    title: z.string().optional().default(''),
    create_time: z.coerce.number().optional().default(0),
    item: z
      .object({
        comment_id: numOrStr.optional(),
        seq: numOrStr.optional(),
        title: z.string().optional().default(''),
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

function extractReplyListObject(value: unknown): unknown {
  let v: unknown = value;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    v = trimmed ? (JSON.parse(trimmed) as unknown) : {};
  }
  if (Array.isArray(v)) return { reply_list: v };
  return v && typeof v === 'object' ? v : {};
}

const commentReplyListSchema = z.preprocess(
  extractReplyListObject,
  z
    .object({
      reply_list: z.array(commentReplyItemSchema).optional().default([]),
      max_reply_id: z.coerce.number().optional().default(0),
    })
    .passthrough()
);

const commentReplyRespSchema = z
  .object({
    base_resp: z
      .object({
        ret: z.coerce.number().optional(),
        err_msg: z.string().optional(),
      })
      .passthrough()
      .optional(),
    reply_list: commentReplyListSchema.optional().default({ reply_list: [], max_reply_id: 0 }),
    continue_flag: z.preprocess(booleanish, z.boolean()).optional().default(false),
  })
  .passthrough();

export interface LatestCommentArticle {
  appmsgid: string;
  itemidx: number;
  title: string;
  commentId: string;
  totalCommentCount: number;
  createTime: number;
}

export function parseArticleCommentsResponse(raw: unknown): ArticleComment[] {
  const parsed = commentRespSchema.parse(raw);
  const ret = parsed.base_resp?.ret ?? 0;
  if (ret !== 0) {
    throw new Error(`留言接口返回异常: ret=${ret} ${parsed.base_resp?.err_msg ?? ''}`.trim());
  }
  return parsed.comment_list;
}

export function parseLatestCommentArticles(raw: unknown): LatestCommentArticle[] {
  const parsed = latestCommentRespSchema.parse(raw);
  const articles: LatestCommentArticle[] = [];
  for (const msg of parsed.app_msg_list.app_msg) {
    if (msg.id === undefined || msg.item?.comment_id === undefined) continue;
    const commentId = String(msg.item.comment_id).trim();
    if (!commentId) continue;
    articles.push({
      appmsgid: String(msg.id),
      itemidx: Number(msg.item.seq ?? 1) || 1,
      title: msg.item.title || msg.title,
      commentId,
      totalCommentCount: msg.item.total_comment_cnt,
      createTime: msg.create_time,
    });
  }
  return articles;
}

export async function fetchLatestCommentArticles(session: MpSession): Promise<LatestCommentArticle[]> {
  const text = await fetchMpHtml(session, '/misc/appmsgcomment', {
    action: 'list_latest_comment',
    begin: 0,
    count: config.comments.latestCount,
    sendtype: 'MASSSEND',
    scene: 1,
    f: 'json',
    ajax: 1,
  });
  return parseLatestCommentArticles(JSON.parse(text));
}

function replyId(reply: z.infer<typeof commentReplyItemSchema>): string {
  return String(reply.reply_id ?? `${reply.nick_name}:${reply.create_time ?? reply.reply_time ?? ''}:${reply.content}`);
}

function mergeReplies(
  current: readonly z.infer<typeof commentReplyItemSchema>[],
  incoming: readonly z.infer<typeof commentReplyItemSchema>[]
): z.infer<typeof commentReplyItemSchema>[] {
  const byId = new Map<string, z.infer<typeof commentReplyItemSchema>>();
  for (const reply of current) {
    if (reply.content) byId.set(replyId(reply), reply);
  }
  for (const reply of incoming) {
    if (reply.content) byId.set(replyId(reply), reply);
  }
  return [...byId.values()].sort((a, b) => Number(a.reply_id ?? 0) - Number(b.reply_id ?? 0));
}

function commentReplyTotal(comment: ArticleComment): number {
  return comment.new_reply?.reply_total_cnt ?? comment.reply?.reply_count ?? comment.reply?.reply_list.length ?? 0;
}

function commentShieldReplyTotal(comment: ArticleComment): number {
  return comment.new_reply?.shield_reply_cnt ?? comment.reply?.shield_reply_cnt ?? 0;
}

function commentMaxReplyId(comment: ArticleComment): number {
  return comment.new_reply?.max_reply_id ?? comment.reply?.max_reply_id ?? 0;
}

function parseCommentReplyResponse(raw: unknown): z.infer<typeof commentReplyRespSchema> {
  const parsed = commentReplyRespSchema.parse(raw);
  const ret = parsed.base_resp?.ret ?? 0;
  if (ret !== 0) {
    throw new Error(`留言回复接口返回异常: ret=${ret} ${parsed.base_resp?.err_msg ?? ''}`.trim());
  }
  return parsed;
}

async function fetchVisibleReplies(
  session: MpSession,
  commentId: string,
  contentId: string,
  initialMaxReplyId: number
): Promise<z.infer<typeof commentReplyItemSchema>[]> {
  if (!initialMaxReplyId) return [];
  const replies: z.infer<typeof commentReplyItemSchema>[] = [];
  let maxReplyId = initialMaxReplyId;
  for (;;) {
    const text = await fetchMpHtml(session, '/misc/appmsgcomment', {
      action: 'get_comment_reply',
      comment_id: commentId,
      content_id: contentId,
      limit: 10,
      max_reply_id: maxReplyId,
      clear_unread: 0,
      f: 'json',
      ajax: 1,
    });
    const page = parseCommentReplyResponse(JSON.parse(text));
    replies.push(...page.reply_list.reply_list);
    if (!page.continue_flag || page.reply_list.reply_list.length === 0) break;
    maxReplyId = page.reply_list.max_reply_id;
    await sleep(config.requestIntervalMs);
  }
  return replies;
}

async function fetchShieldReplies(
  session: MpSession,
  commentId: string,
  contentId: string
): Promise<z.infer<typeof commentReplyItemSchema>[]> {
  const replies: z.infer<typeof commentReplyItemSchema>[] = [];
  let offset = 0;
  for (;;) {
    const text = await fetchMpHtml(session, '/misc/appmsgcomment', {
      action: 'get_comment_reply',
      comment_id: commentId,
      content_id: contentId,
      limit: 10,
      offset,
      is_shield: 1,
      f: 'json',
      ajax: 1,
    });
    const page = parseCommentReplyResponse(JSON.parse(text));
    const pageReplies = page.reply_list.reply_list.map(reply => ({
      ...reply,
      shield_status: reply.shield_status || 3,
    }));
    replies.push(...pageReplies);
    if (!page.continue_flag || pageReplies.length === 0) break;
    offset += pageReplies.length;
    await sleep(config.requestIntervalMs);
  }
  return replies;
}

async function fetchAllRepliesForComment(
  session: MpSession,
  commentId: string,
  comment: ArticleComment
): Promise<z.infer<typeof commentReplyItemSchema>[]> {
  const current = comment.new_reply?.reply_list ?? comment.reply?.reply_list ?? [];
  const visibleTotal = commentReplyTotal(comment);
  const shieldTotal = commentShieldReplyTotal(comment);
  if (visibleTotal + shieldTotal <= current.length) return current;

  const visible = await fetchVisibleReplies(session, commentId, comment.content_id, commentMaxReplyId(comment));
  const mergedVisible = mergeReplies(current, visible);
  if (shieldTotal <= 0) return mergedVisible;

  await sleep(config.requestIntervalMs);
  const shield = await fetchShieldReplies(session, commentId, comment.content_id);
  return mergeReplies(mergedVisible, shield);
}

/** 抓单篇文章全部留言正文。空 comment_id 由调用方跳过,这里直接返回空数组兜底。 */
export async function fetchArticleComments(session: MpSession, commentId: string): Promise<ArticleComment[]> {
  if (!commentId.trim()) return [];
  const all: ArticleComment[] = [];
  const seen = new Set<string>();
  const count = config.comments.fetchCount;

  for (let begin = 0; ; begin += count) {
    const text = await fetchMpHtml(session, '/misc/appmsgcomment', {
      action: 'list_comment',
      comment_id: commentId,
      begin,
      count,
      filtertype: 0,
      day: 0,
      type: COMMENT_LIST_TYPE_ALL,
      max_id: 0,
      f: 'json',
      ajax: 1,
    });
    const raw: unknown = JSON.parse(text);
    const page = parseArticleCommentsResponse(raw);
    let added = 0;
    for (const comment of page) {
      if (seen.has(comment.content_id)) continue;
      seen.add(comment.content_id);
      all.push(comment);
      added += 1;
    }
    if (page.length < count || added === 0) break;
    await sleep(config.requestIntervalMs);
  }

  for (const comment of all) {
    if (commentReplyTotal(comment) + commentShieldReplyTotal(comment) <= 0) continue;
    await sleep(config.requestIntervalMs);
    const replies = await fetchAllRepliesForComment(session, commentId, comment);
    comment.reply = {
      reply_count: comment.reply?.reply_count ?? replies.length,
      max_reply_id: comment.reply?.max_reply_id ?? commentMaxReplyId(comment),
      shield_reply_cnt: comment.reply?.shield_reply_cnt ?? commentShieldReplyTotal(comment),
      elected_reply_cnt: comment.reply?.elected_reply_cnt ?? comment.new_reply?.elected_reply_cnt ?? 0,
      ...(comment.reply ?? {}),
      reply_list: replies,
    };
    if (comment.new_reply) comment.new_reply.reply_list = replies;
  }

  return all;
}
