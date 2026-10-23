import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { articlePaths, config } from './config/index.js';
import { getArticleIncomes, upsertArticle, upsertArticleComments, upsertSnapshot } from './db/index.js';
import { type MediaType, mediaTypeOf } from './types/topic.js';
import { articleDetailSchema, articleListItemSchema } from './types/wechat.js';
import { toDate, toDateTime, toUnixSeconds } from './utils/date.js';
import { countImageRefs, csvEscape, decodeHtmlEntities, mdEscape, safeName } from './utils/text.js';
import { type ArticleComment, articleCommentSchema } from './wechat/comments.js';
import { articleStatsSchema } from './wechat/stats.js';

/** 一条采集记录:列表项 + 正文详情 + (可选)互动数据。即每篇 `<base>/raw.json` 的内容。 */
export const detailEntrySchema = z
  .object({
    listItem: articleListItemSchema,
    detail: articleDetailSchema,
    stats: articleStatsSchema.optional(),
    comments: z.array(articleCommentSchema).optional(),
  })
  .passthrough();
// dirBase:该篇真实所在文件夹名(readDetailEntries 遍历时附上)。链接/路径一律用它,
// 不再由标题+日期重算 base——重算的日期可能与磁盘文件夹差一天而断链。
export type DetailEntry = z.infer<typeof detailEntrySchema> & { dirBase: string };

/**
 * 扫账号目录下每个「文章文件夹」的 raw.json(一篇一文件夹),校验后按文件夹名(日期前缀)排序。
 * 无 raw.json 的目录(reports/templates 等)自动跳过。
 */
export async function readDetailEntries(): Promise<DetailEntry[]> {
  let dirents: { name: string; isDirectory: () => boolean }[];
  try {
    dirents = await fs.readdir(config.accountDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = dirents
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const entries: DetailEntry[] = [];
  for (const base of dirs) {
    const raw = await fs.readFile(articlePaths(base).rawJson, 'utf8').catch(() => null);
    if (raw === null) continue; // 非文章文件夹
    entries.push({ ...detailEntrySchema.parse(JSON.parse(raw)), dirBase: base });
  }
  return entries;
}

export interface ArticleRow {
  index: number;
  title: string;
  media_type: MediaType;
  published: string;
  markdown: string;
  json: string;
  url: string;
  digest: string;
  account: string;
  author: string;
  appmsgid: string | number;
  aid: string | number;
  itemidx: string | number;
  comment_id: string | number;
  content_chars: number;
  image_count: number;
  is_deleted: string;
  is_pay_subscribe: string;
  read_uv: number | '';
  like_count: number | '';
  zaikan_count: number | '';
  comment_count: number | '';
  share_uv: number | '';
  collection_uv: number | '';
  avg_read_minutes: number | '';
  finished_read_ratio: number | '';
  follow_after_read_uv: number | '';
  comment_highlights: string;
}

interface MediaSummary {
  media_type: MediaType;
  count: number;
  avgRead: number;
  medianRead: number;
  avgLike: number;
  sumFollow: number;
}

function optStr(value: unknown): string {
  return value ? String(value) : '';
}

function shorten(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function pickCommentHighlights(comments: readonly ArticleComment[]): ArticleComment[] {
  const byLikes = (a: ArticleComment, b: ArticleComment): number => b.like_num - a.like_num;
  const elected = comments.filter(c => c.is_elected).sort(byLikes);
  const top = [...comments].sort(byLikes);
  const picked: ArticleComment[] = [];
  const seen = new Set<string>();
  for (const comment of [...elected, ...top]) {
    if (seen.has(comment.content_id)) continue;
    picked.push(comment);
    seen.add(comment.content_id);
    if (picked.length >= config.comments.highlightsLimit) break;
  }
  return picked;
}

function formatCommentHighlights(comments: readonly ArticleComment[] | undefined): string {
  if (!comments?.length) return '';
  return pickCommentHighlights(comments)
    .map(comment => {
      const tags = [
        comment.is_elected ? '精选' : '',
        comment.like_num > 0 ? `${comment.like_num}赞` : '',
        comment.ip_wording,
      ].filter(Boolean);
      const prefix = tags.length ? `【${tags.join('·')}】` : '';
      const nick = mdEscape(comment.nick_name || '匿名');
      const content = shorten(mdEscape(comment.content), 48);
      return `${prefix}${nick}: ${content}`;
    })
    .join('<br>');
}

/** 文件名 base(markdown / json 同源),由发布日期 + 标题派生。 */
export function articleBase(entry: DetailEntry, index: number): string {
  const { listItem: item, detail } = entry;
  const title = decodeHtmlEntities(detail.title || item.title || `article-${index + 1}`);
  const date = toDate(detail.ori_create_time || detail.ori_send_time || item.create_time);
  return safeName(`${date}-${title}`, `article-${index + 1}`);
}

function buildRow(entry: DetailEntry, index: number): ArticleRow {
  const { listItem: item, detail, stats } = entry;
  const base = entry.dirBase; // 真实文件夹名,保证链接不断
  return {
    index: index + 1,
    title: decodeHtmlEntities(detail.title || item.title || `article-${index + 1}`),
    media_type: mediaTypeOf(item.item_show_type),
    published: toDateTime(detail.ori_create_time || detail.ori_send_time || item.create_time),
    markdown: `${base}/${base}.md`,
    json: `${base}/raw.json`,
    url: item.link || detail.link || '',
    digest: detail.desc || item.digest || '',
    account: detail.nick_name || '',
    author: detail.author || item.author_name || '',
    appmsgid: item.appmsgid || detail.mid || '',
    aid: item.aid || '',
    itemidx: item.itemidx || detail.idx || '',
    comment_id: detail.comment_id || '',
    content_chars: String(detail.content_noencode || '').length,
    image_count: countImageRefs(detail.content_noencode),
    is_deleted: optStr(item.is_deleted),
    is_pay_subscribe: optStr(item.is_pay_subscribe ?? detail.is_pay_subscribe),
    read_uv: stats?.read_uv ?? '',
    like_count: stats?.like_cnt ?? '',
    zaikan_count: stats?.zaikan_cnt ?? '',
    comment_count: stats?.comment_cnt ?? '',
    share_uv: stats?.share_uv ?? '',
    collection_uv: stats?.collection_uv ?? '',
    avg_read_minutes: stats?.avg_article_read_time_minutes ?? '',
    finished_read_ratio: stats?.finished_read_pv_ratio ?? '',
    follow_after_read_uv: stats?.follow_after_read_uv ?? '',
    comment_highlights: formatCommentHighlights(entry.comments),
  };
}

/** 映射所有记录为行,并按发布时间倒序(index 保留原始顺序)。 */
export function buildRows(entries: DetailEntry[]): ArticleRow[] {
  return entries.map(buildRow).sort((a, b) => b.published.localeCompare(a.published));
}

function numeric(value: number | ''): number {
  return typeof value === 'number' ? value : 0;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (sorted.length % 2 === 0 && lo !== undefined && hi !== undefined) return Math.round((lo + hi) / 2);
  return hi ?? 0;
}

/**
 * 旧目录里可能残留同 appmsgid+itemidx 的 raw.json;总览按文章去重。
 * 同一文章保留 entry index 最大的一条,与 writeDbSnapshots 的后写覆盖口径一致。
 */
export function dedupeRows(rows: ArticleRow[]): ArticleRow[] {
  const byArticle = new Map<string, ArticleRow>();
  for (const row of rows) {
    const appmsgid = String(row.appmsgid || '');
    const itemidx = String(row.itemidx || '');
    const key = appmsgid && itemidx ? `${appmsgid}:${itemidx}` : `row:${row.index}`;
    const prev = byArticle.get(key);
    if (!prev || row.index > prev.index) byArticle.set(key, row);
  }
  return [...byArticle.values()].sort((a, b) => b.published.localeCompare(a.published));
}

function buildMediaSummary(rows: ArticleRow[]): MediaSummary[] {
  const buckets = new Map<MediaType, ArticleRow[]>();
  for (const row of rows) {
    const list = buckets.get(row.media_type);
    if (list) list.push(row);
    else buckets.set(row.media_type, [row]);
  }
  return [...buckets.entries()]
    .map(([media_type, items]) => ({
      media_type,
      count: items.length,
      avgRead: avg(items.map(i => numeric(i.read_uv))),
      medianRead: median(items.map(i => numeric(i.read_uv))),
      avgLike: avg(items.map(i => numeric(i.like_count))),
      sumFollow: items.reduce((sum, i) => sum + numeric(i.follow_after_read_uv), 0),
    }))
    .sort((a, b) => b.avgRead - a.avgRead);
}

function mediaSummaryTable(rows: ArticleRow[], withStats: boolean): string[] {
  const summary = buildMediaSummary(rows);
  if (withStats) {
    return [
      '## 按载体(media_type)',
      '',
      '| 载体 | 篇数 | 平均阅读 | 中位阅读 | 平均点赞 | 读后关注合计 |',
      '| --- | ---: | ---: | ---: | ---: | ---: |',
      ...summary.map(
        s => `| ${s.media_type} | ${s.count} | ${s.avgRead} | ${s.medianRead} | ${s.avgLike} | ${s.sumFollow} |`
      ),
      '',
    ];
  }
  return [
    '## 按载体(media_type)',
    '',
    '| 载体 | 篇数 |',
    '| --- | ---: |',
    ...summary.map(s => `| ${s.media_type} | ${s.count} |`),
    '',
  ];
}

/**
 * 把带 stats 的记录写入 SQLite(article upsert + 当次快照)。无 stats 的记录跳过。
 * capturedAt 为本次采集的 unix 秒(全批同一时刻,快照按天幂等)。返回写入的快照数。
 */
export function writeDbSnapshots(entries: DetailEntry[], capturedAt: number): number {
  const capturedDay = toDate(capturedAt);
  let written = 0;
  for (const entry of entries) {
    const { listItem: item, detail, stats } = entry;
    if (!stats) continue;
    const appmsgid = String(item.appmsgid || detail.mid || '');
    if (!appmsgid) continue;
    const itemidx = Number(item.itemidx || detail.idx || 1) || 1;
    const articleId = upsertArticle({
      appmsgid,
      itemidx,
      title: decodeHtmlEntities(detail.title || item.title || stats.title),
      url: item.link || detail.link || '',
      account: detail.nick_name || '',
      publishTime: toUnixSeconds(detail.ori_create_time || detail.ori_send_time || item.create_time),
      mediaType: mediaTypeOf(item.item_show_type),
    });
    upsertSnapshot(articleId, capturedAt, capturedDay, {
      read_uv: stats.read_uv,
      like_cnt: stats.like_cnt,
      zaikan_cnt: stats.zaikan_cnt,
      comment_cnt: stats.comment_cnt,
      share_uv: stats.share_uv,
      collection_uv: stats.collection_uv,
      follow_uv: stats.follow_after_read_uv,
    });
    if (entry.comments?.length) upsertArticleComments(articleId, entry.comments);
    written += 1;
  }
  return written;
}

/** 每篇把完整记录写到自己的文件夹 `<base>/raw.json`(一篇一文件夹)。 */
export interface ArticleJsonWrite {
  dir: string;
  rawJson: string;
  comment: string;
  entry: DetailEntry;
}

export function planArticleJsonWrites(entries: DetailEntry[]): ArticleJsonWrite[] {
  const byPath = new Map<string, { dir: string; rawJson: string; comment: string; entry: DetailEntry }>();
  for (const [index, entry] of entries.entries()) {
    const base = entry.dirBase || articleBase(entry, index);
    const { dir, rawJson, comment } = articlePaths(base);
    byPath.set(rawJson, { dir, rawJson, comment, entry });
  }
  return [...byPath.values()];
}

/** 每篇人读留言文件 `comment.md`(全部留言 + 作者回复;精选优先、按时间)。 */
export function formatArticleCommentsMd(entry: DetailEntry): string {
  const comments = entry.comments ?? [];
  const title = mdEscape(decodeHtmlEntities(entry.detail.title || entry.listItem.title || '未命名文章'));
  const sorted = [...comments].sort(
    (a, b) => (b.is_elected ? 1 : 0) - (a.is_elected ? 1 : 0) || a.post_time - b.post_time
  );
  const lines = [`# 读者留言 · ${title}`, '', `共 ${comments.length} 条。数据源:公众号后台留言管理。`, ''];
  if (!comments.length) {
    lines.push('暂无已抓取留言。');
    return `${lines.join('\n')}\n`;
  }
  for (const c of sorted) {
    const tags = [c.is_elected ? '精选' : '', c.like_num > 0 ? `${c.like_num}赞` : '', c.ip_wording].filter(Boolean);
    const meta = tags.length ? ` 〔${tags.join('·')}〕` : '';
    lines.push(`- **${mdEscape(c.nick_name || '匿名')}**${meta}: ${mdEscape(c.content || '(空)')}`);
    for (const r of c.reply?.reply_list ?? []) {
      if (!r.content) continue;
      lines.push(`  - ↳ **${mdEscape(r.nick_name || '作者')}**: ${mdEscape(r.content)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function writeArticleJsons(entries: DetailEntry[]): Promise<void> {
  for (const { dir, rawJson, comment, entry } of planArticleJsonWrites(entries)) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(rawJson, JSON.stringify(entry, null, 2));
    await fs.writeFile(comment, formatArticleCommentsMd(entry));
  }
}

const BASE_HEADERS = [
  'index',
  'title',
  'media_type',
  'published',
  'account',
  'author',
  'url',
  'markdown',
  'json',
  'digest',
  'appmsgid',
  'aid',
  'itemidx',
  'comment_id',
  'content_chars',
  'image_count',
  'is_deleted',
  'is_pay_subscribe',
] as const satisfies readonly (keyof ArticleRow)[];

const STATS_HEADERS = [
  'read_uv',
  'like_count',
  'zaikan_count',
  'comment_count',
  'share_uv',
  'collection_uv',
  'avg_read_minutes',
  'finished_read_ratio',
  'follow_after_read_uv',
] as const satisfies readonly (keyof ArticleRow)[];

/** 写 articles-rich.csv(withStats 决定是否含互动数据列)。 */
export async function writeCsv(rows: ArticleRow[], withStats: boolean): Promise<void> {
  const headers: readonly (keyof ArticleRow)[] = withStats ? [...BASE_HEADERS, ...STATS_HEADERS] : BASE_HEADERS;
  const csv = [headers.join(','), ...rows.map(row => headers.map(header => csvEscape(row[header])).join(',')), ''].join(
    '\n'
  );
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.paths.richCsv, csv);
}

/** 写「文章数据总览.md」(Obsidian 表格;withStats 决定列与字段说明)。 */
export async function writeOverview(rows: ArticleRow[], withStats: boolean): Promise<void> {
  const displayRows = dedupeRows(rows);
  const header = ['# 文章数据总览', '', `共 ${displayRows.length} 篇。`, ''];

  // 每篇累计广告收益(元),按 appmsgid+itemidx 关联;未关联/无数据则留空
  const incomeByKey = new Map<string, number>();
  for (const inc of getArticleIncomes()) incomeByKey.set(`${inc.appmsgid}_${inc.itemidx}`, inc.income_cents);
  const incomeOf = (r: ArticleRow): string => {
    const cents = incomeByKey.get(`${r.appmsgid}_${r.itemidx}`);
    return cents === undefined ? '' : (cents / 100).toFixed(2);
  };

  // 正文 .md 实际存在性:视频/转发等可能只有 raw.json 没正文,标题挂 wikilink 会成死链
  const mdExists = new Map<string, boolean>();
  await Promise.all(
    displayRows.map(async r => {
      const ok = await fs
        .access(path.join(config.accountDir, r.markdown))
        .then(() => true)
        .catch(() => false);
      mdExists.set(r.markdown, ok);
    })
  );
  // 有正文 → wikilink 到本地正文;无正文(视频/转发) → 指向微信原文(可点、非死链);都没有才纯文本
  const titleCell = (r: ArticleRow): string => {
    if (mdExists.get(r.markdown)) return `[[${r.markdown}\\|${mdEscape(r.title)}]]`;
    if (r.url) return `[${mdEscape(r.title)}](${r.url})`;
    return mdEscape(r.title);
  };

  const mediaSummary = mediaSummaryTable(displayRows, withStats);
  const commentHighlightsRows = displayRows.filter(r => r.comment_highlights);
  const commentHighlights =
    withStats && commentHighlightsRows.length
      ? [
          '## 留言摘选',
          '',
          '| 日期 | 标题 | 精选/高赞留言 |',
          '| --- | --- | --- |',
          ...commentHighlightsRows.map(r => `| ${r.published} | ${titleCell(r)} | ${r.comment_highlights} |`),
          '',
        ]
      : [];
  let table: string[];
  let legend: string[];

  if (withStats) {
    table = [
      '## 明细',
      '',
      '| 日期 | 载体 | 标题 | 阅读 | 点赞 | 在看 | 评论 | 分享 | 收藏 | 关注 | 收益 | 原文 | 原始数据 |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
      ...displayRows.map(
        r =>
          `| ${r.published} | ${r.media_type} | ${titleCell(r)} | ${r.read_uv} | ${r.like_count} | ${r.zaikan_count} | ${r.comment_count} | ${r.share_uv} | ${r.collection_uv} | ${r.follow_after_read_uv} | ${incomeOf(r)} | [打开](${r.url}) | [[${r.json}\\|JSON]] |`
      ),
    ];
    legend = [
      '## 字段说明',
      '',
      '- `read_uv`: 微信后台“阅读”人数。',
      '- `like_count`: 微信后台“点赞”人数。',
      '- `zaikan_count`: 微信后台“在看”人数。',
      '- `comment_count`: 微信后台“留言/评论”条数。',
      '- `share_uv`: 微信后台“分享”人数。',
      '- `collection_uv`: 微信后台“收藏”人数。',
      '- `关注`: 读后关注人数(读完这篇而新关注的人数 follow_after_read_uv)。',
      '- `收益`: 该篇累计广告收益(元,流量主「文章收入」按标题关联);空 = 未关联或无数据。',
      '- 阅读/点赞/在看/评论/分享:优先使用「已发表」列表页实时人数口径;收藏/读后关注等仍来自内容分析详情页。',
      '',
    ];
  } else {
    table = [
      '## 明细',
      '',
      '| 日期 | 载体 | 标题 | 字数 | 图片 | 原文 | 原始数据 |',
      '| --- | --- | --- | ---: | ---: | --- | --- |',
      ...displayRows.map(
        r =>
          `| ${r.published} | ${r.media_type} | ${titleCell(r)} | ${r.content_chars} | ${r.image_count} | [打开](${r.url}) | [[${r.json}\\|JSON]] |`
      ),
    ];
    legend = [
      '## 字段说明',
      '',
      '- `markdown/`: 已转成 Obsidian Markdown 的正文。',
      '- `raw/articles/`: 每篇文章对应的完整原始 JSON。',
      '- `articles-rich.csv`: 适合用表格软件查看的结构化数据。',
      '- 阅读量、点赞、在看、评论数这类互动数据本次没有抓取;补抓见 enrich-wechat-stats。',
      '',
    ];
  }

  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(
    config.paths.overview,
    [...header, ...mediaSummary, ...commentHighlights, ...table, '', ...legend].join('\n')
  );
}
