import '../test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  countEditorialSubstantiveUnits,
  EDITORIAL_BRIEF_FILE,
  type EditorialBrief,
  editorialBriefSchema,
  hasExplicitStickerRequest,
  validateAccountPostTypePolicy,
  validateAutomatedDraftEditorialQuality,
  validateEditorialBriefPlan,
  validateEditorialQuality,
} from './editorial-quality.js';

const codexSources = [
  { id: 'tibo-gift', label: 'Tibo 收到按钮', path: '素材库/tibo-gift/content.md', evidence: '8 月 19 日收到按钮' },
  {
    id: 'tibo-unused',
    label: 'Tibo 晒按钮',
    path: '素材库/tibo-unused/content.md',
    evidence: '8 月 20 日确认还没用过',
  },
  { id: 'openai-finance', label: 'OpenAI 财务披露', path: '素材库/openai-finance.md', evidence: '二季度营收与亏损' },
  {
    id: 'anthropic-finance',
    label: 'Anthropic 财务披露',
    path: '素材库/anthropic-finance.md',
    evidence: '营收和估值口径',
  },
];

const codexBrief: EditorialBrief = {
  version: 1,
  account: 'Example News',
  date: '2026-08-20',
  selectionMode: 'user_locked',
  userDirective: '写 Tibo 按钮尚未使用、今天自然重置，并比较 OpenAI 与 Claude 最新营收。',
  contentClass: 'analysis',
  topic: 'Tibo 按钮未按与 OpenAI 财务压力',
  primarySignal: 'Tibo 昨天收到按钮，今天确认还没使用；今天同时是账户自然重置日。',
  whyNow: '按钮状态和自然重置发生在今天，OpenAI 同日披露的新财务数据提供了公司层面的背景。',
  readerPromise: '分清自然重置和额外重置，并看懂 OpenAI 与 Anthropic 财务数字的口径差异。',
  titleTerms: [{ anyOf: ['Tibo'] }, { anyOf: ['按钮'] }, { anyOf: ['OpenAI'] }, { anyOf: ['营收'] }],
  sources: codexSources,
  candidates: [
    {
      topic: 'Tibo 按钮未按与 OpenAI 财务压力',
      selected: true,
      reason: '用户锁定的当天信号和比较角度',
      sourceIds: ['tibo-gift', 'tibo-unused', 'openai-finance', 'anthropic-finance'],
    },
  ],
  requirements: [
    {
      id: 'button-gift',
      description: '昨天收到重置按钮',
      scope: 'body',
      allOf: [{ anyOf: ['昨天', '8月19日'] }, { anyOf: ['收到按钮', '新重置按钮'] }],
      sourceIds: ['tibo-gift'],
    },
    {
      id: 'button-unused',
      description: '今天明确尚未使用按钮',
      scope: 'body',
      allOf: [{ anyOf: ['今天', '8月20日'] }, { anyOf: ['还没用过', '尚未使用'] }],
      sourceIds: ['tibo-unused'],
    },
    {
      id: 'natural-reset',
      description: '今天是自然重置日',
      scope: 'body',
      allOf: [{ anyOf: ['自然重置'] }, { anyOf: ['100%', '回满'] }, { anyOf: ['七天周期', '8月13日'] }],
      sourceIds: ['tibo-unused'],
    },
    {
      id: 'openai-quarter',
      description: 'OpenAI 二季度营收与经营亏损',
      scope: 'body',
      allOf: [{ anyOf: ['67亿美元', '67亿'] }, { anyOf: ['123亿美元', '123亿'] }, { anyOf: ['18%'] }],
      sourceIds: ['openai-finance'],
    },
    {
      id: 'combined-users',
      description: '两类工作产品合计周活 2000 万',
      scope: 'body',
      allOf: [
        { anyOf: ['Codex'] },
        { anyOf: ['ChatGPT Work'] },
        { anyOf: ['2000万', '20 million'] },
        { anyOf: ['合计'] },
      ],
      sourceIds: ['openai-finance'],
    },
    {
      id: 'claude-comparison',
      description: 'Anthropic 对比及估值边界',
      scope: 'body',
      allOf: [
        { anyOf: ['Anthropic', 'Claude'] },
        { anyOf: ['115亿美元', '115亿'] },
        { anyOf: ['650亿美元', '650亿'] },
        { anyOf: ['9650亿', '私营公司估值'] },
      ],
      sourceIds: ['anthropic-finance'],
    },
  ],
  forbiddenClaims: [
    { id: 'button-pressed', description: '不得声称 Tibo 已按按钮', scope: 'all', anyOf: ['Tibo按了按钮'] },
    { id: 'button-reset', description: '不得把自然重置写成 Tibo 重置', scope: 'all', anyOf: ['Tibo已经重置'] },
  ],
};

test('autonomous editorial briefs normalize an empty user directive to absent', () => {
  const parsed = editorialBriefSchema.parse({
    ...codexBrief,
    selectionMode: 'autonomous',
    userDirective: '   ',
  });
  assert.equal(parsed.userDirective, undefined);
});

function codexFinalBody(): string {
  const paragraphs = [
    '昨天 13 时 03 分，Tibo 说自己收到一个新重置按钮。今天 0 时 39 分，他把实物放到桌上，明确说还没用过。',
    '今天额度回满 100%，原因是七天周期走完。上一次额外调整发生在 8 月 13 日，所以 8 月 20 日正好是自然重置。按钮尚未使用。',
    'OpenAI 第二季度营收 67 亿美元，第一季度为 57 亿美元，环比增长 18%。同期经营亏损从 93 亿美元扩大到 123 亿美元。',
    '全员会材料还写到，Codex 与 ChatGPT Work 合计周活突破 2000 万。这个合计数不能全部归到 Codex，产品口径需要保留。',
    'Anthropic 第二季度初步营收约 115 亿美元，7 月底年化收入运行速度超过 650 亿美元。最近落地的是 9650 亿美元私营公司估值。',
    '两家公司的第三方渠道确认方式不同。季度营收、年化收入运行速度和私营公司估值必须分开，不能把不同周期或不同会计口径直接相减。',
    '按钮事件回答的是额度时间线，财务披露回答的是公司增长与成本。两者没有公开因果，只能放在同一天观察，不能编造关联。',
  ];
  const prose = paragraphs.join('\n\n');
  const body = `${prose}\n\n![图一](media/1.png)\n![图二](media/2.png)\n![图三](media/3.png)`;
  return `${body}\n\n${'补'.repeat(900 - countEditorialSubstantiveUnits(body, ''))}`;
}

test('today Codex final passes the locked timeline and finance contract', () => {
  assert.doesNotThrow(() =>
    validateEditorialQuality(codexBrief, {
      draftDir: '/vault/Example News/待发布/2026-08-20-final__codex',
      markdown: '',
      title: 'Tibo的按钮没按，OpenAI营收不及预期',
      body: codexFinalBody(),
      postType: '图文',
      accountExact: 'Example News',
    })
  );
});

test('user-locked plan must preserve the literal instruction', () => {
  assert.doesNotThrow(() =>
    validateEditorialBriefPlan(codexBrief, {
      accountExact: 'Example News',
      date: '2026-08-20',
      expectedDirective: codexBrief.userDirective,
    })
  );
  assert.throws(
    () =>
      validateEditorialBriefPlan(
        { ...codexBrief, userDirective: '写 OpenAI 财务。' },
        { accountExact: 'Example News', date: '2026-08-20', expectedDirective: codexBrief.userDirective }
      ),
    /没有逐字保留本次用户指令/u
  );
});

test('Example News defaults to news and accepts newspic only from a direct user request', () => {
  assert.equal(hasExplicitStickerRequest(undefined), false);
  assert.equal(hasExplicitStickerRequest('example-news发文章 除非我要求贴图'), false);
  assert.equal(hasExplicitStickerRequest('不要发贴图'), false);
  assert.equal(hasExplicitStickerRequest('今天 Example News 发贴图', 'Example News'), true);
  assert.equal(hasExplicitStickerRequest('这条改成贴图'), true);
  assert.equal(hasExplicitStickerRequest('贴图发一下'), true);
  assert.equal(hasExplicitStickerRequest('多图贴图（封面＋数据图）'), true);
  assert.equal(hasExplicitStickerRequest('这篇做多图贴图'), true);
  assert.equal(hasExplicitStickerRequest('多图'), false);
  assert.equal(hasExplicitStickerRequest('文章内多图'), false);
  assert.equal(hasExplicitStickerRequest('不要做多图贴图'), false);
  assert.equal(hasExplicitStickerRequest('是否做多图贴图（封面＋数据图）'), false);
  assert.equal(
    hasExplicitStickerRequest(
      'tibo最新帖子 他开始想点子了 你搞一篇贴图发到草稿箱去；贴图要有tibo的卡通形象以及结合上次投票的结果\n发到codex'
    ),
    true
  );
  assert.equal(hasExplicitStickerRequest('帮我做一组贴图放进草稿箱'), true);
  for (const directive of [
    '不要搞一篇贴图发到草稿箱去',
    '如果有结果你搞一篇贴图发到草稿箱去',
    '你搞一篇贴图发到草稿箱去吗',
    '例如你搞一篇贴图发到草稿箱去',
    '他说你搞一篇贴图发到草稿箱去',
    '做一篇文章加贴图发到草稿箱去',
  ]) {
    assert.equal(hasExplicitStickerRequest(directive), false);
  }

  assert.doesNotThrow(() =>
    validateAccountPostTypePolicy({ accountExact: 'Example News', postType: '图文', brief: undefined })
  );
  assert.throws(
    () => validateAccountPostTypePolicy({ accountExact: 'Example News', postType: '贴图', brief: undefined }),
    /Example News 载体硬规则/u
  );
  assert.throws(
    () =>
      validateAccountPostTypePolicy({
        accountExact: 'Example News',
        postType: '贴图',
        brief: { ...codexBrief, userDirective: 'example-news发文章 除非我要求贴图' },
      }),
    /不构成本次贴图指令/u
  );
  assert.doesNotThrow(() =>
    validateAccountPostTypePolicy({
      accountExact: 'Example News',
      postType: '贴图',
      brief: { ...codexBrief, userDirective: '今天 Example News 发贴图' },
    })
  );
  assert.doesNotThrow(() =>
    validateAccountPostTypePolicy({ accountExact: 'Example Notes', postType: '贴图', brief: undefined })
  );
});

test('Asana first draft and wrong Tibo angle both fail the locked contract', () => {
  const asana = `${'Asana 把工作流迁移到了 Codex。'.repeat(90)}\n![1](media/1.png)\n![2](media/2.png)\n![3](media/3.png)`;
  assert.throws(
    () =>
      validateEditorialQuality(codexBrief, {
        draftDir: '/vault/Example News/待发布/2026-08-20-asana__codex',
        markdown: '',
        title: 'Asana怎样把工作流迁进Codex',
        body: asana,
        postType: '图文',
        accountExact: 'Example News',
      }),
    /标题缺少第 1 组核心词（Tibo）/u
  );

  const wrongTibo = codexFinalBody()
    .replaceAll('收到一个新重置按钮', '发布了一条安全更新')
    .replaceAll('还没用过', '正在测试企业安全控制')
    .replaceAll('按钮尚未使用', '安全控制仍在预览');
  assert.throws(
    () =>
      validateEditorialQuality(codexBrief, {
        draftDir: '/vault/Example News/待发布/2026-08-20-wrong-tibo__codex',
        markdown: '',
        title: 'Tibo谈安全，OpenAI营收不及预期',
        body: wrongTibo,
        postType: '图文',
        accountExact: 'Example News',
      }),
    /button-gift[\s\S]*button-unused/u
  );
});

const claudeBrief: EditorialBrief = {
  version: 1,
  account: 'Example Lab',
  date: '2026-08-20',
  selectionMode: 'user_locked',
  userDirective: '写 Anthropic 最新营收和 2 万亿美元估值预期，并与 OpenAI 比较。',
  contentClass: 'analysis',
  topic: 'Anthropic 最新营收与两万亿美元 IPO 预期',
  primarySignal: 'Anthropic 年化收入运行速度超过 650 亿美元，投资人同时谈到两万亿美元 IPO 定价。',
  whyNow: '最新投资材料把收入速度和 IPO 预期放到同一天，估值边界需要立即说明。',
  readerPromise: '区分已实现季度营收、年化速度、已成交估值和投资人预期。',
  titleTerms: [{ anyOf: ['Anthropic'] }, { anyOf: ['650亿'] }, { anyOf: ['2万亿'] }],
  sources: [
    {
      id: 'anthropic-update',
      label: 'Anthropic 投资材料',
      path: '素材库/anthropic.md',
      evidence: '年化速度和季度营收',
    },
    { id: 'ipo-report', label: 'IPO 投资人报道', path: '素材库/ipo.md', evidence: '2 万亿美元为投资人预期' },
    { id: 'openai-compare', label: 'OpenAI 财务材料', path: '素材库/openai.md', evidence: '年化速度和二季度营收' },
  ],
  candidates: [
    {
      topic: 'Anthropic 最新营收与两万亿美元 IPO 预期',
      selected: true,
      reason: '用户指定',
      sourceIds: ['anthropic-update', 'ipo-report', 'openai-compare'],
    },
  ],
  requirements: [
    {
      id: 'run-rate',
      description: '650 亿是年化速度',
      scope: 'body',
      allOf: [{ anyOf: ['650亿美元', '650亿'] }, { anyOf: ['年化收入运行速度', '年化速度'] }],
      sourceIds: ['anthropic-update'],
    },
    {
      id: 'quarter',
      description: '二季度实际营收',
      scope: 'body',
      allOf: [{ anyOf: ['二季度'] }, { anyOf: ['115亿美元', '115亿'] }],
      sourceIds: ['anthropic-update'],
    },
    {
      id: 'closed-value',
      description: '已成交估值',
      scope: 'body',
      allOf: [{ anyOf: ['9650亿'] }, { anyOf: ['已完成', '已经完成', '成交'] }],
      sourceIds: ['anthropic-update'],
    },
    {
      id: 'ipo-boundary',
      description: '2 万亿仍是预期',
      scope: 'body',
      allOf: [
        { anyOf: ['2万亿美元', '2万亿'] },
        { anyOf: ['投资人预期', '投资人的判断', '押注'] },
        { anyOf: ['没有落地', '尚未公布', '目前只有'] },
      ],
      sourceIds: ['ipo-report'],
    },
    {
      id: 'openai',
      description: '与 OpenAI 比较',
      scope: 'body',
      allOf: [{ anyOf: ['OpenAI'] }, { anyOf: ['400亿美元', '400亿', '67亿美元', '67亿'] }],
      sourceIds: ['openai-compare'],
    },
    {
      id: 'product-boundary',
      description: '不能全归 Claude Code',
      scope: 'body',
      allOf: [{ anyOf: ['Claude Code'] }, { anyOf: ['不能全部', '没有拆分', '不能全算'] }],
      sourceIds: ['anthropic-update'],
    },
  ],
  forbiddenClaims: [
    { id: 'market-cap', description: '私营公司不得写市值', scope: 'all', anyOf: ['市值2万亿美元'] },
    { id: 'landed-2t', description: '2 万亿尚未落地', scope: 'all', anyOf: ['已经达到2万亿美元'] },
    { id: 'code-total', description: '公司收入不得全算给产品', scope: 'all', anyOf: ['Claude Code年化收入650亿美元'] },
  ],
};

function claudeFinalBody(): string {
  const paragraphs = [
    'Anthropic 7 月底的年化收入运行速度超过 650 亿美元。650 亿是近期收入外推一年的年化速度，不是今年已经收到的钱。',
    '已经结束的二季度初步营收超过 115 亿美元。季度实际收入和年化速度是两种数字，放在一起时必须分别标清。',
    '5 月融资已经完成，成交对应的私营公司估值为 9650 亿美元。2 万亿美元来自投资人预期，目前只有投资人的判断，没有落地。',
    'OpenAI 最近披露的年化速度超过 400 亿美元，二季度营收 67 亿美元。两家公司部分渠道的会计确认方式也不同。',
    'Anthropic 没有拆分最新产品收入，650 亿美元包含企业版、API 和其他渠道，不能全部算给 Claude Code。',
    '公开上市后还要看毛利、云合同、客户集中度和股权薪酬。IPO 文件出现以前，投资人押注不能冒充已经完成的交易。',
  ];
  const prose = paragraphs.join('\n\n');
  const body = `${prose}\n![1](media/1.png)\n![2](media/2.png)\n![3](media/3.png)`;
  return `${body}\n\n${'补'.repeat(900 - countEditorialSubstantiveUnits(body, ''))}`;
}

test('Claude finance rewrite passes while Concise tutorial fails', () => {
  assert.doesNotThrow(() =>
    validateEditorialQuality(claudeBrief, {
      draftDir: '/vault/Example Lab/待发布/2026-08-20-finance__codex',
      markdown: '',
      title: 'Anthropic年化营收破650亿美元，投资者押注2万亿美元IPO',
      body: claudeFinalBody(),
      postType: '图文',
      accountExact: 'Example Lab',
    })
  );
  assert.throws(
    () =>
      validateEditorialQuality(claudeBrief, {
        draftDir: '/vault/Example Lab/待发布/2026-08-20-concise__codex',
        markdown: '',
        title: 'Claude Code新增Concise输出风格',
        body: `${'打开 config，选择 Concise。'.repeat(120)}\n![1](media/1.png)\n![2](media/2.png)\n![3](media/3.png)`,
        postType: '图文',
        accountExact: 'Example Lab',
      }),
    /标题缺少[\s\S]*Anthropic[\s\S]*缺少必写事实 run-rate/u
  );
});

const stickerBrief: EditorialBrief = {
  version: 1,
  account: 'Example Notes',
  date: '2026-08-20',
  selectionMode: 'user_locked',
  userDirective: '个人公众号发用户突破 2000 万这张图。',
  contentClass: 'sticker',
  topic: 'Codex 用户突破 2000 万',
  primarySignal: '用户指定的增长曲线显示 Codex 用户突破 2000 万。',
  whyNow: '用户明确要求今天在个人公众号发这张图。',
  readerPromise: '一张图看清 Codex 最新用户规模。',
  titleTerms: [{ anyOf: ['Codex'] }, { anyOf: ['2000万'] }],
  sources: [{ id: 'user-image', label: '用户提供图片', path: 'media/cover.png', evidence: '曲线终点为 2000 万' }],
  candidates: [{ topic: 'Codex 用户突破 2000 万', selected: true, reason: '用户指定', sourceIds: ['user-image'] }],
  requirements: [
    {
      id: 'users',
      description: 'Codex 用户突破 2000 万',
      scope: 'all',
      allOf: [{ anyOf: ['Codex'] }, { anyOf: ['2000万'] }],
      sourceIds: ['user-image'],
    },
  ],
  forbiddenClaims: [],
};

test('personal-account 20m sticker passes and unrelated safety sticker fails', () => {
  assert.doesNotThrow(() =>
    validateEditorialQuality(stickerBrief, {
      draftDir: '/vault/Example Notes/待发布/2026-08-20-users__codex',
      markdown: '',
      title: 'Codex用户突破2000万',
      body: '# Codex用户突破2000万\n\n![用户曲线](media/cover.png)\n\nCodex 用户突破 2000 万，最新曲线已确认。',
      postType: '贴图',
      accountExact: 'Example Notes',
    })
  );
  assert.throws(
    () =>
      validateEditorialQuality(stickerBrief, {
        draftDir: '/vault/Example Notes/待发布/2026-08-20-safety__codex',
        markdown: '',
        title: 'OpenAI预览不留数据安全监测',
        body: '![安全流程](media/cover.png)\n\n企业数据控制进入预览。',
        postType: '贴图',
        accountExact: 'Example Notes',
      }),
    /标题缺少[\s\S]*Codex[\s\S]*缺少必写事实 users/u
  );
});

test('automated folders fail closed without a brief; legacy review is explicit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-editorial-quality-'));
  const draftDir = path.join(root, '2026-08-20-auto__codex');
  await fs.mkdir(draftDir);
  const body = '正'.repeat(800);
  const input = {
    draftDir,
    markdown: `---\ntitle: 自动稿\n---\n\n${body}`,
    title: '自动稿',
    body,
    postType: '图文',
    accountExact: 'Example News',
  };
  await assert.rejects(() => validateAutomatedDraftEditorialQuality(input), new RegExp(EDITORIAL_BRIEF_FILE, 'u'));
  const reviewedInput = {
    ...input,
    markdown: `---\ntitle: 自动稿\neditorial_quality_reviewed: true\n---\n\n${body}`,
  };
  await assert.rejects(() => validateAutomatedDraftEditorialQuality(reviewedInput), /只有已存在微信草稿元数据的旧稿/u);
  await fs.writeFile(path.join(draftDir, '.wechat-draft.json'), '{}\n', 'utf8');
  await assert.doesNotReject(() => validateAutomatedDraftEditorialQuality(reviewedInput));
});

test('automated draft reads only its own validated brief', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-editorial-brief-'));
  const draftDir = path.join(root, '2026-08-20-sticker__codex');
  await fs.mkdir(draftDir);
  await fs.writeFile(path.join(draftDir, EDITORIAL_BRIEF_FILE), `${JSON.stringify(stickerBrief)}\n`, 'utf8');
  const body = '# Codex用户突破2000万\n\n![用户曲线](media/cover.png)\n\nCodex 用户突破 2000 万，最新曲线已确认。';
  await assert.doesNotReject(() =>
    validateAutomatedDraftEditorialQuality({
      draftDir,
      markdown: `---\ntitle: Codex用户突破2000万\npost_type: 贴图\n---\n\n${body}`,
      title: 'Codex用户突破2000万',
      body,
      postType: '贴图',
      accountExact: 'Example Notes',
    })
  );
  await assert.rejects(
    () =>
      validateAutomatedDraftEditorialQuality({
        draftDir,
        markdown: '---\ntitle: 自动稿\neditorial_brief: ../outside.json\n---\n\n正文',
        title: '自动稿',
        body: '正文',
        postType: '图文',
        accountExact: 'Example Notes',
      }),
    /必须位于当前草稿目录内/u
  );
});
