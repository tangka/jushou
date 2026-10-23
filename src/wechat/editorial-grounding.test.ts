import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  countEditorialSubstantiveUnits,
  evaluateEditorialGrounding,
  NEWS_GROUNDING_MAX_UNGROUNDED_BLOCK_UNITS,
} from './editorial-grounding.js';
import { type EditorialBrief, validateEditorialBriefPlan, validateEditorialQuality } from './editorial-quality.js';

function requirement(index: number) {
  return {
    id: `req-${index}`,
    description: `第 ${index} 项来源事实`,
    scope: 'body' as const,
    allOf: [{ anyOf: [`信号${index}`] }, { anyOf: [`结论${index}`] }],
    sourceIds: [`src-${index}`],
  };
}

function exactBlock(index: number, units: number): string {
  const prefix = `信号${index}结论${index}`;
  const prefixUnits = countEditorialSubstantiveUnits(prefix, '');
  assert.ok(prefixUnits <= units);
  return `${prefix}${'锚'.repeat(units - prefixUnits)}`;
}

function groundedBody(groundedUnits = 110, ungroundedUnits: readonly number[] = [70, 70]): string {
  const blocks = [
    ...Array.from({ length: 6 }, (_, index) => exactBlock(index + 1, groundedUnits)),
    ...ungroundedUnits.map(units => '泛'.repeat(units)),
    '![证据图](media/evidence.png)',
  ];
  return blocks.join('\n\n');
}

async function v2Fixture(): Promise<{ root: string; draftDir: string; brief: EditorialBrief }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-grounding-'));
  const draftDir = path.join(root, '2026-08-29-grounded__codex');
  const sourceDir = path.join(root, 'sources');
  await fs.mkdir(path.join(draftDir, 'internal-audit'), { recursive: true });
  await fs.mkdir(sourceDir, { recursive: true });
  const sources = [];
  for (let index = 1; index <= 6; index += 1) {
    const sourcePath = path.join(sourceDir, `${index}.md`);
    await fs.writeFile(sourcePath, `source ${index}\n`, 'utf8');
    sources.push({
      id: `src-${index}`,
      label: `来源 ${index}`,
      path: sourcePath,
      evidence: `证明第 ${index} 项事实`,
    });
  }
  const requirements = Array.from({ length: 6 }, (_, index) => requirement(index + 1));
  const brief: EditorialBrief = {
    version: 2,
    account: 'ExampleNews',
    date: '2026-08-29',
    selectionMode: 'user_locked',
    userDirective: '写今天确认的六项事实。',
    contentClass: 'brief',
    topic: '六项事实核查',
    primarySignal: '今天出现六项可以逐项核验的来源事实。',
    whyNow: '六项事实都在今天形成完整的一手证据链。',
    readerPromise: '读者可以逐项核对来源事实与实际影响。',
    titleTerms: [{ anyOf: ['事实'] }],
    sources,
    candidates: [
      {
        topic: '六项事实核查',
        selected: true,
        reason: '用户锁定当天事实',
        sourceIds: sources.map(source => source.id),
      },
    ],
    requirements,
    forbiddenClaims: [],
    minimums: { substantiveUnits: 800, bodyImages: 1, sources: 6, requirements: 6 },
    sourceAudit: 'internal-audit/source-audit.md',
    substanceRequirementIds: requirements.map(item => item.id),
  };
  await fs.writeFile(
    path.join(draftDir, 'internal-audit/source-audit.md'),
    `${requirements.map(item => `${item.id} ${item.sourceIds.join(' ')}`).join('\n')}\n`,
    'utf8'
  );
  return { root, draftDir, brief };
}

function qualityInput(draftDir: string, body: string) {
  return {
    draftDir,
    markdown: '',
    title: '六项事实核查',
    body,
    postType: '图文',
    accountExact: 'ExampleNews',
  };
}

test('v2 grounded news passes with six requirements across at least four blocks', async t => {
  const fixture = await v2Fixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const body = groundedBody();
  assert.equal(countEditorialSubstantiveUnits(body, ''), 800);
  assert.doesNotThrow(() => validateEditorialBriefPlan(fixture.brief, { accountExact: 'ExampleNews', date: '2026-08-29' }));
  assert.doesNotThrow(() => validateEditorialQuality(fixture.brief, qualityInput(fixture.draftDir, body)));
});

test('v2 grounding rejects generic padding even after the article reaches 800 units', async t => {
  const fixture = await v2Fixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const body = groundedBody(30, [89, 89, 89, 89, 88, 88, 88]);
  assert.equal(countEditorialSubstantiveUnits(body, ''), 800);
  assert.throws(() => validateEditorialQuality(fixture.brief, qualityInput(fixture.draftDir, body)), /未锚定内容/u);
});

test('v2 grounding rejects keyword stuffing into one paragraph', async t => {
  const fixture = await v2Fixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const prefix = Array.from({ length: 6 }, (_, index) => `信号${index + 1}结论${index + 1}`).join('');
  const prefixUnits = countEditorialSubstantiveUnits(prefix, '');
  const body = `${prefix}${'锚'.repeat(660 - prefixUnits)}\n\n${'泛'.repeat(70)}\n\n${'泛'.repeat(70)}\n\n![图](media/evidence.png)`;
  assert.equal(countEditorialSubstantiveUnits(body, ''), 800);
  assert.throws(
    () => validateEditorialQuality(fixture.brief, qualityInput(fixture.draftDir, body)),
    /仅 1 个事实锚定段/u
  );
});

test('allOf terms split across paragraphs do not satisfy one grounding requirement', () => {
  const requirements = Array.from({ length: 6 }, (_, index) => requirement(index + 1));
  const body = [
    '信号1'.padEnd(40, '锚'),
    '结论1'.padEnd(40, '锚'),
    ...Array.from({ length: 5 }, (_, index) => exactBlock(index + 2, 110)),
  ].join('\n\n');
  const result = evaluateEditorialGrounding({ body, title: '', requirements });
  assert.deepEqual(result.matchedRequirementIds.sort(), ['req-2', 'req-3', 'req-4', 'req-5', 'req-6']);
});

test('document headings neither inflate substantive length nor consume the ungrounded prose budget', () => {
  const body = groundedBody();
  const headings = Array.from({ length: 46 }, (_, index) => `## 官方指南的第${index + 1}个小节`).join('\n\n');
  const requirements = Array.from({ length: 6 }, (_, index) => requirement(index + 1));
  assert.equal(countEditorialSubstantiveUnits(`${headings}\n\n${body}`, ''), 800);
  assert.deepEqual(
    evaluateEditorialGrounding({ body: `${headings}\n\n${body}`, title: '', requirements }),
    evaluateEditorialGrounding({ body, title: '', requirements })
  );
});

test('source terms placed only in headings cannot earn fact or paragraph credit', () => {
  const requirements = Array.from({ length: 6 }, (_, index) => requirement(index + 1));
  const body = [
    ...Array.from({ length: 6 }, (_, index) => `## 信号${index + 1}结论${index + 1}`),
    '泛'.repeat(800),
  ].join('\n\n');
  const result = evaluateEditorialGrounding({ body, title: '', requirements });
  assert.equal(result.totalUnits, 800);
  assert.equal(result.ungroundedUnits, 800);
  assert.equal(result.matchedBlockCount, 0);
  assert.deepEqual(result.matchedRequirementIds, []);
});

test('heading parsing preserves fenced code comments and handles setext headings', () => {
  const body = '模型参数\n--------\n\n```python\n# 信号1结论1\nprint("保留全部代码")\n```';
  const expectedCode = '信号1结论1\nprint("保留全部代码")';
  assert.equal(countEditorialSubstantiveUnits(body, ''), countEditorialSubstantiveUnits(expectedCode, ''));
  const result = evaluateEditorialGrounding({ body, title: '', requirements: [requirement(1)] });
  assert.deepEqual(result.matchedRequirementIds, ['req-1']);
  assert.equal(result.ungroundedUnits, 0);
});

test('v2 grounding rejects one oversized fully ungrounded paragraph', async t => {
  const fixture = await v2Fixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const body = groundedBody(110, [NEWS_GROUNDING_MAX_UNGROUNDED_BLOCK_UNITS + 1, 19]);
  assert.equal(countEditorialSubstantiveUnits(body, ''), 800);
  assert.throws(
    () => validateEditorialQuality(fixture.brief, qualityInput(fixture.draftDir, body)),
    /单个完全未锚定段 121 单位/u
  );
});

test('v2 source audit must map every substantive requirement to its source ids on one line', async t => {
  const fixture = await v2Fixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(fixture.draftDir, 'internal-audit/source-audit.md'),
    'req-1 src-1\nreq-2 src-2\n',
    'utf8'
  );
  assert.throws(
    () => validateEditorialQuality(fixture.brief, qualityInput(fixture.draftDir, groundedBody())),
    /sourceAudit 未在同一行列出 requirement 与 sourceIds：req-3/u
  );
});

test('v2 planner requires absolute existing local source files and a six-id body contract', async t => {
  const fixture = await v2Fixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const invalid: EditorialBrief = {
    ...fixture.brief,
    sources: fixture.brief.sources.map((source, index) =>
      index === 0
        ? { ...source, path: 'relative/source.md' }
        : index === 1
          ? { ...source, path: path.join(fixture.root, 'missing-source.md') }
          : source
    ),
    requirements: fixture.brief.requirements.map((item, index) =>
      index === 0 ? { ...item, scope: 'title' as const, allOf: [{ anyOf: ['信号1'] }] } : item
    ),
    substanceRequirementIds: fixture.brief.substanceRequirementIds?.slice(0, 5),
  };
  assert.throws(
    () => validateEditorialBriefPlan(invalid, { accountExact: 'ExampleNews', date: '2026-08-29' }),
    /来源必须是绝对路径[\s\S]*来源文件不存在[\s\S]*至少需要 6 个[\s\S]*只能使用 body\/all scope[\s\S]*至少需要 2 个 allOf/u
  );
});

test('version 1 is legacy-only after the cutoff date', async t => {
  const fixture = await v2Fixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const legacy: EditorialBrief = { ...fixture.brief, version: 1, date: '2026-08-29' };
  assert.throws(
    () => validateEditorialBriefPlan(legacy, { accountExact: 'ExampleNews', date: '2026-08-29' }),
    /version 1 仅允许日期不晚于 2026-08-28/u
  );
});

test('remote v2 quality validation does not recheck Mac-only absolute source paths', async t => {
  const fixture = await v2Fixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const remoteBrief: EditorialBrief = {
    ...fixture.brief,
    sources: fixture.brief.sources.map(source => ({
      ...source,
      path: `/Users/local-only/missing/${source.id}.md`,
    })),
  };
  assert.doesNotThrow(() => validateEditorialQuality(remoteBrief, qualityInput(fixture.draftDir, groundedBody())));
});

test('newspic and legacy v1 drafts do not use the v2 news grounding gate', () => {
  const sticker: EditorialBrief = {
    version: 2,
    account: '示例AI',
    date: '2026-08-29',
    selectionMode: 'user_locked',
    userDirective: '发贴图',
    contentClass: 'sticker',
    topic: '贴图事实',
    primarySignal: '今天出现可以直接展示的事实图片。',
    whyNow: '用户今天明确要求使用贴图载体。',
    readerPromise: '一张图看清今天发生的事实。',
    titleTerms: [{ anyOf: ['事实'] }],
    sources: [{ id: 'image', label: '用户图片', path: '/missing/image.png', evidence: '图片展示事实' }],
    candidates: [{ topic: '贴图事实', selected: true, reason: '用户指定贴图', sourceIds: ['image'] }],
    requirements: [
      {
        id: 'image-fact',
        description: '图片事实',
        scope: 'all',
        allOf: [{ anyOf: ['事实'] }],
        sourceIds: ['image'],
      },
    ],
    forbiddenClaims: [],
  };
  assert.doesNotThrow(() =>
    validateEditorialQuality(sticker, {
      draftDir: '/missing/2026-08-29-sticker__codex',
      markdown: '',
      title: '事实贴图',
      body: '事实已经发生，今天可以直接查看。\n\n![图](media/cover.png)',
      postType: '贴图',
      accountExact: '示例AI',
    })
  );

  const requirements = Array.from({ length: 6 }, (_, index) => requirement(index + 1));
  const legacy: EditorialBrief = {
    version: 1,
    account: 'ExampleNews',
    date: '2026-08-28',
    selectionMode: 'user_locked',
    userDirective: '写旧合同文章',
    contentClass: 'brief',
    topic: '旧合同文章',
    primarySignal: '今天保留最后一天的旧合同兼容边界。',
    whyNow: '旧草稿需要在截止日期内保持可校验。',
    readerPromise: '读者可以看到旧合同文章继续通过。',
    titleTerms: [{ anyOf: ['旧合同'] }],
    sources: Array.from({ length: 6 }, (_, index) => ({
      id: `src-${index + 1}`,
      label: `来源${index + 1}`,
      path: 'relative.md',
      evidence: '旧合同证据',
    })),
    candidates: [{ topic: '旧合同文章', selected: true, reason: '兼容旧稿', sourceIds: ['src-1'] }],
    requirements,
    forbiddenClaims: [],
  };
  assert.doesNotThrow(() =>
    validateEditorialQuality(legacy, {
      draftDir: '/missing/2026-08-28-legacy__codex',
      markdown: '',
      title: '旧合同文章',
      body: `${groundedBody()}\n\n${'旧'.repeat(50)}`,
      postType: '图文',
      accountExact: 'ExampleNews',
    })
  );
});

test('grounding metrics cap credit by distinct matched ids', () => {
  const requirements = Array.from({ length: 6 }, (_, index) => requirement(index + 1));
  const result = evaluateEditorialGrounding({ body: groundedBody(), title: '', requirements });
  assert.equal(result.matchedRequirementIds.length, 6);
  assert.equal(result.matchedBlockCount, 6);
  assert.equal(result.matchedBlockUnits, 660);
  assert.equal(result.groundedCredit, 660);
  assert.equal(result.ungroundedUnits, 140);
});
