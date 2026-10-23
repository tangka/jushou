export const dailyDraftStatuses = [
  'draft_verified',
  'published_externally',
  'skipped',
  'unknown',
  'ambiguous',
  'absent',
] as const;

export type DailyDraftStatus = (typeof dailyDraftStatuses)[number];

export const dailyDraftOperations = [
  'created',
  'updated_in_place',
  'recreated',
  'observed_existing',
  'observed_external_publish',
  'skipped',
  'none',
] as const;

export type DailyDraftOperation = (typeof dailyDraftOperations)[number];

export type DailyObservationCertainty = 'verified' | 'unknown' | 'ambiguous';

/**
 * 单账号后台观测快照。这里只接收计数和身份，不接收 media_id、token 等敏感字段。
 */
export type DailyAccountObservation = {
  expectedAccountId: string;
  observedAccountId: string | null;
  draftCount: number | null;
  publishedCount: number | null;
  operation: DailyDraftOperation;
  certainty: DailyObservationCertainty;
};

export type DailyDraftVerificationInput = {
  expectedAccountIds: readonly string[];
  observations: readonly DailyAccountObservation[];
  verifiedAt: string;
};

export type DailyDraftVerificationIssueCode =
  | 'duplicate_expected_account'
  | 'unexpected_account'
  | 'missing_observation'
  | 'duplicate_observation'
  | 'account_identity_unknown'
  | 'account_identity_mismatch'
  | 'invalid_counts'
  | 'observation_unknown'
  | 'observation_ambiguous'
  | 'operation_mismatch'
  | 'content_absent';

export type DailyDraftVerificationIssue = {
  accountId: string | null;
  code: DailyDraftVerificationIssueCode;
};

export type DailyAccountVerification = {
  accountId: string;
  status: DailyDraftStatus;
  draftCount: number | null;
  publishedCount: number | null;
  operation: DailyDraftOperation;
  automationPublished: false;
  verifiedAt: string;
};

export type DailyDraftVerification = {
  ok: boolean;
  accounts: DailyAccountVerification[];
  issues: DailyDraftVerificationIssue[];
  automationPublished: false;
  verifiedAt: string;
};

const DRAFT_OPERATIONS = new Set<DailyDraftOperation>(dailyDraftOperations);
const VERIFIED_DRAFT_OPERATIONS = new Set<DailyDraftOperation>([
  'created',
  'updated_in_place',
  'recreated',
  'observed_existing',
]);

function uniqueExpectedAccounts(accountIds: readonly string[], issues: DailyDraftVerificationIssue[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const rawAccountId of accountIds) {
    const accountId = rawAccountId.trim();
    if (!accountId) throw new Error('expectedAccountIds 不能包含空账号');
    if (seen.has(accountId)) {
      issues.push({ accountId, code: 'duplicate_expected_account' });
      continue;
    }
    seen.add(accountId);
    unique.push(accountId);
  }
  if (unique.length === 0) throw new Error('expectedAccountIds 不能为空');
  return unique;
}

function normalizedVerifiedAt(value: string): string {
  const trimmed = value.trim();
  const timestamp = Date.parse(trimmed);
  if (!trimmed || !Number.isFinite(timestamp)) throw new Error('verifiedAt 必须是有效时间');
  return new Date(timestamp).toISOString();
}

function isValidCount(value: number | null): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isOperation(value: unknown): value is DailyDraftOperation {
  return typeof value === 'string' && DRAFT_OPERATIONS.has(value as DailyDraftOperation);
}

function accountResult(
  accountId: string,
  status: DailyDraftStatus,
  draftCount: number | null,
  publishedCount: number | null,
  operation: DailyDraftOperation,
  verifiedAt: string
): DailyAccountVerification {
  return {
    accountId,
    status,
    draftCount,
    publishedCount,
    operation,
    automationPublished: false,
    verifiedAt,
  };
}

function failAccount(
  accountId: string,
  status: 'unknown' | 'ambiguous' | 'absent',
  code: DailyDraftVerificationIssueCode,
  issues: DailyDraftVerificationIssue[],
  verifiedAt: string,
  counts: { draftCount: number | null; publishedCount: number | null } = {
    draftCount: null,
    publishedCount: null,
  }
): DailyAccountVerification {
  issues.push({ accountId, code });
  return accountResult(accountId, status, counts.draftCount, counts.publishedCount, 'none', verifiedAt);
}

function verifySingleAccount(
  accountId: string,
  matches: readonly DailyAccountObservation[],
  issues: DailyDraftVerificationIssue[],
  verifiedAt: string
): DailyAccountVerification {
  if (matches.length === 0) {
    return failAccount(accountId, 'absent', 'missing_observation', issues, verifiedAt);
  }
  if (matches.length > 1) {
    return failAccount(accountId, 'ambiguous', 'duplicate_observation', issues, verifiedAt);
  }

  const observation = matches[0];
  if (!observation) {
    return failAccount(accountId, 'unknown', 'missing_observation', issues, verifiedAt);
  }

  const actualAccount = observation.observedAccountId?.trim();
  if (!actualAccount) {
    return failAccount(accountId, 'unknown', 'account_identity_unknown', issues, verifiedAt);
  }
  if (actualAccount !== accountId) {
    return failAccount(accountId, 'ambiguous', 'account_identity_mismatch', issues, verifiedAt);
  }

  const counts = {
    draftCount: isValidCount(observation.draftCount) ? observation.draftCount : null,
    publishedCount: isValidCount(observation.publishedCount) ? observation.publishedCount : null,
  };
  if (counts.draftCount === null || counts.publishedCount === null) {
    return failAccount(accountId, 'unknown', 'invalid_counts', issues, verifiedAt, counts);
  }
  if (!isOperation(observation.operation)) {
    return failAccount(accountId, 'unknown', 'operation_mismatch', issues, verifiedAt, counts);
  }
  if (observation.certainty === 'unknown') {
    return failAccount(accountId, 'unknown', 'observation_unknown', issues, verifiedAt, counts);
  }
  if (observation.certainty !== 'verified') {
    return failAccount(accountId, 'ambiguous', 'observation_ambiguous', issues, verifiedAt, counts);
  }

  if (observation.operation === 'skipped') {
    if (counts.draftCount === 0 && counts.publishedCount === 0) {
      return accountResult(accountId, 'skipped', 0, 0, 'skipped', verifiedAt);
    }
    return failAccount(accountId, 'ambiguous', 'operation_mismatch', issues, verifiedAt, counts);
  }

  if (counts.draftCount === 1 && counts.publishedCount === 0) {
    if (!VERIFIED_DRAFT_OPERATIONS.has(observation.operation)) {
      return failAccount(accountId, 'ambiguous', 'operation_mismatch', issues, verifiedAt, counts);
    }
    return accountResult(accountId, 'draft_verified', 1, 0, observation.operation, verifiedAt);
  }

  if (counts.draftCount === 0 && counts.publishedCount === 1) {
    if (observation.operation !== 'observed_external_publish') {
      return failAccount(accountId, 'ambiguous', 'operation_mismatch', issues, verifiedAt, counts);
    }
    return accountResult(accountId, 'published_externally', 0, 1, observation.operation, verifiedAt);
  }

  if (counts.draftCount === 0 && counts.publishedCount === 0 && observation.operation === 'none') {
    return failAccount(accountId, 'absent', 'content_absent', issues, verifiedAt, counts);
  }

  return failAccount(accountId, 'ambiguous', 'operation_mismatch', issues, verifiedAt, counts);
}

/**
 * 聚合每日终态。所有期望账号始终出现在 accounts；任何缺号、串号、重复、未知或歧义都会令 ok=false。
 */
export function verifyDailyDrafts(input: DailyDraftVerificationInput): DailyDraftVerification {
  const issues: DailyDraftVerificationIssue[] = [];
  const verifiedAt = normalizedVerifiedAt(input.verifiedAt);
  const expectedAccountIds = uniqueExpectedAccounts(input.expectedAccountIds, issues);
  const expectedSet = new Set(expectedAccountIds);

  if (input.observations.some(observation => !expectedSet.has(observation.expectedAccountId.trim()))) {
    issues.push({ accountId: null, code: 'unexpected_account' });
  }

  const accounts = expectedAccountIds.map(accountId => {
    const matches = input.observations.filter(observation => observation.expectedAccountId.trim() === accountId);
    return verifySingleAccount(accountId, matches, issues, verifiedAt);
  });

  return {
    ok: issues.length === 0,
    accounts,
    issues,
    automationPublished: false,
    verifiedAt,
  };
}

/** 仅序列化明确白名单字段，避免调用方附加的 media_id、token 等字段进入日志。 */
export function stringifyDailyDraftVerification(report: DailyDraftVerification): string {
  return JSON.stringify({
    ok: report.ok,
    accounts: report.accounts.map(account => ({
      accountId: account.accountId,
      status: account.status,
      draftCount: account.draftCount,
      publishedCount: account.publishedCount,
      operation: account.operation,
      automationPublished: false,
      verifiedAt: account.verifiedAt,
    })),
    issues: report.issues.map(issue => ({ accountId: issue.accountId, code: issue.code })),
    automationPublished: false,
    verifiedAt: report.verifiedAt,
  });
}

export function assertDailyDraftsVerified(report: DailyDraftVerification): void {
  if (report.ok) return;
  const issueCodes = [...new Set(report.issues.map(issue => issue.code))].join(',');
  throw new Error(`每日三账号终态未通过:${issueCodes}`);
}
