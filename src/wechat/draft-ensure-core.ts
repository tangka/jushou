import {
  type ArticleIdentity,
  type DraftLifecycleDependencies,
  type LifecycleResult,
  type RemoteDraftArticle,
  type RemotePublishedArticle,
  replaceDraftAcrossPostTypes,
  resolveRemoteArticleState,
} from './draft-lifecycle.js';

export type EnsureDraftOperation = 'noop_draft' | 'noop_published' | 'create' | 'update' | 'replace';

export type EnsureDraftResult = LifecycleResult & {
  operation?: EnsureDraftOperation;
  ref?: string;
};

export type EnsureDraftDependencies = DraftLifecycleDependencies & {
  update(ref: string): Promise<void>;
  readPinnedDraft?(): Promise<RemoteDraftArticle | undefined>;
};

type Snapshot =
  | { ok: true; drafts: readonly RemoteDraftArticle[]; published: readonly RemotePublishedArticle[] }
  | { ok: false };

function sameIdentity(left: ArticleIdentity, right: ArticleIdentity): boolean {
  return left.title === right.title && left.fingerprint === right.fingerprint && left.postType === right.postType;
}

async function snapshot(target: ArticleIdentity, deps: EnsureDraftDependencies): Promise<Snapshot> {
  try {
    const [listedDrafts, published, pinned] = await Promise.all([
      deps.drafts.listByTitle(target.title),
      deps.published.listByTitle(target.title),
      deps.readPinnedDraft?.() ?? Promise.resolve(undefined),
    ]);
    const drafts = listedDrafts.filter(record => record.title === target.title);
    if (pinned && !drafts.some(record => record.ref === pinned.ref)) drafts.unshift(pinned);
    return {
      ok: true,
      drafts,
      published: published.filter(record => record.title === target.title),
    };
  } catch {
    return { ok: false };
  }
}

function fail(state: 'unknown' | 'ambiguous', code: LifecycleResult['code']): EnsureDraftResult {
  return { state, outcome: 'safe_failure', code };
}

async function rollbackCreated(ref: string, deps: EnsureDraftDependencies): Promise<EnsureDraftResult | undefined> {
  try {
    await deps.drafts.remove(ref);
    return undefined;
  } catch {
    return { state: 'replace_cleanup_pending', outcome: 'retryable', code: 'rollback_failed' };
  }
}

async function verifyMutation(
  target: ArticleIdentity,
  ref: string,
  operation: 'create' | 'update',
  deps: EnsureDraftDependencies
): Promise<EnsureDraftResult> {
  let readback: RemoteDraftArticle | undefined;
  try {
    readback = await deps.drafts.read(ref);
  } catch {
    if (operation === 'create') {
      const cleanup = await rollbackCreated(ref, deps);
      if (cleanup) return cleanup;
    }
    return fail('unknown', operation === 'create' ? 'new_readback_failed' : 'final_readback_failed');
  }
  if (!readback || !sameIdentity(readback, target)) {
    if (operation === 'create') {
      const cleanup = await rollbackCreated(ref, deps);
      if (cleanup) return cleanup;
    }
    return fail('ambiguous', operation === 'create' ? 'new_readback_mismatch' : 'final_readback_ambiguous');
  }
  const finalState = await resolveRemoteArticleState(target, deps);
  if (finalState !== 'draft_exact') {
    if (operation === 'create') {
      const cleanup = await rollbackCreated(ref, deps);
      if (cleanup) return cleanup;
    }
    return fail(finalState === 'unknown' ? 'unknown' : 'ambiguous', 'final_readback_failed');
  }
  return { state: 'draft_exact', outcome: 'complete', operation, ref };
}

async function finishReplacement(
  result: LifecycleResult,
  target: ArticleIdentity,
  deps: EnsureDraftDependencies
): Promise<EnsureDraftResult> {
  if (result.outcome !== 'complete') return result;
  if (result.state === 'published_externally') return { ...result, operation: 'replace' };
  if (result.state !== 'draft_exact') return result;
  try {
    const matches = (await deps.drafts.listByTitle(target.title)).filter(record => sameIdentity(record, target));
    if (matches.length !== 1) return fail('ambiguous', 'final_readback_ambiguous');
    return { ...result, operation: 'replace', ref: matches[0]?.ref };
  } catch {
    return fail('unknown', 'final_readback_failed');
  }
}

export async function ensureRemoteDraft(
  operationId: string,
  target: ArticleIdentity,
  deps: EnsureDraftDependencies
): Promise<EnsureDraftResult> {
  try {
    const recovery = await deps.journal.load(operationId);
    if (recovery && recovery.stage !== 'completed') {
      if (!sameIdentity(recovery.desired, target)) return fail('ambiguous', 'final_readback_ambiguous');
      const recovered = await replaceDraftAcrossPostTypes(
        {
          operationId,
          desired: target,
          previous: { ...recovery.previous, ref: recovery.oldDraftRef },
        },
        deps
      );
      return finishReplacement(recovered, target, deps);
    }
  } catch {
    return fail('unknown', 'final_readback_failed');
  }
  const current = await snapshot(target, deps);
  if (!current.ok) return fail('unknown', 'final_readback_failed');
  if (current.published.length > 1 || current.drafts.length > 1) {
    return fail('ambiguous', 'final_readback_ambiguous');
  }
  if (current.published.length === 1) {
    if (current.drafts.length > 0) return fail('ambiguous', 'final_readback_ambiguous');
    const published = current.published[0];
    if (!published || !sameIdentity(published, target)) return fail('ambiguous', 'final_readback_ambiguous');
    return { state: 'published_externally', outcome: 'complete', operation: 'noop_published' };
  }

  const existing = current.drafts[0];
  if (!existing) {
    let ref: string;
    try {
      ref = await deps.drafts.create(target);
    } catch {
      return fail('unknown', 'create_failed');
    }
    return verifyMutation(target, ref, 'create', deps);
  }
  if (sameIdentity(existing, target)) {
    return { state: 'draft_exact', outcome: 'complete', operation: 'noop_draft', ref: existing.ref };
  }
  if (existing.postType === target.postType) {
    try {
      await deps.update(existing.ref);
    } catch {
      return fail('unknown', 'final_readback_failed');
    }
    return verifyMutation(target, existing.ref, 'update', deps);
  }

  const result = await replaceDraftAcrossPostTypes({ operationId, desired: target, previous: existing }, deps);
  return finishReplacement(result, target, deps);
}
