import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parseMarkdown } from '../build-publish-html.js';
import { accountPolicy } from '../config/account-policy.js';
import { getOperatorAccount } from '../config/operator-profile.js';
import { readFrontmatterField } from '../utils/frontmatter.js';
import {
  collectV2GroundingContractErrors,
  collectV2SourceAuditAndGroundingErrors,
  countEditorialSubstantiveUnits,
} from './editorial-grounding.js';
import { collectTranslationReviewErrors } from './editorial-translation.js';

export { countEditorialSubstantiveUnits } from './editorial-grounding.js';

export const EDITORIAL_BRIEF_FILE = 'editorial-brief.json';
export const NEWS_SUBSTANTIVE_MIN = 800;
export const NEWS_SUBSTANTIVE_MAX = 10000;
const EXISTING_DRAFT_META_FILE = '.wechat-draft.json';
const LEGACY_BRIEF_LAST_DATE = '2026-08-28';

const termGroupSchema = z.object({
  anyOf: z.array(z.string().trim().min(1)).min(1),
});

const sourceSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  path: z.string().trim().min(1),
  evidence: z.string().trim().min(4),
});

const candidateSchema = z.object({
  topic: z.string().trim().min(2),
  selected: z.boolean(),
  reason: z.string().trim().min(4),
  sourceIds: z.array(z.string().trim().min(1)).min(1),
});

const requirementSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().trim().min(4),
  scope: z.enum(['title', 'body', 'all']).default('body'),
  allOf: z.array(termGroupSchema).min(1),
  sourceIds: z.array(z.string().trim().min(1)).min(1),
});

const forbiddenClaimSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().trim().min(4),
  scope: z.enum(['title', 'body', 'all']).default('all'),
  anyOf: z.array(z.string().trim().min(2)).min(1),
});

const minimumsSchema = z
  .object({
    substantiveUnits: z.number().int().nonnegative().optional(),
    bodyImages: z.number().int().nonnegative().optional(),
    sources: z.number().int().nonnegative().optional(),
    requirements: z.number().int().nonnegative().optional(),
  })
  .optional();

export const editorialBriefSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  account: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  selectionMode: z.enum(['user_locked', 'autonomous']),
  userDirective: z.preprocess(
    value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional()
  ),
  contentClass: z.enum(['sticker', 'brief', 'analysis', 'tutorial', 'review', 'translation']),
  topic: z.string().trim().min(2),
  primarySignal: z.string().trim().min(8),
  whyNow: z.string().trim().min(8),
  readerPromise: z.string().trim().min(8),
  titleTerms: z.array(termGroupSchema).min(1),
  sources: z.array(sourceSchema).min(1),
  candidates: z.array(candidateSchema).min(1),
  requirements: z.array(requirementSchema).min(1),
  forbiddenClaims: z.array(forbiddenClaimSchema).default([]),
  minimums: minimumsSchema,
  sourceAudit: z.string().trim().min(1).optional(),
  substanceRequirementIds: z.array(z.string().trim().min(1)).optional(),
});

export type EditorialBrief = z.infer<typeof editorialBriefSchema>;
export type EditorialQualityInput = {
  draftDir: string;
  markdown: string;
  title: string;
  body: string;
  postType: string | undefined;
  accountExact: string;
};
export type EditorialBriefContext = {
  accountExact: string;
  date: string;
  expectedDirective?: string;
};

type ContentClass = EditorialBrief['contentClass'];
type Scope = 'title' | 'body' | 'all';

const CLASS_MINIMUMS: Record<
  ContentClass,
  { substantiveUnits: number; bodyImages: number; sources: number; requirements: number }
> = {
  sticker: { substantiveUnits: 10, bodyImages: 1, sources: 1, requirements: 1 },
  brief: { substantiveUnits: NEWS_SUBSTANTIVE_MIN, bodyImages: 1, sources: 2, requirements: 3 },
  analysis: { substantiveUnits: NEWS_SUBSTANTIVE_MIN, bodyImages: 3, sources: 3, requirements: 5 },
  tutorial: { substantiveUnits: NEWS_SUBSTANTIVE_MIN, bodyImages: 3, sources: 2, requirements: 5 },
  review: { substantiveUnits: NEWS_SUBSTANTIVE_MIN, bodyImages: 3, sources: 2, requirements: 5 },
  translation: { substantiveUnits: NEWS_SUBSTANTIVE_MIN, bodyImages: 0, sources: 1, requirements: 6 },
};

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function isTrue(value: string | undefined): boolean {
  return /^(1|true|yes|确认|已确认)$/iu.test(value?.trim() ?? '');
}

export function hasExplicitStickerRequest(directive: string | undefined, accountExact?: string): boolean {
  if (!directive) return false;
  const account = getOperatorAccount(accountExact);
  const aliases = [accountExact, account?.name, account?.id, ...(account?.aliases ?? [])].filter(
    (value): value is string => Boolean(value)
  );
  const names = aliases.map(value => value.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('zh-CN'));
  const clauses = directive
    .normalize('NFKC')
    .split(/[，,。！？!?；;\n]/u)
    .map(clause => clause.replace(/\s+/gu, '').toLocaleLowerCase('zh-CN'))
    .map(clause => names.reduce((value, name) => value.replace(name, ''), clause))
    .filter(Boolean);
  const stickerTerm = /(?:贴图|图片消息|newspic)/iu;
  const conditionalOrNegative = /(?:不要|别|不准|禁止|默认|除非|如果|若|只有|是否|能否|可否|允许)/u;
  const directRequest =
    /^(?:今天|这次|本次|当前)?(?:这篇|这条|这个)?(?:请|要|就|直接|给我|麻烦)?(?:发|做|出|用|改成|换成|制作|上传|发布)?(?:一张|这张|这条|这个|成|为)?(?:多图)?(?:贴图|图片消息|newspic)(?:稿|形式|模式|载体)?(?:\(封面\+数据图\))?(?:吧|啊|即可|就行)?$/iu;
  const reverseRequest =
    /^(?:今天|这次|本次|当前)?(?:这篇|这条|这个)?(?:贴图|图片消息|newspic)(?:稿|形式|模式|载体)?(?:发|做|出|发布|上传)(?:一下|吧|啊)?$/iu;
  const draftDeliveryRequest =
    /(?:^|你)(?:给我|帮我)?(?:搞|做|出|制作)(?:一篇|一张|一组|一套)(?:多图)?(?:贴图|图片消息|newspic)(?:发|放|上传)(?:到|进)(?:公众号)?草稿箱(?:去|里)?$/iu;
  const quotedExample = /(?:比如|例如|示例|他说|她说|原话|[“”"'「」『』])/u;
  return clauses.some(
    clause =>
      stickerTerm.test(clause) &&
      !conditionalOrNegative.test(clause) &&
      (directRequest.test(clause) ||
        reverseRequest.test(clause) ||
        (!quotedExample.test(clause) && draftDeliveryRequest.test(clause)))
  );
}

export function validateAccountPostTypePolicy(input: {
  accountExact: string;
  postType: string | undefined;
  brief: EditorialBrief | undefined;
}): void {
  if (!accountPolicy(input.accountExact).newsOnly || input.postType !== '贴图') return;
  if (
    input.brief?.selectionMode === 'user_locked' &&
    hasExplicitStickerRequest(input.brief.userDirective, input.accountExact)
  )
    return;
  throw new Error(
    `${input.accountExact} 载体硬规则：默认只能上传文章(news)。` +
      `贴图(newspic)必须由本次 user_locked 的 userDirective 明确要求“发贴图”；` +
      '“除非我要求贴图”这类规则说明不构成本次贴图指令。'
  );
}

function textForScope(input: Pick<EditorialQualityInput, 'title' | 'body'>, scope: Scope): string {
  if (scope === 'title') return input.title;
  if (scope === 'body') return input.body;
  return `${input.title}\n${input.body}`;
}

function containsTerm(text: string, term: string): boolean {
  return normalize(text).includes(normalize(term));
}

function collectNewsLengthErrors(
  input: Pick<EditorialQualityInput, 'body' | 'markdown' | 'postType' | 'title'>,
  errors: string[]
): void {
  if (input.postType === '贴图' || input.postType === '视频' || input.postType === '视频号') return;
  const units = countEditorialSubstantiveUnits(input.body, input.title);
  if (units < NEWS_SUBSTANTIVE_MIN || units > NEWS_SUBSTANTIVE_MAX) {
    errors.push(`公众号文章有效正文 ${units} 单位，要求 ${NEWS_SUBSTANTIVE_MIN}~${NEWS_SUBSTANTIVE_MAX}`);
  }
}

export function validateWechatArticleLength(
  input: Pick<EditorialQualityInput, 'body' | 'markdown' | 'postType' | 'title'>
): void {
  const errors: string[] = [];
  collectNewsLengthErrors(input, errors);
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

function bodyImageCount(body: string): number {
  const images = new Set<string>();
  for (const match of body.matchAll(/!\[\[([^\]\n]+)\]\]/gu)) {
    if (match[1]) images.add(match[1].split('|')[0]?.trim() ?? match[1].trim());
  }
  for (const match of body.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/gu)) {
    if (match[1]) images.add(match[1].trim());
  }
  return images.size;
}

function duplicateIds(values: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) duplicates.add(value.id);
    seen.add(value.id);
  }
  return [...duplicates];
}

function effectiveMinimums(brief: EditorialBrief): (typeof CLASS_MINIMUMS)[ContentClass] {
  const floor = CLASS_MINIMUMS[brief.contentClass];
  return {
    substantiveUnits: Math.max(floor.substantiveUnits, brief.minimums?.substantiveUnits ?? 0),
    bodyImages: Math.max(floor.bodyImages, brief.minimums?.bodyImages ?? 0),
    sources: Math.max(floor.sources, brief.minimums?.sources ?? 0),
    requirements: Math.max(floor.requirements, brief.minimums?.requirements ?? 0),
  };
}

function folderDate(draftDir: string): string | undefined {
  return path.basename(draftDir).match(/^(\d{4}-\d{2}-\d{2})-/u)?.[1];
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function collectBriefPlanErrors(
  brief: EditorialBrief,
  context: EditorialBriefContext,
  validateLocalSources = false
): string[] {
  const errors: string[] = [];
  if (brief.version === 1 && brief.date > LEGACY_BRIEF_LAST_DATE) {
    errors.push(`editorial-brief version 1 仅允许日期不晚于 ${LEGACY_BRIEF_LAST_DATE}`);
  }
  if (normalize(brief.account) !== normalize(context.accountExact)) {
    errors.push(`编辑任务账号=${brief.account}，当前账号=${context.accountExact}`);
  }
  if (brief.date !== context.date) {
    errors.push(`编辑任务日期=${brief.date}，目标日期=${context.date}`);
  }
  if (brief.selectionMode === 'user_locked' && !brief.userDirective) {
    errors.push('user_locked 编辑任务缺少 userDirective');
  }
  if (context.expectedDirective !== undefined) {
    if (brief.selectionMode !== 'user_locked') errors.push('收到用户指令后 selectionMode 必须是 user_locked');
    if (brief.userDirective !== context.expectedDirective) errors.push('编辑任务没有逐字保留本次用户指令');
  }
  if (brief.selectionMode === 'autonomous' && brief.candidates.length < 3) {
    errors.push(`自主选题只比较了 ${brief.candidates.length} 个候选，至少需要 3 个`);
  }
  const selected = brief.candidates.filter(candidate => candidate.selected);
  if (selected.length !== 1) errors.push(`候选题必须且只能选中 1 个，当前为 ${selected.length} 个`);
  if (selected[0] && normalize(selected[0].topic) !== normalize(brief.topic)) {
    errors.push(`选中候选「${selected[0].topic}」与锁定主题「${brief.topic}」不一致`);
  }

  const allIdentified = [...brief.sources, ...brief.requirements, ...brief.forbiddenClaims];
  const duplicates = duplicateIds(allIdentified);
  if (duplicates.length > 0) errors.push(`编辑任务存在重复 id：${duplicates.join('、')}`);

  const sourceIds = new Set(brief.sources.map(source => source.id));
  const referencedSourceIds = [
    ...brief.candidates.flatMap(candidate => candidate.sourceIds),
    ...brief.requirements.flatMap(requirement => requirement.sourceIds),
  ];
  const missingSourceIds = [...new Set(referencedSourceIds.filter(sourceId => !sourceIds.has(sourceId)))];
  if (missingSourceIds.length > 0) errors.push(`编辑任务引用了不存在的来源：${missingSourceIds.join('、')}`);

  errors.push(...collectV2GroundingContractErrors(brief, validateLocalSources));
  if (brief.contentClass === 'translation' && brief.version !== 2) {
    errors.push('翻译稿必须使用 version 2 来源合同');
  }

  const minimums = effectiveMinimums(brief);
  const requestedSubstantiveUnits = brief.minimums?.substantiveUnits;
  if (
    brief.contentClass !== 'sticker' &&
    requestedSubstantiveUnits !== undefined &&
    requestedSubstantiveUnits !== 0 &&
    requestedSubstantiveUnits !== NEWS_SUBSTANTIVE_MIN
  ) {
    errors.push(
      `公众号文章（含周刊）有效正文统一为 ${NEWS_SUBSTANTIVE_MIN}~${NEWS_SUBSTANTIVE_MAX} 单位；` +
        `minimums.substantiveUnits 只能填 0 或 ${NEWS_SUBSTANTIVE_MIN}`
    );
  }
  if (brief.sources.length < minimums.sources) {
    errors.push(`编辑任务仅 ${brief.sources.length} 个来源，${brief.contentClass} 至少需要 ${minimums.sources} 个`);
  }
  if (brief.requirements.length < minimums.requirements) {
    errors.push(
      `编辑任务仅 ${brief.requirements.length} 项必写事实，${brief.contentClass} 至少需要 ${minimums.requirements} 项`
    );
  }
  return errors;
}

function validateBriefStructure(brief: EditorialBrief, input: EditorialQualityInput, errors: string[]): void {
  const expectedDate = folderDate(input.draftDir) ?? brief.date;
  errors.push(...collectBriefPlanErrors(brief, { accountExact: input.accountExact, date: expectedDate }));

  const isSticker = input.postType === '贴图';
  if (isSticker !== (brief.contentClass === 'sticker')) {
    errors.push(`载体与编辑任务不一致：post_type=${input.postType ?? '图文'}，contentClass=${brief.contentClass}`);
  }
}

function validateRequirements(brief: EditorialBrief, input: EditorialQualityInput, errors: string[]): void {
  for (const [index, group] of brief.titleTerms.entries()) {
    if (!group.anyOf.some(term => containsTerm(input.title, term))) {
      errors.push(`标题缺少第 ${index + 1} 组核心词（${group.anyOf.join(' / ')}）`);
    }
  }

  for (const requirement of brief.requirements) {
    const scopedText = textForScope(input, requirement.scope);
    const missingGroups = requirement.allOf.filter(group => !group.anyOf.some(term => containsTerm(scopedText, term)));
    if (missingGroups.length > 0) {
      errors.push(
        `缺少必写事实 ${requirement.id}「${requirement.description}」：${missingGroups
          .map(group => group.anyOf.join(' / '))
          .join('；')}`
      );
    }
  }

  for (const claim of brief.forbiddenClaims) {
    const scopedText = textForScope(input, claim.scope);
    const hit = claim.anyOf.find(term => containsTerm(scopedText, term));
    if (hit) errors.push(`命中禁写结论 ${claim.id}「${claim.description}」：${hit}`);
  }
}

function validateMinimums(brief: EditorialBrief, input: EditorialQualityInput, errors: string[]): void {
  const minimums = effectiveMinimums(brief);
  const units = countEditorialSubstantiveUnits(input.body, input.title);
  const images = bodyImageCount(input.body);
  if (brief.contentClass === 'sticker' && units < minimums.substantiveUnits) {
    errors.push(`有效正文仅 ${units} 单位，${brief.contentClass} 至少需要 ${minimums.substantiveUnits}`);
  }
  collectNewsLengthErrors(input, errors);
  if (images < minimums.bodyImages) {
    errors.push(`正文仅 ${images} 张图，${brief.contentClass} 至少需要 ${minimums.bodyImages} 张`);
  }
}

export function parseEditorialBrief(raw: string): EditorialBrief {
  const json: unknown = JSON.parse(raw);
  return editorialBriefSchema.parse(json);
}

export function validateEditorialBriefPlan(brief: EditorialBrief, context: EditorialBriefContext): void {
  const errors = collectBriefPlanErrors(brief, context, true);
  if (errors.length > 0) throw new Error(`编辑任务不合格：\n- ${errors.join('\n- ')}`);
}

export function validateEditorialQuality(brief: EditorialBrief, input: EditorialQualityInput): void {
  const errors: string[] = [];
  validateBriefStructure(brief, input, errors);
  validateRequirements(brief, input, errors);
  validateMinimums(brief, input, errors);
  errors.push(...collectV2SourceAuditAndGroundingErrors(brief, input));
  errors.push(...collectTranslationReviewErrors(brief, input));
  if (errors.length > 0) {
    throw new Error(`编辑质量门禁未通过，已阻止自动稿上传：\n- ${errors.join('\n- ')}`);
  }
}

export async function validateAutomatedDraftEditorialQuality(
  input: EditorialQualityInput
): Promise<EditorialBrief | undefined> {
  const automatedFolder = /__(?:codex|claude)$/u.test(path.basename(input.draftDir));
  const marked = isTrue(readFrontmatterField(input.markdown, 'auto_quality_gate'));
  const explicitlyReviewed = isTrue(readFrontmatterField(input.markdown, 'editorial_quality_reviewed'));
  const configuredBrief = readFrontmatterField(input.markdown, 'editorial_brief')?.trim();
  const draftRoot = path.resolve(input.draftDir);
  const briefPath = path.resolve(draftRoot, configuredBrief || EDITORIAL_BRIEF_FILE);
  if (!isInside(draftRoot, briefPath)) {
    throw new Error(`editorial_brief 必须位于当前草稿目录内，已阻止读取：${configuredBrief}`);
  }
  const briefExists = (await fs.stat(briefPath).catch(() => undefined))?.isFile() ?? false;

  if (!automatedFolder && !marked && !briefExists) {
    validateWechatArticleLength(input);
    return undefined;
  }
  if (!briefExists) {
    const existingDraftMeta = (
      await fs.stat(path.join(draftRoot, EXISTING_DRAFT_META_FILE)).catch(() => undefined)
    )?.isFile();
    if (explicitlyReviewed && existingDraftMeta) {
      validateWechatArticleLength(input);
      console.log(`编辑质量门禁：旧自动稿已人工确认，未找到 ${EDITORIAL_BRIEF_FILE}。`);
      return undefined;
    }
    throw new Error(
      `自动稿缺少 ${EDITORIAL_BRIEF_FILE}，已阻止上传。` +
        '请先补齐当天主题、时间线、必写事实、对比项和禁写结论；' +
        '只有已存在微信草稿元数据的旧稿，人工逐项确认后才可写 editorial_quality_reviewed: true。'
    );
  }

  const [realDraftRoot, realBriefPath] = await Promise.all([fs.realpath(draftRoot), fs.realpath(briefPath)]);
  if (!isInside(realDraftRoot, realBriefPath)) {
    throw new Error(`editorial_brief 不能通过符号链接离开当前草稿目录，已阻止读取：${configuredBrief}`);
  }

  const raw = await fs.readFile(briefPath, 'utf8');
  let brief: EditorialBrief;
  try {
    brief = parseEditorialBrief(raw);
  } catch (error) {
    throw new Error(
      `编辑任务格式错误，已阻止上传：${briefPath}\n${error instanceof Error ? error.message : String(error)}`
    );
  }
  validateEditorialQuality(brief, input);
  console.log(
    `编辑合同机械校验通过：${brief.contentClass}，${brief.requirements.length} 项必写事实，` +
      `${brief.sources.length} 个来源，${brief.candidates.length} 个候选。`
  );
  return brief;
}

export async function validateAutomatedDraftQuality(
  draftDir: string,
  markdown: string,
  title: string,
  postType: string | undefined,
  accountExact: string
): Promise<EditorialBrief | undefined> {
  return validateAutomatedDraftEditorialQuality({
    draftDir,
    markdown,
    title,
    body: parseMarkdown(markdown, path.basename(draftDir)).body,
    postType,
    accountExact,
  });
}
