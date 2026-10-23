import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('remote allowlist transfers only the exact root prose review without widening audit access', async t => {
  if (spawnSync('rsync', ['--version']).error) {
    t.skip('rsync is unavailable');
    return;
  }
  const uploader = await fs.readFile(new URL('./remote-upload-draft.sh', import.meta.url), 'utf8');
  const filters = uploader.match(/draft_sync_args=\(([\s\S]*?)\n\)/u)?.[1] ?? '';
  const includes = Array.from(filters.matchAll(/--include='([^']+)'/gu), match => `--include=${match[1]}`);
  assert.equal(includes.filter(value => value === '--include=/human-writing-review.json').length, 1);
  assert.ok(!includes.includes('--include=/internal-audit/***'));
  assert.ok(uploader.includes("draft_sync_args+=(--exclude='*')"));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-remote-allowlist-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const draft = path.join(root, 'draft');
  const remote = path.join(root, 'remote');
  const allowed = {
    'article.md': '本机白名单测试正文',
    'editorial-brief.json': '{"version":2}',
    'human-writing-review.json': '{"version":1,"fixture":"reviewed"}',
    'internal-audit/source-audit.md': '已允许的来源审计',
    'internal-audit/translation-review.json': '{"version":1}',
    'internal-audit/translation-sources/source.md': '已允许的翻译来源快照',
  };
  const excluded = [
    'human-writing-review.private.json',
    'unrelated.json',
    'nested/human-writing-review.json',
    'internal-audit/human-writing-review.json',
    'internal-audit/private-note.md',
  ];
  for (const [relative, content] of Object.entries(allowed)) {
    const target = path.join(draft, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  for (const relative of excluded) {
    const target = path.join(draft, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '不应同步');
  }
  await fs.mkdir(remote);
  // 只在测试临时目录之间复制，绝不执行上传脚本、SSH 或微信写入。
  const sync = spawnSync('rsync', ['-a', ...includes, '--exclude=*', `${draft}/`, `${remote}/`], {
    encoding: 'utf8',
  });
  assert.equal(sync.status, 0, sync.stderr);
  for (const [relative, content] of Object.entries(allowed)) {
    assert.equal(await fs.readFile(path.join(remote, relative), 'utf8'), content);
  }
  for (const relative of excluded) {
    await assert.rejects(() => fs.stat(path.join(remote, relative)), /ENOENT/u);
  }
});
