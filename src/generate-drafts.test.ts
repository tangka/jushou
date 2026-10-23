import './test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHOR_FACT_BOUNDARY_INSTRUCTION,
  AUTHOR_VOICE_INSTRUCTION,
  AUTHOR_VOICE_REVIEW_INSTRUCTION,
  READER_WRITING_INSTRUCTION,
  SELECTION_EVIDENCE_INSTRUCTION,
  TITLE_OPENING_INSTRUCTION,
  TOPIC_CONTINUITY_INSTRUCTION,
  TOPIC_SELECTION_INSTRUCTION,
} from './draft-prompts.js';
import {
  buildPlannerPrompt,
  buildPrompt,
  editorialPlanPath,
  parseDraftOptions,
  repairPrompt,
  shanghaiToday,
} from './generate-drafts.js';
import { testOperatorProfile, writeTestOperatorProfile } from './test-support/operator-profile-fixture.js';

test('draft CLI keeps a literal user brief separate from engine selection', () => {
  assert.deepEqual(parseDraftOptions([]), { engine: 'codex', directive: undefined, briefFile: undefined });
  assert.deepEqual(parseDraftOptions(['--engine=codex', '--brief', 'Tibo 按钮今天仍未使用']), {
    engine: 'codex',
    directive: 'Tibo 按钮今天仍未使用',
    briefFile: undefined,
  });
  assert.deepEqual(parseDraftOptions(['--engine', 'claude', '--brief-file=./today.md']), {
    engine: 'claude',
    directive: undefined,
    briefFile: './today.md',
  });
  assert.throws(() => parseDraftOptions(['--engine=unknown']), /不支持的 --engine/u);
  assert.throws(() => parseDraftOptions(['--engine']), /--engine 不能为空/u);
  assert.throws(() => parseDraftOptions(['--engine=']), /不支持的 --engine/u);
  assert.throws(() => parseDraftOptions(['--brief=']), /--brief 不能为空/u);
  assert.throws(() => parseDraftOptions(['--brief', 'A', '--brief-file', 'B']), /只能使用一个/u);
});

test('draft engine uses private configuration only when no explicit CLI engine is supplied', () => {
  try {
    writeTestOperatorProfile({ ...testOperatorProfile, operations: { draftEngine: 'both' } });
    assert.equal(parseDraftOptions([]).engine, 'both');
    assert.equal(parseDraftOptions(['--engine=codex']).engine, 'codex');
    assert.equal(parseDraftOptions(['--engine=claude']).engine, 'claude');
    for (const draftEngine of ['invalid', '', 42]) {
      writeTestOperatorProfile({ ...testOperatorProfile, operations: { draftEngine } });
      assert.throws(() => parseDraftOptions([]), /operations\.draftEngine/u);
      assert.equal(parseDraftOptions(['--engine=codex']).engine, 'codex');
    }
    writeTestOperatorProfile({ version: 1 });
    assert.equal(parseDraftOptions([]).engine, 'codex');
  } finally {
    writeTestOperatorProfile();
  }
});

test('draft dates use Asia Shanghai instead of UTC slicing', () => {
  assert.equal(shanghaiToday(new Date('2026-08-19T16:30:00.000Z')), '2026-08-20');
});

test('each engine plans independently while preserving the same literal user instruction', () => {
  const directive = 'Tibo 昨天收到按钮，今天自然重置但按钮仍未使用；加 OpenAI 与 Claude 财务对比。';
  const planner = buildPlannerPrompt('codex', '/vault/数据/编辑任务/2026-08-20/codex/run.json', directive);
  assert.match(planner, /必须逐字写入 userDirective/u);
  assert.match(planner, /不得换成你觉得更好的题/u);
  assert.match(planner, /禁止读取、参考或复用另一写稿引擎的编辑任务/u);
  assert.match(planner, new RegExp(JSON.stringify(directive).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));

  const writer = buildPrompt('codex', '/vault/数据/编辑任务/2026-08-20/codex/run.json');
  assert.match(writer, /本引擎锁定编辑任务：/u);
  assert.match(writer, /禁止读取或复用另一引擎的编辑任务与候选稿/u);
  assert.match(writer, /不得再按通用“原创实用优先”改选别的教程/u);
  assert.match(writer, /auto_quality_gate: true/u);
  assert.match(writer, /禁止写 `human_writing_reviewed` 或 `editorial_quality_reviewed`/u);
  assert.match(writer, /Example News 载体硬规则/u);
  assert.match(writer, /默认且只能写文章\(news\)/u);
  assert.match(writer, /连续多日的同题事件按已锁定的上一集/u);
  assert.match(writer, /只有来源里存在真实未决信号时才写下一步观察/u);
  assert.match(writer, /文章篇幅/u);
  assert.match(writer, /所有公众号文章[\s\S]*800~10000 单位/u);
  assert.match(writer, /周刊必须/u);
  assert.match(writer, /栏目: 周刊/u);
  assert.match(writer, /tags: \[周刊\]/u);
  assert.match(writer, /文章来源细节硬卡/u);
  assert.match(writer, /至少 6 个不同来源锚点/u);
  assert.match(writer, /通用建议、常识清单、空泛影响/u);
  assert.match(writer, /sourceAudit/u);
  assert.doesNotMatch(writer, /1500~2000 字/u);
  assert.doesNotMatch(writer, /900~1100/u);

  assert.match(planner, /Example News 公众号载体默认且只能是文章\(news\)/u);
  assert.match(planner, /“除非我要求贴图”不算本次贴图指令/u);
  assert.match(planner, /同题跨日更新按连续剧规划/u);
  assert.match(planner, /brief、analysis、tutorial、review/u);
  assert.match(planner, /文章\(news\)，包括周刊[\s\S]*800~10000 单位/u);
  assert.match(planner, /周刊必须/u);
  assert.match(planner, /minimums\.substantiveUnits 只能填 0 或 800/u);
  assert.match(planner, /"version": 2/u);
  assert.match(planner, /"sourceAudit"/u);
  assert.match(planner, /"substanceRequirementIds"/u);
  assert.match(planner, /至少 6 个/u);
  assert.match(planner, /仍不足则不要生成任务/u);
});

test('writer receives the selected article class without production-stage instructions', () => {
  for (const engine of ['codex', 'claude'] as const) {
    const translation = buildPrompt(engine, '/vault/brief.json', 'translation');
    assert.match(translation, /体裁：translation，完整直译/u);
    assert.match(translation, /保留全部参数、条件、示例、代码及完整提示词/u);
    assert.doesNotMatch(
      translation,
      /正文必须有原创增量|真实实操、踩坑|数据头版|video\/plan|视频号|生成封面|选题建议|今天的素材目录/u
    );
    assert.ok(!translation.includes(AUTHOR_VOICE_INSTRUCTION));
    const article = buildPrompt(engine, '/vault/brief.json', 'brief');
    assert.match(article, /体裁：brief/u);
    assert.ok(article.includes(AUTHOR_VOICE_INSTRUCTION));
    assert.doesNotMatch(article, /video\/plan|视频号|必须创建 \*\*2 个|echo '<JSON>'/u);
  }
});

test('initial author prompt writes for readers without editorial context; translations remain faithful', () => {
  for (const engine of ['codex', 'claude'] as const) {
    const writer = buildPrompt(engine, '/vault/brief.json', 'analysis');
    assert.ok(writer.includes(READER_WRITING_INSTRUCTION));
    assert.match(writer, /不默认读者看过旧文/u);
    assert.match(writer, /内部简称与编辑串场话不进入正文/u);
    assert.match(writer, /链接文字写真实标题或具体内容名称/u);
    assert.match(writer, /周刊按本周事实组织文章，不按发稿记录逐篇报账/u);
    assert.ok(writer.indexOf(READER_WRITING_INSTRUCTION) < writer.indexOf('文章来源细节硬卡'));
    const translation = buildPrompt(engine, '/vault/brief.json', 'translation');
    assert.ok(!translation.includes(READER_WRITING_INSTRUCTION));
    assert.match(translation, /只翻译锁定来源，不增加原文没有的解释或建议/u);
  }
});

test('planner exposes translation as its own class with a single original source', () => {
  const prompt = buildPlannerPrompt('codex', '/vault/brief.json', '直接翻译官方指南，保留完整提示词');
  assert.match(prompt, /sticker\|brief\|analysis\|tutorial\|review\|translation/u);
  assert.match(prompt, /单一完整原文即可作来源/u);
  assert.match(prompt, /不补写、不删节/u);
  assert.match(prompt, /关键词门禁不能代替语义审稿/u);
});

test('autonomous planner omits the user directive field instead of emitting an empty string', () => {
  const planner = buildPlannerPrompt('codex', '/vault/数据/编辑任务/2026-08-26/codex/run.json', undefined);
  assert.match(planner, /必须完全省略 userDirective 字段/u);
  assert.doesNotMatch(planner, /"userDirective":/u);
});

test('Codex and Claude editorial plans use separate engine directories', () => {
  const codex = editorialPlanPath('/vault/数据/编辑任务', '2026-08-20', 'codex', 'run');
  const claude = editorialPlanPath('/vault/数据/编辑任务', '2026-08-20', 'claude', 'run');
  assert.equal(codex, '/vault/数据/编辑任务/2026-08-20/codex/run.json');
  assert.equal(claude, '/vault/数据/编辑任务/2026-08-20/claude/run.json');
  assert.notEqual(codex, claude);
});

test('planner qualifies data evidence and reader relevance before ranking topics', () => {
  const planner = buildPlannerPrompt('codex', '/vault/brief.json', undefined);
  for (const instruction of [
    TOPIC_SELECTION_INSTRUCTION,
    SELECTION_EVIDENCE_INSTRUCTION,
    TOPIC_CONTINUITY_INSTRUCTION,
  ]) {
    assert.ok(planner.includes(instruction));
  }
  assert.match(planner, /本账号定位和私有编辑规范/u);
  assert.match(planner, /至少 3 个今天值得发布的候选题/u);
  assert.match(planner, /已核实且影响读者的重大变化不能被普通教程覆盖/u);
  assert.match(planner, /标签不足、小样本或过期报告不能用于题材排名/u);
  assert.match(planner, /不得拼接不同分组冠军/u);
  assert.match(planner, /中位阅读、读后关注人数及率、分享和收藏/u);
  assert.match(planner, /近14天已发布/u);
  assert.match(planner, /不包装成今日新闻/u);
  assert.doesNotMatch(planner, /为什么必须今天发|今天真正发生或状态变化的信号 >|至少 3 个当天候选题/u);
});

test('title and opening serve the reader promise without changing faithful translations or writer scope', () => {
  for (const contentClass of ['brief', 'analysis', 'tutorial', 'review', 'sticker'] as const) {
    const writer = buildPrompt('codex', '/vault/brief.json', contentClass);
    assert.ok(writer.includes(TITLE_OPENING_INSTRUCTION));
    assert.match(writer, /用户已锁定标题时保留原话/u);
    assert.match(writer, /结果、数字和利益必须有正文证据/u);
    assert.match(writer, /先用惊叹、愤怒、鲜明判断或有来源的场景/u);
    assert.match(writer, /时间戳不必放首句/u);
    assert.match(writer, /不作为固定信息三件套/u);
    assert.doesNotMatch(writer, /前一两段交代发生了什么、影响谁、本文能解决什么/u);
    assert.ok(!writer.includes(SELECTION_EVIDENCE_INSTRUCTION));
  }
  const translation = buildPrompt('codex', '/vault/brief.json', 'translation');
  assert.ok(!translation.includes(TITLE_OPENING_INSTRUCTION));
  assert.match(translation, /只翻译锁定来源，不增加原文没有的解释或建议/u);
});

test('default author expression is portable and does not inherit a private persona', () => {
  for (const engine of ['codex', 'claude'] as const) {
    const writer = buildPrompt(engine, '/vault/brief.json', 'analysis');
    assert.ok(writer.includes(AUTHOR_VOICE_INSTRUCTION));
    assert.match(writer, /不预设固定情绪强度/u);
    assert.doesNotMatch(writer, /在情绪峰值主动用粗口|密集封神要组织成逐轮加码/u);
  }
});

test('author opinion is distinct from source facts while fabricated experience and grounding bypass stay blocked', () => {
  const writer = buildPrompt('codex', '/vault/brief.json', 'analysis');
  assert.ok(writer.includes(AUTHOR_FACT_BOUNDARY_INSTRUCTION));
  assert.match(writer, /时间、数字、参数、金额、引语、发布状态、排名和真实动作须由来源/u);
  assert.match(writer, /作者的情绪、审美、主观赞誉与观点由你主动写出/u);
  assert.match(writer, /判断的事实前提要能核对/u);
  assert.match(writer, /不要求官方替作者说话/u);
  assert.match(writer, /不冒充客观测评、认证、全体共识或保证/u);
  assert.match(writer, /不得把原作者的“我”偷换成本文作者/u);
  assert.match(writer, /不编造试用、付款、熬夜、同事对白或现场经历/u);
  assert.match(writer, /至少 6 个不同来源锚点/u);
  assert.match(writer, /至少 4 个正文段落/u);
  assert.match(writer, /情绪、赞誉、比喻和宏大判断不冒充来源事实/u);
  assert.doesNotMatch(writer, /判断、读者动作和个人经历必须有本次来源或实测记录/u);
});

test('author review preserves expressive repetition and emotional endings instead of flattening them', () => {
  const writer = buildPrompt('codex', '/vault/brief.json', 'analysis');
  assert.ok(writer.includes(AUTHOR_VOICE_REVIEW_INSTRUCTION));
  assert.match(writer, /不机械删除承担表达作用的重复/u);
});

test('faithful translation receives none of the added author voice or original-opinion instructions', () => {
  for (const engine of ['codex', 'claude'] as const) {
    const translation = buildPrompt(engine, '/vault/brief.json', 'translation');
    for (const instruction of [
      AUTHOR_FACT_BOUNDARY_INSTRUCTION,
      AUTHOR_VOICE_INSTRUCTION,
      AUTHOR_VOICE_REVIEW_INSTRUCTION,
      TITLE_OPENING_INSTRUCTION,
    ]) {
      assert.ok(!translation.includes(instruction));
    }
    assert.match(translation, /按原文章节顺序翻译/u);
    assert.match(translation, /保留全部参数、条件、示例、代码及完整提示词/u);
    assert.match(translation, /原文中的作者经历按原作者归属翻译/u);
    assert.match(translation, /不能补话或删节凑入范围/u);
  }
});

test('non-translation repairs fix source facts while retaining the established author voice', () => {
  for (const contentClass of ['brief', 'analysis', 'tutorial', 'review', 'sticker'] as const) {
    const repair = repairPrompt(
      { dir: '/vault/draft', mdPath: '/vault/draft/article.md' },
      '/vault/brief.json',
      new Error('缺少一项已选来源事实'),
      contentClass
    );
    assert.ok(repair.includes(AUTHOR_FACT_BOUNDARY_INSTRUCTION));
    assert.ok(repair.includes(AUTHOR_VOICE_REVIEW_INSTRUCTION));
    assert.match(repair, /判断的事实前提要能核对/u);
    assert.match(repair, /不机械删除承担表达作用的重复/u);
    assert.match(repair, /至少 6 个来源锚点与 sourceAudit 照常保留/u);
    assert.match(repair, /不换题、不新建第二篇公众号稿/u);
    assert.match(repair, /不得修改编辑任务/u);
    assert.match(repair, /资源包装由下一阶段处理/u);
    assert.match(repair, /绕过门禁/u);
  }
});

test('translation repairs keep source fidelity and do not acquire original-author style requirements', () => {
  const repair = repairPrompt(undefined, '/vault/brief.json', '漏译一个参数', 'translation');
  assert.ok(!repair.includes(AUTHOR_FACT_BOUNDARY_INSTRUCTION));
  assert.ok(!repair.includes(AUTHOR_VOICE_REVIEW_INSTRUCTION));
  assert.match(repair, /保留原文章节、条件、参数、代码和完整提示词/u);
  assert.match(repair, /来源中的原话不得为了避开句式检查而删改/u);
  assert.match(repair, /只改译文和 sourceAudit，不改来源、编辑任务或独立审稿记录/u);
});

test('configured author voice is applied only to its account and never to a translation', () => {
  const voice = '使用示例作者的俏皮比喻，解释每项可核对的变化。';
  const review = '保留示例作者的俏皮比喻，修正事实。';
  writeTestOperatorProfile({
    ...testOperatorProfile,
    accounts: testOperatorProfile.accounts.map(account => ({
      ...account,
      editorial: account.id === 'example-news' ? { authorVoice: voice, authorVoiceReview: review } : {},
    })),
  });
  try {
    const writer = buildPrompt('codex', '/vault/brief.json', 'analysis');
    assert.ok(writer.includes(voice));
    assert.ok(writer.includes(review));
    assert.ok(!writer.includes(AUTHOR_VOICE_INSTRUCTION));
    assert.ok(!buildPrompt('codex', '/vault/brief.json', 'translation').includes(voice));
    const repair = repairPrompt(
      { dir: '/vault/draft', mdPath: '/vault/draft/article.md' },
      '/vault/brief.json',
      new Error('补来源'),
      'analysis'
    );
    assert.ok(repair.includes(review));
  } finally {
    writeTestOperatorProfile();
  }
});
