import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import {
  upsertToutiaoComment,
  upsertToutiaoItem,
  upsertToutiaoItemSnapshot,
  upsertToutiaoRawCapture,
} from '../db/index.js';
import { writeToutiaoMarkdown } from '../fetch-toutiao-stats.js';
import {
  type ToutiaoCaptureTarget,
  type ToutiaoComment,
  type ToutiaoItem,
  type ToutiaoMetrics,
  type ToutiaoRawCapture,
  toutiaoCaptureTargetSchema,
  toutiaoRawCaptureSchema,
} from '../types/toutiao.js';
import { isMain, runCli } from '../utils/cli.js';
import { toDate } from '../utils/date.js';

type CaptureInput =
  | {
      captures?:
        | Partial<Record<ToutiaoCaptureTarget, ToutiaoRawCapture[]>>
        | Array<ToutiaoRawCapture & { target?: ToutiaoCaptureTarget }>;
      item_list?: unknown;
      item_stats?: unknown;
      comments?: unknown;
      fans?: unknown;
      income?: unknown;
    }
  | Partial<Record<ToutiaoCaptureTarget, unknown>>;

const TARGET_KEYS = ['item_list', 'item_stats', 'comments', 'fans', 'income', 'unknown'] as const;

interface ImportStats {
  captures: number;
  items: number;
  comments: number;
}

function parseCli(argv: readonly string[]): { file: string } {
  let file = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--file') {
      const value = argv[i + 1];
      if (!value) throw new Error('--file 需要传 Codex 浏览器采集 JSON 路径');
      file = value;
      i++;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`用法:
  pnpm toutiao:import-capture -- --file .data/toutiao-codex-capture-${config.accountExact}.json

说明:
  - 导入 Codex 内置浏览器从头条号后台抓到的作品列表/数据/评论 JSON。
  - 先保存原始响应,再尽量识别作品与评论字段落 SQLite。`);
      process.exit(0);
    } else {
      throw new Error(`未知参数:${arg}`);
    }
  }
  if (!file) file = `.data/toutiao-codex-capture-${config.accountExact}.json`;
  return { file };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): ToutiaoRawCapture[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(v => {
    const record = asRecord(v);
    if (record && 'json' in record) return toutiaoRawCaptureSchema.parse(record);
    return toutiaoRawCaptureSchema.parse({ json: v });
  });
}

function targetFromUrl(url: string): ToutiaoCaptureTarget {
  const lower = url.toLowerCase();
  if (/comment|reply|interaction|message/.test(lower)) return 'comments';
  if (/income|revenue|profit|earning|收益/.test(lower)) return 'income';
  if (/fan|follower|粉丝|user_stat/.test(lower)) return 'fans';
  if (/stat|data|analysis|analytics/.test(lower)) return 'item_stats';
  if (/article|content|item|list|manage|publish/.test(lower)) return 'item_list';
  return 'unknown';
}

function normalizeCaptures(input: CaptureInput): Record<ToutiaoCaptureTarget, ToutiaoRawCapture[]> {
  const out: Record<ToutiaoCaptureTarget, ToutiaoRawCapture[]> = {
    item_list: [],
    item_stats: [],
    comments: [],
    fans: [],
    income: [],
    unknown: [],
  };
  const record = input as Record<string, unknown>;
  const captures = record.captures;
  if (Array.isArray(captures)) {
    for (const raw of captures) {
      const parsed = toutiaoRawCaptureSchema.parse(raw);
      const target = toutiaoCaptureTargetSchema.parse(parsed.target ?? targetFromUrl(parsed.matchedUrl));
      out[target].push({ ...parsed, target });
    }
  } else if (captures && typeof captures === 'object') {
    for (const key of TARGET_KEYS) {
      for (const capture of asArray((captures as Record<string, unknown>)[key]))
        out[key].push({ ...capture, target: key });
    }
  }

  for (const key of TARGET_KEYS) {
    for (const capture of asArray(record[key])) out[key].push({ ...capture, target: key });
  }

  for (const capture of out.unknown.splice(0)) {
    const target = targetFromUrl(capture.matchedUrl);
    out[target].push({ ...capture, target });
  }
  return out;
}

function primitiveString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = primitiveString(record[key]);
    if (value) return value;
  }
  return '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/[,，]/g, '').trim();
    if (/^\d+(\.\d+)?万$/.test(normalized)) return Math.round(Number(normalized.slice(0, -1)) * 10_000);
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function unixSeconds(value: unknown): number | null {
  const n = numberValue(value);
  if (n !== null) return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
  const text = primitiveString(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function firstUnixSeconds(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = unixSeconds(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function centsFrom(record: Record<string, unknown>): number | null {
  const cents = firstNumber(record, ['income_cents', 'incomeCents', 'revenue_cents', 'amount_cents']);
  if (cents !== null) return Math.round(cents);
  const yuan = firstNumber(record, ['income', 'revenue', 'amount', 'profit', '收益']);
  return yuan === null ? null : Math.round(yuan * 100);
}

function metricsFrom(record: Record<string, unknown>): ToutiaoMetrics {
  return {
    readCount: firstNumber(record, [
      'read_count',
      'readCount',
      'read_num',
      'readNum',
      'readCnt',
      'view_count',
      'viewCount',
      'go_detail_count',
      'pv',
      'read',
    ]),
    commentCount: firstNumber(record, ['comment_count', 'commentCount', 'comment_num', 'commentNum', 'comments']),
    likeCount: firstNumber(record, ['like_count', 'likeCount', 'digg_count', 'diggCount', 'bury_count', 'likes']),
    shareCount: firstNumber(record, ['share_count', 'shareCount', 'share_num', 'shareNum', 'repost_count']),
    favoriteCount: firstNumber(record, [
      'favorite_count',
      'favoriteCount',
      'collect_count',
      'collectCount',
      'fav_count',
    ]),
    followCount: firstNumber(record, ['follow_count', 'followCount', 'new_follow_count', 'subscribe_count']),
    incomeCents: centsFrom(record),
  };
}

function findArrays(value: unknown, maxDepth = 7): unknown[][] {
  const out: unknown[][] = [];
  const seen = new Set<unknown>();
  function walk(current: unknown, depth: number): void {
    if (depth > maxDepth || current === null || current === undefined) return;
    if (typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.some(v => asRecord(v))) out.push(current);
      for (const child of current) walk(child, depth + 1);
      return;
    }
    for (const child of Object.values(current as Record<string, unknown>)) walk(child, depth + 1);
  }
  walk(value, 0);
  return out;
}

function itemFromRecord(record: Record<string, unknown>): ToutiaoItem | null {
  const title = firstString(record, ['title', 'display_title', 'name', 'content_title']);
  const itemId = firstString(record, [
    'group_id',
    'groupId',
    'item_id',
    'itemId',
    'article_id',
    'articleId',
    'content_id',
    'contentId',
    'id',
    'gid',
  ]);
  if (!title || !itemId) return null;
  return {
    itemId,
    title,
    url: firstString(record, [
      'url',
      'article_url',
      'articleUrl',
      'share_url',
      'shareUrl',
      'display_url',
      'source_url',
    ]),
    itemType: firstString(record, ['item_type', 'itemType', 'type', 'genre', 'content_type']) || 'unknown',
    publishTime: firstUnixSeconds(record, [
      'publish_time',
      'publishTime',
      'create_time',
      'createTime',
      'display_time',
      'release_time',
      'published_at',
      'date',
    ]),
    status: firstString(record, ['status', 'status_text', 'statusText', 'review_status', 'audit_status']),
    abstract: firstString(record, ['abstract', 'summary', 'description', 'desc']),
    metrics: metricsFrom(record),
    raw: record,
  };
}

function commentFromRecord(record: Record<string, unknown>): ToutiaoComment | null {
  const content = firstString(record, ['content', 'text', 'comment', 'comment_text', 'commentText']);
  const commentId = firstString(record, ['comment_id', 'commentId', 'comment_id_str', 'id', 'cid']);
  if (!content || !commentId) return null;
  return {
    commentId,
    itemId:
      firstString(record, ['item_id', 'itemId', 'group_id', 'groupId', 'article_id', 'articleId', 'content_id']) ||
      'unknown',
    nickName: firstString(record, ['nick_name', 'nickName', 'nickname', 'user_name', 'userName', 'name']),
    content,
    likeCount: firstNumber(record, ['like_count', 'likeCount', 'digg_count', 'diggCount']),
    replyCount: firstNumber(record, ['reply_count', 'replyCount', 'reply_num', 'replyNum']),
    createTime: firstUnixSeconds(record, ['create_time', 'createTime', 'comment_time', 'commentTime', 'time']),
    status: firstString(record, ['status', 'status_text', 'state']),
    raw: record,
  };
}

function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function extractItems(captures: ToutiaoRawCapture[]): ToutiaoItem[] {
  const rows: ToutiaoItem[] = [];
  for (const capture of captures) {
    for (const array of findArrays(capture.json)) {
      for (const value of array) {
        const record = asRecord(value);
        if (!record) continue;
        const item = itemFromRecord(record);
        if (item) rows.push(item);
      }
    }
  }
  return uniqueBy(rows, row => row.itemId);
}

function extractComments(captures: ToutiaoRawCapture[]): ToutiaoComment[] {
  const rows: ToutiaoComment[] = [];
  for (const capture of captures) {
    for (const array of findArrays(capture.json)) {
      for (const value of array) {
        const record = asRecord(value);
        if (!record) continue;
        const comment = commentFromRecord(record);
        if (comment) rows.push(comment);
      }
    }
  }
  return uniqueBy(rows, row => row.commentId);
}

export async function importToutiaoCapture(file: string): Promise<ImportStats> {
  const input = JSON.parse(await fs.readFile(path.resolve(file), 'utf8')) as CaptureInput;
  const captures = normalizeCaptures(input);
  const capturedAt = Math.floor(Date.now() / 1000);
  const capturedDay = toDate(capturedAt);
  let captureCount = 0;
  for (const target of TARGET_KEYS) {
    for (const capture of captures[target]) {
      upsertToutiaoRawCapture(target, capture);
      captureCount++;
    }
  }

  const items = extractItems([...captures.item_list, ...captures.item_stats, ...captures.income]);
  for (const item of items) {
    upsertToutiaoItem(item, capturedAt);
    upsertToutiaoItemSnapshot(item, capturedAt, capturedDay);
  }

  const comments = extractComments(captures.comments);
  for (const comment of comments) upsertToutiaoComment(comment, capturedAt);

  return { captures: captureCount, items: items.length, comments: comments.length };
}

export async function run(): Promise<void> {
  const { file } = parseCli(process.argv.slice(2));
  const stats = await importToutiaoCapture(file);
  await writeToutiaoMarkdown();
  console.log(`Codex 头条号采集导入:${file}`);
  console.log(`原始响应:${stats.captures}`);
  console.log(`作品:${stats.items}`);
  console.log(`评论:${stats.comments}`);
  console.log(`DB ${config.dbPath}`);
  console.log(`INDEX ${config.paths.toutiaoOverview}`);
}

if (isMain(import.meta.url)) runCli(run);
