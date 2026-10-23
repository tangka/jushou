import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const TRANSLATION_REVIEW_FILE = 'internal-audit/translation-review.json';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const translationReviewSchema = z.object({
  version: z.literal(1),
  articleSha256: sha256Schema,
  sourceHashes: z
    .array(z.object({ id: z.string().min(1), sourcePath: z.string().min(1), sha256: sha256Schema }))
    .min(1),
  sections: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        sourceSection: z.string().min(1),
        translatedSection: z.string().min(1),
        assessment: z.string().min(1),
      })
    )
    .min(1),
  parameterReview: z.string().min(1),
  promptReview: z.string().min(1),
  additionsReview: z.string().min(1),
  issues: z.array(z.string().min(1)),
});

type TranslationSource = { id: string; path: string };
type TranslationBrief = { contentClass: string; sources: readonly TranslationSource[] };

export function translationReviewInputs(markdown: string, sources: readonly TranslationSource[]) {
  return {
    articleSha256: createHash('sha256').update(markdown).digest('hex'),
    sourceHashes: sources.map(source => ({
      id: source.id,
      sourcePath: source.path,
      sha256: createHash('sha256').update(fs.readFileSync(source.path)).digest('hex'),
    })),
  };
}

/** 已审原文按内容哈希随草稿封装，供远端复核，不依赖远端存在 Mac 绝对路径。 */
export function snapshotTranslationSources(draftDir: string, sources: readonly TranslationSource[]): void {
  const root = fs.realpathSync(draftDir);
  const directory = path.join(root, 'internal-audit/translation-sources');
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.realpathSync(directory).startsWith(`${root}${path.sep}`)) {
    throw new Error('翻译原文快照目录不能通过符号链接离开当前草稿');
  }
  for (const source of sources) {
    const bytes = fs.readFileSync(source.path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const target = path.join(directory, `${hash}.md`);
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: 'wx' });
    if (!fs.realpathSync(target).startsWith(`${root}${path.sep}`) || !fs.readFileSync(target).equals(bytes)) {
      throw new Error(`翻译原文快照不一致：${source.id}`);
    }
  }
}

/** 这里只验证独立审稿记录对应当前文件，不以字段齐全或关键词命中证明翻译保真。 */
export function collectTranslationReviewErrors(
  brief: TranslationBrief,
  input: { draftDir: string; markdown: string }
): string[] {
  if (brief.contentClass !== 'translation') return [];
  const reviewPath = path.join(input.draftDir, TRANSLATION_REVIEW_FILE);
  try {
    const realRoot = fs.realpathSync(input.draftDir);
    const relative = path.relative(realRoot, fs.realpathSync(reviewPath));
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      return ['翻译审稿记录不能通过符号链接离开当前草稿目录'];
    }
    const parsed = translationReviewSchema.safeParse(JSON.parse(fs.readFileSync(reviewPath, 'utf8')));
    if (!parsed.success) return ['翻译审稿记录格式不完整，需要独立逐章核对原文、参数、提示词和增删内容'];
    const review = parsed.data;
    const errors = review.issues.map(issue => `翻译审稿待修复：${issue}`);
    const articleHash = createHash('sha256').update(input.markdown).digest('hex');
    if (review.articleSha256 !== articleHash) errors.push('译文已变更，需要重新进行翻译完整性审稿');
    for (const source of brief.sources) {
      const recorded = review.sourceHashes.filter(item => item.id === source.id);
      const record = recorded[0];
      if (recorded.length !== 1 || !record || record.sourcePath !== source.path) {
        errors.push(`翻译来源与审稿记录不一致：${source.id}`);
        continue;
      }
      const snapshot = path.join(realRoot, 'internal-audit/translation-sources', `${record.sha256}.md`);
      if (!fs.realpathSync(snapshot).startsWith(`${realRoot}${path.sep}`)) {
        errors.push(`翻译原文快照不能通过符号链接离开当前草稿：${source.id}`);
        continue;
      }
      const snapshotHash = createHash('sha256').update(fs.readFileSync(snapshot)).digest('hex');
      if (snapshotHash !== record.sha256) errors.push(`已审翻译原文快照已变更：${source.id}`);
      const localSource = fs.statSync(source.path, { throwIfNoEntry: false });
      if (localSource?.isFile()) {
        const localHash = createHash('sha256').update(fs.readFileSync(source.path)).digest('hex');
        if (localHash !== record.sha256) errors.push(`翻译来源已变更，需要重新审稿：${source.id}`);
      }
      if (!review.sections.some(section => section.sourceId === source.id)) {
        errors.push(`翻译审稿缺少来源的章节对照记录：${source.id}`);
      }
    }
    const knownIds = new Set(brief.sources.map(source => source.id));
    if (
      review.sourceHashes.some(source => !knownIds.has(source.id)) ||
      review.sections.some(section => !knownIds.has(section.sourceId))
    ) {
      errors.push('翻译审稿引用了编辑任务之外的来源');
    }
    return errors;
  } catch (error) {
    return [`翻译审稿记录或来源无法读取：${error instanceof Error ? error.message : String(error)}`];
  }
}
