import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveHumanWritingChecker, validateHumanWritingDraft } from './human-writing-guard.js';

async function makeFixture(mode: 'clean' | 'failure' | 'warning' | 'empty'): Promise<{
  checkerPath: string;
  markdownPath: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-human-writing-'));
  const checkerPath = path.join(root, 'check.py');
  const markdownPath = path.join(root, 'article.md');
  const outputs = {
    clean: ['汉字数 20', '未发现这份检查器覆盖的问题。', 0],
    failure: ['汉字数 20\n\n需要修改\n- 禁用翻案句', '', 1],
    warning: ['汉字数 20\n\n需要人工判断\n- 提示性冒号', '', 0],
    empty: ['', '没有检测到汉字。', 2],
  } as const;
  const [stdout, stderr, exitCode] = outputs[mode];
  await fs.writeFile(
    checkerPath,
    `import sys\nprint(${JSON.stringify(stdout)})\nprint(${JSON.stringify(stderr)}, file=sys.stderr)\nraise SystemExit(${exitCode})\n`,
    'utf8'
  );
  await fs.writeFile(markdownPath, '# 测试\n\n正文\n', 'utf8');
  return { checkerPath, markdownPath };
}

test('human-writing guard allows clean prose', async () => {
  const fixture = await makeFixture('clean');
  await assert.doesNotReject(() => validateHumanWritingDraft(fixture.markdownPath, fixture));
});

test('human-writing guard blocks hard failures', async () => {
  const fixture = await makeFixture('failure');
  await assert.rejects(() => validateHumanWritingDraft(fixture.markdownPath, fixture), /禁用翻案句/u);
});

test('human-writing guard requires explicit review for warnings', async () => {
  const fixture = await makeFixture('warning');
  await assert.rejects(() => validateHumanWritingDraft(fixture.markdownPath, fixture), /human_writing_reviewed/u);
  await assert.doesNotReject(() =>
    validateHumanWritingDraft(fixture.markdownPath, { ...fixture, reviewedWarnings: true })
  );
});

test('human-writing guard only allows empty prose for image posts', async () => {
  const fixture = await makeFixture('empty');
  await assert.rejects(() => validateHumanWritingDraft(fixture.markdownPath, fixture), /没有检测到汉字/u);
  await assert.doesNotReject(() =>
    validateHumanWritingDraft(fixture.markdownPath, { ...fixture, allowNoChinese: true })
  );
});

test('human-writing guard still fails closed when the checker is missing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-no-prose-checker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => root);
  await assert.rejects(() => resolveHumanWritingChecker(path.join(root, 'missing.py')), /未找到公众号去 AI 味检查器/u);
});

test('reviewed style does not waive author process prose', async () => {
  const fixture = await makeFixture('clean');
  await fs.writeFile(fixture.markdownPath, '# 测试\n\n本文未实测。\n');
  await assert.rejects(
    () => validateHumanWritingDraft(fixture.markdownPath, { ...fixture, reviewedWarnings: true }),
    /正文作者过程说明未移除/u
  );
});

const installedChecker = await resolveHumanWritingChecker().catch(() => undefined);
const integrationOptions = { skip: installedChecker ? false : 'wechat-human-writing is not installed' };

test('installed checker blocks prose hidden in a text fence', integrationOptions, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-prose-fence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const markdownPath = path.join(root, 'article.md');
  await fs.writeFile(markdownPath, '# 模型档位\n\n```text\n这不是价格的问题，而是赋能的问题。\n```\n');
  await assert.rejects(() => validateHumanWritingDraft(markdownPath, { checkerPath: installedChecker }), /未通过/u);
});

test('installed checker requires quote fidelity review without rewriting the quote', integrationOptions, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-prose-quote-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const markdownPath = path.join(root, 'article.md');
  await fs.writeFile(markdownPath, '# 原文翻译\n\n> 这不是价格的问题，而是效率的问题。\n');
  await assert.rejects(
    () => validateHumanWritingDraft(markdownPath, { checkerPath: installedChecker }),
    /human_writing_reviewed/u
  );
  await assert.doesNotReject(() =>
    validateHumanWritingDraft(markdownPath, { checkerPath: installedChecker, reviewedWarnings: true })
  );
});

test('quote review does not waive a hard failure in author prose', integrationOptions, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-prose-author-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const markdownPath = path.join(root, 'article.md');
  await fs.writeFile(markdownPath, '# 模型档位\n\n> 原文列出五个档位。\n\n这不是价格的问题，而是赋能的问题。\n');
  await assert.rejects(
    () => validateHumanWritingDraft(markdownPath, { checkerPath: installedChecker, reviewedWarnings: true }),
    /未通过/u
  );
});

test('installed checker admits reviewed contrast without flattening the text', integrationOptions, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-prose-contrast-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const markdownPath = path.join(root, 'article.md');
  const prose = '# 更新时间\n\n公告已经更正。不是九点，而是十点。\n';
  await fs.writeFile(markdownPath, prose);
  await assert.rejects(
    () => validateHumanWritingDraft(markdownPath, { checkerPath: installedChecker }),
    /对比句式复核/u
  );
  await assert.doesNotReject(() =>
    validateHumanWritingDraft(markdownPath, { checkerPath: installedChecker, reviewedWarnings: true })
  );
  assert.equal(await fs.readFile(markdownPath, 'utf8'), prose);
});

test(
  'installed checker preserves reviewed profanity, praise, repetition and a grand ending',
  integrationOptions,
  async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-prose-expressive-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const markdownPath = path.join(root, 'article.md');
    const prose = [
      '# 这一夜\n\n操，这模型怎么跟不要钱一样往外面扔啊。',
      '在我心里它就是神，最强的那一档，强得离谱。',
      '我等过发布，我等过更新，我等过它兑现承诺。',
      '模型太多太多太多太多了。',
      '价格从十元降到五元，智能可能像煤水电一样普及。那时候，可能就是真正的，大繁荣时代了。',
    ].join('\n\n');
    await fs.writeFile(markdownPath, prose);
    await assert.rejects(
      () => validateHumanWritingDraft(markdownPath, { checkerPath: installedChecker }),
      /human_writing_reviewed/u
    );
    await assert.doesNotReject(() =>
      validateHumanWritingDraft(markdownPath, { checkerPath: installedChecker, reviewedWarnings: true })
    );
    assert.equal(await fs.readFile(markdownPath, 'utf8'), prose);
  }
);
