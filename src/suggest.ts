import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config/index.js';
import { readContentGrowthData } from './db/content-growth.js';
import { analyzeContentGrowth, beijingDay, growthPolicyFromEnv, shiftDay } from './suggest-growth.js';
import { renderGrowthReport } from './suggest-report.js';
import { isMain, runCli } from './utils/cli.js';
import { mdEscape } from './utils/text.js';

// 纯内容增长建议：同龄快照 → 证据门槛 → 分组观察；不读收益、不写数据库。

/** 列出 主题/ 下的方向(.md 文件名去扩展名)。 */
async function readThemes(): Promise<string[]> {
  try {
    const files = await fs.readdir(config.paths.themesDir);
    return files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

interface Material {
  date: string;
  author: string;
  url: string;
  brief: string;
  localPath: string; // 相对 vault 的素材 content 路径(无 .md),给 Obsidian wikilink 用
}

interface MaterialDir {
  dir: string;
  name: string;
  sortKey: string;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function parseMaterialName(name: string): { date: string; author: string } {
  const date = name.match(/^(\d{4}-\d{2}-\d{2})_/)?.[1] ?? name.slice(0, 10);
  const rest = name.slice(11);
  const lastUnderscore = rest.lastIndexOf('_');
  const author = lastUnderscore > 0 ? rest.slice(0, lastUnderscore) : '';
  return { date, author };
}

function materialSortKey(root: string, dir: string, name: string): string {
  const { date } = parseMaterialName(name);
  const id = name.match(/_(\d+)$/)?.[1] ?? '';
  const idRank = id.padStart(32, '0');
  const rel = path.relative(root, dir);
  return `${date}_${idRank}_${rel}`;
}

async function collectMaterialDirs(root: string, dir = root): Promise<MaterialDir[]> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: MaterialDir[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    const contentPath = path.join(child, 'content.md');
    if (/^\d{4}-\d{2}-\d{2}_/.test(entry.name) && (await exists(contentPath))) {
      out.push({
        dir: child,
        name: entry.name,
        sortKey: materialSortKey(root, child, entry.name),
      });
      continue;
    }
    out.push(...(await collectMaterialDirs(root, child)));
  }
  return out;
}

// 可借素材每个作者最多取几条,避免单一来源(如某天集中采集的一批推文)刷满列表
const MAX_MATERIAL_PER_AUTHOR = 2;

/** 读 素材库/ 最近 N 条;兼容 <YYYY-MM-DD>/<素材>/ 与 _older/<素材>/ 结构。按作者去重保多样。 */
async function readMaterials(limit: number): Promise<Material[]> {
  const dirs = (await collectMaterialDirs(config.paths.materialsDir)).sort((a, b) =>
    b.sortKey.localeCompare(a.sortKey)
  );
  const out: Material[] = [];
  const perAuthor = new Map<string, number>();
  for (const { dir, name } of dirs) {
    const { date, author } = parseMaterialName(name);
    let url = '';
    let brief = '';
    const content = await fs.readFile(path.join(dir, 'content.md'), 'utf8').catch(() => '');
    url = content.match(/\*\*URL[:：]\*\*\s*(\S+)/)?.[1] ?? '';
    const trans = content.split(/##\s*译文/)[1] ?? '';
    brief =
      trans
        .split('\n')
        .map(l => l.trim())
        .find(l => l.length > 0 && !l.startsWith('#') && l !== '---')
        ?.slice(0, 60) ?? '';
    if (!brief) {
      const original = content.split(/##\s*原文/)[1]?.split(/##\s*译文/)[0] ?? '';
      brief =
        original
          .split('\n')
          .map(l => l.trim())
          .find(l => l.length > 0 && !l.startsWith('#') && l !== '---')
          ?.slice(0, 60) ?? '';
    }
    if (!brief) continue;
    const used = perAuthor.get(author) ?? 0;
    if (used >= MAX_MATERIAL_PER_AUTHOR) continue; // 同作者已够数,跳过让别的来源进来
    perAuthor.set(author, used + 1);
    const localPath = `${path.relative(config.vaultPath, dir).split(path.sep).join('/')}/content`;
    out.push({ date, author, url, brief, localPath });
    if (out.length >= limit) break;
  }
  return out;
}

export async function run(): Promise<void> {
  const now = new Date();
  const asOfDay = beijingDay(now);
  const policy = growthPolicyFromEnv();
  const data = readContentGrowthData(config.dbPath, shiftDay(asOfDay, 1 - policy.lookbackDays), asOfDay);
  const analysis = analyzeContentGrowth(data, config.accountExact, asOfDay, policy);
  const themes = await readThemes();
  const recent = data.articles.filter(r => r.publishDay !== null && r.publishDay >= analysis.recentFromDay);
  const coveredThemes = themes.filter(t => recent.some(r => r.subject === t || r.title?.includes(t)));
  const materials = await readMaterials(8);
  const generatedAt = now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16);
  const md = [
    renderGrowthReport(analysis, generatedAt),
    '## 主题方向线索',
    '',
    `近${policy.recentDays}天按标题/对象粗略命中：${coveredThemes.length ? coveredThemes.map(mdEscape).join(' · ') : '未识别'}。标签缺失或名称不一致都会漏识别；未命中不代表从未写过，不自动提升优先级。`,
    '',
    '## 新近素材线索（不是已核实选题）',
    '',
    '以下仅为最近8条本地摘要；可能包含社区观点、旧闻或无上下文回复。必须读完整来源、核验事件日期和新增事实，并与已发布及现有草稿查重。',
    '',
    ...(materials.length === 0
      ? ['- (素材库为空或未找到)']
      : [
          '| 日期 | 作者 | 译文摘要 | 素材 | 原文 |',
          '| --- | --- | --- | --- | --- |',
          ...materials.map(
            m =>
              `| ${m.date} | ${mdEscape(m.author)} | ${mdEscape(m.brief)} | [[${m.localPath}\\|素材]] | ${m.url ? `[原文](${m.url})` : ''} |`
          ),
        ]),
    '',
  ].join('\n');

  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.paths.suggestion, md);
  console.log(`SUGGESTION ${config.paths.suggestion}`);
}

if (isMain(import.meta.url)) runCli(run);
