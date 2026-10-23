import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { config } from './config/index.js';
import { getAllArticles } from './db/index.js';
import { isMain, runCli } from './utils/cli.js';
import { readFrontmatterField } from './utils/frontmatter.js';

// 回收已发布的待发布草稿。
// 「已发布」的唯一可靠判据:草稿主 md 的 frontmatter `title` 已被一期采集进 articles 表
// (能采到 = 已经发出去了)。命中即整文件夹删除(含 media/comments),不可逆。
// 护栏:只删「title 精确命中 articles」的文件夹;无主 md / 无 title / 未命中 一律保留;
// `_` 前缀(收集箱散文件)与隐藏文件跳过。默认 dry-run 打印,传 apply 才真删。

/** 标题归一化:Unicode NFC + 去首尾空白,消除等价字符 / 空白差异。 */
function norm(title: string): string {
  return title.normalize('NFC').trim();
}

/** 取草稿文件夹的主 md:优先同名 `<name>.md`,否则目录内首个非 `_`/`.` 开头的 .md。 */
function findMainMarkdown(dir: string, name: string): string | undefined {
  const sameName = path.join(dir, `${name}.md`);
  if (fs.existsSync(sameName)) return sameName;
  const fallback = fs.readdirSync(dir).find(f => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.'));
  return fallback ? path.join(dir, fallback) : undefined;
}

export async function run(opts: { apply?: boolean } = {}): Promise<void> {
  const apply = opts.apply ?? true; // 默认真删(定时省心);手动演练传 false
  const draftsDir = config.paths.draftsDir;

  if (!fs.existsSync(draftsDir)) {
    console.log(`待发布目录不存在,跳过:${draftsDir}`);
    return;
  }

  // 已发布标题集合(当前账号)
  const published = new Set(
    getAllArticles()
      .map(a => a.title)
      .filter(Boolean)
      .map(norm)
  );

  const entries = fs.readdirSync(draftsDir, { withFileTypes: true });
  let removed = 0;
  let kept = 0;
  let skipped = 0;

  for (const entry of entries) {
    // 只处理「一文一文件夹」;散文件(收集箱 `_…`)与隐藏项跳过
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const dir = path.join(draftsDir, entry.name);
    const mainMd = findMainMarkdown(dir, entry.name);
    if (!mainMd) {
      console.log(`  ? 跳过(无主 md):${entry.name}`);
      skipped++;
      continue;
    }

    const title = readFrontmatterField(fs.readFileSync(mainMd, 'utf8'), 'title');
    if (!title) {
      console.log(`  ? 跳过(无 title):${entry.name}`);
      skipped++;
      continue;
    }

    if (!published.has(norm(title))) {
      kept++; // 未发,保留(静默)
      continue;
    }

    if (apply) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`  ✓ 已删(已发布):${entry.name}`);
    } else {
      console.log(`  [dry-run] 将删(已发布):${entry.name}`);
    }
    removed++;
  }

  const verb = apply ? '已回收' : '待回收(dry-run)';
  console.log(`待发布回收:${verb} ${removed} 篇,保留 ${kept} 篇,跳过 ${skipped} 项。`);
}

if (isMain(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  runCli(() => run({ apply: !dryRun }));
}
