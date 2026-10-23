import fs from 'node:fs/promises';
import path from 'node:path';
import { findMainMarkdown } from './build-publish-html.js';
import { config } from './config/index.js';
import { isMain, runCli } from './utils/cli.js';
import { readFrontmatterField } from './utils/frontmatter.js';

// 重写内容地图(MOC)里的「待发布」区:扫 待发布/ 当前草稿生成 wikilink 列表。
// 只替换 AUTO:drafts 锚之间的内容,静态导航(主题/流程)原样保留。
// 发布后草稿被 prune-drafts 回收 → 这里重跑就自动从列表消失,不用手动维护。

const BEGIN = '<!-- AUTO:drafts:begin -->';
const END = '<!-- AUTO:drafts:end -->';

/** 扫 待发布/ 生成草稿 wikilink 列表(标题取 frontmatter title,缺则用文件夹名)。 */
export async function draftLinks(draftsDir = config.paths.draftsDir): Promise<string[]> {
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await fs.readdir(draftsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const links: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const draftDir = path.join(draftsDir, e.name);
    const mainMd = await findMainMarkdown(draftDir, e.name);
    if (!mainMd) continue;
    const content = await fs.readFile(mainMd, 'utf8').catch(() => undefined);
    if (content === undefined) continue;
    const title = (content && readFrontmatterField(content, 'title')) || e.name;
    const mainName = path.basename(mainMd, path.extname(mainMd));
    links.push(`- [[待发布/${e.name}/${mainName}|${title}]]`);
  }
  return links;
}

export async function run(): Promise<void> {
  let md: string;
  try {
    md = await fs.readFile(config.paths.contentMap, 'utf8');
  } catch {
    console.log(`内容地图不存在,跳过:${config.paths.contentMap}`);
    return;
  }

  const begin = md.indexOf(BEGIN);
  const end = md.indexOf(END);
  if (begin < 0 || end < 0 || end < begin) {
    console.log(`内容地图缺 ${BEGIN} / ${END} 锚,跳过(待发布区不自动生成)`);
    return;
  }

  const links = await draftLinks();
  const body = links.length > 0 ? links.join('\n') : '- (暂无待发布草稿)';
  const next = `${md.slice(0, begin + BEGIN.length)}\n${body}\n${md.slice(end)}`;
  await fs.writeFile(config.paths.contentMap, next);
  console.log(`内容地图「待发布」区已更新:${links.length} 条 → ${config.paths.contentMap}`);
}

if (isMain(import.meta.url)) runCli(run);
