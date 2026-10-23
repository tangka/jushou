import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DRAFT_META_FILE, DRAFT_STATE_FILE, writeWechatDraftTerminalState } from './draft-meta.js';

test('published terminal state updates stale metadata without losing its audit fields', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-terminal-state-'));
  await fs.writeFile(
    path.join(root, DRAFT_META_FILE),
    `${JSON.stringify({ media_id: 'private-ref', fingerprint: 'audit-fingerprint', draft_status: 'verified' })}\n`,
    'utf8'
  );
  await writeWechatDraftTerminalState({
    draftDir: root,
    account: 'ExampleNews',
    title: '文章',
    state: 'published_externally',
    operation: 'noop_published',
  });

  const meta = JSON.parse(await fs.readFile(path.join(root, DRAFT_META_FILE), 'utf8')) as Record<string, unknown>;
  const state = JSON.parse(await fs.readFile(path.join(root, DRAFT_STATE_FILE), 'utf8')) as Record<string, unknown>;
  assert.equal(meta.media_id, 'private-ref');
  assert.equal(meta.fingerprint, 'audit-fingerprint');
  assert.equal(meta.draft_status, 'published_externally');
  assert.equal(meta.automation_published, false);
  assert.equal(state.draft_status, 'published_externally');
});
