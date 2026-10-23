import type { ArticlePostType } from './draft-lifecycle.js';
import { callWechatJsonApi, isWechatMissingMediaError } from './wechat-api-client.js';

export type WechatRemoteArticle = {
  ref: string;
  title: string;
  postType: ArticlePostType;
  content: string;
  author: string;
  digest: string;
  contentSourceUrl: string;
  thumbMediaId: string;
  imageMediaIds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === 'string' ? field : '';
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === 'number' ? field : undefined;
}

function firstArticle(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !Array.isArray(value.news_item)) return undefined;
  const first = value.news_item[0];
  return isRecord(first) ? first : undefined;
}

function imageMediaIds(article: Record<string, unknown>): string[] {
  const info = article.image_info;
  if (!isRecord(info) || !Array.isArray(info.image_list)) return [];
  return info.image_list.flatMap(item => {
    if (!isRecord(item)) return [];
    const mediaId = stringField(item, 'image_media_id');
    return mediaId ? [mediaId] : [];
  });
}

function parseArticle(ref: string, content: unknown): WechatRemoteArticle | undefined {
  const article = firstArticle(content);
  if (!article) return undefined;
  const title = stringField(article, 'title');
  if (!title) return undefined;
  const declaredType = stringField(article, 'article_type');
  const images = imageMediaIds(article);
  return {
    ref,
    title,
    postType: declaredType === 'newspic' || images.length > 0 ? 'newspic' : 'news',
    content: stringField(article, 'content'),
    author: stringField(article, 'author'),
    digest: stringField(article, 'digest'),
    contentSourceUrl: stringField(article, 'content_source_url'),
    thumbMediaId: stringField(article, 'thumb_media_id'),
    imageMediaIds: images,
  };
}

function parseBatch(value: unknown, refKey: 'media_id' | 'article_id'): WechatRemoteArticle[] {
  if (!isRecord(value) || !Array.isArray(value.item)) return [];
  return value.item.flatMap(item => {
    if (!isRecord(item)) return [];
    const ref = stringField(item, refKey);
    const article = ref ? parseArticle(ref, item.content) : undefined;
    return article ? [article] : [];
  });
}

async function listAll(
  endpoint: string,
  refKey: 'media_id' | 'article_id',
  action: string
): Promise<WechatRemoteArticle[]> {
  const records: WechatRemoteArticle[] = [];
  const count = 20;
  let offset = 0;
  while (true) {
    const data = await callWechatJsonApi(endpoint, { offset, count, no_content: 0 }, action);
    const page = parseBatch(data, refKey);
    records.push(...page);
    const itemCount = numberField(data, 'item_count') ?? page.length;
    const totalCount = numberField(data, 'total_count') ?? offset + itemCount;
    if (itemCount === 0 || offset + itemCount >= totalCount) return records;
    offset += itemCount;
  }
}

export async function listWechatDraftArticlesByTitle(title: string): Promise<WechatRemoteArticle[]> {
  const records = await listAll('/cgi-bin/draft/batchget', 'media_id', '查询微信草稿列表');
  return records.filter(record => record.title === title);
}

export async function readWechatDraftArticle(ref: string): Promise<WechatRemoteArticle | undefined> {
  try {
    const data = await callWechatJsonApi('/cgi-bin/draft/get', { media_id: ref }, '读取微信草稿');
    const article = parseArticle(ref, data);
    if (!article) throw new Error('读取微信草稿返回结构异常');
    return article;
  } catch (error) {
    if (isWechatMissingMediaError(error)) return undefined;
    throw error;
  }
}

export async function deleteWechatDraftArticle(ref: string): Promise<void> {
  await callWechatJsonApi('/cgi-bin/draft/delete', { media_id: ref }, '删除补偿草稿');
}

export async function listWechatPublishedArticlesByTitle(title: string): Promise<WechatRemoteArticle[]> {
  const records = await listAll('/cgi-bin/freepublish/batchget', 'article_id', '查询微信已发表列表');
  return records.filter(record => record.title === title);
}

export const draftRemoteApiInternals = { parseArticle, parseBatch };
