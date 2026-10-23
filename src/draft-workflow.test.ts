import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPackagingPreservesText, prepareDraftForValidation } from './draft-workflow.js';

test('translation is packaged and fixed before independent review and validation', async () => {
  const calls: string[] = [];
  for (const contentClass of ['translation', 'brief']) {
    calls.length = 0;
    const stage = (name: string) => async () => {
      calls.push(name);
    };
    await prepareDraftForValidation({
      contentClass,
      packageDraft: stage('package'),
      attachBrief: stage('attach'),
      reviewTranslation: stage('review'),
      reviewHumanWriting: stage('style-review'),
      validateDraft: stage('validate'),
    });
    assert.deepEqual(
      calls,
      contentClass === 'translation'
        ? ['package', 'attach', 'review', 'validate']
        : ['package', 'attach', 'style-review', 'validate']
    );
  }
});

test('failed independent review cannot reach successful validation', async () => {
  let validated = false;
  await assert.rejects(
    () =>
      prepareDraftForValidation({
        contentClass: 'translation',
        packageDraft: async () => {},
        attachBrief: async () => {},
        reviewTranslation: async () => {
          throw new Error('原文未读全');
        },
        reviewHumanWriting: async () => {},
        validateDraft: async () => {
          validated = true;
        },
      }),
    /原文未读全/u
  );
  assert.equal(validated, false);
});

test('packaging can add image resources and cover metadata but cannot rewrite title or prose', () => {
  const before = '---\ntitle: 使用指南\n---\n\n## 参数\n\n保留参数值。';
  const after = '---\ntitle: 使用指南\ncover: media/cover.png\n---\n\n## 参数\n\n保留参数值。\n\n![原图](media/1.png)';
  assert.doesNotThrow(() => assertPackagingPreservesText(before, after));
  assert.throws(
    () => assertPackagingPreservesText(before, after.replace('保留参数值。', '参数值不重要。')),
    /改动了正文/u
  );
  assert.throws(
    () => assertPackagingPreservesText(before, after.replace('title: 使用指南', 'title: 风险指南')),
    /改动了正文或标题/u
  );
});
