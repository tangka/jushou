import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ReplacementJournal } from './draft-lifecycle.js';
import { createAtomicDraftJournalStore, DRAFT_OPERATION_FILE } from './draft-operation-journal.js';

const journal: ReplacementJournal = {
  version: 1,
  operationId: 'op-1',
  stage: 'planned',
  desired: { title: '标题', fingerprint: 'new', postType: 'news' },
  previous: { title: '标题', fingerprint: 'old', postType: 'newspic' },
  oldDraftRef: 'private-old-ref',
};

test('atomic journal persists and only resumes the matching operation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-draft-journal-'));
  const store = createAtomicDraftJournalStore(root);
  await store.save(journal);

  assert.deepEqual(await store.load('op-1'), journal);
  assert.equal(await store.load('another-operation'), undefined);
  const names = await fs.readdir(root);
  assert.deepEqual(names, [DRAFT_OPERATION_FILE]);
});

test('malformed journal fails closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-draft-journal-bad-'));
  await fs.writeFile(path.join(root, DRAFT_OPERATION_FILE), '{bad json', 'utf8');
  await assert.rejects(() => createAtomicDraftJournalStore(root).load('op-1'), /不是合法 JSON/);
});
