import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseMarkdown, renderArticle } from '../build-publish-html.js';
import { prepareDraftForValidation } from '../draft-workflow.js';
import {
  type EditorialBrief,
  parseEditorialBrief,
  validateAutomatedDraftEditorialQuality,
  validateEditorialBriefPlan,
} from './editorial-quality.js';
import {
  collectTranslationReviewErrors,
  snapshotTranslationSources,
  TRANSLATION_REVIEW_FILE,
  translationReviewInputs,
} from './editorial-translation.js';
import { resolveHumanWritingChecker, validateWechatDraftHumanWriting } from './human-writing-guard.js';

// 用户提供的官方写作提示词译文片段，保留其列举的禁词作为真实检查器测试输入。
const OFFICIAL_PROMPT =
  '避免使用套话和滥用词，例如在结论中写“底线是：”，或使用“深入探讨”、“培养”、“利用”、“值得注意的是”、“重要的是”、“问题？答案。”、“这不是X的问题，而是Y的问题”、“真正地”，以及用连字符组成的复合描述和形容词。不要使用“简而言之：……”、“最简单的心智模型是：……”之类总结句。';
const installedChecker = await resolveHumanWritingChecker().catch(() => undefined);
const integrationOptions = { skip: installedChecker ? false : 'wechat-human-writing is not installed' };

async function fixture(options: { quotedPrompt?: boolean; authorText?: string } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-translation-'));
  const draftDir = path.join(root, '2026-09-06-指南__codex');
  await fs.mkdir(path.join(draftDir, 'internal-audit'), { recursive: true });
  const sourcePath = path.join(root, 'original.md');
  const paragraphs = Array.from(
    { length: 6 },
    (_, i) => `## 章节${i + 1}\n\n参数${i + 1}采用取值${i + 1}。${'译'.repeat(options.quotedPrompt ? 110 : 126)}`
  );
  if (options.quotedPrompt) paragraphs[5] += `\n\n> \`\`\`text\n> ${OFFICIAL_PROMPT}\n> \`\`\``;
  await fs.writeFile(sourcePath, paragraphs.join('\n\n'));
  const markdown = `---\ntitle: 模型使用指南\naccount: 示例AI\ncontent_type: news\n---\n\n${paragraphs.join('\n\n')}${options.authorText ? `\n\n${options.authorText}` : ''}`;
  const requirements = paragraphs.map((_, i) => ({
    id: `fact-${i + 1}`,
    description: `完整保留第${i + 1}章的参数和值`,
    scope: 'body' as const,
    allOf: [{ anyOf: [`参数${i + 1}`] }, { anyOf: [`取值${i + 1}`] }],
    sourceIds: ['original'],
  }));
  const brief: EditorialBrief = {
    version: 2,
    account: '示例AI',
    date: '2026-09-06',
    selectionMode: 'user_locked',
    userDirective: '完整翻译官方指南，保留章节、参数与完整提示词。',
    contentClass: 'translation',
    topic: '模型使用指南',
    primarySignal: '用户要求完整翻译官方使用指南。',
    whyNow: '用户现在需要阅读完整中文使用文档。',
    readerPromise: '读者可以完整查阅原文对应的参数和提示词。',
    titleTerms: [{ anyOf: ['使用指南'] }],
    sources: [{ id: 'original', label: '官方原文', path: sourcePath, evidence: '原文包含全部章节及参数说明。' }],
    candidates: [
      { topic: '模型使用指南', selected: true, reason: '用户明确指定翻译该篇原文', sourceIds: ['original'] },
    ],
    requirements,
    forbiddenClaims: [],
    sourceAudit: 'internal-audit/source-audit.md',
    substanceRequirementIds: requirements.map(item => item.id),
  };
  await fs.writeFile(path.join(draftDir, 'editorial-brief.json'), JSON.stringify(brief));
  await fs.writeFile(
    path.join(draftDir, brief.sourceAudit ?? ''),
    requirements.map(item => `${item.id}: original`).join('\n')
  );
  const report = {
    version: 1,
    ...translationReviewInputs(markdown, brief.sources),
    sections: paragraphs.map((_, i) => ({
      sourceId: 'original',
      sourceSection: `章节${i + 1}`,
      translatedSection: `章节${i + 1}`,
      assessment: '本章的参数名、值与条件均对应原文。',
    })),
    parameterReview: '逐项对照了六章的参数与值。',
    promptReview: options.quotedPrompt
      ? '已逐句对照第六章的 text 提示词，列举的禁词、标点与完整语句均保留。'
      : '测试原文没有提示词代码块。',
    additionsReview: '逐章对照未增加作者经历或建议。',
    issues: [] as string[],
  };
  const input = {
    draftDir,
    markdown,
    title: '模型使用指南',
    body: parseMarkdown(markdown, 'article').body,
    postType: '图文',
    accountExact: '示例AI',
  };
  snapshotTranslationSources(draftDir, brief.sources);
  await fs.writeFile(path.join(draftDir, 'article.md'), markdown);
  return { root, brief, input, report, reviewPath: path.join(draftDir, TRANSLATION_REVIEW_FILE), sourcePath };
}

test(
  'reviewed official text prompt completes packaging, review and real prose validation unchanged',
  integrationOptions,
  async t => {
    const f = await fixture({ quotedPrompt: true });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const articlePath = path.join(f.input.draftDir, 'article.md');
    const before = await fs.readFile(articlePath, 'utf8');
    const stages: string[] = [];
    await prepareDraftForValidation({
      contentClass: 'translation',
      packageDraft: async () => {
        stages.push('package');
      },
      attachBrief: async () => {
        stages.push('attach');
      },
      reviewTranslation: async () => {
        stages.push('review');
        // 离线测试注入逐项审稿记录；不声称执行过模型语义审稿。
        await fs.writeFile(f.reviewPath, JSON.stringify(f.report));
      },
      reviewHumanWriting: async () => {
        assert.fail('译文不能走非翻译作者文风复核');
      },
      validateDraft: async () => {
        stages.push('validate');
        await validateAutomatedDraftEditorialQuality(f.input);
        await validateWechatDraftHumanWriting(articlePath, f.input.markdown, '图文');
      },
    });
    assert.deepEqual(stages, ['package', 'attach', 'review', 'validate']);
    assert.equal(await fs.readFile(articlePath, 'utf8'), before);
    assert.ok(before.includes(`> \`\`\`text\n> ${OFFICIAL_PROMPT}\n> \`\`\``));
    assert.ok(!before.includes('human_writing_reviewed'));
    const html = renderArticle(f.input.title, f.input.body);
    assert.ok(html.includes(OFFICIAL_PROMPT));
    assert.match(html, /<blockquote[\s>]/u);
    assert.match(html, /language-text/u);
  }
);

test(
  'translation quote reminders require a current review and cannot use another article text',
  integrationOptions,
  async t => {
    const f = await fixture({ quotedPrompt: true });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    const articlePath = path.join(f.input.draftDir, 'article.md');
    const validate = () => validateWechatDraftHumanWriting(articlePath, f.input.markdown, '图文');
    await assert.rejects(validate, /人工判断项/u);
    await fs.writeFile(f.reviewPath, JSON.stringify({ ...f.report, issues: ['提示词漏译了一句'] }));
    await assert.rejects(validate, /人工判断项/u);
    await fs.writeFile(f.reviewPath, JSON.stringify(f.report));
    await assert.doesNotReject(validate);
    await fs.appendFile(articlePath, '\n\n新增了一句。');
    await assert.rejects(validate, /人工判断项/u);
  }
);

test('translation review never waives author prose warnings or failures', integrationOptions, async t => {
  for (const [authorText, expected] of [
    ['甲：一。乙：二。丙：三。丁：四。', /提示性冒号/u],
    ['这不是价格的问题，而是效率的问题。', /对比句式复核/u],
  ] as const) {
    const f = await fixture({ quotedPrompt: true, authorText });
    t.after(() => fs.rm(f.root, { recursive: true, force: true }));
    await fs.writeFile(f.reviewPath, JSON.stringify(f.report));
    assert.deepEqual(collectTranslationReviewErrors(f.brief, f.input), []);
    await assert.rejects(
      () => validateWechatDraftHumanWriting(path.join(f.input.draftDir, 'article.md'), f.input.markdown, '图文'),
      expected
    );
  }
});

test('translation accepts one complete source without invented images and still requires an independent review record', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  assert.equal(parseEditorialBrief(JSON.stringify(f.brief)).contentClass, 'translation');
  assert.doesNotThrow(() =>
    validateEditorialBriefPlan(f.brief, {
      accountExact: '示例AI',
      date: '2026-09-06',
      expectedDirective: f.brief.userDirective,
    })
  );
  await assert.rejects(() => validateAutomatedDraftEditorialQuality(f.input), /翻译审稿记录/u);
  await fs.writeFile(f.reviewPath, JSON.stringify(f.report));
  await assert.doesNotReject(() => validateAutomatedDraftEditorialQuality(f.input));
});

test('translation keeps source requirements and 800–10000 length safety checks', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await fs.writeFile(f.reviewPath, JSON.stringify(f.report));
  await assert.rejects(
    () => validateAutomatedDraftEditorialQuality({ ...f.input, body: f.input.body.replace('参数1', '省略参数') }),
    /缺少必写事实 fact-1/u
  );
  for (const body of ['短'.repeat(799), '长'.repeat(10001)]) {
    await assert.rejects(() => validateAutomatedDraftEditorialQuality({ ...f.input, body }), /800~10000/u);
  }
  await assert.rejects(
    () => validateAutomatedDraftEditorialQuality({ ...f.input, accountExact: 'ExampleNews' }),
    /当前账号=ExampleNews/u
  );
});

test('translation review issues, changed prose, and changed sources all block upload', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await fs.writeFile(f.reviewPath, JSON.stringify({ ...f.report, issues: ['第三章漏译一个条件'] }));
  assert.match(collectTranslationReviewErrors(f.brief, f.input).join('\n'), /第三章漏译/u);
  await fs.writeFile(f.reviewPath, JSON.stringify(f.report));
  assert.match(
    collectTranslationReviewErrors(f.brief, { ...f.input, markdown: `${f.input.markdown}\n新增一句` }).join('\n'),
    /译文已变更/u
  );
  await fs.appendFile(f.sourcePath, '\n新参数');
  assert.match(collectTranslationReviewErrors(f.brief, f.input).join('\n'), /翻译来源已变更/u);
});

test('translation review cannot escape its draft through a symlink', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const outside = path.join(f.root, 'outside-review.json');
  await fs.writeFile(outside, JSON.stringify(f.report));
  await fs.symlink(outside, f.reviewPath);
  assert.match(collectTranslationReviewErrors(f.brief, f.input).join('\n'), /符号链接离开/u);
});

test('remote translation validation uses the reviewed source snapshot when the Mac path is unavailable', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await fs.writeFile(f.reviewPath, JSON.stringify(f.report));
  await fs.rename(f.sourcePath, path.join(f.root, 'not-on-remote.md'));
  await assert.doesNotReject(() => validateAutomatedDraftEditorialQuality(f.input));
  const snapshot = path.join(
    f.input.draftDir,
    'internal-audit/translation-sources',
    `${f.report.sourceHashes[0]?.sha256}.md`
  );
  await fs.appendFile(snapshot, '\n未审新增内容');
  await assert.rejects(() => validateAutomatedDraftEditorialQuality(f.input), /原文快照已变更/u);
});

test('remote upload allowlist actually transfers translation review and snapshots, not unrelated audit files', async t => {
  if (spawnSync('rsync', ['--version']).error) {
    t.skip('rsync is unavailable');
    return;
  }
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await fs.writeFile(f.reviewPath, JSON.stringify(f.report));
  await fs.writeFile(path.join(f.input.draftDir, 'internal-audit/private-note.md'), '不应上传');
  const uploader = await fs.readFile(path.resolve('scripts/remote-upload-draft.sh'), 'utf8');
  const filters = uploader.match(/draft_sync_args=\(([\s\S]*?)\n\)/u)?.[1] ?? '';
  const includes = Array.from(filters.matchAll(/--include='([^']+)'/gu), match => `--include=${match[1]}`);
  const remote = path.join(f.root, 'remote-draft');
  await fs.mkdir(remote);
  const sync = spawnSync('rsync', ['-a', ...includes, '--exclude=*', `${f.input.draftDir}/`, `${remote}/`], {
    encoding: 'utf8',
  });
  assert.equal(sync.status, 0, sync.stderr);
  assert.equal(await fs.readFile(path.join(remote, TRANSLATION_REVIEW_FILE), 'utf8'), JSON.stringify(f.report));
  const snapshotName = `${f.report.sourceHashes[0]?.sha256}.md`;
  assert.equal(
    await fs.readFile(path.join(remote, 'internal-audit/translation-sources', snapshotName), 'utf8'),
    await fs.readFile(f.sourcePath, 'utf8')
  );
  await assert.rejects(() => fs.stat(path.join(remote, 'internal-audit/private-note.md')), /ENOENT/u);
  await fs.rename(f.sourcePath, path.join(f.root, 'not-on-remote.md'));
  await assert.doesNotReject(() => validateAutomatedDraftEditorialQuality({ ...f.input, draftDir: remote }));
});
