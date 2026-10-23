import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { proseVariants } from './fixtures/prose-variants.js';
import { validateHumanWritingDraft } from './human-writing-guard.js';
import { inspectProsePatterns } from './prose-patterns.js';

for (const sample of proseVariants) {
  test(`new prose sample: ${sample.id}`, () => {
    const findings = inspectProsePatterns(sample.text);
    if (sample.expected) {
      assert.ok(
        findings.some(item => item.id === sample.expected),
        `${sample.expected} 未检出：${sample.text}`
      );
    } else {
      assert.deepEqual(findings, [], `正常表达不应触发新增套路提醒：${sample.text}`);
    }
  });
}

test('newly worded positive samples cannot pass the upload guard with a reviewed flag', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-prose-variants-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const checkerPath = path.join(root, 'checker.py');
  await fs.writeFile(checkerPath, 'print("未发现这份检查器覆盖的问题。")\n');
  const markdownPath = path.join(root, 'article.md');
  for (const sample of proseVariants.filter(item => item.expected)) {
    await fs.writeFile(markdownPath, `---\nhuman_writing_reviewed: true\n---\n\n${sample.text}`);
    await assert.rejects(
      () => validateHumanWritingDraft(markdownPath, { checkerPath, reviewedWarnings: true }),
      /表达检查/u,
      sample.id
    );
  }
});
