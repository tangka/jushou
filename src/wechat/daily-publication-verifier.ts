import { z } from 'zod';
import { DAILY_PUBLICATION_POLICY } from '../config/daily-publication.js';
import { dailyDraftOperations, verifyDailyDrafts } from './daily-draft-verifier.js';

const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema = z.object({
  source: z.literal('wechat_backend'),
  accountId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  articleType: z.enum(['news', 'newspic']),
  status: z.enum(['published', 'submitted', 'reviewing', 'failed', 'unknown']),
  receipt: z.string().trim().min(1).max(500).optional(),
  articleUrl: z.string().nullable(),
  verifiedAt: timestamp,
  draftSha256: sha256.optional(),
  bodyMatches: z.boolean(),
  coverMatches: z.boolean(),
  imagesMatch: z.boolean(),
  entryMatches: z.boolean(),
  originalityVerified: z.boolean(),
  submission: z
    .object({
      accountId: z.string().trim().min(1),
      title: z.string().trim().min(1),
      submittedAt: timestamp,
      draftSha256: sha256,
      notificationSent: z.boolean(),
      notificationEnabled: z.boolean().optional(),
      notificationAuthorization: z
        .object({
          source: z.literal('user_instruction'),
          policy: z.literal('send_if_quota_available'),
          quotaAvailableBefore: z.number().int().positive(),
          quotaObservedAt: timestamp,
        })
        .optional(),
    })
    .optional(),
});

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedAccountIds: z.array(z.string().trim().min(1)).min(1),
  verifiedAt: timestamp,
  observations: z.array(
    z.object({
      expectedAccountId: z.string().trim().min(1),
      observedAccountId: z.string().trim().min(1).nullable(),
      title: z.string().trim().min(1).optional(),
      postType: z.enum(['news', 'newspic']).optional(),
      draftSha256: sha256.optional(),
      draftCount: z.number().int().nonnegative().nullable(),
      publishedCount: z.number().int().nonnegative().nullable(),
      operation: z.enum([...dailyDraftOperations, 'published_by_automation', 'publish_submitted']),
      certainty: z.enum(['verified', 'unknown', 'ambiguous']),
      skipReason: z.string().trim().min(1).optional(),
      publicationProof: proofSchema.optional(),
    })
  ),
});

export type DailyPublicationInput = z.infer<typeof inputSchema>;
type Observation = DailyPublicationInput['observations'][number];
type Proof = z.infer<typeof proofSchema>;
type Issue = { accountId: string | null; code: string };

export function parseDailyPublicationInput(value: unknown): DailyPublicationInput {
  return inputSchema.parse(value);
}

function localDate(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_PUBLICATION_POLICY.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** 仅保留正式文章标识,预览地址、后台 token 和附加追踪参数不进入报告。 */
function publicArticleUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== DAILY_PUBLICATION_POLICY.publicOrigin || url.username || url.password) return null;
    if (/^\/s\/[\w-]+$/.test(url.pathname)) return `${url.origin}${url.pathname}`;
    if (url.pathname !== '/s') return null;
    const clean = new URL('/s', DAILY_PUBLICATION_POLICY.publicOrigin);
    for (const key of ['__biz', 'mid', 'idx', 'sn']) {
      const part = url.searchParams.get(key);
      if (!part || !/^[\w=+-]+$/.test(part)) return null;
      clean.searchParams.set(key, part);
    }
    return clean.toString();
  } catch {
    return null;
  }
}

function proofMatches(observation: Observation, proof: Proof, input: DailyPublicationInput): boolean {
  return (
    proof.accountId === observation.expectedAccountId &&
    proof.title === observation.title &&
    proof.articleType === observation.postType &&
    localDate(proof.verifiedAt) === input.date &&
    Date.parse(proof.verifiedAt) <= Date.parse(input.verifiedAt) &&
    proof.bodyMatches &&
    proof.coverMatches &&
    proof.imagesMatch &&
    proof.entryMatches &&
    proof.originalityVerified
  );
}

function submissionMatches(observation: Observation, proof: Proof, date: string): boolean {
  const submission = proof.submission;
  const authorization = submission?.notificationAuthorization;
  const notificationAllowed =
    !(submission?.notificationSent || submission?.notificationEnabled) ||
    (authorization &&
      localDate(authorization.quotaObservedAt) === date &&
      Date.parse(authorization.quotaObservedAt) <= Date.parse(submission.submittedAt));
  return !!(
    submission &&
    observation.draftSha256 &&
    proof.draftSha256 === observation.draftSha256 &&
    submission.draftSha256 === observation.draftSha256 &&
    submission.accountId === observation.expectedAccountId &&
    submission.title === observation.title &&
    localDate(submission.submittedAt) === date &&
    Date.parse(submission.submittedAt) <= Date.parse(proof.verifiedAt) &&
    notificationAllowed
  );
}

/** 平台确认接收即完成操作;仅有成功回执时不冒充审核中或已经公开。 */
function acceptedSubmission(observation: Observation, input: DailyPublicationInput): boolean {
  const proof = observation.publicationProof;
  return !!(
    observation.operation === 'publish_submitted' &&
    observation.certainty === 'verified' &&
    observation.observedAccountId === observation.expectedAccountId &&
    observation.draftCount === 0 &&
    observation.publishedCount === 0 &&
    (proof?.status === 'reviewing' || (proof?.status === 'submitted' && proof.receipt)) &&
    typeof proof.submission?.notificationEnabled === 'boolean' &&
    proofMatches(observation, proof, input) &&
    submissionMatches(observation, proof, input.date)
  );
}

/** 校验真实后台观测合同;不代替浏览器采证,也不执行发表。旧草稿终验保持原有语义。 */
export function verifyDailyPublications(raw: unknown, now = new Date()) {
  const input = parseDailyPublicationInput(raw);
  const policies = DAILY_PUBLICATION_POLICY.accounts;
  const requiredAccounts = Object.keys(policies);
  if (!requiredAccounts.length) throw new Error('请先在私有 operator profile 配置日更账号与发表策略');
  const base = verifyDailyDrafts({
    ...input,
    expectedAccountIds: requiredAccounts,
    observations: input.observations.map(observation => ({
      ...observation,
      operation:
        observation.operation === 'published_by_automation'
          ? ('observed_external_publish' as const)
          : observation.operation === 'publish_submitted'
            ? ('none' as const)
            : observation.operation,
    })),
  });
  // 草稿与公开列表均为零时,真实平台受理证据替代旧合同的“内容不存在”。
  const accepted = new Set(
    input.observations.filter(item => acceptedSubmission(item, input)).map(item => item.expectedAccountId)
  );
  const issues: Issue[] = base.issues.filter(
    issue => !(issue.code === 'content_absent' && issue.accountId && accepted.has(issue.accountId))
  );
  if (
    input.expectedAccountIds.length !== requiredAccounts.length ||
    new Set(input.expectedAccountIds).size !== requiredAccounts.length ||
    requiredAccounts.some(account => !input.expectedAccountIds.includes(account))
  ) {
    issues.push({ accountId: null, code: 'expected_accounts_mismatch' });
  }
  if (
    localDate(now) !== input.date ||
    localDate(input.verifiedAt) !== input.date ||
    Date.parse(input.verifiedAt) > now.getTime()
  ) {
    issues.push({ accountId: null, code: 'verification_date_mismatch' });
  }

  const accounts = base.accounts.map(account => {
    const matches = input.observations.filter(item => item.expectedAccountId === account.accountId);
    const observation = matches.length === 1 ? matches[0] : undefined;
    let status: string = account.status;
    let automationPublished: boolean | null = false;
    let articleUrl: string | null = null;
    const fail = (code: string) => issues.push({ accountId: account.accountId, code });
    const mayPublish = policies[account.accountId] === 'publish';

    if (matches.some(item => item.publicationProof?.submission)) {
      automationPublished = null;
      if (!mayPublish) fail('automatic_publication_forbidden');
    }

    if (observation) {
      const automated = ['published_by_automation', 'publish_submitted'].includes(observation.operation);
      if (automated) {
        automationPublished = null;
        if (!mayPublish) fail('automatic_publication_forbidden');
      }
      if (account.status === 'skipped' && !observation.skipReason) fail('skip_reason_missing');
      if (mayPublish && account.status === 'draft_verified') fail('publication_not_completed');

      const proof = observation.publicationProof;
      const verifiedUrl = proof ? publicArticleUrl(proof.articleUrl) : null;
      if (proof?.submission && !automated && account.status !== 'published_externally') {
        status = 'unknown';
        fail('publication_actor_mismatch');
      }
      if (automated || account.status === 'published_externally') {
        if (!proof) {
          status = 'unknown';
          fail('publication_proof_missing');
        } else if (proof.status === 'reviewing' || proof.status === 'submitted') {
          if (observation.operation === 'publish_submitted' && accepted.has(account.accountId)) {
            status = 'publication_submitted';
          } else {
            status = 'publication_pending';
            fail('publication_pending');
          }
        } else if (
          account.status !== 'published_externally' ||
          proof.status !== 'published' ||
          !proofMatches(observation, proof, input) ||
          !verifiedUrl
        ) {
          status = 'unknown';
          articleUrl = null;
          fail('publication_proof_mismatch');
        } else if (automated) {
          if (!submissionMatches(observation, proof, input.date)) {
            status = 'unknown';
            fail('publication_submission_mismatch');
          } else {
            status = 'published_by_automation';
            automationPublished = true;
          }
        } else if (proof.submission) {
          status = 'unknown';
          automationPublished = null;
          fail('publication_actor_mismatch');
        }
        if (status === 'published_by_automation' || status === 'published_externally') articleUrl = verifiedUrl;
      }
    }

    return {
      accountId: account.accountId,
      title: observation?.title ?? null,
      status,
      draftCount: account.draftCount,
      publishedCount: account.publishedCount,
      operation: observation?.operation ?? 'none',
      automationPublished,
      articleUrl,
      verifiedAt: input.verifiedAt,
    };
  });

  return {
    ok: issues.length === 0,
    date: input.date,
    accounts,
    issues,
    automationPublished: accounts.some(account => account.automationPublished === true)
      ? true
      : accounts.some(account => account.automationPublished === null)
        ? null
        : false,
    verifiedAt: input.verifiedAt,
  };
}
