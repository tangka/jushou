import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { draftLinks } from './build-content-map.js';

async function writeMarkdown(dir: string, fileName: string, title: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), `---\ntitle: "${title}"\n---\n\n正文\n`, 'utf8');
}

test('draftLinks links the actual main markdown and skips directories without one', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-content-map-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const exactName = '2026-07-18-目录与主稿同名__codex';
  await writeMarkdown(path.join(root, exactName), `${exactName}.md`, '同名主稿');

  const differentName = '2026-07-18-目录与主稿不同__codex';
  const actualMainName = '2026-07-18-真实主稿文件__codex';
  await writeMarkdown(path.join(root, differentName), `${actualMainName}.md`, '真实主稿');

  await fs.mkdir(path.join(root, '2026-07-18-空目录__codex'));
  const ignoredOnly = path.join(root, '2026-07-18-只有忽略文件__codex');
  await writeMarkdown(ignoredOnly, '_notes.md', '不是主稿');

  const links = await draftLinks(root);

  assert.deepEqual(links.sort(), [
    `- [[待发布/${differentName}/${actualMainName}|真实主稿]]`,
    `- [[待发布/${exactName}/${exactName}|同名主稿]]`,
  ]);
});
