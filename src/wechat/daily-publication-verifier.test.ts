import '../test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeTestOperatorProfile } from '../test-support/operator-profile-fixture.js';
import {
  type DailyPublicationInput,
  parseDailyPublicationInput,
  verifyDailyPublications,
} from './daily-publication-verifier.js';

const NOW = new Date('2026-09-20T00:30:00Z');
const SHA = 'a'.repeat(64);
type Observation = DailyPublicationInput['observations'][number];

function published(accountId: string): Observation {
  return {
    expectedAccountId: accountId,
    observedAccountId: accountId,
    title: `${accountId} 今日文章`,
    postType: 'news',
    draftSha256: SHA,
    draftCount: 0,
    publishedCount: 1,
    operation: 'published_by_automation',
    certainty: 'verified',
    publicationProof: {
      source: 'wechat_backend',
      accountId,
      title: `${accountId} 今日文章`,
      articleType: 'news',
      status: 'published',
      articleUrl: `https://mp.weixin.qq.com/s/${accountId}-article`,
      verifiedAt: '2026-09-20T00:29:00Z',
      draftSha256: SHA,
      bodyMatches: true,
      coverMatches: true,
      imagesMatch: true,
      entryMatches: true,
      originalityVerified: true,
      submission: {
        accountId,
        title: `${accountId} 今日文章`,
        submittedAt: '2026-09-20T00:28:00Z',
        draftSha256: SHA,
        notificationSent: false,
      },
    },
  };
}

function input(): DailyPublicationInput {
  return {
    date: '2026-09-20',
    expectedAccountIds: ['example-news', 'example-lab', 'example-notes'],
    verifiedAt: NOW.toISOString(),
    observations: [
      {
        expectedAccountId: 'example-news',
        observedAccountId: 'example-news',
        title: 'Example News 今日草稿',
        draftCount: 1,
        publishedCount: 0,
        operation: 'created',
        certainty: 'verified',
      },
      published('example-lab'),
      published('example-notes'),
    ],
  };
}

function verify(value: DailyPublicationInput) {
  return verifyDailyPublications(value, NOW);
}

test('Example News 留草稿、两号真实发表可通过,外部发表归因不混淆', () => {
  const value = input();
  const report = verify(value);
  assert.equal(report.ok, true);
  assert.equal(report.automationPublished, true);
  assert.deepEqual(
    report.accounts.map(account => [account.status, account.automationPublished]),
    [
      ['draft_verified', false],
      ['published_by_automation', true],
      ['published_by_automation', true],
    ]
  );
  const external = value.observations[2];
  assert.ok(external?.publicationProof);
  external.operation = 'observed_external_publish';
  delete external.publicationProof.submission;
  assert.equal(verify(value).accounts[2]?.automationPublished, false);
  assert.equal(verify(value).accounts[2]?.status, 'published_externally');
  assert.equal(verify(value).ok, true);
});

test('Example News 自动发表即使已发生也不能通过,但不抹掉实际发表事实', () => {
  const value = input();
  value.observations[0] = published('example-news');
  const report = verify(value);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some(issue => issue.code === 'automatic_publication_forbidden'));
  assert.equal(report.accounts[0]?.automationPublished, true);
});

test('自动发表号停在草稿箱不能算完成;有理由的编辑跳过可以', () => {
  const value = input();
  const observation = value.observations[1];
  assert.ok(observation);
  Object.assign(observation, { draftCount: 1, publishedCount: 0, operation: 'created' });
  delete observation.publicationProof;
  assert.ok(verify(value).issues.some(issue => issue.code === 'publication_not_completed'));
  Object.assign(observation, { draftCount: 0, operation: 'skipped' });
  assert.equal(verify(value).ok, false);
  observation.skipReason = '官方来源复核后没有足够的当天新事实';
  assert.equal(verify(value).ok, true);
});

test('缺号、重复、串号、未知观测与漏填期望账号均失败', () => {
  const mutations: Array<(value: DailyPublicationInput) => void> = [
    value => value.observations.pop(),
    value => value.observations.push(published('example-notes')),
    value => value.expectedAccountIds.pop(),
    value => {
      value.expectedAccountIds[2] = 'example-lab';
    },
    value => {
      const observation = value.observations[1];
      assert.ok(observation);
      observation.observedAccountId = 'example-notes';
    },
    value => {
      const observation = value.observations[1];
      assert.ok(observation);
      observation.certainty = 'unknown';
    },
  ];
  for (const mutate of mutations) {
    const value = input();
    mutate(value);
    const report = verify(value);
    assert.equal(report.ok, false);
    assert.equal(report.accounts.length, 3);
  }
});

test('已核实受理的审核中是操作终点,不要求正式链接也不冒充已发表', () => {
  const value = input();
  const observation = value.observations[1];
  assert.ok(observation?.publicationProof);
  observation.operation = 'publish_submitted';
  observation.publicationProof.status = 'reviewing';
  observation.publicationProof.articleUrl = null;
  observation.publishedCount = 0;
  assert.ok(observation.publicationProof.submission);
  observation.publicationProof.submission.notificationEnabled = false;
  let report = verify(value);
  assert.equal(report.ok, true);
  assert.equal(report.accounts[1]?.status, 'publication_submitted');
  assert.equal(report.accounts[1]?.automationPublished, null);
  assert.equal(report.accounts[1]?.articleUrl, null);
  delete observation.publicationProof;
  report = verify(value);
  assert.equal(report.ok, false);
  assert.equal(report.accounts[1]?.automationPublished, null);
});

test('平台成功回执可确认已提交,不虚构审核状态或要求继续取公开链接', () => {
  const value = input();
  const observation = value.observations[2];
  assert.ok(observation?.publicationProof?.submission);
  Object.assign(observation, { operation: 'publish_submitted', publishedCount: 0 });
  Object.assign(observation.publicationProof, {
    status: 'submitted',
    articleUrl: null,
    receipt: '已发表，正在返回首页',
  });
  observation.publicationProof.submission.notificationEnabled = false;
  const report = verify(value);
  assert.equal(report.ok, true);
  assert.equal(report.accounts[2]?.status, 'publication_submitted');
  assert.equal(report.accounts[2]?.automationPublished, null);
  assert.equal(report.accounts[2]?.articleUrl, null);
  delete observation.publicationProof.receipt;
  assert.equal(verify(value).ok, false);
});

test('审核终点仍验证身份、版本、原创、通知设置及受理证据', () => {
  const mutations: Array<(observation: Observation) => void> = [
    observation => {
      observation.observedAccountId = 'example-notes';
    },
    observation => {
      observation.draftSha256 = 'b'.repeat(64);
    },
    observation => {
      observation.certainty = 'unknown';
    },
    observation => {
      observation.publishedCount = 1;
    },
    observation => {
      assert.ok(observation.publicationProof?.submission);
      delete observation.publicationProof.submission.notificationEnabled;
    },
    observation => {
      assert.ok(observation.publicationProof?.submission);
      observation.publicationProof.submission.notificationEnabled = true;
    },
    observation => {
      assert.ok(observation.publicationProof);
      observation.publicationProof.originalityVerified = false;
    },
    observation => {
      assert.ok(observation.publicationProof);
      observation.publicationProof.status = 'unknown';
    },
  ];
  for (const status of ['reviewing', 'submitted'] as const) {
    for (const mutate of mutations) {
      const value = input();
      const observation = value.observations[1];
      assert.ok(observation?.publicationProof?.submission);
      Object.assign(observation, { operation: 'publish_submitted', publishedCount: 0 });
      Object.assign(observation.publicationProof, { status, articleUrl: null, receipt: '平台确认已提交' });
      observation.publicationProof.submission.notificationEnabled = false;
      mutate(observation);
      assert.equal(verify(value).ok, false);
    }
  }
});

test('回读身份、标题、内容、图片、原创、链接和提交版本逐项匹配', () => {
  const mutations: Array<(observation: Observation) => void> = [
    observation => {
      delete observation.publicationProof;
    },
    observation => {
      observation.draftSha256 = 'b'.repeat(64);
    },
    observation => {
      observation.postType = 'newspic';
    },
    ...['accountId', 'title', 'articleUrl'].map(key => (observation: Observation) => {
      assert.ok(observation.publicationProof);
      Object.assign(observation.publicationProof, { [key]: 'wrong' });
    }),
    ...['bodyMatches', 'coverMatches', 'imagesMatch', 'entryMatches', 'originalityVerified'].map(
      key => (observation: Observation) => {
        assert.ok(observation.publicationProof);
        Object.assign(observation.publicationProof, { [key]: false });
      }
    ),
    observation => {
      assert.ok(observation.publicationProof?.submission);
      observation.publicationProof.submission.notificationSent = true;
    },
    observation => {
      assert.ok(observation.publicationProof?.submission);
      observation.publicationProof.submission.accountId = 'example-notes';
    },
    observation => {
      assert.ok(observation.publicationProof);
      delete observation.publicationProof.submission;
    },
  ];
  for (const mutate of mutations) {
    const value = input();
    const observation = value.observations[1];
    assert.ok(observation);
    mutate(observation);
    assert.equal(verify(value).ok, false);
    assert.equal(verify(value).accounts[1]?.automationPublished, null);
  }
});

test('用户授权且提交前核实有额度的群发可通过,缺授权或额度证据仍失败', () => {
  const value = input();
  const submission = value.observations[1]?.publicationProof?.submission;
  assert.ok(submission);
  submission.notificationSent = true;
  assert.equal(verify(value).ok, false);
  submission.notificationAuthorization = {
    source: 'user_instruction',
    policy: 'send_if_quota_available',
    quotaAvailableBefore: 1,
    quotaObservedAt: '2026-09-20T00:27:00Z',
  };
  assert.equal(verify(value).ok, true);
  submission.notificationAuthorization.quotaObservedAt = '2026-09-20T00:29:00Z';
  assert.equal(verify(value).ok, false);
  submission.notificationAuthorization.quotaObservedAt = '2026-09-19T00:27:00Z';
  assert.equal(verify(value).ok, false);
  submission.notificationAuthorization.quotaAvailableBefore = 0;
  assert.throws(() => parseDailyPublicationInput(value));
});

test('自动发表记录不能改标外部发表绕过提交校验', () => {
  const value = input();
  const observation = value.observations[1];
  assert.ok(observation);
  observation.operation = 'observed_external_publish';
  assert.equal(verify(value).ok, false);
  assert.ok(verify(value).issues.some(issue => issue.code === 'publication_actor_mismatch'));
  Object.assign(observation, { operation: 'created', draftCount: 1, publishedCount: 0 });
  assert.equal(verify(value).ok, false);
  assert.equal(verify(value).accounts[1]?.automationPublished, null);
});

test('按北京时间校验日期,旧回读、未来回读和倒序提交不能通过', () => {
  const value = input();
  value.date = '2026-09-19';
  assert.equal(verify(value).ok, false);
  const fresh = input();
  const proof = fresh.observations[1]?.publicationProof;
  assert.ok(proof?.submission);
  proof.verifiedAt = '2026-09-19T00:29:00Z';
  assert.equal(verify(fresh).ok, false);
  proof.verifiedAt = '2026-09-20T00:31:00Z';
  assert.equal(verify(fresh).ok, false);
  proof.verifiedAt = '2026-09-20T00:29:00Z';
  proof.submission.submittedAt = '2026-09-20T00:30:00Z';
  assert.equal(verify(fresh).ok, false);
});

test('正式短链移除附加参数,预览链接拒绝,日志和输入剥离秘密字段', () => {
  const value = input();
  const observation = value.observations[1];
  assert.ok(observation?.publicationProof);
  Object.assign(observation, { media_id: 'sensitive-media', token: 'sensitive-token' });
  Object.assign(observation.publicationProof, { cookies: 'sensitive-cookie' });
  observation.publicationProof.articleUrl = 'https://mp.weixin.qq.com/s/real-article?token=sensitive-token';
  const parsed = parseDailyPublicationInput({ ...value, appsecret: 'sensitive-secret' });
  const report = verify(parsed);
  assert.equal(report.ok, true);
  assert.equal(report.accounts[1]?.articleUrl, 'https://mp.weixin.qq.com/s/real-article');
  assert.doesNotMatch(JSON.stringify(report), /sensitive-|media_id|cookies|appsecret|token/);
  assert.doesNotMatch(JSON.stringify(parsed), /sensitive-media|sensitive-cookie|sensitive-secret/);
  observation.publicationProof.articleUrl = 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=preview';
  assert.equal(verify(value).ok, false);
});

test('an empty operator profile cannot inherit another operator daily publication authority', () => {
  writeTestOperatorProfile({ version: 1 });
  try {
    assert.throws(() => verify(input()), /私有 operator profile 配置/u);
  } finally {
    writeTestOperatorProfile();
  }
});
