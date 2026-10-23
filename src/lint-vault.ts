import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config/index.js';
import { isMain, runCli } from './utils/cli.js';

// 全库链接体检:扫 vault 下所有 .md 的 wikilink,报「目标不存在」的断链。
// 只发现、不修复——接入 sync 每天体检,断了就在日志里列出来(人工修)。
// 这是「文件/产物过期」这类问题的通用兜底:一处脚本管所有 md,不用人肉排查哪里断了。

const WIKILINK = /\[\[([^\]]+?)\]\]/g;

/** 取 wikilink 真实目标:还原表格里的 `\|`、去掉 `|别名`/`#标题锚`/`^块锚`。保留扩展名(可能指附件)。 */
function targetOf(raw: string): string {
  const unescaped = raw.replace(/\\\|/g, '|'); // Obsidian 表格里 alias 分隔写成 \|,先还原
  const noAlias = unescaped.split('|')[0] ?? '';
  const noHeading = noAlias.split('#')[0] ?? '';
  return (noHeading.split('^')[0] ?? '').trim();
}

/** 跳过隐藏目录(.obsidian / .trash 等),它们里的文件不该参与体检。 */
function isHidden(rel: string): boolean {
  return rel.split('/').some(seg => seg.startsWith('.'));
}

export interface BrokenLink {
  file: string;
  target: string;
}

export async function findBrokenLinks(root: string): Promise<BrokenLink[]> {
  const dirents = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files = dirents
    .filter(d => d.isFile())
    .map(d => path.relative(root, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
    .filter(rel => !isHidden(rel));

  const allSet = new Set<string>(files); // 所有文件相对路径(含扩展名;给 raw.json 等附件用)
  const mdNoExt = new Set<string>(); // .md 去扩展的相对路径
  const mdBase = new Set<string>(); // .md 的文件名(去扩展)
  for (const rel of files) {
    if (!rel.endsWith('.md')) continue;
    const noExt = rel.slice(0, -3);
    mdNoExt.add(noExt);
    mdBase.add(noExt.split('/').pop() ?? noExt);
  }

  const hasSuffix = (set: Set<string>, t: string): boolean => {
    if (set.has(t)) return true;
    for (const p of set) if (p.endsWith(`/${t}`)) return true;
    return false;
  };
  const resolveMd = (t: string): boolean => (t.includes('/') ? hasSuffix(mdNoExt, t) : mdBase.has(t));
  const resolvable = (t: string): boolean => {
    if (/\.[A-Za-z][A-Za-z0-9]*$/.test(t)) {
      // 带扩展名(必须字母打头,避免把 `…0.142` 这类纯数字结尾误判成后缀):
      // 先按附件精确/后缀匹配;若是 .md 再退回按笔记名解析
      if (hasSuffix(allSet, t)) return true;
      return t.endsWith('.md') ? resolveMd(t.slice(0, -3)) : false;
    }
    return resolveMd(t); // 无扩展名:当笔记解析
  };

  const broken: BrokenLink[] = [];
  for (const rel of files) {
    if (!rel.endsWith('.md')) continue;
    const content = await fs.readFile(path.join(root, rel), 'utf8');
    for (const m of content.matchAll(WIKILINK)) {
      const t = targetOf(m[1] ?? '');
      if (t && !resolvable(t)) broken.push({ file: rel, target: t });
    }
  }
  return broken;
}

export async function run(): Promise<void> {
  const broken = await findBrokenLinks(config.vaultPath);
  if (broken.length === 0) {
    console.log('链接体检:无断链 ✓');
    return;
  }
  console.log(`链接体检:发现 ${broken.length} 处断链(目标在库中不存在):`);
  for (const b of broken) console.log(`  ✗ [[${b.target}]]  ← ${b.file}`);
}

if (isMain(import.meta.url)) runCli(run);
