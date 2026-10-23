import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { REJECTED_PROSE_SAMPLE } from '../test-support/prose-fixture.js';
import { inspectHumanWritingDraft } from './human-writing-checker.js';
import { validateHumanWritingDraft, validateWechatDraftHumanWriting } from './human-writing-guard.js';
import { buildProsePatternReviewTemplate, PROSE_PATTERN_REVIEW_FILE } from './prose-pattern-review.js';

const TIMELINE = '14:32:11锁被释放，14:32:16任务重试，14:32:17写入失败。';
async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-pattern-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const draftDir = path.join(root, 'draft');
  await fs.mkdir(draftDir);
  const markdownPath = path.join(draftDir, 'article.md');
  const checkerPath = path.join(root, 'checker.py');
  await fs.writeFile(checkerPath, 'print("汉字数 20\\n未发现这份检查器覆盖的问题。")\n');
  await fs.writeFile(markdownPath, `---\nhuman_writing_reviewed: true\n---\n\n# 调试时间线\n\n${TIMELINE}`);
  return { root, draftDir, markdownPath, checkerPath, reviewPath: path.join(draftDir, PROSE_PATTERN_REVIEW_FILE) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function reviewed(f: Fixture) {
  const inspection = await inspectHumanWritingDraft(f.markdownPath, f);
  const record = buildProsePatternReviewTemplate(inspection);
  for (const item of record.findings) {
    item.decision = 'retain';
    for (const evidence of item.evidence) {
      evidence.purpose = `时刻 ${evidence.excerpt} 对应锁释放与重试写入的竞态顺序，说明具体触发条件。`;
      evidence.removalCost = `省略 ${evidence.excerpt} 的秒数会把三个事件压成同一分钟，读者无法判断先后。`;
    }
  }
  await fs.writeFile(f.reviewPath, JSON.stringify(record));
  return record;
}
const validate = (f: Fixture) => validateHumanWritingDraft(f.markdownPath, { ...f, reviewedWarnings: true });

test('existing reviewed flag cannot waive new warnings even when the Python checker is clean', async t => {
  const f = await fixture(t);
  const inspection = await inspectHumanWritingDraft(f.markdownPath, f);
  assert.equal(inspection.warnings.length, 0);
  await assert.rejects(() => validate(f), /human_writing_reviewed 不能跳过/u);
  // 同时覆盖上传入口从 frontmatter 读取旧标记的路径。
  const previous = process.env.WECHAT_HUMAN_WRITING_CHECKER;
  process.env.WECHAT_HUMAN_WRITING_CHECKER = f.checkerPath;
  t.after(() => {
    if (previous === undefined) delete process.env.WECHAT_HUMAN_WRITING_CHECKER;
    else process.env.WECHAT_HUMAN_WRITING_CHECKER = previous;
  });
  const markdown = await fs.readFile(f.markdownPath, 'utf8');
  await assert.rejects(() => validateWechatDraftHumanWriting(f.markdownPath, markdown, '图文'), /表达检查待复核/u);
});

test('known rejected draft cannot be approved by a review file or a flag', async t => {
  const f = await fixture(t);
  const article = REJECTED_PROSE_SAMPLE;
  await reviewed(f);
  await fs.writeFile(f.markdownPath, article);
  await assert.rejects(() => validate(f), /表达检查存在硬命中/u);
  assert.equal(await fs.readFile(f.markdownPath, 'utf8'), article);
});

test('merely removing the two rejected phrases still cannot bypass precision and transition review', async t => {
  const f = await fixture(t);
  const article = REJECTED_PROSE_SAMPLE.replace('好好好，锅铲你拿着，额度我收下。', '').replace(
    '我允许自己嘚瑟一下',
    '这事终于有结果了'
  );
  await fs.writeFile(f.markdownPath, article);
  const inspection = await inspectHumanWritingDraft(f.markdownPath, f);
  assert.ok(inspection.proseFindings.every(item => item.severity === 'review'));
  assert.ok(inspection.proseFindings.some(item => item.id === 'precision-overload'));
  assert.ok(inspection.proseFindings.some(item => item.id === 'transition-overload'));
  await assert.rejects(() => validate(f), /human_writing_reviewed 不能跳过/u);
});

test('paragraph template warnings alone require concrete review despite the reviewed flag', async t => {
  const f = await fixture(t);
  await fs.writeFile(
    f.markdownPath,
    [
      '---\nhuman_writing_reviewed: true\n---\n',
      '真香，这下我高兴了。价格从每月十元降到五元，公告今天更新，原订阅到期也能续上。总之这回划算。',
      '离谱，这次真让我惊喜。软件支持把五份文档一起导出，原来需要逐份选择确认。这样用起来省心。',
      '好好好，这事让我满意。今天上线的批量功能支持十个任务，之前只能逐个提交。这个变化值得。',
    ].join('\n\n')
  );
  const inspection = await inspectHumanWritingDraft(f.markdownPath, f);
  assert.deepEqual(
    inspection.proseFindings.map(item => item.id),
    ['paragraph-template']
  );
  await assert.rejects(() => validate(f), /段落闭合形状重复/u);
});

test('pending, generic and incomplete reviews fail; specific technical purpose preserves the prose', async t => {
  const f = await fixture(t);
  const inspection = await inspectHumanWritingDraft(f.markdownPath, f);
  const pending = buildProsePatternReviewTemplate(inspection);
  await fs.writeFile(f.reviewPath, JSON.stringify(pending));
  await assert.rejects(() => validate(f), /缺项或仍未审/u);
  const record = await reviewed(f);
  const original = await fs.readFile(f.markdownPath);
  await assert.doesNotReject(() => validate(f));
  assert.deepEqual(await fs.readFile(f.markdownPath), original);
  const item = record.findings[0]?.evidence[0];
  assert.ok(item);
  item.purpose = '推进情绪';
  await fs.writeFile(f.reviewPath, JSON.stringify(record));
  await assert.rejects(() => validate(f), /缺项或仍未审/u);
});

test('article, checker, rules and exact findings bind the review, including order and excerpts', async t => {
  const mutations = [
    'article',
    'checker',
    'rules',
    'missing',
    'reorder',
    'excerpt',
    'hash',
    'revise',
    'issues',
  ] as const;
  for (const mutation of mutations) {
    const f = await fixture(t);
    const record = await reviewed(f);
    if (mutation === 'article') await fs.appendFile(f.markdownPath, '\n\n这个竞态还在重现。');
    if (mutation === 'checker') await fs.appendFile(f.checkerPath, '\n# changed\n');
    if (mutation === 'rules') record.rulesVersion = '2026-10-20.1';
    if (mutation === 'hash') record.findingsSha256 = '0'.repeat(64);
    if (mutation === 'issues') record.issues.push('缺少重试触发条件，尚未完成复核');
    const item = record.findings[0];
    assert.ok(item);
    if (mutation === 'missing') item.evidence.pop();
    if (mutation === 'reorder') item.evidence.reverse();
    if (mutation === 'excerpt') {
      const first = item.evidence[0];
      assert.ok(first);
      first.excerpt = '14:32:10';
    }
    if (mutation === 'revise') item.decision = 'revise';
    await fs.writeFile(f.reviewPath, JSON.stringify(record));
    await assert.rejects(() => validate(f), /表达检查待复核/u, mutation);
  }
});

test('symlink escape cannot import a review from another draft', async t => {
  const f = await fixture(t);
  await reviewed(f);
  const outside = path.join(f.root, 'review.json');
  await fs.rename(f.reviewPath, outside);
  await fs.symlink(outside, f.reviewPath);
  await assert.rejects(() => validate(f), /不能通过符号链接离开/u);
});

test('remote draft allowlist carries only the bound review and validates after relocation', async t => {
  if (spawnSync('rsync', ['--version']).error) return t.skip('rsync is unavailable');
  const f = await fixture(t);
  await reviewed(f);
  await fs.writeFile(path.join(f.draftDir, 'private-notes.json'), '{"private":true}');
  const script = await fs.readFile('scripts/remote-upload-draft.sh', 'utf8');
  const filters = script.match(/draft_sync_args=\(([\s\S]*?)\n\)/u)?.[1] ?? '';
  const includes = Array.from(filters.matchAll(/--include='([^']+)'/gu), match => `--include=${match[1]}`);
  const remote = path.join(f.root, 'remote');
  await fs.mkdir(remote);
  const sync = spawnSync('rsync', ['-a', ...includes, '--exclude=*', `${f.draftDir}/`, `${remote}/`], {
    encoding: 'utf8',
  });
  assert.equal(sync.status, 0, sync.stderr);
  assert.deepEqual((await fs.readdir(remote)).sort(), ['article.md', PROSE_PATTERN_REVIEW_FILE].sort());
  await assert.doesNotReject(() =>
    validateHumanWritingDraft(path.join(remote, 'article.md'), { checkerPath: f.checkerPath, reviewedWarnings: true })
  );
  await fs.rm(path.join(remote, PROSE_PATTERN_REVIEW_FILE));
  await assert.rejects(
    () =>
      validateHumanWritingDraft(path.join(remote, 'article.md'), {
        checkerPath: f.checkerPath,
        reviewedWarnings: true,
      }),
    /表达检查待复核/u
  );
});
