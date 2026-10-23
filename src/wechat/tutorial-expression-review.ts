import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const TUTORIAL_EXPRESSION_REVIEW = 'internal-audit/tutorial-expression-review.json';
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const reviewSchema = z.object({
  version: z.literal(1),
  reviewer: z.string().trim().min(1),
  reviewedAt: z.string().datetime({ offset: true }),
  bodySha256: sha,
  briefSha256: sha,
  sourceAuditSha256: sha,
  sourceHashes: z.array(z.object({ id: z.string(), path: z.string(), sha256: sha })),
  unresolvedFacts: z.array(z.string()).length(0),
  expressions: z.array(
    z.object({
      blockIndex: z.number().int().nonnegative(),
      textSha256: sha,
      kind: z.enum(['author-response', 'teaching-example', 'instruction-template', 'editorial-transition']),
      reason: z.string().trim().min(16),
    })
  ),
});

export function tutorialReviewHash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

type ReviewBrief = {
  contentClass: string;
  sources: readonly { id: string; path: string }[];
};

/** 教程中的示例、指令和反应不冒充来源事实；只有逐段审阅且版本完全一致时才从密度分母扣除。 */
export function readTutorialExpressionReview(input: {
  draftDir: string;
  body: string;
  brief: ReviewBrief;
  sourceAudit: string;
  blocks: readonly { text: string }[];
}): Set<number> {
  const file = path.join(input.draftDir, TUTORIAL_EXPRESSION_REVIEW);
  if (!fs.existsSync(file)) return new Set();
  if (input.brief.contentClass !== 'tutorial') throw new Error('教程表达审阅仅适用于 tutorial');
  const relative = path.relative(fs.realpathSync(input.draftDir), fs.realpathSync(file));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('教程表达审阅不能指向草稿外部');
  const review = reviewSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown);
  if (
    review.bodySha256 !== tutorialReviewHash(input.body) ||
    review.briefSha256 !== tutorialReviewHash(JSON.stringify(input.brief)) ||
    review.sourceAuditSha256 !== tutorialReviewHash(input.sourceAudit)
  ) {
    throw new Error('教程表达审阅已过期：正文、编辑合同或来源审计发生变化');
  }
  if (
    JSON.stringify(review.sourceHashes.map(({ id, path: sourcePath }) => ({ id, path: sourcePath }))) !==
    JSON.stringify(input.brief.sources.map(({ id, path: sourcePath }) => ({ id, path: sourcePath })))
  ) {
    throw new Error('教程表达审阅来源集合不一致');
  }
  for (const source of review.sourceHashes) {
    if (fs.existsSync(source.path)) {
      if (tutorialReviewHash(fs.readFileSync(source.path)) !== source.sha256) {
        throw new Error(`教程表达审阅来源已变化：${source.id}`);
      }
    } else if (process.env.WOA_REMOTE_UPLOAD !== '1') {
      throw new Error(`教程表达审阅来源不存在：${source.id}`);
    }
  }
  const indices = new Set<number>();
  for (const item of review.expressions) {
    const block = input.blocks[item.blockIndex];
    if (!block || indices.has(item.blockIndex) || tutorialReviewHash(block.text) !== item.textSha256) {
      throw new Error(`教程表达审阅段落不一致或重复：${item.blockIndex}`);
    }
    indices.add(item.blockIndex);
  }
  return indices;
}
