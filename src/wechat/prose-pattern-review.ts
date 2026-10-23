import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { type HumanWritingInspection, humanWritingSha256 } from './human-writing-checker.js';
import { PROSE_PATTERN_VERSION } from './prose-patterns.js';

export const PROSE_PATTERN_REVIEW_FILE = 'prose-pattern-review.json';
const specificReason = z
  .string()
  .trim()
  .min(12)
  .refine(
    value =>
      !/^(?:已核对|已确认|没有问题|无问题|保留|通过|符合作者风格|推进情绪|形成呼应|保持节奏)[。！.!\s]*$/u.test(value)
  );
const reviewSchema = z.strictObject({
  version: z.literal(1),
  articleSha256: z.string(),
  checkerSha256: z.string(),
  rulesVersion: z.literal(PROSE_PATTERN_VERSION),
  findingsSha256: z.string(),
  findings: z
    .array(
      z.strictObject({
        id: z.string(),
        decision: z.enum(['retain', 'revise']),
        evidence: z
          .array(
            z.strictObject({
              line: z.number().int().positive(),
              excerpt: z.string().min(1),
              purpose: specificReason,
              removalCost: specificReason,
            })
          )
          .min(1),
      })
    )
    .min(1),
  issues: z.array(z.string().trim().min(1)),
});

/** 只生成未审模板；pending 和空理由不能被上传门禁接受。 */
export function buildProsePatternReviewTemplate(inspection: HumanWritingInspection) {
  return {
    version: 1,
    articleSha256: inspection.articleSha256,
    checkerSha256: inspection.checkerSha256,
    rulesVersion: PROSE_PATTERN_VERSION,
    findingsSha256: humanWritingSha256(JSON.stringify(inspection.proseFindings)),
    findings: inspection.proseFindings.map(finding => ({
      id: finding.id,
      decision: 'pending',
      evidence: finding.evidence.map(item => ({ ...item, purpose: '', removalCost: '' })),
    })),
    issues: [] as string[],
  };
}

/** 新增表达提醒必须有当前版本的逐处删句试验；旧布尔标记与独立文风记录不代替它。 */
export async function collectProsePatternReviewErrors(
  markdownPath: string,
  inspection: HumanWritingInspection
): Promise<string[]> {
  if (!inspection.proseFindings.length) return [];
  if (inspection.proseFindings.some(finding => finding.severity === 'block'))
    return ['表达硬命中必须修改，不能复核豁免'];
  try {
    const draftDir = await fs.realpath(path.dirname(markdownPath));
    const reviewPath = path.join(draftDir, PROSE_PATTERN_REVIEW_FILE);
    const realPath = await fs.realpath(reviewPath);
    if (path.dirname(realPath) !== draftDir) return ['表达复核记录不能通过符号链接离开当前草稿目录'];
    const parsed = reviewSchema.safeParse(JSON.parse(await fs.readFile(reviewPath, 'utf8')));
    if (!parsed.success) return ['表达复核记录缺项或仍未审；每处需填写具体作用和删掉后的损失，不能只写通用保留理由'];
    const review = parsed.data;
    const errors = review.issues.map(issue => `表达复核待修复：${issue}`);
    if (review.articleSha256 !== inspection.articleSha256) errors.push('正文已变更，表达复核记录失效');
    if (review.checkerSha256 !== inspection.checkerSha256) errors.push('检查器已变更，表达复核记录失效');
    if (review.findingsSha256 !== humanWritingSha256(JSON.stringify(inspection.proseFindings))) {
      errors.push('实际表达提醒已变更，需完整重新复核');
    }
    const recorded = review.findings.map(item => ({
      id: item.id,
      evidence: item.evidence.map(({ line, excerpt }) => ({ line, excerpt })),
    }));
    const actual = inspection.proseFindings.map(({ id, evidence }) => ({ id, evidence }));
    if (JSON.stringify(recorded) !== JSON.stringify(actual)) {
      errors.push('表达复核与当前提醒不一致，不能漏项、调序、增加或替换命中原文');
    }
    for (const item of review.findings) {
      if (item.decision !== 'retain') errors.push(`表达复核仍要求修改：${item.id}`);
    }
    return errors;
  } catch {
    return [`缺少或无法读取 ${PROSE_PATTERN_REVIEW_FILE}，需完成本篇实际表达复核`];
  }
}
