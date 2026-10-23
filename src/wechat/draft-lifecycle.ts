export type RemoteArticleState =
  | 'draft_exact'
  | 'published_externally'
  | 'absent'
  | 'ambiguous'
  | 'unknown'
  | 'replace_cleanup_pending';

export type ResolvedRemoteArticleState = Exclude<RemoteArticleState, 'replace_cleanup_pending'>;

export type ArticlePostType = 'news' | 'newspic';
export type RemoteDraftRef = string;

export type ArticleIdentity = {
  title: string;
  fingerprint: string;
  postType: ArticlePostType;
};

export type RemoteDraftArticle = ArticleIdentity & { ref: RemoteDraftRef };
export type RemotePublishedArticle = ArticleIdentity;

export type DraftProvider = {
  listByTitle(title: string): Promise<readonly RemoteDraftArticle[]>;
  read(ref: RemoteDraftRef): Promise<RemoteDraftArticle | undefined>;
  create(article: ArticleIdentity): Promise<RemoteDraftRef>;
  remove(ref: RemoteDraftRef): Promise<void>;
};

export type PublishedProvider = {
  listByTitle(title: string): Promise<readonly RemotePublishedArticle[]>;
};

export type ReplacementStage =
  | 'planned'
  | 'new_created'
  | 'new_verified'
  | 'old_rechecked'
  | 'old_deleted'
  | 'rollback_new_pending'
  | 'cleanup_old_pending'
  | 'completed';

export type ReplacementJournal = {
  version: 1;
  operationId: string;
  stage: ReplacementStage;
  desired: ArticleIdentity;
  previous: ArticleIdentity;
  oldDraftRef: RemoteDraftRef;
  newDraftRef?: RemoteDraftRef;
  pendingState?: Exclude<RemoteArticleState, 'replace_cleanup_pending'>;
  failureCode?: LifecycleFailureCode;
  finalState?: Exclude<RemoteArticleState, 'replace_cleanup_pending'>;
};

export type JournalStore = {
  load(operationId: string): Promise<ReplacementJournal | undefined>;
  save(journal: ReplacementJournal): Promise<void>;
};

export type LifecycleEvent =
  | 'operation_started'
  | 'new_created'
  | 'new_verified'
  | 'old_rechecked'
  | 'old_deleted'
  | 'new_rolled_back'
  | 'published_detected'
  | 'replacement_verified'
  | 'cleanup_pending'
  | 'provider_unknown';

export type LifecycleFailureCode =
  | 'create_failed'
  | 'new_readback_failed'
  | 'new_readback_mismatch'
  | 'old_recheck_failed'
  | 'old_recheck_ambiguous'
  | 'old_delete_failed'
  | 'rollback_failed'
  | 'final_readback_failed'
  | 'final_readback_ambiguous';

export type LifecycleResult = {
  state: RemoteArticleState;
  outcome: 'complete' | 'safe_failure' | 'retryable';
  code?: LifecycleFailureCode;
};

export type ReplacementRequest = {
  operationId: string;
  desired: ArticleIdentity;
  previous: ArticleIdentity & { ref: RemoteDraftRef };
};

export type DraftLifecycleDependencies = {
  drafts: DraftProvider;
  published: PublishedProvider;
  journal: JournalStore;
  log?: (event: LifecycleEvent) => void;
};

export type ReplacementRecoveryAction =
  | 'create_new'
  | 'verify_new'
  | 'recheck_old'
  | 'verify_unique'
  | 'rollback_new'
  | 'cleanup_old'
  | 'done';

type ProviderSnapshot<T> = { ok: true; records: readonly T[] } | { ok: false };

function sameIdentity(left: ArticleIdentity, right: ArticleIdentity): boolean {
  return left.title === right.title && left.fingerprint === right.fingerprint && left.postType === right.postType;
}

async function capture<T>(read: () => Promise<readonly T[]>): Promise<ProviderSnapshot<T>> {
  try {
    return { ok: true, records: await read() };
  } catch {
    return { ok: false };
  }
}

export async function resolveRemoteArticleState(
  target: ArticleIdentity,
  providers: Pick<DraftLifecycleDependencies, 'drafts' | 'published'>
): Promise<ResolvedRemoteArticleState> {
  const [drafts, published] = await Promise.all([
    capture(() => providers.drafts.listByTitle(target.title)),
    capture(() => providers.published.listByTitle(target.title)),
  ]);
  const draftRecords = drafts.ok ? drafts.records.filter(item => item.title === target.title) : [];
  const publishedRecords = published.ok ? published.records.filter(item => item.title === target.title) : [];
  const exactDrafts = draftRecords.filter(item => sameIdentity(item, target));
  const exactPublished = publishedRecords.filter(item => sameIdentity(item, target));
  const hasConflict = [...draftRecords, ...publishedRecords].some(item => !sameIdentity(item, target));

  if (!drafts.ok || !published.ok) return 'unknown';
  if (hasConflict || exactDrafts.length > 1 || exactPublished.length > 1) return 'ambiguous';
  if (exactDrafts.length === 1 && exactPublished.length === 1) return 'ambiguous';
  if (exactPublished.length === 1) return 'published_externally';
  if (exactDrafts.length === 1) return 'draft_exact';
  return 'absent';
}

export function decideReplacementRecovery(journal: ReplacementJournal): ReplacementRecoveryAction {
  switch (journal.stage) {
    case 'planned':
      return 'create_new';
    case 'new_created':
      return 'verify_new';
    case 'new_verified':
    case 'old_rechecked':
      return 'recheck_old';
    case 'old_deleted':
      return 'verify_unique';
    case 'rollback_new_pending':
      return 'rollback_new';
    case 'cleanup_old_pending':
      return 'cleanup_old';
    case 'completed':
      return 'done';
  }
}

function validateJournal(request: ReplacementRequest, journal: ReplacementJournal): void {
  if (
    journal.version !== 1 ||
    journal.operationId !== request.operationId ||
    !sameIdentity(journal.desired, request.desired) ||
    !sameIdentity(journal.previous, request.previous)
  ) {
    throw new Error('草稿替换操作记录与当前请求不一致，拒绝继续');
  }
}

async function saveStage(
  deps: DraftLifecycleDependencies,
  journal: ReplacementJournal,
  patch: Partial<ReplacementJournal>
): Promise<ReplacementJournal> {
  const next = { ...journal, ...patch };
  await deps.journal.save(next);
  return next;
}

async function inspectOld(
  journal: ReplacementJournal,
  deps: DraftLifecycleDependencies
): Promise<'draft' | 'published' | 'absent' | 'ambiguous' | 'unknown'> {
  let current: RemoteDraftArticle | undefined;
  try {
    current = await deps.drafts.read(journal.oldDraftRef);
  } catch {
    return 'unknown';
  }
  if (current) return sameIdentity(current, journal.previous) ? 'draft' : 'ambiguous';

  const published = await capture(() => deps.published.listByTitle(journal.previous.title));
  if (!published.ok) return 'unknown';
  const sameTitle = published.records.filter(item => item.title === journal.previous.title);
  const exact = sameTitle.filter(item => sameIdentity(item, journal.previous));
  if (sameTitle.some(item => !sameIdentity(item, journal.previous)) || exact.length > 1) return 'ambiguous';
  return exact.length === 1 ? 'published' : 'absent';
}

async function complete(
  deps: DraftLifecycleDependencies,
  journal: ReplacementJournal,
  state: Exclude<RemoteArticleState, 'replace_cleanup_pending'>,
  code?: LifecycleFailureCode
): Promise<LifecycleResult> {
  await saveStage(deps, journal, { stage: 'completed', finalState: state, failureCode: code });
  return { state, outcome: code ? 'safe_failure' : 'complete', code };
}

async function scheduleRollback(
  deps: DraftLifecycleDependencies,
  journal: ReplacementJournal,
  state: Exclude<RemoteArticleState, 'replace_cleanup_pending'>,
  code?: LifecycleFailureCode
): Promise<ReplacementJournal> {
  return saveStage(deps, journal, { stage: 'rollback_new_pending', pendingState: state, failureCode: code });
}

async function rollbackNew(
  deps: DraftLifecycleDependencies,
  journal: ReplacementJournal
): Promise<LifecycleResult | ReplacementJournal> {
  if (!journal.newDraftRef) return complete(deps, journal, journal.pendingState ?? 'unknown', journal.failureCode);
  try {
    await deps.drafts.remove(journal.newDraftRef);
  } catch {
    let stillExists: RemoteDraftArticle | undefined;
    try {
      stillExists = await deps.drafts.read(journal.newDraftRef);
    } catch {
      deps.log?.('cleanup_pending');
      return { state: 'replace_cleanup_pending', outcome: 'retryable', code: 'rollback_failed' };
    }
    if (stillExists) {
      deps.log?.('cleanup_pending');
      return { state: 'replace_cleanup_pending', outcome: 'retryable', code: 'rollback_failed' };
    }
  }
  deps.log?.('new_rolled_back');
  return complete(deps, journal, journal.pendingState ?? 'unknown', journal.failureCode);
}

async function recheckAndDeleteOld(
  deps: DraftLifecycleDependencies,
  journal: ReplacementJournal
): Promise<LifecycleResult | ReplacementJournal> {
  const oldState = await inspectOld(journal, deps);
  if (oldState === 'published') {
    deps.log?.('published_detected');
    return scheduleRollback(deps, journal, 'published_externally');
  }
  if (oldState === 'unknown' || oldState === 'ambiguous') {
    deps.log?.(oldState === 'unknown' ? 'provider_unknown' : 'cleanup_pending');
    return scheduleRollback(
      deps,
      journal,
      oldState,
      oldState === 'unknown' ? 'old_recheck_failed' : 'old_recheck_ambiguous'
    );
  }
  if (oldState === 'absent') return saveStage(deps, journal, { stage: 'old_deleted' });

  deps.log?.('old_rechecked');
  journal = await saveStage(deps, journal, { stage: 'old_rechecked' });
  try {
    await deps.drafts.remove(journal.oldDraftRef);
  } catch {
    const afterFailure = await inspectOld(journal, deps);
    if (afterFailure === 'published') {
      deps.log?.('published_detected');
      return scheduleRollback(deps, journal, 'published_externally');
    }
    if (afterFailure !== 'absent') {
      await saveStage(deps, journal, { stage: 'cleanup_old_pending', failureCode: 'old_delete_failed' });
      deps.log?.('cleanup_pending');
      return { state: 'replace_cleanup_pending', outcome: 'retryable', code: 'old_delete_failed' };
    }
  }
  deps.log?.('old_deleted');
  return saveStage(deps, journal, { stage: 'old_deleted' });
}

export async function replaceDraftAcrossPostTypes(
  request: ReplacementRequest,
  deps: DraftLifecycleDependencies
): Promise<LifecycleResult> {
  if (request.desired.postType === request.previous.postType) {
    throw new Error('跨类型草稿替换要求新旧稿件类型不同');
  }
  let journal = await deps.journal.load(request.operationId);
  if (journal) validateJournal(request, journal);
  else {
    journal = {
      version: 1,
      operationId: request.operationId,
      stage: 'planned',
      desired: request.desired,
      previous: request.previous,
      oldDraftRef: request.previous.ref,
    };
    await deps.journal.save(journal);
    deps.log?.('operation_started');
  }

  while (true) {
    const action = decideReplacementRecovery(journal);
    if (action === 'done')
      return {
        state: journal.finalState ?? 'unknown',
        outcome: journal.failureCode ? 'safe_failure' : 'complete',
        code: journal.failureCode,
      };
    if (action === 'create_new') {
      try {
        const newDraftRef = await deps.drafts.create(request.desired);
        journal = await saveStage(deps, journal, { stage: 'new_created', newDraftRef });
        deps.log?.('new_created');
      } catch {
        const state = await resolveRemoteArticleState(request.desired, deps);
        return complete(deps, journal, state, 'create_failed');
      }
      continue;
    }
    if (action === 'verify_new') {
      let created: RemoteDraftArticle | undefined;
      try {
        created = journal.newDraftRef ? await deps.drafts.read(journal.newDraftRef) : undefined;
      } catch {
        journal = await scheduleRollback(deps, journal, 'unknown', 'new_readback_failed');
        continue;
      }
      if (!created || !sameIdentity(created, request.desired)) {
        journal = await scheduleRollback(deps, journal, 'ambiguous', 'new_readback_mismatch');
        continue;
      }
      journal = await saveStage(deps, journal, { stage: 'new_verified' });
      deps.log?.('new_verified');
      continue;
    }
    if (action === 'recheck_old') {
      const result = await recheckAndDeleteOld(deps, journal);
      if ('state' in result) return result;
      journal = result;
      continue;
    }
    if (action === 'cleanup_old') {
      const result = await recheckAndDeleteOld(deps, journal);
      if ('state' in result) return result;
      journal = result;
      continue;
    }
    if (action === 'rollback_new') {
      const result = await rollbackNew(deps, journal);
      if ('state' in result) return result;
      journal = result;
      continue;
    }

    const state = await resolveRemoteArticleState(request.desired, deps);
    if (state === 'draft_exact' || state === 'published_externally') {
      deps.log?.('replacement_verified');
      return complete(deps, journal, state);
    }
    if (state === 'ambiguous') {
      await saveStage(deps, journal, { stage: 'cleanup_old_pending', failureCode: 'final_readback_ambiguous' });
      deps.log?.('cleanup_pending');
      return { state: 'replace_cleanup_pending', outcome: 'retryable', code: 'final_readback_ambiguous' };
    }
    if (state === 'absent') {
      await saveStage(deps, journal, { stage: 'planned', newDraftRef: undefined, failureCode: undefined });
      return { state, outcome: 'retryable', code: 'final_readback_failed' };
    }
    deps.log?.('provider_unknown');
    return { state, outcome: 'retryable', code: 'final_readback_failed' };
  }
}
