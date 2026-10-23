import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDailyDraftVerificationInput, parseDailyDraftVerifierCli } from './verify-daily-drafts.js';

test('daily verifier CLI requires one input file', () => {
  assert.deepEqual(parseDailyDraftVerifierCli(['--', '--input', '/tmp/result.json']), {
    input: '/tmp/result.json',
  });
  assert.throws(() => parseDailyDraftVerifierCli([]), /必须传 --input/);
  assert.throws(() => parseDailyDraftVerifierCli(['--input']), /需要终态观测/);
  assert.throws(() => parseDailyDraftVerifierCli(['--bad']), /未知参数/);
});

test('daily verifier input strips credentials and rejects malformed counts', () => {
  const parsed = parseDailyDraftVerificationInput({
    expectedAccountIds: ['examplenews'],
    observations: [
      {
        expectedAccountId: 'examplenews',
        observedAccountId: 'examplenews',
        draftCount: 1,
        publishedCount: 0,
        operation: 'created',
        certainty: 'verified',
        media_id: 'must-not-survive',
        token: 'must-not-survive',
      },
    ],
    verifiedAt: '2026-08-14T03:30:00.000Z',
    appsecret: 'must-not-survive',
  });
  assert.equal('appsecret' in parsed, false);
  assert.equal('media_id' in (parsed.observations[0] ?? {}), false);
  assert.throws(
    () =>
      parseDailyDraftVerificationInput({
        expectedAccountIds: ['examplenews'],
        observations: [
          {
            expectedAccountId: 'examplenews',
            observedAccountId: 'examplenews',
            draftCount: -1,
            publishedCount: 0,
            operation: 'created',
            certainty: 'verified',
          },
        ],
        verifiedAt: '2026-08-14T03:30:00.000Z',
      }),
    /too_small/
  );
});
