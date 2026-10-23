import { parseMarkdown } from './build-publish-html.js';

export function assertPackagingPreservesText(before: string, after: string): void {
  const text = (markdown: string): string => {
    const parsed = parseMarkdown(markdown, 'article');
    return `${parsed.title}\n${parsed.body}`
      .replace(/!\[\[[^\]\n]+\]\]/gu, '')
      .replace(/!\[[^\]\n]*\]\([^)\n]+\)/gu, '')
      .replace(/<img\b[^>]*>/giu, '')
      .replace(/\s+/gu, '');
  };
  if (text(before) !== text(after)) throw new Error('资源包装改动了正文或标题，必须恢复原稿后重新包装');
}

/** 包装后锁定稿件，分别独立审查译文或作者文风；校验读取同一版本。 */
export async function prepareDraftForValidation(stages: {
  contentClass: string;
  packageDraft: () => Promise<void>;
  attachBrief: () => Promise<void>;
  reviewTranslation: () => Promise<void>;
  reviewHumanWriting: () => Promise<void>;
  validateDraft: () => Promise<void>;
}): Promise<void> {
  await stages.packageDraft();
  await stages.attachBrief();
  if (stages.contentClass === 'translation') await stages.reviewTranslation();
  else await stages.reviewHumanWriting();
  await stages.validateDraft();
}
