import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { editorialBlocks, evaluateEditorialGrounding } from './editorial-grounding.js';
import {
  readTutorialExpressionReview,
  TUTORIAL_EXPRESSION_REVIEW,
  tutorialReviewHash,
} from './tutorial-expression-review.js';

function fixture(t: { after: (fn: () => void) => void }) {
  const draftDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-review-'));
  t.after(() => fs.rmSync(draftDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(draftDir, 'internal-audit'));
  const source = path.join(draftDir, 'source.md');
  fs.writeFileSync(source, '产品有独立任务，可在原任务继续。');
  const body = '产品有独立任务，可在原任务继续。\n\n请检查这个示例项目并报告结果。';
  const brief = { contentClass: 'tutorial', sources: [{ id: 'official', path: source }] };
  const sourceAudit = 'F1 official 产品独立任务';
  const blocks = editorialBlocks(body, '教程');
  const review = {
    version: 1,
    reviewer: 'codex-main',
    reviewedAt: '2026-10-12T08:00:00Z',
    bodySha256: tutorialReviewHash(body),
    briefSha256: tutorialReviewHash(JSON.stringify(brief)),
    sourceAuditSha256: tutorialReviewHash(sourceAudit),
    sourceHashes: [{ id: 'official', path: source, sha256: tutorialReviewHash(fs.readFileSync(source)) }],
    unresolvedFacts: [] as string[],
    expressions: [
      {
        blockIndex: 1,
        textSha256: tutorialReviewHash(blocks[1]?.text ?? ''),
        kind: 'instruction-template',
        reason: '给读者复制的请求示例，不宣称这个操作已经执行或成功。',
      },
    ],
  };
  const file = path.join(draftDir, TUTORIAL_EXPRESSION_REVIEW);
  const save = () => fs.writeFileSync(file, JSON.stringify(review));
  save();
  return { input: { draftDir, body, brief, sourceAudit, blocks }, review, save, source, file };
}

test('reviewed instructions do not inflate facts or change article length', t => {
  const f = fixture(t);
  const reviewedExpressionBlocks = readTutorialExpressionReview(f.input);
  const requirements = [{ id: 'F1', allOf: [{ anyOf: ['独立任务'] }, { anyOf: ['原任务'] }] }];
  const before = evaluateEditorialGrounding({ body: f.input.body, title: '', requirements });
  const after = evaluateEditorialGrounding({ body: f.input.body, title: '', requirements, reviewedExpressionBlocks });
  assert.equal(after.totalUnits, before.totalUnits);
  assert.equal(after.groundedCredit, before.groundedCredit);
  assert.deepEqual(after.matchedRequirementIds, ['F1']);
  assert.equal(after.matchedBlockCount, 1);
  assert.equal(after.ungroundedUnits, 0);
  assert.equal(after.reviewedExpressionUnits, f.input.blocks[1]?.units);
});

test('missing review preserves the normal gate; classifying everything cannot supply six facts', t => {
  const f = fixture(t);
  fs.unlinkSync(f.file);
  assert.equal(readTutorialExpressionReview(f.input).size, 0);
  const result = evaluateEditorialGrounding({
    body: f.input.body,
    title: '',
    requirements: [{ id: 'F1', allOf: [{ anyOf: ['独立任务'] }] }],
    reviewedExpressionBlocks: new Set([0, 1]),
  });
  assert.equal(result.groundedCredit, 0);
  assert.equal(result.matchedBlockCount, 0);
  assert.equal(result.matchedRequirementIds.length, 0);
});

test('body, contract, audit and source mutations invalidate the review', t => {
  const f = fixture(t);
  assert.throws(() => readTutorialExpressionReview({ ...f.input, body: `${f.input.body}另一个断言。` }), /已过期/u);
  assert.throws(
    () => readTutorialExpressionReview({ ...f.input, brief: { ...f.input.brief, sources: [] } }),
    /已过期/u
  );
  assert.throws(() => readTutorialExpressionReview({ ...f.input, sourceAudit: 'changed' }), /已过期/u);
  fs.writeFileSync(f.source, 'changed');
  assert.throws(() => readTutorialExpressionReview(f.input), /来源已变化/u);
});

test('other carriers, missing source coverage, and unresolved facts fail closed', t => {
  const f = fixture(t);
  assert.throws(
    () => readTutorialExpressionReview({ ...f.input, brief: { ...f.input.brief, contentClass: 'brief' } }),
    /仅适用于/u
  );
  f.review.sourceHashes = [];
  f.save();
  assert.throws(() => readTutorialExpressionReview(f.input), /来源集合不一致/u);
  f.review.unresolvedFacts = ['需要核实产品状态'];
  f.save();
  assert.throws(() => readTutorialExpressionReview(f.input));
});

test('duplicate or stale block classifications fail closed', t => {
  const f = fixture(t);
  const item = f.review.expressions[0];
  assert.ok(item);
  f.review.expressions.push({ ...item });
  f.save();
  assert.throws(() => readTutorialExpressionReview(f.input), /段落不一致或重复/u);
  f.review.expressions = [{ ...item, textSha256: '0'.repeat(64) }];
  f.save();
  assert.throws(() => readTutorialExpressionReview(f.input), /段落不一致或重复/u);
});

test('a symlink cannot borrow a review outside the draft', t => {
  const f = fixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.copyFileSync(f.file, path.join(external, 'review.json'));
  fs.unlinkSync(f.file);
  fs.symlinkSync(path.join(external, 'review.json'), f.file);
  assert.throws(() => readTutorialExpressionReview(f.input), /不能指向/u);
});
