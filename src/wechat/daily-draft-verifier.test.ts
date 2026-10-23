import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDailyDraftsVerified,
  type DailyAccountObservation,
  stringifyDailyDraftVerification,
  verifyDailyDrafts,
} from './daily-draft-verifier.js';

const EXPECTED_ACCOUNTS = ['examplenews', 'exampledev', 'exampleai'] as const;
const VERIFIED_AT = '2026-08-14T03:15:00.000Z';

function observation(
  expectedAccountId: string,
  values: Partial<DailyAccountObservation> = {}
): DailyAccountObservation {
  return {
    expectedAccountId,
    observedAccountId: expectedAccountId,
    draftCount: 1,
    publishedCount: 0,
    operation: 'created',
    certainty: 'verified',
    ...values,
  };
}

test('允许 Codex 已由用户发表、另两号在草稿箱的混合成功终态', () => {
  const result = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [
      observation('examplenews', {
        draftCount: 0,
        publishedCount: 1,
        operation: 'observed_external_publish',
      }),
      observation('exampledev', { operation: 'updated_in_place' }),
      observation('exampleai'),
    ],
    verifiedAt: VERIFIED_AT,
  });

  assert.equal(result.ok, true);
  assert.equal(result.automationPublished, false);
  assert.deepEqual(
    result.accounts.map(account => ({
      accountId: account.accountId,
      status: account.status,
      draftCount: account.draftCount,
      publishedCount: account.publishedCount,
      operation: account.operation,
      automationPublished: account.automationPublished,
      verifiedAt: account.verifiedAt,
    })),
    [
      {
        accountId: 'examplenews',
        status: 'published_externally',
        draftCount: 0,
        publishedCount: 1,
        operation: 'observed_external_publish',
        automationPublished: false,
        verifiedAt: VERIFIED_AT,
      },
      {
        accountId: 'exampledev',
        status: 'draft_verified',
        draftCount: 1,
        publishedCount: 0,
        operation: 'updated_in_place',
        automationPublished: false,
        verifiedAt: VERIFIED_AT,
      },
      {
        accountId: 'exampleai',
        status: 'draft_verified',
        draftCount: 1,
        publishedCount: 0,
        operation: 'created',
        automationPublished: false,
        verifiedAt: VERIFIED_AT,
      },
    ]
  );
  assert.doesNotThrow(() => assertDailyDraftsVerified(result));
});

test('缺号时仍列齐期望账号并 fail closed', () => {
  const result = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [observation('examplenews'), observation('exampleai')],
    verifiedAt: VERIFIED_AT,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.accounts.map(account => account.accountId),
    EXPECTED_ACCOUNTS
  );
  assert.deepEqual(result.accounts[1], {
    accountId: 'exampledev',
    status: 'absent',
    draftCount: null,
    publishedCount: null,
    operation: 'none',
    automationPublished: false,
    verifiedAt: VERIFIED_AT,
  });
  assert.deepEqual(result.issues, [{ accountId: 'exampledev', code: 'missing_observation' }]);
  assert.throws(() => assertDailyDraftsVerified(result), /missing_observation/);
});

test('串号时标为 ambiguous 并拒绝完成', () => {
  const result = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [
      observation('examplenews'),
      observation('exampledev', { observedAccountId: 'exampleai' }),
      observation('exampleai'),
    ],
    verifiedAt: VERIFIED_AT,
  });

  assert.equal(result.ok, false);
  assert.equal(result.accounts[1]?.status, 'ambiguous');
  assert.equal(result.accounts[1]?.draftCount, null);
  assert.deepEqual(result.issues, [{ accountId: 'exampledev', code: 'account_identity_mismatch' }]);
});

test('同账号重复观测时不猜测，标为 ambiguous', () => {
  const result = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [
      observation('examplenews'),
      observation('exampledev'),
      observation('exampledev', { operation: 'observed_existing' }),
      observation('exampleai'),
    ],
    verifiedAt: VERIFIED_AT,
  });

  assert.equal(result.ok, false);
  assert.equal(result.accounts[1]?.status, 'ambiguous');
  assert.deepEqual(result.issues, [{ accountId: 'exampledev', code: 'duplicate_observation' }]);
});

test('未知和歧义快照都 fail closed', () => {
  for (const certainty of ['unknown', 'ambiguous'] as const) {
    const result = verifyDailyDrafts({
      expectedAccountIds: EXPECTED_ACCOUNTS,
      observations: [observation('examplenews'), observation('exampledev', { certainty }), observation('exampleai')],
      verifiedAt: VERIFIED_AT,
    });

    assert.equal(result.ok, false);
    assert.equal(result.accounts[1]?.status, certainty);
    assert.equal(result.issues[0]?.code, certainty === 'unknown' ? 'observation_unknown' : 'observation_ambiguous');
  }
});

test('重复内容计数和操作不一致均标为 ambiguous', () => {
  const duplicate = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [observation('examplenews'), observation('exampledev', { draftCount: 2 }), observation('exampleai')],
    verifiedAt: VERIFIED_AT,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.accounts[1]?.status, 'ambiguous');

  const mistakenPublish = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [
      observation('examplenews', { draftCount: 0, publishedCount: 1, operation: 'created' }),
      observation('exampledev'),
      observation('exampleai'),
    ],
    verifiedAt: VERIFIED_AT,
  });
  assert.equal(mistakenPublish.ok, false);
  assert.equal(mistakenPublish.accounts[0]?.status, 'ambiguous');
  assert.equal(mistakenPublish.accounts[0]?.automationPublished, false);
});

test('明确跳过可作为已验证终态，空内容不能冒充跳过', () => {
  const skipped = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [
      observation('examplenews'),
      observation('exampledev', {
        draftCount: 0,
        publishedCount: 0,
        operation: 'skipped',
      }),
      observation('exampleai'),
    ],
    verifiedAt: VERIFIED_AT,
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.accounts[1]?.status, 'skipped');

  const absent = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [
      observation('examplenews'),
      observation('exampledev', { draftCount: 0, publishedCount: 0, operation: 'none' }),
      observation('exampleai'),
    ],
    verifiedAt: VERIFIED_AT,
  });
  assert.equal(absent.ok, false);
  assert.equal(absent.accounts[1]?.status, 'absent');
  assert.deepEqual(absent.issues, [{ accountId: 'exampledev', code: 'content_absent' }]);
});

test('意外账号和重复期望账号都会 fail closed', () => {
  const result = verifyDailyDrafts({
    expectedAccountIds: ['examplenews', 'exampledev', 'exampledev', 'exampleai'],
    observations: [
      observation('examplenews'),
      observation('exampledev'),
      observation('exampleai'),
      observation('wrong-account'),
    ],
    verifiedAt: VERIFIED_AT,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.accounts.map(account => account.accountId),
    EXPECTED_ACCOUNTS
  );
  assert.deepEqual(result.issues, [
    { accountId: 'exampledev', code: 'duplicate_expected_account' },
    { accountId: null, code: 'unexpected_account' },
  ]);
});

test('安全 JSON 只输出白名单字段，不泄露 media_id 或 token', () => {
  const sensitiveObservation: DailyAccountObservation & {
    media_id: string;
    token: string;
  } = {
    ...observation('examplenews'),
    media_id: 'sensitive-media-value',
    token: 'sensitive-token-value',
  };
  const result = verifyDailyDrafts({
    expectedAccountIds: EXPECTED_ACCOUNTS,
    observations: [sensitiveObservation, observation('exampledev'), observation('exampleai')],
    verifiedAt: VERIFIED_AT,
  });
  const json = stringifyDailyDraftVerification({
    ...result,
    media_id: 'result-media-value',
    token: 'result-token-value',
  } as typeof result & { media_id: string; token: string });

  assert.equal(result.ok, true);
  assert.doesNotMatch(json, /media_id|token|sensitive-media-value|sensitive-token-value|result-media-value/);
  assert.deepEqual(JSON.parse(json), result);
});
