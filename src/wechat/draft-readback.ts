import { load } from 'cheerio';
import {
  isAllowedOfficialAccountUrl,
  validateWechatArticleMiniProgram,
  validateWechatContentLinks,
} from './link-policy.js';

export type WechatDraftArticleType = 'news' | 'newspic';

export type WechatDraftSnapshot = {
  title: string;
  author?: string;
  articleType: WechatDraftArticleType;
  content: string;
  contentSourceUrl?: string;
  hasCover: boolean;
  imageCount: number;
};

export type WechatDraftReadbackExpectation =
  | {
      articleType: 'news';
      title: string;
      author: string;
      thumbMediaId: string;
      accountExact: string;
      imageCount: number;
      contentSourceUrl?: string;
      miniProgramEntryRequired?: boolean;
    }
  | {
      articleType: 'newspic';
      title: string;
      imageCount: number;
    };

type ParsedWechatDraft = WechatDraftSnapshot & {
  thumbMediaId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== 'string' || !field.trim()) throw new Error(`微信草稿官方回读缺少有效${label}`);
  return field.trim();
}

function optionalString(value: Record<string, unknown>, key: string, label: string): string | undefined {
  const field = value[key];
  if (field === undefined || field === null || field === '') return undefined;
  if (typeof field !== 'string') throw new Error(`微信草稿官方回读的${label}结构异常`);
  return field.trim() || undefined;
}

function readNewsItems(value: unknown): unknown[] {
  if (!isRecord(value)) throw new Error('微信草稿官方回读结构异常');
  if (Array.isArray(value.news_item)) return value.news_item;
  if (isRecord(value.content) && Array.isArray(value.content.news_item)) return value.content.news_item;
  throw new Error('微信草稿官方回读缺少 news_item');
}

function parseImageCount(article: Record<string, unknown>): number {
  if (!isRecord(article.image_info) || !Array.isArray(article.image_info.image_list)) {
    throw new Error('微信贴图草稿官方回读缺少 image_info.image_list');
  }
  for (const image of article.image_info.image_list) {
    if (!isRecord(image) || typeof image.image_media_id !== 'string' || !image.image_media_id.trim()) {
      throw new Error('微信贴图草稿官方回读包含无效图片项');
    }
  }
  return article.image_info.image_list.length;
}

function parseNewsImageCount(content: string): number {
  return load(content, {}, false)('img').length;
}

function parseWechatDraft(value: unknown): ParsedWechatDraft {
  const newsItems = readNewsItems(value);
  if (newsItems.length !== 1) {
    throw new Error(`微信草稿官方回读必须恰好包含 1 篇内容，实际 ${newsItems.length} 篇`);
  }
  const article = newsItems[0];
  if (!isRecord(article)) throw new Error('微信草稿官方回读文章结构异常');
  const articleType = requiredString(article, 'article_type', 'article_type');
  if (articleType !== 'news' && articleType !== 'newspic') {
    throw new Error(`微信草稿官方回读 article_type 不受支持:${articleType}`);
  }

  const title = requiredString(article, 'title', '标题');
  if (typeof article.content !== 'string') throw new Error('微信草稿官方回读缺少有效正文');
  const content = article.content;
  if (articleType === 'newspic') {
    return {
      title,
      articleType,
      content,
      hasCover: false,
      imageCount: parseImageCount(article),
    };
  }

  const thumbMediaId = requiredString(article, 'thumb_media_id', '封面');
  return {
    title,
    author: optionalString(article, 'author', '作者'),
    articleType,
    content,
    contentSourceUrl: optionalString(article, 'content_source_url', '阅读原文链接'),
    hasCover: true,
    imageCount: parseNewsImageCount(content),
    thumbMediaId,
  };
}

/** 解析官方 draft/get 或 batchget 单项，返回不含任何素材 ID 的快照。 */
export function parseWechatDraftSnapshot(value: unknown): WechatDraftSnapshot {
  const { thumbMediaId: _thumbMediaId, ...snapshot } = parseWechatDraft(value);
  return snapshot;
}

/** 上传完成后校验官方回读；任一字段缺失、类型错位或链接规则失效都 fail closed。 */
export function validateWechatDraftReadback(
  value: unknown,
  expected: WechatDraftReadbackExpectation
): WechatDraftSnapshot {
  const parsed = parseWechatDraft(value);
  if (parsed.title !== expected.title) {
    throw new Error(`微信草稿官方回读标题不一致:预期「${expected.title}」，实际「${parsed.title}」`);
  }
  if (parsed.articleType !== expected.articleType) {
    throw new Error(`微信草稿官方回读类型不一致:预期 ${expected.articleType}，实际 ${parsed.articleType}`);
  }

  if (expected.articleType === 'news' && parsed.author !== expected.author) {
    throw new Error(
      `微信文章草稿官方回读作者不一致:预期「${expected.author}」，实际「${parsed.author ?? ''}」`
    );
  }

  if (expected.articleType === 'newspic') {
    if (parsed.imageCount !== expected.imageCount) {
      throw new Error(`微信贴图草稿官方回读图片数不一致:预期 ${expected.imageCount}，实际 ${parsed.imageCount}`);
    }
    validateWechatContentLinks(parsed.content);
    return parseWechatDraftSnapshot(value);
  }

  if (parsed.thumbMediaId !== expected.thumbMediaId) {
    throw new Error('微信文章草稿官方回读封面与本次上传不一致');
  }
  if (parsed.imageCount !== expected.imageCount) {
    throw new Error(`微信文章草稿官方回读正文图片数不一致:预期 ${expected.imageCount}，实际 ${parsed.imageCount}`);
  }
  if (parsed.contentSourceUrl !== expected.contentSourceUrl) {
    throw new Error('微信文章草稿官方回读的阅读原文链接与本地稿件不一致');
  }
  if (parsed.contentSourceUrl && !isAllowedOfficialAccountUrl(parsed.contentSourceUrl)) {
    throw new Error('微信文章草稿官方回读包含非公众号阅读原文链接');
  }
  validateWechatContentLinks(parsed.content);
  validateWechatArticleMiniProgram(parsed.content, expected.accountExact, expected.miniProgramEntryRequired !== false);
  return parseWechatDraftSnapshot(value);
}
