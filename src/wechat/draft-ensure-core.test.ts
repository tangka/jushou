import assert from 'node:assert/strict';
import test from 'node:test';
import { type EnsureDraftDependencies, ensureRemoteDraft } from './draft-ensure-core.js';
import type {
  ArticleIdentity,
  RemoteDraftArticle,
  RemotePublishedArticle,
  ReplacementJournal,
} from './draft-lifecycle.js';

const target: ArticleIdentity = { title: '今天标题', fingerprint: 'local-new', postType: 'news' };

class FakeEnsureRemote {
  readonly drafts = new Map<string, RemoteDraftArticle>();
  readonly published: RemotePublishedArticle[] = [];
  readonly journals = new Map<string, ReplacementJournal>();
  createCalls = 0;
  updateCalls = 0;
  removeCalls: string[] = [];
  publishedFails = false;
  failCreatedRead = false;
  publishOldOnRead = false;
  pinned?: RemoteDraftArticle;

  readonly deps: EnsureDraftDependencies = {
    drafts: {
      listByTitle: async title => [...this.drafts.values()].filter(record => record.title === title),
      read: async ref => {
        const record = this.drafts.get(ref);
        if (record?.ref === 'created' && this.failCreatedRead) throw new Error('read failed');
        if (record?.ref === 'old' && this.publishOldOnRead) {
          this.publishOldOnRead = false;
          this.drafts.delete(ref);
          this.published.push({ title: record.title, fingerprint: record.fingerprint, postType: record.postType });
          return undefined;
        }
        return record;
      },
      create: async identity => {
        this.createCalls += 1;
        this.drafts.set('created', { ...identity, ref: 'created' });
        return 'created';
      },
      remove: async ref => {
        this.removeCalls.push(ref);
        this.drafts.delete(ref);
      },
    },
    published: {
      listByTitle: async title => {
        if (this.publishedFails) throw new Error('freepublish unavailable');
        return this.published.filter(record => record.title === title);
      },
    },
    journal: {
      load: async id => this.journals.get(id),
      save: async journal => {
        this.journals.set(journal.operationId, structuredClone(journal));
      },
    },
    update: async ref => {
      this.updateCalls += 1;
      this.drafts.set(ref, { ...target, ref });
    },
    readPinnedDraft: async () => this.pinned,
  };
}

test('same-title publication with another fingerprint is ambiguous', async () => {
  const remote = new FakeEnsureRemote();
  remote.published.push({ ...target, fingerprint: 'other' });
  const result = await ensureRemoteDraft('op', target, remote.deps);
  assert.equal(result.state, 'ambiguous');
  assert.equal(result.outcome, 'safe_failure');
  assert.equal(remote.createCalls, 0);
});

test('pinned draft with the previous title updates in place instead of creating', async () => {
  const remote = new FakeEnsureRemote();
  remote.pinned = { title: '原标题', fingerprint: 'old', postType: 'news', ref: 'pinned' };
  remote.drafts.set('pinned', remote.pinned);
  const result = await ensureRemoteDraft('op', target, remote.deps);
  assert.deepEqual(result, {
    state: 'draft_exact',
    outcome: 'complete',
    operation: 'update',
    ref: 'pinned',
  });
  assert.equal(remote.updateCalls, 1);
  assert.equal(remote.createCalls, 0);
});

test('cross-type replacement returns the uniquely verified new ref', async () => {
  const remote = new FakeEnsureRemote();
  remote.drafts.set('old', { ...target, fingerprint: 'old', postType: 'newspic', ref: 'old' });
  const result = await ensureRemoteDraft('op', target, remote.deps);
  assert.equal(result.state, 'draft_exact');
  assert.equal(result.operation, 'replace');
  assert.equal(result.ref, 'created');
  assert.deepEqual(remote.removeCalls, ['old']);
});

test('manual publication during cross-type replacement rolls the new draft back', async () => {
  const remote = new FakeEnsureRemote();
  remote.drafts.set('old', { ...target, fingerprint: 'old', postType: 'newspic', ref: 'old' });
  remote.publishOldOnRead = true;
  const result = await ensureRemoteDraft('op', target, remote.deps);
  assert.equal(result.state, 'published_externally');
  assert.equal(result.outcome, 'complete');
  assert.equal(remote.drafts.size, 0);
  assert.ok(remote.removeCalls.includes('created'));
});

test('create readback failure removes the unverified new draft', async () => {
  const remote = new FakeEnsureRemote();
  remote.failCreatedRead = true;
  const result = await ensureRemoteDraft('op', target, remote.deps);
  assert.equal(result.state, 'unknown');
  assert.equal(result.outcome, 'safe_failure');
  assert.equal(remote.drafts.size, 0);
  assert.deepEqual(remote.removeCalls, ['created']);
});

test('published provider failure is unknown and never creates a draft', async () => {
  const remote = new FakeEnsureRemote();
  remote.publishedFails = true;
  const result = await ensureRemoteDraft('op', target, remote.deps);
  assert.equal(result.state, 'unknown');
  assert.equal(result.outcome, 'safe_failure');
  assert.equal(remote.createCalls, 0);
});

test('exact published proof is a terminal no-op', async () => {
  const remote = new FakeEnsureRemote();
  remote.published.push(target);
  const result = await ensureRemoteDraft('op', target, remote.deps);
  assert.deepEqual(result, {
    state: 'published_externally',
    outcome: 'complete',
    operation: 'noop_published',
  });
});
