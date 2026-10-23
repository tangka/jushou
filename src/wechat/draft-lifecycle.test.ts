import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type DraftLifecycleDependencies,
  decideReplacementRecovery,
  type LifecycleEvent,
  type RemoteDraftArticle,
  type RemoteDraftRef,
  type RemotePublishedArticle,
  type ReplacementJournal,
  type ReplacementRequest,
  replaceDraftAcrossPostTypes,
  resolveRemoteArticleState,
} from './draft-lifecycle.js';

const desired = { title: '同一标题', fingerprint: 'fingerprint-new', postType: 'news' as const };
const previous = { title: '同一标题', fingerprint: 'fingerprint-old', postType: 'newspic' as const };
const oldRef = 'remote-old-secret';
const request: ReplacementRequest = {
  operationId: 'replace-20260814',
  desired,
  previous: { ...previous, ref: oldRef },
};

class FakeRemote {
  readonly drafts = new Map<RemoteDraftRef, RemoteDraftArticle>();
  readonly published: RemotePublishedArticle[] = [];
  readonly readFailures = new Set<RemoteDraftRef>();
  readonly removeFailures = new Set<RemoteDraftRef>();
  createFails = false;
  draftListFails = false;
  publishedListFails = false;
  createCalls = 0;
  removeCalls: RemoteDraftRef[] = [];
  createdOverride?: RemoteDraftArticle;
  beforeRemove?: (ref: RemoteDraftRef) => void;
  afterRemove?: (ref: RemoteDraftRef) => void;

  constructor() {
    this.drafts.set(oldRef, { ...previous, ref: oldRef });
  }

  readonly draftProvider = {
    listByTitle: async (title: string): Promise<readonly RemoteDraftArticle[]> => {
      if (this.draftListFails) throw new Error('draft provider failed with remote-secret');
      return [...this.drafts.values()].filter(item => item.title === title);
    },
    read: async (ref: RemoteDraftRef): Promise<RemoteDraftArticle | undefined> => {
      if (this.readFailures.has(ref)) throw new Error('read failed with remote-secret');
      return this.drafts.get(ref);
    },
    create: async (): Promise<RemoteDraftRef> => {
      this.createCalls += 1;
      if (this.createFails) throw new Error('create failed with remote-secret');
      const ref = `remote-new-secret-${this.createCalls}`;
      this.drafts.set(ref, this.createdOverride ?? { ...desired, ref });
      return ref;
    },
    remove: async (ref: RemoteDraftRef): Promise<void> => {
      this.removeCalls.push(ref);
      this.beforeRemove?.(ref);
      if (this.removeFailures.has(ref)) throw new Error('remove failed with remote-secret');
      this.drafts.delete(ref);
      this.afterRemove?.(ref);
    },
  };

  readonly publishedProvider = {
    listByTitle: async (title: string): Promise<readonly RemotePublishedArticle[]> => {
      if (this.publishedListFails) throw new Error('published provider failed with remote-secret');
      return this.published.filter(item => item.title === title);
    },
  };
}

class MemoryJournal {
  current?: ReplacementJournal;
  readonly history: ReplacementJournal[] = [];

  readonly store = {
    load: async (operationId: string): Promise<ReplacementJournal | undefined> => {
      return this.current?.operationId === operationId ? structuredClone(this.current) : undefined;
    },
    save: async (journal: ReplacementJournal): Promise<void> => {
      this.current = structuredClone(journal);
      this.history.push(structuredClone(journal));
    },
  };
}

function harness(remote = new FakeRemote()): {
  remote: FakeRemote;
  journal: MemoryJournal;
  events: LifecycleEvent[];
  deps: DraftLifecycleDependencies;
} {
  const journal = new MemoryJournal();
  const events: LifecycleEvent[] = [];
  return {
    remote,
    journal,
    events,
    deps: {
      drafts: remote.draftProvider,
      published: remote.publishedProvider,
      journal: journal.store,
      log: event => events.push(event),
    },
  };
}

test('remote state proves absence only when both providers succeed', async () => {
  const { remote, deps } = harness();
  remote.drafts.clear();
  assert.equal(await resolveRemoteArticleState(desired, deps), 'absent');

  remote.draftListFails = true;
  assert.equal(await resolveRemoteArticleState(desired, deps), 'unknown');
  remote.draftListFails = false;
  remote.publishedListFails = true;
  assert.equal(await resolveRemoteArticleState(desired, deps), 'unknown');
});

test('remote state distinguishes exact drafts, external publication, and ambiguity', async () => {
  const { remote, deps } = harness();
  remote.drafts.clear();
  remote.drafts.set('new', { ...desired, ref: 'new' });
  assert.equal(await resolveRemoteArticleState(desired, deps), 'draft_exact');

  remote.drafts.clear();
  remote.published.push(desired);
  assert.equal(await resolveRemoteArticleState(desired, deps), 'published_externally');

  remote.published.splice(0);
  remote.drafts.set('old', { ...previous, ref: 'old' });
  assert.equal(await resolveRemoteArticleState(desired, deps), 'ambiguous');

  remote.drafts.set('new-1', { ...desired, ref: 'new-1' });
  assert.equal(await resolveRemoteArticleState(desired, deps), 'ambiguous');
});

test('any provider failure keeps the remote state unknown', async () => {
  const { remote, deps } = harness();
  remote.drafts.clear();
  remote.drafts.set('new', { ...desired, ref: 'new' });
  remote.publishedListFails = true;
  assert.equal(await resolveRemoteArticleState(desired, deps), 'unknown');

  remote.drafts.clear();
  remote.draftListFails = true;
  remote.publishedListFails = false;
  remote.published.push(desired);
  assert.equal(await resolveRemoteArticleState(desired, deps), 'unknown');
});

test('journal stages map to safe idempotent recovery actions', () => {
  const base: ReplacementJournal = {
    version: 1,
    operationId: request.operationId,
    stage: 'planned',
    desired,
    previous,
    oldDraftRef: oldRef,
  };
  assert.deepEqual(
    (
      [
        'planned',
        'new_created',
        'new_verified',
        'old_rechecked',
        'old_deleted',
        'rollback_new_pending',
        'cleanup_old_pending',
        'completed',
      ] as const
    ).map(stage => decideReplacementRecovery({ ...base, stage })),
    ['create_new', 'verify_new', 'recheck_old', 'recheck_old', 'verify_unique', 'rollback_new', 'cleanup_old', 'done']
  );
});

test('cross-type replacement creates, verifies, deletes, and uniquely reads back', async () => {
  const { remote, journal, events, deps } = harness();
  const result = await replaceDraftAcrossPostTypes(request, deps);

  assert.deepEqual(result, { state: 'draft_exact', outcome: 'complete', code: undefined });
  assert.equal(remote.drafts.has(oldRef), false);
  assert.equal([...remote.drafts.values()].filter(item => item.fingerprint === desired.fingerprint).length, 1);
  assert.equal(journal.current?.stage, 'completed');
  assert.ok(events.includes('new_verified'));
  assert.ok(events.includes('old_deleted'));
  assert.ok(events.includes('replacement_verified'));

  const second = await replaceDraftAcrossPostTypes(request, deps);
  assert.deepEqual(second, result);
  assert.equal(remote.createCalls, 1);
});

test('create failure leaves the old draft untouched and does not leak provider details', async () => {
  const { remote, deps, events } = harness();
  remote.createFails = true;
  const result = await replaceDraftAcrossPostTypes(request, deps);

  assert.deepEqual(result, { state: 'ambiguous', outcome: 'safe_failure', code: 'create_failed' });
  assert.equal(remote.drafts.has(oldRef), true);
  assert.equal(JSON.stringify({ result, events }).includes('remote-secret'), false);
});

test('new draft readback failure rolls back the new draft before returning', async () => {
  const { remote, deps } = harness();
  const originalRead = remote.draftProvider.read;
  remote.draftProvider.read = async ref => {
    if (ref !== oldRef) throw new Error('temporary readback failure');
    return originalRead(ref);
  };
  const result = await replaceDraftAcrossPostTypes(request, deps);

  assert.deepEqual(result, { state: 'unknown', outcome: 'safe_failure', code: 'new_readback_failed' });
  assert.equal(remote.drafts.has(oldRef), true);
  assert.equal(remote.drafts.size, 1);
});

test('mismatched new readback is removed and reported as ambiguous', async () => {
  const { remote, deps } = harness();
  remote.createdOverride = { ...desired, fingerprint: 'unexpected', ref: 'ignored-by-create' };
  const result = await replaceDraftAcrossPostTypes(request, deps);

  assert.deepEqual(result, { state: 'ambiguous', outcome: 'safe_failure', code: 'new_readback_mismatch' });
  assert.equal(remote.drafts.has(oldRef), true);
  assert.equal(remote.drafts.size, 1);
});

test('failed rollback is journaled as cleanup pending and can be resumed', async () => {
  const { remote, journal, deps } = harness();
  remote.createdOverride = { ...desired, fingerprint: 'unexpected', ref: 'ignored-by-create' };
  remote.beforeRemove = ref => {
    if (ref !== oldRef) remote.removeFailures.add(ref);
  };
  const first = await replaceDraftAcrossPostTypes(request, deps);
  assert.deepEqual(first, { state: 'replace_cleanup_pending', outcome: 'retryable', code: 'rollback_failed' });
  assert.equal(journal.current?.stage, 'rollback_new_pending');

  remote.removeFailures.clear();
  remote.beforeRemove = undefined;
  const resumed = await replaceDraftAcrossPostTypes(request, deps);
  assert.deepEqual(resumed, { state: 'ambiguous', outcome: 'safe_failure', code: 'new_readback_mismatch' });
  assert.equal(remote.drafts.size, 1);
  assert.equal(remote.createCalls, 1);
});

test('unknown or mismatched old readback rolls back the verified new draft', async () => {
  const unknownCase = harness();
  unknownCase.remote.readFailures.add(oldRef);
  assert.deepEqual(await replaceDraftAcrossPostTypes(request, unknownCase.deps), {
    state: 'unknown',
    outcome: 'safe_failure',
    code: 'old_recheck_failed',
  });
  assert.equal(unknownCase.remote.drafts.size, 1);

  const ambiguousCase = harness();
  ambiguousCase.remote.drafts.set(oldRef, { ...previous, fingerprint: 'changed', ref: oldRef });
  assert.deepEqual(await replaceDraftAcrossPostTypes(request, ambiguousCase.deps), {
    state: 'ambiguous',
    outcome: 'safe_failure',
    code: 'old_recheck_ambiguous',
  });
  assert.equal(ambiguousCase.remote.drafts.size, 1);
});

test('manual publication before old deletion removes the new draft and returns published', async () => {
  const { remote, deps } = harness();
  const originalRead = remote.draftProvider.read;
  let oldReads = 0;
  remote.draftProvider.read = async ref => {
    if (ref === oldRef && ++oldReads === 1) {
      remote.drafts.delete(oldRef);
      remote.published.push(previous);
      return undefined;
    }
    return originalRead(ref);
  };
  const result = await replaceDraftAcrossPostTypes(request, deps);

  assert.deepEqual(result, { state: 'published_externally', outcome: 'complete', code: undefined });
  assert.equal(remote.drafts.size, 0);
  assert.equal(remote.published.length, 1);
});

test('publication racing with delete is detected and compensates the new draft', async () => {
  const { remote, deps } = harness();
  remote.beforeRemove = ref => {
    if (ref !== oldRef) return;
    remote.drafts.delete(oldRef);
    remote.published.push(previous);
    remote.removeFailures.add(oldRef);
  };
  const result = await replaceDraftAcrossPostTypes(request, deps);

  assert.deepEqual(result, { state: 'published_externally', outcome: 'complete', code: undefined });
  assert.equal(remote.drafts.size, 0);
});

test('old delete failure keeps the verified new draft and resumes cleanup without recreating', async () => {
  const { remote, journal, deps } = harness();
  remote.removeFailures.add(oldRef);
  const first = await replaceDraftAcrossPostTypes(request, deps);
  assert.deepEqual(first, { state: 'replace_cleanup_pending', outcome: 'retryable', code: 'old_delete_failed' });
  assert.equal(journal.current?.stage, 'cleanup_old_pending');
  assert.equal(remote.drafts.size, 2);

  remote.removeFailures.clear();
  const resumed = await replaceDraftAcrossPostTypes(request, deps);
  assert.deepEqual(resumed, { state: 'draft_exact', outcome: 'complete', code: undefined });
  assert.equal(remote.createCalls, 1);
  assert.equal(remote.drafts.size, 1);
});

test('final provider failure stays retryable at unique-readback stage', async () => {
  const { remote, journal, deps } = harness();
  remote.afterRemove = ref => {
    if (ref === oldRef) remote.draftListFails = true;
  };
  const result = await replaceDraftAcrossPostTypes(request, deps);

  assert.deepEqual(result, { state: 'unknown', outcome: 'retryable', code: 'final_readback_failed' });
  assert.equal(journal.current?.stage, 'old_deleted');
});

test('duplicate appearing at final readback becomes cleanup pending', async () => {
  const { remote, journal, deps } = harness();
  remote.afterRemove = ref => {
    if (ref === oldRef) remote.drafts.set('unexpected-duplicate', { ...desired, ref: 'unexpected-duplicate' });
  };
  const result = await replaceDraftAcrossPostTypes(request, deps);

  assert.deepEqual(result, {
    state: 'replace_cleanup_pending',
    outcome: 'retryable',
    code: 'final_readback_ambiguous',
  });
  assert.equal(journal.current?.stage, 'cleanup_old_pending');
});

test('cross-type guard and journal ownership fail closed without exposing refs', async () => {
  const { journal, deps } = harness();
  await assert.rejects(
    () => replaceDraftAcrossPostTypes({ ...request, desired: { ...desired, postType: 'newspic' } }, deps),
    /类型不同/
  );

  journal.current = {
    version: 1,
    operationId: request.operationId,
    stage: 'planned',
    desired: { ...desired, fingerprint: 'someone-else' },
    previous,
    oldDraftRef: 'another-secret-ref',
  };
  await assert.rejects(
    () => replaceDraftAcrossPostTypes(request, deps),
    error => error instanceof Error && /记录与当前请求不一致/.test(error.message) && !error.message.includes('secret')
  );
});
