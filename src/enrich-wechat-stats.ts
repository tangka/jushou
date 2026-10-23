import fs from 'node:fs/promises';
import { articlePaths, config } from './config/index.js';
import { CgiDataNotFoundError, RateLimitError } from './errors.js';
import {
  articleBase,
  buildRows,
  type DetailEntry,
  readDetailEntries,
  writeArticleJsons,
  writeCsv,
  writeDbSnapshots,
  writeOverview,
} from './report.js';
import { isMain, runCli } from './utils/cli.js';
import { toDate, toUnixSeconds } from './utils/date.js';
import { upsertFrontmatter } from './utils/frontmatter.js';
import { backoffWithJitter, sleep } from './utils/retry.js';
import { fetchArticleComments } from './wechat/comments.js';
import { applyPublishedStats, fetchPublishedArticleStats, publishedStatsKey } from './wechat/published-stats.js';
import { loadAuthKey, loadMpSession } from './wechat/session.js';
import { type ArticleStats, fetchArticleStats, makeEmptyStats } from './wechat/stats.js';

const DAY_MS = 86_400_000;

/** 是否超过刷新窗口；恰好 N 天仍刷新，N 天以前才跳过。 */
export function isOutsideRefreshWindow(
  publishedAtSeconds: number | null,
  refreshDays: number,
  nowMs = Date.now()
): boolean {
  if (refreshDays <= 0 || publishedAtSeconds === null) return false;
  return nowMs - publishedAtSeconds * 1000 > refreshDays * DAY_MS;
}

/** 文章是否在刷新窗口外:无论已有统计是否缺失，都不再请求后台。 */
function isStale(entry: DetailEntry): boolean {
  const published = toUnixSeconds(
    entry.detail.ori_create_time || entry.detail.ori_send_time || entry.listItem.create_time
  );
  return isOutsideRefreshWindow(published, config.refreshDays);
}

function normalizeCommentId(value: unknown): string {
  return String(value ?? '').trim();
}

// 逐篇补抓后台互动数据 → 写回 frontmatter + 写 SQLite(待 1C)/JSON/总览/CSV。
export async function run(): Promise<void> {
  const authKey = await loadAuthKey();
  const session = await loadMpSession(authKey);
  const entries = await readDetailEntries();
  const publishedStats = await fetchPublishedArticleStats(session).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`已发表列表实时统计获取失败,继续使用内容分析详情页口径: ${msg}`);
    return new Map<string, never>();
  });

  const refreshed: DetailEntry[] = []; // 本次真正补抓到的(只为这些写当次快照)
  let cgiMissing = 0;
  let fetchedCount = 0;
  let consecutiveMisses = 0; // 连续缺 cgiData 的篇数 → 越多越像限流,退避越久
  const candidates = entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .filter(({ entry }) => !isStale(entry));
  const skippedOldCount = entries.length - candidates.length;

  if (config.refreshDays > 0) {
    console.log(`刷新窗口:最近 ${config.refreshDays} 天;待补 ${candidates.length} 篇,跳过旧文章 ${skippedOldCount} 篇`);
  } else {
    console.log(`刷新窗口:全部历史;待补 ${candidates.length} 篇`);
  }

  for (const [candidateIndex, candidate] of candidates.entries()) {
    const { entry, originalIndex } = candidate;
    const { listItem: item, detail } = entry;
    const appmsgid = item.appmsgid || detail.mid || '';
    const itemidx = item.itemidx || detail.idx || 1;
    const publishDate = toDate(detail.ori_create_time || detail.ori_send_time || item.create_time);
    const fallbackTitle = detail.title || item.title || `article-${originalIndex + 1}`;
    const published = publishedStats.get(publishedStatsKey(appmsgid, itemidx));
    const publishedCommentId = normalizeCommentId(published?.comment_id);
    if (publishedCommentId) detail.comment_id = publishedCommentId;

    let stats: ArticleStats;
    try {
      stats = await fetchArticleStats(session, { appmsgid, itemidx, publishDate, fallbackTitle });
      consecutiveMisses = 0; // 拿到数据 → 没被限流,恢复正常节奏
    } catch (error) {
      if (error instanceof CgiDataNotFoundError) {
        cgiMissing += 1;
        consecutiveMisses += 1;
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[${candidateIndex + 1}/${candidates.length}] 跳过(无法获取统计): ${fallbackTitle} — ${msg}`);
      stats = entry.stats ?? makeEmptyStats({ appmsgid, itemidx, publishDate, fallbackTitle });
    }
    stats = applyPublishedStats(stats, published);
    entry.stats = stats;

    const commentId = normalizeCommentId(published?.comment_id || detail.comment_id);
    if (stats.comment_cnt > 0 && commentId) {
      try {
        entry.comments = await fetchArticleComments(session, commentId);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(
          `[${candidateIndex + 1}/${candidates.length}] 留言正文获取失败,继续主流程: ${fallbackTitle} — ${msg}`
        );
      }
    }

    refreshed.push(entry);
    fetchedCount += 1;

    const mdPath = articlePaths(articleBase(entry, originalIndex)).md;
    try {
      const markdown = await fs.readFile(mdPath, 'utf8');
      await fs.writeFile(
        mdPath,
        upsertFrontmatter(markdown, {
          wechat_read_uv: stats.read_uv,
          wechat_like_count: stats.like_cnt,
          wechat_zaikan_count: stats.zaikan_cnt,
          wechat_comment_count: stats.comment_cnt,
          wechat_share_uv: stats.share_uv,
          wechat_collection_uv: stats.collection_uv,
        })
      );
    } catch {
      // 对应 markdown 不存在则跳过 frontmatter 写回
    }

    console.log(
      `[${candidateIndex + 1}/${candidates.length}] ${stats.title}: read=${stats.read_uv}, like=${stats.like_cnt}, zaikan=${stats.zaikan_cnt}, comments=${stats.comment_cnt}`
    );

    // 请求间隔:正常 = 基础间隔 + 抖动;连续缺数据(疑似限流)→ 指数退避(给后台恢复时间)
    if (candidateIndex < candidates.length - 1) {
      const delay = backoffWithJitter(config.requestIntervalMs, consecutiveMisses);
      if (consecutiveMisses >= 3) {
        console.warn(`  连续 ${consecutiveMisses} 篇缺数据,疑似限流 → 退避 ${(delay / 1000).toFixed(1)}s`);
      }
      await sleep(delay);
    }
  }

  // 限流判定:本次补抓的文章全部缺 cgiData 才是限流(单篇缺失可能只是当天新文),报错不写盘(ADR 0004)
  if (fetchedCount > 0 && cgiMissing === fetchedCount && publishedStats.size === 0) {
    throw new RateLimitError('所有文章都拿不到 cgiData,判定为微信后台限流;请停 1~2 分钟再跑(勿重新扫码)。');
  }

  // 把更新后的 stats 写回各篇 raw.json
  await writeArticleJsons(entries);

  // 写 SQLite 时间序列快照(分析事实源);只为本次真正补抓的文章写当次快照
  const snapshots = writeDbSnapshots(refreshed, Math.floor(Date.now() / 1000));

  const rows = buildRows(entries);
  await writeOverview(rows, true);
  await writeCsv(rows, true);

  console.log(`CSV ${config.paths.richCsv}`);
  console.log(`INDEX ${config.paths.overview}`);
  console.log(`DB ${config.dbPath} (+${snapshots} 快照,补抓 ${fetchedCount} 篇)`);
}

if (isMain(import.meta.url)) runCli(run);
