import fs from 'node:fs/promises';
import path from 'node:path';
import { readFrontmatterField } from '../utils/frontmatter.js';
import { EDITORIAL_BRIEF_FILE, parseEditorialBrief } from './editorial-quality.js';
import { collectTranslationReviewErrors } from './editorial-translation.js';
import { type HumanWritingCheckerOptions, inspectHumanWritingDraft } from './human-writing-checker.js';
import { collectHumanWritingReviewErrors } from './human-writing-review.js';
import { collectProsePatternReviewErrors } from './prose-pattern-review.js';
import { formatProseFindings } from './prose-patterns.js';

type HumanWritingGuardOptions = HumanWritingCheckerOptions & {
  reviewedWarnings?: boolean;
  log?: (message: string) => void;
};

export { resolveHumanWritingChecker } from './human-writing-checker.js';

const QUOTE_FIDELITY_WARNING =
  /^- 引用或译文共 \d+ 行（第 \d+(?:、\d+)* 行），需核对原文准确与完整；不能改写原话来清除禁词。确认来源归属后再记录人工复核。$/u;

/** 只承接已独立审稿的引用保真提醒；未知提醒和作者正文提醒仍需逐项处理。 */
async function hasReviewedTranslationQuotes(markdownPath: string, output: string): Promise<boolean> {
  const sections = output.split(/^需要人工判断$/mu);
  if (sections.length !== 2) return false;
  const warnings = sections[1]?.trim().split('\n');
  if (!warnings?.length || !warnings.every(line => QUOTE_FIDELITY_WARNING.test(line))) return false;
  try {
    const draftDir = await fs.realpath(path.dirname(markdownPath));
    const markdown = await fs.readFile(markdownPath, 'utf8');
    const configuredBrief = readFrontmatterField(markdown, 'editorial_brief')?.trim();
    const briefPath = path.resolve(draftDir, configuredBrief || EDITORIAL_BRIEF_FILE);
    const inside = (target: string) => target.startsWith(`${draftDir}${path.sep}`);
    if (!inside(briefPath) || !inside(await fs.realpath(briefPath))) return false;
    const brief = parseEditorialBrief(await fs.readFile(briefPath, 'utf8'));
    return (
      brief.contentClass === 'translation' && collectTranslationReviewErrors(brief, { draftDir, markdown }).length === 0
    );
  } catch {
    return false;
  }
}

export async function validateHumanWritingDraft(
  markdownPath: string,
  options: HumanWritingGuardOptions = {}
): Promise<void> {
  const inspection = await inspectHumanWritingDraft(markdownPath, options);
  const patternErrors = await collectProsePatternReviewErrors(markdownPath, inspection);
  if (patternErrors.length) {
    throw new Error(
      `表达检查待复核，已阻止上传草稿箱：${markdownPath}\n${formatProseFindings(inspection.proseFindings)}\n` +
        `${patternErrors.join('\n')}\n` +
        'human_writing_reviewed 不能跳过这些提醒。运行 pnpm check-prose -- <主稿路径> 获取未审模板；修改后重跑，或逐处完成有版本绑定的复核。'
    );
  }
  if (inspection.skippedNoChinese) {
    options.log?.('去 AI 味检查跳过：贴图没有可检查的中文正文。');
    return;
  }

  const quoteFidelityReviewed =
    inspection.warnings.length > 0 &&
    !options.reviewedWarnings &&
    (await hasReviewedTranslationQuotes(markdownPath, inspection.stdout));
  const styleReviewErrors =
    inspection.warnings.length > 0 && !options.reviewedWarnings && !quoteFidelityReviewed
      ? await collectHumanWritingReviewErrors(markdownPath, inspection)
      : [];
  if (styleReviewErrors.length) {
    throw new Error(
      `去 AI 味检查存在人工判断项，已阻止上传草稿箱：${markdownPath}\n${inspection.stdout}\n` +
        `${styleReviewErrors.join('\n')}\n` +
        '逐项确认或修改后，在 frontmatter 写 human_writing_reviewed: true 再重试；pnpm draft 自动生成入口不得作者自签，需有效独立文风审稿记录。'
    );
  }

  if (quoteFidelityReviewed) options.log?.('引用保真提醒已对应本篇独立翻译审稿记录。');
  else if (inspection.warnings.length && !options.reviewedWarnings)
    options.log?.('作者文风提醒已对应当前独立逐项复核记录。');
  if (inspection.proseFindings.length) options.log?.('表达提醒已逐处记录作用与删句损失，并与当前正文版本核对。');
  options.log?.(`去 AI 味检查通过：${markdownPath}\n${inspection.stdout}`);
}

export async function validateWechatDraftHumanWriting(
  markdownPath: string,
  markdown: string,
  postType: string | undefined
): Promise<void> {
  const reviewedWarnings = /^(1|true|yes|确认|已确认)$/iu.test(
    readFrontmatterField(markdown, 'human_writing_reviewed')?.trim() ?? ''
  );
  await validateHumanWritingDraft(markdownPath, {
    reviewedWarnings,
    allowNoChinese: postType === '贴图',
    log: message => console.log(message),
  });
}
