import fs from 'node:fs/promises';
import { fetchChannelsData, getChannelsRuntimeStatus } from './channels/fetch.js';
import { resolveChannelVideoTitle } from './channels/title.js';
import { config } from './config/index.js';
import {
  type ChannelArticleCandidate,
  getChannelArticleCandidates,
  upsertChannelDailyFans,
  upsertChannelVideo,
  upsertChannelVideoSnapshot,
} from './db/index.js';
import type { ChannelDailyFans, ChannelVideo } from './types/channels.js';
import { isMain, runCli } from './utils/cli.js';
import { toDate, toDateTime } from './utils/date.js';
import { mdEscape } from './utils/text.js';

interface ArticleMatch {
  article: ChannelArticleCandidate;
  diffSeconds: number;
}

function compact(value: unknown, max = 80): string {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function videoTitle(video: ChannelVideo): string {
  return compact(
    resolveChannelVideoTitle({
      description: video.desc.description,
      shortTitle: video.desc.shortTitle,
    }),
    96
  );
}

function rate(value: number): string {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

function fixed(value: number): string {
  return value.toFixed(1);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function findArticleMatch(video: ChannelVideo, candidates: ChannelArticleCandidate[]): ArticleMatch | null {
  const videoCandidates = candidates.filter(c => c.media_type === '视频');
  const pool = videoCandidates.length > 0 ? videoCandidates : candidates;
  let best: ArticleMatch | null = null;
  for (const article of pool) {
    const diffSeconds = Math.abs(article.publish_time - video.createTime);
    if (diffSeconds > config.channels.joinWindowSeconds) continue;
    if (!best || diffSeconds < best.diffSeconds) best = { article, diffSeconds };
  }
  return best;
}

function articleCell(match: ArticleMatch | null): string {
  if (!match) return '-';
  const title = mdEscape(match.article.title);
  if (match.article.url) return `[${title}](${match.article.url})`;
  return title;
}

function sourceCell(day: ChannelDailyFans): string {
  const parts = day.fansDataByTabtype
    .filter(tab => tab.add !== 0 || tab.reduce !== 0 || tab.netAdd !== 0 || tab.total !== 0)
    .map(tab => `${tab.tabTypeName || tab.tabType}:${signed(tab.netAdd)}/${tab.total}`);
  return mdEscape(parts.join('、') || '-');
}

function buildVideoTable(videos: ChannelVideo[], candidates: ChannelArticleCandidate[]): string[] {
  return [
    '## 视频列表',
    '',
    '| 发布时间 | 视频文案 | 播放 | 昨日播放 | 完播率 | 均播秒 | 快划率 | 点赞 | 收藏 | 评论 | 转发 | 关注 | 对应公众号文章 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...videos
      .map(video => {
        const match = findArticleMatch(video, candidates);
        return [
          toDateTime(video.createTime),
          mdEscape(videoTitle(video)),
          video.readCount,
          video.yesterdayReadCount,
          rate(video.fullPlayRate),
          fixed(video.avgPlayTimeSec),
          rate(video.fastFlipRate),
          video.likeCount,
          video.favCount,
          video.commentCount,
          video.forwardCount,
          video.followCount,
          articleCell(match),
        ].join(' | ');
      })
      .map(row => `| ${row} |`),
    '',
  ];
}

function buildFansTable(days: ChannelDailyFans[]): string[] {
  const recent = [...days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
  return [
    '## 粉丝趋势',
    '',
    '| 日期 | 新增 | 取消 | 净增 | 累计 | 来源细分(净增/累计) |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...recent.map(
      day => `| ${day.date} | ${day.add} | ${day.reduce} | ${signed(day.netAdd)} | ${day.total} | ${sourceCell(day)} |`
    ),
    '',
  ];
}

async function writeMarkdown(videos: ChannelVideo[], dailyFans: ChannelDailyFans[], capturedAt: number): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const candidates = getChannelArticleCandidates();
  const matched = videos.filter(video => findArticleMatch(video, candidates)).length;
  const latestFans = [...dailyFans].sort((a, b) => b.date.localeCompare(a.date))[0];
  const md = [
    '# 视频号数据',
    '',
    `账号:${config.accountExact}`,
    `更新于 ${new Date(capturedAt * 1000).toLocaleString('zh-CN')}`,
    '',
    `- 视频数:${videos.length}`,
    `- 已按发布时间关联公众号文章:${matched}/${videos.length}`,
    `- 粉丝累计:${latestFans ? `${latestFans.total}(截至 ${latestFans.date})` : '-'}`,
    '',
    ...buildVideoTable(videos, candidates),
    ...buildFansTable(dailyFans),
    '## 说明',
    '',
    '- 数据源:视频号助手后台页面自身 XHR(`post_list` / `fans_trend`),由本机 Chrome 登录态驱动,不手写接口签名。',
    `- 公众号文章关联:优先匹配 \`media_type=视频\` 的已发布文章,发布时间差不超过 ${Math.round(
      config.channels.joinWindowSeconds / 60
    )} 分钟;若库里没有视频载体记录,再退回全部已发布文章候选。`,
    '- 只保存列表指标与趋势数据,不抓取、不下载、不存储视频本体。',
    '- 粉丝趋势日期来自 `fans_trend` 请求窗口;如果页面未暴露请求起止时间,脚本按最近 T-1 日期回推。',
    '',
  ].join('\n');
  await fs.writeFile(config.paths.channelsOverview, md);
}

export async function run(): Promise<void> {
  const status = getChannelsRuntimeStatus();
  if (!status.ok && config.channels.skip) {
    console.log(`[channels] 跳过:${status.reason ?? '已配置跳过'}`);
    return;
  }

  const result = await fetchChannelsData();
  const capturedAt = Math.floor(Date.now() / 1000);
  const capturedDay = toDate(capturedAt);

  for (const video of result.videos) {
    upsertChannelVideo(video, capturedAt);
    upsertChannelVideoSnapshot(video, capturedAt, capturedDay);
  }
  upsertChannelDailyFans(result.dailyFans, capturedAt);

  await writeMarkdown(result.videos, result.dailyFans, capturedAt);

  console.log(`视频号视频:${result.videos.length}/${result.postListTotalCount || result.videos.length}`);
  console.log(`视频号粉丝趋势:${result.dailyFans.length} 天`);
  console.log(`DB ${config.dbPath}`);
  console.log(`INDEX ${config.paths.channelsOverview}`);
}

if (isMain(import.meta.url)) runCli(run);
