import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { stripLeadingTitleHeading } from '../build-publish-html.js';
import { collectEditorialProcessRequirementErrors } from './editorial-process-guard.js';
import { readTutorialExpressionReview } from './tutorial-expression-review.js';

export const NEWS_GROUNDING_MIN_REQUIREMENT_IDS = 6;
export const NEWS_GROUNDING_MIN_BLOCKS = 4;
export const NEWS_GROUNDING_CREDIT_PER_ID = 110;
export const NEWS_GROUNDING_MAX_UNGROUNDED_UNITS = 200;
export const NEWS_GROUNDING_MAX_UNGROUNDED_RATIO = 0.25;
export const NEWS_GROUNDING_MAX_UNGROUNDED_BLOCK_UNITS = 120;
const REQUIRED_SOURCE_AUDIT = 'internal-audit/source-audit.md';
const editorialMarkdown = new MarkdownIt({ html: true });

type TermGroup = { anyOf: readonly string[] };

export type EditorialGroundingRequirement = {
  id: string;
  allOf: readonly TermGroup[];
};

type GroundingContractRequirement = EditorialGroundingRequirement & {
  description?: string;
  scope: 'title' | 'body' | 'all';
  sourceIds: readonly string[];
};

type GroundingContract = {
  version: 1 | 2;
  contentClass: 'sticker' | 'brief' | 'analysis' | 'tutorial' | 'review' | 'translation';
  sourceAudit?: string;
  substanceRequirementIds?: readonly string[];
  sources: readonly { id: string; path: string }[];
  requirements: readonly GroundingContractRequirement[];
};

export type EditorialGroundingResult = {
  totalUnits: number;
  matchedBlockUnits: number;
  groundedCredit: number;
  ungroundedUnits: number;
  allowedUngroundedUnits: number;
  matchedRequirementIds: string[];
  matchedBlockCount: number;
  maxUngroundedBlockUnits: number;
  reviewedExpressionUnits?: number;
};

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function withoutMarkdownHeadings(value: string): string {
  const lines = value.split('\n');
  // 按 Markdown 语法识别标题，避免把代码里的 # 注释误删；标题不能充当正文事实。
  for (const token of editorialMarkdown.parse(value, {})) {
    if (token.type !== 'heading_open' || !token.map) continue;
    const [start, end] = token.map;
    for (let index = start; index < end; index += 1) lines[index] = '';
  }
  return lines.join('\n');
}

function cleanEditorialMarkup(value: string): string {
  return withoutMarkdownHeadings(value)
    .replace(/<a\b(?=[^>]*(?:data-miniprogram-appid|weapp_text_link))[^>]*>[\s\S]*?<\/a>/giu, '')
    .replace(/<\/?(?:p|section|article|blockquote|li|h[1-6])\b[^>]*>/giu, '\n\n')
    .replace(/^[ \t]{0,3}(?:`{3,}|~{3,})[^\n]*$/gmu, '')
    .replace(/!\[\[[^\]\n]+\]\]/gu, '')
    .replace(/!\[[^\]\n]*\]\([^)\n]+\)/gu, '')
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/gu, '$1')
    .replace(/https?:\/\/[\u0021-\u0028\u002A-\u003D\u003F-\u007E]+/gu, '')
    .replace(/<[^>]*>/gu, '')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/[`*_>#]/gu, ' ');
}

function countUnits(value: string): number {
  const han = value.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  const alphanumericTokens = value.match(/[A-Za-z0-9]+/gu)?.length ?? 0;
  return han + alphanumericTokens;
}

export function countEditorialSubstantiveUnits(body: string, title: string): number {
  return countUnits(cleanEditorialMarkup(stripLeadingTitleHeading(body, title)));
}

export function editorialBlocks(body: string, title: string): Array<{ text: string; units: number }> {
  const visible = cleanEditorialMarkup(stripLeadingTitleHeading(body, title));
  return visible
    .split(/\n[ \t]*\n+|(?=^[ \t]*(?:[-+*]|\d+[.)])\s+)/gmu)
    .map(text => text.trim())
    .filter(Boolean)
    .map(text => ({ text, units: countUnits(text) }))
    .filter(block => block.units > 0);
}

function blockMatchesRequirement(block: string, requirement: EditorialGroundingRequirement): boolean {
  const normalizedBlock = normalize(block);
  return requirement.allOf.every(group => group.anyOf.some(term => normalizedBlock.includes(normalize(term))));
}

export function evaluateEditorialGrounding(input: {
  body: string;
  title: string;
  requirements: readonly EditorialGroundingRequirement[];
  reviewedExpressionBlocks?: ReadonlySet<number>;
}): EditorialGroundingResult {
  const blocks = editorialBlocks(input.body, input.title);
  const matchedRequirementIds = new Set<string>();
  let matchedBlockUnits = 0;
  let matchedBlockCount = 0;
  let maxUngroundedBlockUnits = 0;
  let reviewedExpressionUnits = 0;

  for (const [index, block] of blocks.entries()) {
    if (input.reviewedExpressionBlocks?.has(index)) {
      reviewedExpressionUnits += block.units;
      continue;
    }
    const matches = input.requirements.filter(requirement => blockMatchesRequirement(block.text, requirement));
    if (matches.length === 0) {
      maxUngroundedBlockUnits = Math.max(maxUngroundedBlockUnits, block.units);
      continue;
    }
    matchedBlockCount += 1;
    matchedBlockUnits += block.units;
    for (const requirement of matches) matchedRequirementIds.add(requirement.id);
  }

  const totalUnits = blocks.reduce((sum, block) => sum + block.units, 0);
  const groundedCredit = Math.min(matchedBlockUnits, matchedRequirementIds.size * NEWS_GROUNDING_CREDIT_PER_ID);
  const factualUnits = totalUnits - reviewedExpressionUnits;
  const ungroundedUnits = Math.max(0, factualUnits - groundedCredit);
  const allowedUngroundedUnits = Math.min(
    NEWS_GROUNDING_MAX_UNGROUNDED_UNITS,
    Math.floor(factualUnits * NEWS_GROUNDING_MAX_UNGROUNDED_RATIO)
  );

  return {
    totalUnits,
    matchedBlockUnits,
    groundedCredit,
    ungroundedUnits,
    allowedUngroundedUnits,
    matchedRequirementIds: [...matchedRequirementIds],
    matchedBlockCount,
    maxUngroundedBlockUnits,
    ...(reviewedExpressionUnits ? { reviewedExpressionUnits } : {}),
  };
}

export function collectV2GroundingContractErrors(brief: GroundingContract, validateLocalSources: boolean): string[] {
  const errors = collectEditorialProcessRequirementErrors(brief.requirements);
  if (brief.version !== 2) return errors;

  if (validateLocalSources) {
    for (const source of brief.sources) {
      if (!path.isAbsolute(source.path)) {
        errors.push(`v2 编辑任务来源必须是绝对路径：${source.id}=${source.path}`);
        continue;
      }
      const stat = fs.statSync(source.path, { throwIfNoEntry: false });
      if (!stat?.isFile()) errors.push(`v2 编辑任务来源文件不存在：${source.id}=${source.path}`);
    }
  }

  if (brief.contentClass === 'sticker') return errors;
  if (brief.sourceAudit !== REQUIRED_SOURCE_AUDIT) {
    errors.push(`v2 文章 sourceAudit 必须为 ${REQUIRED_SOURCE_AUDIT}`);
  }

  const ids = brief.substanceRequirementIds ?? [];
  if (ids.length < NEWS_GROUNDING_MIN_REQUIREMENT_IDS) {
    errors.push(`v2 文章 substanceRequirementIds 至少需要 ${NEWS_GROUNDING_MIN_REQUIREMENT_IDS} 个`);
  }
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length > 0) {
    errors.push(`v2 文章 substanceRequirementIds 重复：${duplicateIds.join('、')}`);
  }

  const requirements = new Map(brief.requirements.map(requirement => [requirement.id, requirement]));
  const sourceIds = new Set(brief.sources.map(source => source.id));
  for (const id of ids) {
    const requirement = requirements.get(id);
    if (!requirement) {
      errors.push(`v2 文章 substanceRequirementIds 引用了不存在的 requirement：${id}`);
      continue;
    }
    if (requirement.scope !== 'body' && requirement.scope !== 'all') {
      errors.push(`v2 文章实质 requirement 只能使用 body/all scope：${id}`);
    }
    if (requirement.allOf.length < 2) {
      errors.push(`v2 文章实质 requirement 至少需要 2 个 allOf：${id}`);
    }
    const missing = requirement.sourceIds.filter(sourceId => !sourceIds.has(sourceId));
    if (requirement.sourceIds.length === 0 || missing.length > 0) {
      errors.push(
        `v2 文章实质 requirement 未绑定真实 sourceIds：${id}${missing.length ? ` (${missing.join('、')})` : ''}`
      );
    }
  }
  return errors;
}

export function collectV2SourceAuditAndGroundingErrors(
  brief: GroundingContract,
  input: { draftDir: string; body: string; title: string; postType?: string }
): string[] {
  if (brief.version !== 2 || brief.contentClass === 'sticker' || input.postType === '贴图') return [];
  const errors: string[] = [];
  const configuredAudit = brief.sourceAudit ?? '';
  const draftRoot = path.resolve(input.draftDir);
  const auditPath = path.resolve(draftRoot, configuredAudit);
  if (!isInside(draftRoot, auditPath)) {
    return [`sourceAudit 必须位于当前草稿目录内：${configuredAudit}`];
  }
  const auditStat = fs.statSync(auditPath, { throwIfNoEntry: false });
  if (!auditStat?.isFile()) return [`sourceAudit 不存在：${auditPath}`];
  const realDraftRoot = fs.realpathSync(draftRoot);
  const realAuditPath = fs.realpathSync(auditPath);
  if (!isInside(realDraftRoot, realAuditPath)) {
    return [`sourceAudit 不能通过符号链接离开当前草稿目录：${configuredAudit}`];
  }

  const sourceAudit = fs.readFileSync(realAuditPath, 'utf8');
  const auditLines = sourceAudit.split(/\r?\n/u);
  const requirementMap = new Map(brief.requirements.map(requirement => [requirement.id, requirement]));
  const substanceRequirements = (brief.substanceRequirementIds ?? [])
    .map(id => requirementMap.get(id))
    .filter((requirement): requirement is GroundingContractRequirement => Boolean(requirement));
  for (const requirement of substanceRequirements) {
    const mapped = auditLines.some(
      line => line.includes(requirement.id) && requirement.sourceIds.every(sourceId => line.includes(sourceId))
    );
    if (!mapped) errors.push(`sourceAudit 未在同一行列出 requirement 与 sourceIds：${requirement.id}`);
  }

  let reviewedExpressionBlocks: Set<number> | undefined;
  try {
    reviewedExpressionBlocks = readTutorialExpressionReview({
      ...input,
      brief,
      sourceAudit,
      blocks: editorialBlocks(input.body, input.title),
    });
  } catch (error) {
    errors.push(`教程表达审阅无效：${error instanceof Error ? error.message : String(error)}`);
  }
  const grounding = evaluateEditorialGrounding({
    body: input.body,
    title: input.title,
    requirements: substanceRequirements,
    reviewedExpressionBlocks,
  });
  if (grounding.matchedRequirementIds.length < NEWS_GROUNDING_MIN_REQUIREMENT_IDS) {
    errors.push(
      `正文仅命中 ${grounding.matchedRequirementIds.length} 个不同实质 requirement，` +
        `至少需要 ${NEWS_GROUNDING_MIN_REQUIREMENT_IDS} 个`
    );
  }
  if (grounding.matchedBlockCount < NEWS_GROUNDING_MIN_BLOCKS) {
    errors.push(`正文仅 ${grounding.matchedBlockCount} 个事实锚定段，至少需要 ${NEWS_GROUNDING_MIN_BLOCKS} 个`);
  }
  if (grounding.ungroundedUnits > grounding.allowedUngroundedUnits) {
    errors.push(
      `正文未锚定内容 ${grounding.ungroundedUnits} 单位，最多允许 ${grounding.allowedUngroundedUnits}；` +
        `锚定计分 ${grounding.groundedCredit}/${grounding.totalUnits}`
    );
  }
  if (grounding.maxUngroundedBlockUnits > NEWS_GROUNDING_MAX_UNGROUNDED_BLOCK_UNITS) {
    errors.push(
      `正文单个完全未锚定段 ${grounding.maxUngroundedBlockUnits} 单位，` +
        `最多允许 ${NEWS_GROUNDING_MAX_UNGROUNDED_BLOCK_UNITS}`
    );
  }
  return errors;
}
