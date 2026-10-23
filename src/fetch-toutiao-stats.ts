import fs from 'node:fs/promises';
import { config } from './config/index.js';
import { getToutiaoCommentsLatest, getToutiaoItemsLatest } from './db/index.js';
import type { ToutiaoItemLatest } from './db/toutiao.js';
import { isMain, runCli } from './utils/cli.js';
import { toDateTime } from './utils/date.js';
import { mdEscape } from './utils/text.js';

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : String(value);
}

function yuan(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '-' : (cents / 100).toFixed(2);
}

function itemTitleCell(item: ToutiaoItemLatest): string {
  const title = mdEscape(item.title || item.item_id);
  return item.url ? `[${title}](${item.url})` : title;
}

function buildItemsTable(items: ToutiaoItemLatest[]): string[] {
  return [
    '## 作品列表',
    '',
    '| 发布时间 | 标题 | 类型 | 状态 | 阅读 | 评论 | 点赞 | 分享 | 收藏 | 关注 | 收益(元) |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...items
      .slice(0, 80)
      .map(
        item =>
          `| ${toDateTime(item.publish_time)} | ${itemTitleCell(item)} | ${mdEscape(item.item_type || '-')} | ${mdEscape(
            item.status || '-'
          )} | ${num(item.read_count)} | ${num(item.comment_count)} | ${num(item.like_count)} | ${num(
            item.share_count
          )} | ${num(item.favorite_count)} | ${num(item.follow_count)} | ${yuan(item.income_cents)} |`
      ),
    '',
  ];
}

function buildCommentsTable(): string[] {
  const comments = getToutiaoCommentsLatest(30);
  if (comments.length === 0) return [];
  return [
    '## 最新评论',
    '',
    '| 时间 | 用户 | 内容 | 点赞 | 回复 | 作品ID |',
    '| --- | --- | --- | ---: | ---: | --- |',
    ...comments.map(
      comment =>
        `| ${toDateTime(comment.create_time)} | ${mdEscape(comment.nick_name || '-')} | ${mdEscape(
          comment.content || ''
        )} | ${num(comment.like_count)} | ${num(comment.reply_count)} | ${mdEscape(comment.item_id)} |`
    ),
    '',
  ];
}

export async function writeToutiaoMarkdown(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const items = getToutiaoItemsLatest();
  const latestCapture = Math.max(0, ...items.map(item => item.captured_at ?? 0));
  const totalRead = items.reduce((sum, item) => sum + (item.read_count ?? 0), 0);
  const totalComments = items.reduce((sum, item) => sum + (item.comment_count ?? 0), 0);
  const totalLikes = items.reduce((sum, item) => sum + (item.like_count ?? 0), 0);
  const md = [
    '# 头条号数据',
    '',
    `账号:${config.accountExact}`,
    `更新于 ${new Date().toLocaleString('zh-CN')}`,
    '',
    `- 已识别作品:${items.length}`,
    `- 最近采集:${latestCapture ? toDateTime(latestCapture) : '-'}`,
    `- 累计阅读:${totalRead}`,
    `- 累计评论:${totalComments}`,
    `- 累计点赞:${totalLikes}`,
    '',
    ...buildItemsTable(items),
    ...buildCommentsTable(),
    '## 说明',
    '',
    '- 数据源:Codex 内置浏览器在头条号后台拦截到的页面自身接口响应。',
    '- 导入器会先保存原始响应,再按常见字段名识别作品、指标和评论;头条前端字段变化时不会丢原始数据。',
    '- 发布/回复动作默认不自动执行,先做采集、草稿和人工确认。',
    '',
  ].join('\n');
  await fs.writeFile(config.paths.toutiaoOverview, md);
}

export async function run(): Promise<void> {
  await writeToutiaoMarkdown();
  console.log(`INDEX ${config.paths.toutiaoOverview}`);
}

if (isMain(import.meta.url)) runCli(run);
