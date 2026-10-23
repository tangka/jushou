// 自动出稿:按当前账号与显式引擎配置生成候选稿，默认只使用 Codex。
// 引擎在账号的 vault 目录里直接读素材/选题建议、写待发布草稿(本地跑,Docker 里没 SDK 登录态,别进容器)。
// 跑:pnpm draft -- --engine=codex|claude|both [--brief '<用户原话>'|--brief-file <path>]。默认 codex。
import fs from 'node:fs/promises';
import * as path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Codex } from '@openai/codex-sdk';
import { findMainMarkdown, parseMarkdown } from './build-publish-html.js';
import { accountPolicy } from './config/account-policy.js';
import { config } from './config/index.js';
import { loadOperatorProfile } from './config/operator-profile.js';
import {
  AUTHOR_FACT_BOUNDARY_INSTRUCTION,
  authorVoiceReviewInstruction,
  buildPackagingPrompt,
  buildPrompt,
  buildTranslationReviewPrompt,
  EDITORIAL_AUTHORITY_INSTRUCTION,
  type GeneratedDraft,
  READER_REVIEW_INSTRUCTION,
  SELECTION_EVIDENCE_INSTRUCTION,
  TOPIC_CONTINUITY_INSTRUCTION,
  TOPIC_SELECTION_INSTRUCTION,
  WRITING_SCOPE_INSTRUCTION,
} from './draft-prompts.js';
import { assertPackagingPreservesText, prepareDraftForValidation } from './draft-workflow.js';
import { isMain, runCli } from './utils/cli.js';
import { readFrontmatterField, upsertFrontmatter } from './utils/frontmatter.js';
import {
  EDITORIAL_BRIEF_FILE,
  type EditorialBrief,
  parseEditorialBrief,
  validateEditorialBriefPlan,
  validateEditorialQuality,
} from './wechat/editorial-quality.js';
import { snapshotTranslationSources, translationReviewInputs } from './wechat/editorial-translation.js';
import { validateWechatDraftHumanWriting } from './wechat/human-writing-guard.js';
import { reviewHumanWritingWarnings } from './wechat/human-writing-review.js';

type Engine = 'codex' | 'claude';
type DraftEngine = Engine | 'both';
type DraftOptions = {
  engine: DraftEngine;
  directive?: string;
  briefFile?: string;
};

const MAX_REPAIR_ATTEMPTS = 2;

class LockedEditorialBriefError extends Error {}

export { ARTICLE_GROUNDING_INSTRUCTION, ARTICLE_LENGTH_INSTRUCTION, buildPrompt } from './draft-prompts.js';

export function shanghaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const inline = args.find(arg => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseDraftOptions(args: readonly string[]): DraftOptions {
  const requestedEngine = optionValue(args, '--engine');
  if (args.includes('--engine') && requestedEngine === undefined) throw new Error('--engine 不能为空');
  const rawEngine = requestedEngine ?? loadOperatorProfile().operations.draftEngine ?? 'codex';
  if (rawEngine !== 'codex' && rawEngine !== 'claude' && rawEngine !== 'both') {
    if (requestedEngine === undefined) throw new Error('私有配置 operations.draftEngine 只允许 codex、claude、both');
    throw new Error(`不支持的 --engine=${rawEngine}，只允许 codex、claude、both`);
  }
  const directive = optionValue(args, '--brief')?.trim();
  const briefFile = optionValue(args, '--brief-file')?.trim();
  if (directive && briefFile) throw new Error('--brief 与 --brief-file 只能使用一个');
  if (args.some(arg => arg === '--brief' || arg.startsWith('--brief=')) && !directive) {
    throw new Error('--brief 不能为空');
  }
  if (args.some(arg => arg === '--brief-file' || arg.startsWith('--brief-file=')) && !briefFile) {
    throw new Error('--brief-file 不能为空');
  }
  return { engine: rawEngine, directive, briefFile };
}

export function buildPlannerPrompt(engine: Engine, outputPath: string, directive: string | undefined): string {
  const today = shanghaiToday();
  const root = config.accountRoot;
  const mode = directive ? 'user_locked' : 'autonomous';
  const userBlock = directive
    ? `本次用户原话如下，必须逐字写入 userDirective，并将其作为最高优先级，不得换成你觉得更好的题：\n${JSON.stringify(directive)}`
    : '本次没有额外用户指令。你必须比较至少 3 个今天值得发布的候选题，再锁定 1 个；候选可来自重大变化、具体问题与已有真实案例、同题新增证据，不要求每类凑一个。JSON 必须完全省略 userDirective 字段，不能写空字符串。';
  const accountPostTypeRule = accountPolicy(config.accountExact).newsOnly
    ? `${config.accountExact} 公众号载体默认且只能是文章(news)。只有本次用户原话明确要求“发贴图”时才允许 contentClass=sticker；“除非我要求贴图”不算本次贴图指令。同题跨日更新按连续剧规划，必须承接同账号上一集并锁定今天新增状态。`
    : '公众号载体按当前账号规范与本次用户原话选择。';
  return [
    `你是「${config.accountExact}」的 ${engine} 独立责任编辑。今天是 ${today}。本轮只整理选题与来源要求，不写文章。`,
    '禁止读取、参考或复用另一写稿引擎的编辑任务、选题结论和候选稿。你必须只根据本账号定位、已核实素材、历史数据和用户原话独立得出结论。',
    userBlock,
    EDITORIAL_AUTHORITY_INSTRUCTION,
    WRITING_SCOPE_INSTRUCTION,
    accountPostTypeRule,
    '',
    '必须读取：',
    `- 账号定位：${config.paths.positioningDoc}`,
    `- 选题建议：${path.join(root, '数据', '选题建议.md')}`,
    `- 当天素材：${path.join(root, '素材库', today)}；可从同账号素材库补读与候选相关的既有完整来源，保留真实事件日期，不遍历无关材料`,
    `- 近14天已发布去重及同题上一集：${path.join(root, '已发布')}`,
    '- 当前选题策略与内容规范：使用账号定位文件、operator.local.json 的 editorial 字段及用户本次指令，不读取未提供的项目文档。',
    '',
    TOPIC_SELECTION_INSTRUCTION,
    SELECTION_EVIDENCE_INSTRUCTION,
    TOPIC_CONTINUITY_INSTRUCTION,
    '看到“昨天收到、今天未使用、今天自然到期”这类时间线时，三个状态必须拆开。公司财务比较必须区分季度营收、年化运行速度、亏损、私营公司估值和未落地的 IPO 预期。',
    '',
    `把一个 JSON 对象写到 ${outputPath}，不得写 Markdown 围栏。字段必须是：`,
    '{',
    `  "version": 2, "account": ${JSON.stringify(config.accountExact)}, "date": ${JSON.stringify(today)},`,
    directive
      ? `  "selectionMode": ${JSON.stringify(mode)}, "userDirective": ${JSON.stringify(directive)},`
      : `  "selectionMode": ${JSON.stringify(mode)},`,
    '  "contentClass": "sticker|brief|analysis|tutorial|review|translation",',
    '  "topic": "锁定主题", "primarySignal": "本次新增事实或已完成结果，注明事件实际日期",',
    '  "whyNow": "为什么现在值得发布，不把旧事件写成今天发生", "readerPromise": "具体读者的什么问题，以及来源能支持的所得",',
    '  "titleTerms": [{"anyOf":["标题必须命中的同义词"]}],',
    '  "sources": [{"id":"全局唯一 id","label":"来源名","path":"已存在的绝对本地文件路径","evidence":"它具体证明什么"}],',
    '  "candidates": [{"topic":"候选题","selected":true,"reason":"读者问题、新增证据、时效、可比历史样本及局限、选择或淘汰理由","sourceIds":["来源 id"]}],',
    '  "requirements": [{"id":"全局唯一 id","description":"对读者有用的来源事实或用户明确要求","scope":"title|body|all","allOf":[{"anyOf":["正文可实际命中的同义表达"]}],"sourceIds":["来源 id"]}],',
    '  "sourceAudit": "internal-audit/source-audit.md",',
    '  "substanceRequirementIds": ["至少 6 个真正承载正文细节的 body/all requirement id"],',
    '  "forbiddenClaims": [{"id":"全局唯一 id","description":"禁止写出的错误结论","scope":"title|body|all","anyOf":["精确错误短语"]}],',
    '  "minimums": {"substantiveUnits":0,"bodyImages":0,"sources":0,"requirements":0}',
    '}',
    '',
    '事实边界用于约束事实措辞或 forbiddenClaims，不自动生成对外解释要求。每项正文 requirement 先确认用户确有要求或来源确有这一细节，再确认它对本题读者有用；不能把作者的执行限制、采集记录或未实测声明登记成来源锚点。',
    '用户要求直译、逐段翻译或完整翻译时使用 contentClass=translation。原文章节、参数、代码和完整提示词是必保留内容；单一完整原文即可作来源，正文图片按原文保留，不凑图。翻译任务不套原创增量、作者经历、读者建议或额外风险解释，不把用户参考截图变成配图要求。仍执行 800~10000 与版本 2 来源合同；译文不足下限或超过上限时报告冲突，不补写、不删节。每个原文章节都要纳入任务范围，生成后由独立审稿阶段逐章核对完整性，关键词门禁不能代替语义审稿。',
    '硬要求：brief、analysis、tutorial、review 只要载体是文章(news)，包括周刊，有效正文统一为 800~10000 单位；周刊必须同时标记 frontmatter 的“栏目: 周刊”与“tags: [周刊]”。minimums.substantiveUnits 只能填 0 或 800，不得通过体裁或任务自行加严。每篇 news 的 substanceRequirementIds 至少 6 个，必须引用 scope=body/all 的 requirements；这些 requirement 各自至少有 2 组 allOf、绑定真实 sourceIds，并能在同一正文段落完整命中。文章随篇幅增长必须继续增加来源锚点，保持来源细节覆盖；只有来源事实、真实动作、数字、原话或有日志的实测步骤可以列入；标题、小程序入口、普通建议、空泛影响和免责声明不能列入。材料要能自然铺开至少 4 个有来源段落并支撑 800 单位；不够就缩小题目，仍不足则不要生成任务。analysis 至少 3 个独立来源、5 项 requirements 和 3 张正文图；tutorial/review 至少 2 个来源、5 项 requirements 和 3 张图；brief 至少 2 个来源、3 项 requirements；sticker 至少 1 个来源、1 项 requirement、1 张图，且不套文章字数和来源覆盖门禁。每个 source.path 必须是已存在的绝对本地文件。每项 requirement 的词组必须足够具体，能把错误题材挡住，不能只写“OpenAI”“增长”这种空词。所有 id 全局唯一。autonomous 必须列至少 3 个候选且只能选中一个；user_locked 可以只有一个候选。最后重新读取 JSON，确认可解析、来源真实存在、事实边界不互相冲突。',
  ].join('\n');
}

export function editorialPlanPath(planDir: string, date: string, engine: Engine, runId: string): string {
  return path.join(planDir, date, engine, `${runId}.json`);
}

function createCodexThread() {
  const codex = new Codex();
  return codex.startThread({
    workingDirectory: config.accountRoot,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
  });
}

async function runClaudePrompt(prompt: string): Promise<string> {
  let last = '';
  for await (const msg of query({
    prompt,
    options: {
      cwd: config.accountRoot,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    },
  })) {
    if (msg.type === 'result' && 'result' in msg && typeof msg.result === 'string') last = msg.result;
  }
  return last;
}

async function planEditorialBrief(
  options: DraftOptions,
  plannerEngine: Engine
): Promise<{ brief: EditorialBrief; path: string }> {
  const today = shanghaiToday();
  const planDir = path.join(config.accountRoot, '数据', '编辑任务');
  const planPath = editorialPlanPath(planDir, today, plannerEngine, Date.now().toString(36));
  await fs.mkdir(path.dirname(planPath), { recursive: true });

  let directive = options.directive;
  if (options.briefFile) {
    const sourcePath = path.resolve(process.cwd(), options.briefFile);
    directive = (await fs.readFile(sourcePath, 'utf8')).trim();
    if (!directive) throw new Error(`编辑指令文件为空：${sourcePath}`);
  }

  console.log(`[draft] ── ${plannerEngine} 独立选题并锁定编辑任务 ──`);
  if (plannerEngine === 'codex') {
    await createCodexThread().run(buildPlannerPrompt(plannerEngine, planPath, directive));
  } else {
    await runClaudePrompt(buildPlannerPrompt(plannerEngine, planPath, directive));
  }

  const raw = await fs.readFile(planPath, 'utf8').catch(() => '');
  if (!raw) throw new Error(`责任编辑没有生成编辑任务：${planPath}`);
  const brief = parseEditorialBrief(raw);
  validateEditorialBriefPlan(brief, {
    accountExact: config.accountExact,
    date: today,
    expectedDirective: directive,
  });
  console.log(
    `[draft] ${plannerEngine} 独立编辑任务已锁定：${brief.topic}（${brief.contentClass}，${brief.requirements.length} 项必写事实）`
  );
  return { brief, path: planPath };
}

async function findGeneratedArticle(engine: Engine, startedAt: number): Promise<GeneratedDraft> {
  const today = shanghaiToday();
  const entries = await fs.readdir(config.paths.draftsDir, { withFileTypes: true }).catch(() => []);
  const candidates: Array<GeneratedDraft & { mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${today}-`) || !entry.name.endsWith(`__${engine}`)) continue;
    const dir = path.join(config.paths.draftsDir, entry.name);
    const mdPath = await findMainMarkdown(dir, entry.name);
    if (!mdPath) continue;
    const markdown = await fs.readFile(mdPath, 'utf8').catch(() => '');
    if (!markdown || parseMarkdown(markdown, entry.name).postType === '视频号') continue;
    const mtimeMs = (await fs.stat(mdPath)).mtimeMs;
    if (mtimeMs >= startedAt - 2_000) candidates.push({ dir, mdPath, mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates.length !== 1) {
    throw new Error(
      `本轮 ${engine} 应生成且只生成 1 篇公众号稿，实际找到 ${candidates.length} 篇：` +
        candidates.map(candidate => candidate.dir).join('、')
    );
  }
  const candidate = candidates[0];
  if (!candidate) throw new Error(`${engine} 没有生成公众号稿`);
  return { dir: candidate.dir, mdPath: candidate.mdPath };
}

async function assertLockedEditorialBrief(
  briefPath: string,
  lockedBrief: EditorialBrief,
  allowMissing = false
): Promise<void> {
  let diskBrief: EditorialBrief;
  try {
    diskBrief = parseEditorialBrief(await fs.readFile(briefPath, 'utf8'));
  } catch (error) {
    if (allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw new LockedEditorialBriefError(`无法核对本轮锁定编辑任务：${briefPath}`, { cause: error });
  }
  if (JSON.stringify(diskBrief) !== JSON.stringify(lockedBrief)) {
    throw new LockedEditorialBriefError(
      `编辑任务已偏离本轮锁定版本，已停止处理：${briefPath}。不得修改合同以通过正文门禁。`
    );
  }
}

export async function attachEditorialBrief(
  draft: GeneratedDraft,
  planPath: string,
  brief: EditorialBrief
): Promise<void> {
  const targetBrief = path.join(draft.dir, EDITORIAL_BRIEF_FILE);
  await assertLockedEditorialBrief(planPath, brief);
  await assertLockedEditorialBrief(targetBrief, brief, true);
  await fs.copyFile(planPath, targetBrief);
  const original = await fs.readFile(draft.mdPath, 'utf8');
  const marked = upsertFrontmatter(original, {
    auto_quality_gate: true,
    editorial_brief: EDITORIAL_BRIEF_FILE,
  });
  if (marked === original && !original.startsWith('---\n'))
    throw new Error(`自动稿缺少合法 frontmatter：${draft.mdPath}`);
  if (marked !== original) await fs.writeFile(draft.mdPath, marked, 'utf8');
  const markdown = await fs.readFile(draft.mdPath, 'utf8');
  const selfReviewBypass = ['human_writing_reviewed', 'editorial_quality_reviewed'].find(field =>
    /^(1|true|yes|确认|已确认)$/iu.test(readFrontmatterField(markdown, field)?.trim() ?? '')
  );
  if (selfReviewBypass) throw new Error(`自动写稿不得自行设置 ${selfReviewBypass}：${draft.mdPath}`);
}

async function validateGeneratedDraft(draft: GeneratedDraft, brief: EditorialBrief): Promise<void> {
  const markdown = await fs.readFile(draft.mdPath, 'utf8');
  if (readFrontmatterField(markdown, 'editorial_brief') !== EDITORIAL_BRIEF_FILE) {
    throw new LockedEditorialBriefError(`草稿的编辑任务引用已变更：${draft.mdPath}`);
  }
  await assertLockedEditorialBrief(path.join(draft.dir, EDITORIAL_BRIEF_FILE), brief);
  const parsed = parseMarkdown(markdown, path.basename(draft.dir));
  validateEditorialQuality(brief, {
    draftDir: draft.dir,
    markdown,
    title: parsed.title,
    body: parsed.body,
    postType: parsed.postType,
    accountExact: config.accountExact,
  });
  await validateWechatDraftHumanWriting(draft.mdPath, markdown, parsed.postType);
}

export function repairPrompt(
  draft: GeneratedDraft | undefined,
  planPath: string,
  error: unknown,
  contentClass: EditorialBrief['contentClass']
): string {
  const target = draft?.dir ?? config.paths.draftsDir;
  return [
    '刚才的自动稿没有通过质量门禁。继续当前任务，只修公众号稿，不换题、不新建第二篇公众号稿，也不要碰其它草稿。',
    `锁定编辑任务：${planPath}`,
    `要修的目标：${target}`,
    `门禁错误：\n${error instanceof Error ? error.message : String(error)}`,
    EDITORIAL_AUTHORITY_INSTRUCTION,
    WRITING_SCOPE_INSTRUCTION,
    contentClass === 'translation' ? '' : AUTHOR_FACT_BOUNDARY_INSTRUCTION,
    contentClass === 'translation'
      ? '按原文修复审稿指出的漏译、误译或擅自增添内容，保留原文章节、条件、参数、代码和完整提示词。来源中的原话不得为了避开句式检查而删改；无法兼顾时报告具体冲突。只改译文和 sourceAudit，不改来源、编辑任务或独立审稿记录。'
      : '按来源修复正文中的事实、时间线或材料缺漏，删除没有来源的通用建议和空泛影响，同步更新 sourceAudit。只修改本篇正文与来源映射；资源包装由下一阶段处理。',
    '来源覆盖不足时补入已选来源中遗漏的真实细节，或删除空泛段落；仍不足就报告材料不足。不得修改编辑任务或事后新增 requirements，把已有解释、免责声明或执行状态改成计分项。',
    '禁止凑字、机械堆关键词或写 human_writing_reviewed、editorial_quality_reviewed 绕过门禁。',
    READER_REVIEW_INSTRUCTION,
    contentClass === 'translation' ? '' : authorVoiceReviewInstruction(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function prepareAndValidateDraft(
  engine: Engine,
  draft: GeneratedDraft,
  brief: EditorialBrief,
  planPath: string
): Promise<void> {
  await assertLockedEditorialBrief(planPath, brief);
  const runIndependent = async (prompt: string): Promise<void> => {
    if (engine === 'codex') await createCodexThread().run(prompt);
    else await runClaudePrompt(prompt);
  };
  await prepareDraftForValidation({
    contentClass: brief.contentClass,
    packageDraft: async () => {
      const before = await fs.readFile(draft.mdPath, 'utf8');
      await runIndependent(buildPackagingPrompt(draft, brief, planPath));
      assertPackagingPreservesText(before, await fs.readFile(draft.mdPath, 'utf8'));
    },
    attachBrief: () => attachEditorialBrief(draft, planPath, brief),
    reviewTranslation: async () => {
      const markdown = await fs.readFile(draft.mdPath, 'utf8');
      snapshotTranslationSources(draft.dir, brief.sources);
      await runIndependent(
        buildTranslationReviewPrompt(draft, planPath, translationReviewInputs(markdown, brief.sources))
      );
    },
    reviewHumanWriting: () =>
      reviewHumanWritingWarnings({
        markdownPath: draft.mdPath,
        planPath,
        brief,
        runIndependent,
        checkerOptions: { allowNoChinese: brief.contentClass === 'sticker' },
      }),
    validateDraft: () => validateGeneratedDraft(draft, brief),
  });
}

async function runCodexWriter(brief: EditorialBrief, planPath: string): Promise<string> {
  const thread = createCodexThread();
  const startedAt = Date.now();
  let response = (await thread.run(buildPrompt('codex', planPath, brief.contentClass))).finalResponse;
  let draft: GeneratedDraft | undefined;
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      draft ??= await findGeneratedArticle('codex', startedAt);
      await prepareAndValidateDraft('codex', draft, brief, planPath);
      return `${response}\n\n本地草稿检查完成：${draft.dir}`;
    } catch (error) {
      if (error instanceof LockedEditorialBriefError || attempt === MAX_REPAIR_ATTEMPTS) throw error;
      console.warn(`[draft] Codex 第 ${attempt + 1} 次质量检查未通过，自动返修。`);
      response = (await thread.run(repairPrompt(draft, planPath, error, brief.contentClass))).finalResponse;
    }
  }
  throw new Error('Codex 自动返修次数异常');
}

async function runClaudeWriter(brief: EditorialBrief, planPath: string): Promise<string> {
  const startedAt = Date.now();
  let response = await runClaudePrompt(buildPrompt('claude', planPath, brief.contentClass));
  let draft: GeneratedDraft | undefined;
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      draft ??= await findGeneratedArticle('claude', startedAt);
      await prepareAndValidateDraft('claude', draft, brief, planPath);
      return `${response}\n\n本地草稿检查完成：${draft.dir}`;
    } catch (error) {
      if (error instanceof LockedEditorialBriefError || attempt === MAX_REPAIR_ATTEMPTS) throw error;
      console.warn(`[draft] Claude 第 ${attempt + 1} 次质量检查未通过，自动返修。`);
      response = await runClaudePrompt(repairPrompt(draft, planPath, error, brief.contentClass));
    }
  }
  throw new Error('Claude 自动返修次数异常');
}

async function runEngine(engine: Engine, options: DraftOptions): Promise<string> {
  const planned = await planEditorialBrief(options, engine);
  console.log(`[draft] ── ${engine} 按自己的选题出稿 ──`);
  return engine === 'codex'
    ? runCodexWriter(planned.brief, planned.path)
    : runClaudeWriter(planned.brief, planned.path);
}

async function main(): Promise<void> {
  const options = parseDraftOptions(process.argv.slice(2));
  console.log(`[draft] 账号=${config.accountExact} 引擎=${options.engine} 目录=${config.paths.draftsDir}`);
  const engines: Engine[] = options.engine === 'both' ? ['codex', 'claude'] : [options.engine];
  const results = await Promise.allSettled(engines.map(engine => runEngine(engine, options)));
  const failures: string[] = [];
  for (const [index, result] of results.entries()) {
    const engine = engines[index];
    if (!engine) continue;
    if (result.status === 'fulfilled') {
      console.log(result.value);
      continue;
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push(`${engine}：${message}`);
    console.error(`[draft] ${engine} 失败:`, message);
  }
  if (failures.length > 0) throw new Error(`自动出稿未到可交付终点：\n- ${failures.join('\n- ')}`);
  console.log('[draft] 完成：所选引擎已独立选题、写稿与包装，并通过本地合同及文风检查；翻译稿已单独审稿。');
}

if (isMain(import.meta.url)) runCli(main);
