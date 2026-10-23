import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { prepareDraftForValidation } from '../draft-workflow.js';
import { attachEditorialBrief } from '../generate-drafts.js';
import { upsertFrontmatter } from '../utils/frontmatter.js';
import { EDITORIAL_BRIEF_FILE, type EditorialBrief } from './editorial-quality.js';
import { humanWritingSha256, inspectHumanWritingDraft } from './human-writing-checker.js';
import { resolveHumanWritingChecker, validateHumanWritingDraft } from './human-writing-guard.js';
import {
  collectHumanWritingReviewErrors,
  HUMAN_WRITING_REVIEW_FILE,
  humanWritingReviewSchema,
  reviewHumanWritingWarnings,
} from './human-writing-review.js';

type Review = z.infer<typeof humanWritingReviewSchema>;
const WARNINGS = [
  '- 对比句式复核，第 8 行，“不是九点，而是十点”。核对是否有材料的对比。',
  '- 从第 10 行起连续出现 4 个短促单句段，核对递进与情绪作用。',
];
const PROSE = [
  '# 更新时间\n\n公告已经更正。不是九点，而是十点。',
  '操，这个价格真爽。',
  '在我心里它就是神。',
  '真够离谱。',
  '我愿意再喊一句，爽。',
  '智能可能像煤水电一样普及。那时候，可能就是真正的，大繁荣时代了。',
].join('\n\n');

async function fixture(options: { mode?: 'warnings' | 'clean' | 'hard' | 'quote'; checkerPath?: string } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-independent-style-'));
  const draftDir = path.join(root, '2026-10-10-更新时间__codex');
  await fs.mkdir(draftDir);
  const markdownPath = path.join(draftDir, 'article.md');
  const sourcePath = path.join(root, 'original.md');
  const planPath = path.join(root, 'plan.json');
  const briefPath = path.join(draftDir, EDITORIAL_BRIEF_FILE);
  const reviewPath = path.join(draftDir, HUMAN_WRITING_REVIEW_FILE);
  const auditPath = path.join(draftDir, 'internal-audit/source-audit.md');
  const checkerPath = options.checkerPath ?? path.join(root, 'check.py');
  const brief: EditorialBrief = {
    version: 2,
    account: 'ExampleNews',
    date: '2026-10-10',
    selectionMode: 'user_locked',
    userDirective: '解释公告更正后的更新时间。',
    contentClass: 'brief',
    topic: '更新时间',
    primarySignal: '公告更正为十点。',
    whyNow: '读者需要核对本次更正。',
    readerPromise: '看清更新后的时间。',
    titleTerms: [{ anyOf: ['更新时间'] }],
    sources: [{ id: 'original', label: '测试公告', path: sourcePath, evidence: '记录时间由九点更正为十点。' }],
    candidates: [{ topic: '更新时间', selected: true, reason: '用户指定', sourceIds: ['original'] }],
    requirements: [
      { id: 'time', description: '写清更正时间', scope: 'body', allOf: [{ anyOf: ['十点'] }], sourceIds: ['original'] },
    ],
    forbiddenClaims: [],
    sourceAudit: 'internal-audit/source-audit.md',
  };
  const markdown = upsertFrontmatter(`---\ntitle: 更新时间\n---\n\n${PROSE}`, {
    auto_quality_gate: true,
    editorial_brief: EDITORIAL_BRIEF_FILE,
  });
  await fs.writeFile(markdownPath, markdown);
  await fs.writeFile(sourcePath, '测试公告：时间由九点更正为十点。');
  await fs.writeFile(planPath, JSON.stringify(brief));
  await fs.writeFile(briefPath, JSON.stringify(brief));
  await fs.mkdir(path.dirname(auditPath));
  await fs.writeFile(auditPath, 'time: original；九点更正为十点。');
  if (!options.checkerPath) {
    const mode = options.mode ?? 'warnings';
    const warnings = mode === 'quote' ? ['- 引用或译文共 1 行，需核对原文准确与完整。'] : WARNINGS;
    const output =
      mode === 'clean'
        ? '汉字数 60\n未发现这份检查器覆盖的问题。'
        : mode === 'hard'
          ? '需要修改\n- 黑话，赋能'
          : `汉字数 60\n\n需要人工判断\n${warnings.join('\n')}`;
    await fs.writeFile(checkerPath, `print(${JSON.stringify(output)})\nraise SystemExit(${mode === 'hard' ? 1 : 0})\n`);
  }
  return {
    root,
    draftDir,
    markdownPath,
    markdown,
    planPath,
    briefPath,
    reviewPath,
    sourcePath,
    checkerPath,
    auditPath,
    brief,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** 测试注入记录而不调用模型；不把该模拟称为真实语义审稿。 */
function recordFromPrompt(prompt: string): Review {
  const raw: unknown = JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n{') + 2));
  const template = z.record(z.string(), z.unknown()).parse(raw);
  const warnings = z.array(z.object({ warning: z.string() })).parse(template.warnings);
  return humanWritingReviewSchema.parse({
    ...template,
    warnings: warnings.map(({ warning }) => ({
      warning,
      decision: 'retain',
      reason: warning.includes('对比')
        ? '九点到十点是来源中的具体更正，不是虚构反方；保留能突出时间变化。'
        : '连续短句从价格的惊讶递进到主观叫好，再呼应结尾；停顿承担情绪鼓点。',
    })),
  });
}

async function review(f: Fixture, callback?: (record: Review, prompt: string) => Promise<void>): Promise<void> {
  await reviewHumanWritingWarnings({
    markdownPath: f.markdownPath,
    planPath: f.planPath,
    brief: f.brief,
    checkerOptions: { checkerPath: f.checkerPath },
    runIndependent: async prompt => {
      const record = recordFromPrompt(prompt);
      if (callback) await callback(record, prompt);
      else await fs.writeFile(f.reviewPath, JSON.stringify(record));
    },
  });
}

const validate = (f: Fixture) => validateHumanWritingDraft(f.markdownPath, { checkerPath: f.checkerPath });
const installedChecker = await resolveHumanWritingChecker().catch(() => undefined);

test(
  'actual prepare → independent record → final guard preserves expressive prose',
  { skip: !installedChecker },
  async t => {
    const f = await fixture({ checkerPath: installedChecker });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const calls: string[] = [];
    let fixedMarkdown = '';
    await prepareDraftForValidation({
      contentClass: 'brief',
      packageDraft: async () => {
        calls.push('package');
        await fs.writeFile(f.markdownPath, upsertFrontmatter(f.markdown, { cover: 'media/cover.png' }));
      },
      attachBrief: async () => {
        calls.push('attach');
        await attachEditorialBrief({ dir: f.draftDir, mdPath: f.markdownPath }, f.planPath, f.brief);
        fixedMarkdown = await fs.readFile(f.markdownPath, 'utf8');
      },
      reviewTranslation: async () => assert.fail('原创不得触发译文审稿'),
      reviewHumanWriting: async () => {
        calls.push('style-review');
        await review(f, async (record, prompt) => {
          calls.push('independent');
          assert.match(prompt, /禁止修改正文/u);
          assert.match(prompt, /Humanizer-zh 通读全文/u);
          assert.match(prompt, /引用\/译文保真不在本轮范围/u);
          assert.ok(record.warnings.some(item => item.warning.includes('对比句式复核')));
          assert.ok(record.warnings.some(item => item.warning.includes('短促单句段')));
          await fs.writeFile(f.reviewPath, JSON.stringify(record));
        });
      },
      validateDraft: async () => {
        calls.push('validate');
        await validate(f);
      },
    });
    assert.deepEqual(calls, ['package', 'attach', 'style-review', 'independent', 'validate']);
    assert.equal(await fs.readFile(f.markdownPath, 'utf8'), fixedMarkdown);
    assert.ok(fixedMarkdown.includes(PROSE));
    assert.ok(!fixedMarkdown.includes('human_writing_reviewed'));
  }
);

test('clean drafts and translation never invoke the non-translation independent reviewer', async t => {
  for (const mode of ['clean', 'warnings'] as const) {
    const f = await fixture({ mode });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await reviewHumanWritingWarnings({
      markdownPath: f.markdownPath,
      planPath: f.planPath,
      brief: mode === 'warnings' ? { ...f.brief, contentClass: 'translation' } : f.brief,
      checkerOptions: { checkerPath: f.checkerPath },
      runIndependent: async () => assert.fail('不应调用文风审稿'),
    });
    assert.equal(await fs.stat(f.reviewPath).catch(() => undefined), undefined);
    if (mode === 'clean') await validate(f);
  }
});

test('hard errors and author process errors fail before review even with a valid style record', async t => {
  for (const hard of ['checker', 'process'] as const) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await review(f);
    if (hard === 'checker')
      await fs.writeFile(f.checkerPath, 'print("需要修改\\n- 黑话，赋能")\nraise SystemExit(1)\n');
    else await fs.appendFile(f.markdownPath, '\n\n本文未实测。');
    await assert.rejects(() => review(f, async () => assert.fail('硬错不得进入独立审稿')), /未通过|作者过程说明/u);
    await assert.rejects(() => validate(f), /未通过|作者过程说明/u);
    await assert.rejects(
      () => validateHumanWritingDraft(f.markdownPath, { checkerPath: f.checkerPath, reviewedWarnings: true }),
      /未通过|作者过程说明/u
    );
  }
});

test('missing, incomplete, fake empty, duplicate, extra, issues and revise records block the final guard', async t => {
  const mutations: Array<(record: Review) => unknown> = [
    record => ({ ...record, warnings: [] }),
    record => ({ ...record, warnings: record.warnings.slice(0, 1) }),
    record => ({ ...record, warnings: [...record.warnings].reverse() }),
    record => ({ ...record, warnings: [...record.warnings, record.warnings[0]] }),
    record => ({
      ...record,
      warnings: [...record.warnings, { warning: '- 未实际出现的提醒', decision: 'retain', reason: '另一个理由' }],
    }),
    record => ({ ...record, issues: ['对比没有来源支撑'] }),
    record => ({ ...record, warnings: record.warnings.map(item => ({ ...item, decision: 'revise' })) }),
    record => ({ ...record, warnings: record.warnings.map(item => ({ ...item, reason: '' })) }),
    record => ({ ...record, warnings: record.warnings.map(item => ({ ...item, reason: '已核对' })) }),
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await assert.rejects(() => validate(f), /人工判断项/u);
    await review(f);
    const record = humanWritingReviewSchema.parse(JSON.parse(await fs.readFile(f.reviewPath, 'utf8')));
    await fs.writeFile(f.reviewPath, JSON.stringify(mutate(record)));
    await assert.rejects(() => validate(f), /人工判断项/u);
  }
});

test('article, checker, locked brief, source and source audit changes invalidate the recorded review', async t => {
  for (const target of ['markdownPath', 'checkerPath', 'briefPath', 'sourcePath', 'auditPath'] as const) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await review(f);
    await validate(f);
    await fs.appendFile(f[target], target === 'checkerPath' ? '\n# version changed\n' : '\n ');
    await assert.rejects(() => validate(f), /人工判断项/u);
  }
});

test('a review callback cannot alter fixed prose, plan, draft brief, source or checker and then self-certify', async t => {
  for (const target of ['markdownPath', 'planPath', 'briefPath', 'sourcePath', 'checkerPath', 'auditPath'] as const) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await assert.rejects(
      () =>
        review(f, async record => {
          await fs.appendFile(f[target], target === 'checkerPath' ? '\n# updated\n' : '\n ');
          if (target === 'markdownPath') record.articleSha256 = humanWritingSha256(await fs.readFile(f.markdownPath));
          if (target === 'briefPath') record.briefSha256 = humanWritingSha256(await fs.readFile(f.briefPath));
          if (target === 'checkerPath') record.checkerSha256 = humanWritingSha256(await fs.readFile(f.checkerPath));
          if (target === 'sourcePath')
            record.sourceHashes[0] = {
              id: 'original',
              sourcePath: f.sourcePath,
              sha256: humanWritingSha256(await fs.readFile(f.sourcePath)),
            };
          await fs.writeFile(f.reviewPath, JSON.stringify(record));
        }),
      /擅自修改了锁定文件/u
    );
  }
});

test('writer self-signing is still blocked when the actual locked brief is attached', async t => {
  for (const field of ['human_writing_reviewed', 'editorial_quality_reviewed']) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await fs.writeFile(f.markdownPath, upsertFrontmatter(f.markdown, { [field]: true }));
    await assert.rejects(
      () => attachEditorialBrief({ dir: f.draftDir, mdPath: f.markdownPath }, f.planPath, f.brief),
      /自动写稿不得自行设置/u
    );
  }
});

test('source audit traversal or symlink escape is blocked before independent review', async t => {
  for (const symlink of [false, true]) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const outside = path.join(f.root, 'external-audit.md');
    await fs.writeFile(outside, '外部笔记');
    if (symlink) {
      await fs.unlink(f.auditPath);
      await fs.symlink(outside, f.auditPath);
    } else {
      f.brief.sourceAudit = '../external-audit.md';
      await fs.writeFile(f.briefPath, JSON.stringify(f.brief));
      await fs.writeFile(f.planPath, JSON.stringify(f.brief));
    }
    await assert.rejects(
      () => review(f, async () => assert.fail('外部审计不能进入本轮')),
      /来源审计不能|来源审计文件/u
    );
  }
});

test('source audit record is mandatory, explicit null only represents an absent contract audit', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await review(f);
  const record = humanWritingReviewSchema.parse(JSON.parse(await fs.readFile(f.reviewPath, 'utf8')));
  assert.deepEqual(record.sourceAudit, {
    path: f.brief.sourceAudit,
    sha256: humanWritingSha256(await fs.readFile(f.auditPath)),
  });
  for (const sourceAudit of [undefined, null, { ...record.sourceAudit, path: 'internal-audit/other.md' }]) {
    await fs.writeFile(f.reviewPath, JSON.stringify({ ...record, sourceAudit }));
    await assert.rejects(() => validate(f), /人工判断项/u);
  }
  delete f.brief.sourceAudit;
  await fs.writeFile(f.briefPath, JSON.stringify(f.brief));
  await fs.writeFile(f.planPath, JSON.stringify(f.brief));
  await review(f);
  const noAudit = humanWritingReviewSchema.parse(JSON.parse(await fs.readFile(f.reviewPath, 'utf8')));
  assert.equal(noAudit.sourceAudit, null);
  await validate(f);
});

test('final source audit validation rejects deletion and external symlinks after review', async t => {
  for (const symlink of [false, true]) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await review(f);
    const outside = path.join(f.root, 'external-audit.md');
    await fs.rename(f.auditPath, outside);
    if (symlink) await fs.symlink(outside, f.auditPath);
    await assert.rejects(() => validate(f), /来源审计文件/u);
  }
});

test('remote allowlist relocation keeps standard source audit binding and fails for omitted custom audit', async t => {
  if (spawnSync('rsync', ['--version']).error) return t.skip('rsync is unavailable');
  const uploader = await fs.readFile(path.resolve('scripts/remote-upload-draft.sh'), 'utf8');
  const filters = uploader.match(/draft_sync_args=\(([\s\S]*?)\n\)/u)?.[1] ?? '';
  const includes = Array.from(filters.matchAll(/--include='([^']+)'/gu), match => `--include=${match[1]}`);
  for (const custom of [false, true]) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    if (custom) {
      f.brief.sourceAudit = 'internal-audit/private-note.md';
      const customPath = path.join(f.draftDir, f.brief.sourceAudit);
      await fs.rename(f.auditPath, customPath);
      f.auditPath = customPath;
      await fs.writeFile(f.planPath, JSON.stringify(f.brief));
      await fs.writeFile(f.briefPath, JSON.stringify(f.brief));
    }
    await review(f);
    const remote = path.join(f.root, 'remote');
    await fs.mkdir(remote);
    const sync = spawnSync('rsync', ['-a', ...includes, '--exclude=*', `${f.draftDir}/`, `${remote}/`], {
      encoding: 'utf8',
    });
    assert.equal(sync.status, 0, sync.stderr);
    await fs.unlink(f.sourcePath);
    const validateRemote = () =>
      validateHumanWritingDraft(path.join(remote, 'article.md'), { checkerPath: f.checkerPath });
    if (custom) await assert.rejects(validateRemote, /来源审计文件/u);
    else {
      await validateRemote();
      await fs.appendFile(path.join(remote, 'internal-audit/source-audit.md'), '\n一');
      await assert.rejects(validateRemote, /来源审计路径或字节已变更/u);
    }
  }
});

test(
  'real duplicate checker warnings preserve order and multiplicity for manual and independent review',
  { skip: !installedChecker },
  async t => {
    const f = await fixture({ checkerPath: installedChecker });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await fs.writeFile(
      f.markdownPath,
      f.markdown.replace(PROSE, '# 更新时间\n\n不是九点，而是十点。不是九点，而是十点。')
    );
    const inspected = await inspectHumanWritingDraft(f.markdownPath, { checkerPath: f.checkerPath });
    const duplicates = inspected.warnings.filter(item => item.includes('对比句式复核'));
    assert.equal(duplicates.length, 2);
    assert.equal(duplicates[0], duplicates[1]);
    await assert.rejects(() => validate(f), /人工判断项/u);
    await validateHumanWritingDraft(f.markdownPath, { checkerPath: f.checkerPath, reviewedWarnings: true });
    await review(f);
    const record = humanWritingReviewSchema.parse(JSON.parse(await fs.readFile(f.reviewPath, 'utf8')));
    assert.deepEqual(
      record.warnings.map(item => item.warning),
      inspected.warnings
    );
    await validate(f);
    await fs.writeFile(f.reviewPath, JSON.stringify({ ...record, warnings: record.warnings.slice(0, 1) }));
    await assert.rejects(() => validate(f), /提醒集合/u);
  }
);

test('a stale record cannot stand in for this independent review invocation', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await review(f);
  await assert.rejects(() => review(f, async () => {}), /没有生成本轮新记录/u);
});

test('non-translation records cannot waive quote fidelity or translation author warnings', async t => {
  const f = await fixture({ mode: 'quote' });
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await assert.rejects(() => review(f, async () => assert.fail('引用不得走文风审稿')), /引用\/译文保真/u);
  await assert.rejects(() => validate(f), /人工判断项/u);
  const original = await fixture();
  t.after(() => fs.rm(original.root, { recursive: true, force: true }));
  await review(original);
  const translation = { ...original.brief, contentClass: 'translation' };
  await fs.writeFile(original.briefPath, JSON.stringify(translation));
  const record = humanWritingReviewSchema.parse(JSON.parse(await fs.readFile(original.reviewPath, 'utf8')));
  record.briefSha256 = humanWritingSha256(await fs.readFile(original.briefPath));
  await fs.writeFile(original.reviewPath, JSON.stringify(record));
  await assert.rejects(() => validate(original), /人工判断项/u);
});

test('independent record outside the draft and unmarked manual draft fail closed; manual interface stays', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await review(f);
  const external = path.join(f.root, 'outside-review.json');
  await fs.rename(f.reviewPath, external);
  await fs.symlink(external, f.reviewPath);
  await assert.rejects(() => validate(f), /人工判断项/u);
  await fs.unlink(f.reviewPath);
  await fs.rename(external, f.reviewPath);
  await fs.writeFile(f.markdownPath, PROSE);
  await assert.rejects(() => validate(f), /人工判断项/u);
  await assert.doesNotReject(() =>
    validateHumanWritingDraft(f.markdownPath, { checkerPath: f.checkerPath, reviewedWarnings: true })
  );
});

test('unknown and malformed warning groups never silently become an empty successful review', async t => {
  for (const output of ['需要人工判断\n', '需要人工判断\n不是列表', '需要人工判断\n- 未来未知类别，第 1 行']) {
    const f = await fixture();
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await fs.writeFile(f.checkerPath, `print(${JSON.stringify(output)})\n`);
    await assert.rejects(
      () => review(f, async () => assert.fail('未知提醒不得自动放行')),
      /集合无法完整解析|未知提醒/u
    );
    await assert.rejects(() => validate(f), /集合无法完整解析|人工判断项/u);
  }
});

test('warning set drifting without article or checker edits cannot reuse the bound record', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const modePath = path.join(f.root, 'warning-mode.txt');
  await fs.writeFile(modePath, 'first');
  await fs.writeFile(
    f.checkerPath,
    `from pathlib import Path\nmode=Path(${JSON.stringify(modePath)}).read_text()\nprint("需要人工判断")\nprint(${JSON.stringify(WARNINGS[0])})\nif mode == "second": print(${JSON.stringify(WARNINGS[1])})\n`
  );
  await assert.rejects(
    () =>
      review(f, async record => {
        await fs.writeFile(f.reviewPath, JSON.stringify(record));
        await fs.writeFile(modePath, 'second');
      }),
    /前后检查器提醒集合不一致/u
  );
  const errors = await collectHumanWritingReviewErrors(
    f.markdownPath,
    await inspectHumanWritingDraft(f.markdownPath, { checkerPath: f.checkerPath })
  );
  assert.ok(errors.some(error => error.includes('提醒集合')));
});
