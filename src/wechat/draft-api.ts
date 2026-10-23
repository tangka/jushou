import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import { config } from '../config/index.js';
import { validateWechatDraftReadback, type WechatDraftReadbackExpectation } from './draft-readback.js';
import type { DraftImageRef, DraftUploadSource, WechatDraftResult } from './draft-types.js';
import {
  isAllowedOfficialAccountUrl,
  validateWechatArticleMiniProgram,
  validateWechatContentLinks,
} from './link-policy.js';

export type { DraftImageRef, DraftUploadSource, WechatDraftResult } from './draft-types.js';

export type WechatDraftTitleMatch = { mediaId: string; title: string };

export class WechatApiError extends Error {
  constructor(
    message: string,
    readonly errcode: number
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function getNumber(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === 'number' ? field : undefined;
}

function cropText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxChars ? compact.slice(0, maxChars) : compact;
}

function requireCredentials(): void {
  if (!config.wechatApi.appid || !config.wechatApi.appsecret) {
    throw new Error('缺少 WECHAT_APPID/WECHAT_APPSECRET。请写入当前账号 .env 后重试。');
  }
}

async function readJsonResponse(response: Response, action: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${action} 返回非 JSON:HTTP ${response.status} ${cropText(text, 300)}`);
  }
  if (!isRecord(parsed)) throw new Error(`${action} 返回结构异常:${cropText(text, 300)}`);
  const errcode = getNumber(parsed, 'errcode');
  if (!response.ok || (errcode !== undefined && errcode !== 0)) {
    const errmsg = getString(parsed, 'errmsg') ?? response.statusText;
    const hint = errcode === 40164 ? '。这是 IP 白名单问题,需要把当前出口 IP 加到微信开发接口管理' : '';
    throw new WechatApiError(
      `${action} 失败: errcode=${errcode ?? response.status} errmsg=${errmsg}${hint}`,
      errcode ?? response.status
    );
  }
  return parsed;
}

export async function postWechatJson(
  url: string,
  body: Record<string, unknown>,
  action: string
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  return readJsonResponse(response, action);
}

async function readCachedToken(): Promise<string | undefined> {
  const raw = await fs.readFile(config.wechatApi.tokenCachePath, 'utf8').catch(() => undefined);
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const appid = getString(parsed, 'appid');
  const accessToken = getString(parsed, 'access_token');
  const expiresAt = getNumber(parsed, 'expires_at');
  if (appid !== config.wechatApi.appid || !accessToken || !expiresAt) return undefined;
  return expiresAt > Date.now() + 300_000 ? accessToken : undefined;
}

export async function getWechatAccessToken(): Promise<string> {
  requireCredentials();
  const cached = await readCachedToken();
  if (cached) return cached;

  const data = await postWechatJson(
    `${config.wechatApi.baseUrl}/cgi-bin/stable_token`,
    {
      grant_type: 'client_credential',
      appid: config.wechatApi.appid,
      secret: config.wechatApi.appsecret,
      force_refresh: false,
    },
    '获取 access_token'
  );
  const accessToken = getString(data, 'access_token');
  if (!accessToken) throw new Error('获取 access_token 失败:响应缺少 access_token');
  const expiresIn = getNumber(data, 'expires_in') ?? 7200;
  await fs.mkdir(path.dirname(config.wechatApi.tokenCachePath), { recursive: true });
  await fs.writeFile(
    config.wechatApi.tokenCachePath,
    `${JSON.stringify({ appid: config.wechatApi.appid, access_token: accessToken, expires_at: Date.now() + expiresIn * 1000 }, null, 2)}\n`
  );
  return accessToken;
}

function mimeForImage(pathname: string): string {
  const ext = path.extname(pathname).toLowerCase();
  return ext === '.png' ? 'image/png' : 'image/jpeg';
}

async function postMultipartImage(url: string, imagePath: string, action: string): Promise<Record<string, unknown>> {
  const boundary = `----woa-${randomUUID()}`;
  const image = await fs.readFile(imagePath);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${path.basename(imagePath)}"\r\nContent-Type: ${mimeForImage(
      imagePath
    )}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([head, image, tail]),
  });
  return readJsonResponse(response, action);
}

async function uploadBodyImage(accessToken: string, image: DraftImageRef): Promise<string> {
  const url = `${config.wechatApi.baseUrl}/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(accessToken)}`;
  const data = await postMultipartImage(url, image.filePath, `上传正文图片 ${image.src}`);
  const uploadedUrl = getString(data, 'url');
  if (!uploadedUrl) throw new Error(`上传正文图片失败,响应缺少 url:${image.src}`);
  return uploadedUrl;
}

async function uploadPermanentImage(
  accessToken: string,
  imagePath: string,
  action: string,
  type: 'image' | 'thumb' = 'image'
): Promise<string> {
  const url = `${config.wechatApi.baseUrl}/cgi-bin/material/add_material?access_token=${encodeURIComponent(accessToken)}&type=${type}`;
  const data = await postMultipartImage(url, imagePath, action);
  const mediaId = getString(data, 'media_id');
  if (!mediaId) throw new Error(`${action}失败,响应缺少 media_id`);
  return mediaId;
}

async function uploadCover(accessToken: string, coverPath: string): Promise<string> {
  return uploadPermanentImage(accessToken, coverPath, '上传封面永久素材', config.wechatApi.coverMaterialType);
}

function firstDraftTitle(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const newsItems = value.news_item;
  if (!Array.isArray(newsItems)) return undefined;
  const first = newsItems[0];
  return isRecord(first) ? getString(first, 'title') : undefined;
}

export function parseWechatDraftBatchItems(value: unknown): WechatDraftTitleMatch[] {
  if (!isRecord(value) || !Array.isArray(value.item)) return [];
  const matches: WechatDraftTitleMatch[] = [];
  for (const rawItem of value.item) {
    if (!isRecord(rawItem)) continue;
    const mediaId = getString(rawItem, 'media_id');
    const content = rawItem.content;
    const title = firstDraftTitle(content);
    if (mediaId && title) matches.push({ mediaId, title });
  }
  return matches;
}

export function selectWechatDraftMediaId(
  requestedMediaId: string,
  sourceTitle: string,
  requestedDraftTitle: string | undefined,
  exactTitleMatches: readonly WechatDraftTitleMatch[],
  expectedCurrentTitle?: string
): string {
  const targetCurrentTitle = expectedCurrentTitle ?? sourceTitle;
  if (requestedDraftTitle !== undefined) {
    if (requestedDraftTitle !== targetCurrentTitle) {
      throw new Error(
        `拒绝更新标题不匹配的微信草稿:草稿箱标题=${requestedDraftTitle},预期当前标题=${targetCurrentTitle},本地新标题=${sourceTitle}`
      );
    }
    return requestedMediaId;
  }

  if (exactTitleMatches.length === 1) return exactTitleMatches[0]?.mediaId ?? requestedMediaId;
  if (exactTitleMatches.length === 0) {
    throw new Error(`本地 media_id 已失效,且草稿箱没有完整标题匹配项:${targetCurrentTitle}`);
  }
  throw new Error(
    `本地 media_id 已失效,但草稿箱存在 ${exactTitleMatches.length} 个同标题草稿,拒绝猜测更新目标:${targetCurrentTitle}`
  );
}

async function getWechatDraftTitle(accessToken: string, mediaId: string): Promise<string | undefined> {
  try {
    const data = await getWechatDraft(accessToken, mediaId, '读取微信草稿');
    const title = firstDraftTitle(data);
    if (!title) throw new Error('读取微信草稿返回结构异常');
    return title;
  } catch (error) {
    if (error instanceof WechatApiError && error.errcode === 40007) return undefined;
    throw error;
  }
}

async function getWechatDraft(accessToken: string, mediaId: string, action: string): Promise<Record<string, unknown>> {
  return postWechatJson(
    `${config.wechatApi.baseUrl}/cgi-bin/draft/get?access_token=${encodeURIComponent(accessToken)}`,
    { media_id: mediaId },
    action
  );
}

async function verifyWechatDraftReadback(
  accessToken: string,
  mediaId: string,
  expected: WechatDraftReadbackExpectation
): Promise<void> {
  const data = await getWechatDraft(accessToken, mediaId, '回读验证微信草稿');
  validateWechatDraftReadback(data, expected);
}

async function findWechatDraftsByExactTitle(accessToken: string, title: string): Promise<WechatDraftTitleMatch[]> {
  const matches: WechatDraftTitleMatch[] = [];
  let offset = 0;
  const count = 20;

  while (true) {
    const data = await postWechatJson(
      `${config.wechatApi.baseUrl}/cgi-bin/draft/batchget?access_token=${encodeURIComponent(accessToken)}`,
      { offset, count, no_content: 0 },
      '查询微信草稿列表'
    );
    const items = parseWechatDraftBatchItems(data);
    matches.push(...items.filter(item => item.title === title));
    const itemCount = getNumber(data, 'item_count') ?? items.length;
    const totalCount = getNumber(data, 'total_count') ?? offset + itemCount;
    if (itemCount === 0 || offset + itemCount >= totalCount) break;
    offset += itemCount;
  }
  return matches;
}

async function resolveWechatDraftMediaId(
  accessToken: string,
  requestedMediaId: string,
  title: string,
  expectedCurrentTitle?: string
): Promise<string> {
  const requestedDraftTitle = await getWechatDraftTitle(accessToken, requestedMediaId);
  const lookupTitle = expectedCurrentTitle ?? title;
  const matches = requestedDraftTitle === undefined ? await findWechatDraftsByExactTitle(accessToken, lookupTitle) : [];
  return selectWechatDraftMediaId(requestedMediaId, title, requestedDraftTitle, matches, expectedCurrentTitle);
}

function replaceBodyImages(articleHtml: string, uploads: Record<string, string>): string {
  const $ = load(articleHtml, {}, false);
  $('img').each((_index, element) => {
    const src = $(element).attr('src')?.trim();
    if (!src) return;
    const uploaded = uploads[src];
    if (uploaded) $(element).attr('src', uploaded);
  });
  return $.html();
}

export function buildWechatNewsArticle(
  source: Pick<DraftUploadSource, 'title' | 'author' | 'digest' | 'contentSourceUrl'>,
  content: string,
  thumbMediaId: string
): Record<string, unknown> {
  const article: Record<string, unknown> = {
    article_type: 'news',
    title: source.title,
    author: source.author,
    digest: source.digest,
    content,
    thumb_media_id: thumbMediaId,
    need_open_comment: config.wechatApi.needOpenComment,
    only_fans_can_comment: config.wechatApi.onlyFansCanComment,
  };
  if (source.contentSourceUrl) article.content_source_url = source.contentSourceUrl;
  return article;
}

export async function createWechatDraft(
  source: DraftUploadSource,
  bodyImages: readonly DraftImageRef[]
): Promise<WechatDraftResult> {
  if (source.postType === '贴图') return createWechatStickerDraft(source);

  validateWechatContentLinks(source.articleHtml);
  validateWechatArticleMiniProgram(source.articleHtml, config.accountExact, source.miniProgramEntryRequired !== false);
  if (source.contentSourceUrl && !isAllowedOfficialAccountUrl(source.contentSourceUrl)) {
    throw new Error(
      `公众号链接白名单:微信 payload 的阅读原文只允许 mp.weixin.qq.com，检测到:${source.contentSourceUrl}`
    );
  }
  requireCredentials();
  const accessToken = await getWechatAccessToken();

  const uploadedBodyImages: Record<string, string> = {};
  for (const image of bodyImages) uploadedBodyImages[image.src] = await uploadBodyImage(accessToken, image);

  const thumbMediaId = await uploadCover(accessToken, source.coverPath);
  const content = replaceBodyImages(source.articleHtml, uploadedBodyImages);
  validateWechatContentLinks(content);
  validateWechatArticleMiniProgram(content, config.accountExact, source.miniProgramEntryRequired !== false);
  const article = buildWechatNewsArticle(source, content, thumbMediaId);
  const data = await postWechatJson(
    `${config.wechatApi.baseUrl}/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`,
    { articles: [article] },
    '创建微信草稿'
  );
  const mediaId = getString(data, 'media_id');
  if (!mediaId) throw new Error('创建微信草稿失败,响应缺少 media_id');
  await verifyWechatDraftReadback(accessToken, mediaId, {
    articleType: 'news',
    title: source.title,
    author: source.author,
    thumbMediaId,
    accountExact: config.accountExact,
    imageCount: load(content, {}, false)('img').length,
    contentSourceUrl: source.contentSourceUrl,
    miniProgramEntryRequired: source.miniProgramEntryRequired,
  });
  return { mediaId, uploadedBodyImages, thumbMediaId };
}

export async function updateWechatDraft(
  source: DraftUploadSource,
  bodyImages: readonly DraftImageRef[],
  mediaId: string,
  expectedCurrentTitle?: string
): Promise<WechatDraftResult> {
  if (source.postType === '贴图') return updateWechatStickerDraft(source, mediaId, expectedCurrentTitle);
  if (!mediaId.trim()) throw new Error('更新微信草稿需要非空 media_id');

  validateWechatContentLinks(source.articleHtml);
  validateWechatArticleMiniProgram(source.articleHtml, config.accountExact, source.miniProgramEntryRequired !== false);
  if (source.contentSourceUrl && !isAllowedOfficialAccountUrl(source.contentSourceUrl)) {
    throw new Error(
      `公众号链接白名单:微信 payload 的阅读原文只允许 mp.weixin.qq.com，检测到:${source.contentSourceUrl}`
    );
  }
  requireCredentials();
  const accessToken = await getWechatAccessToken();
  const resolvedMediaId = await resolveWechatDraftMediaId(accessToken, mediaId, source.title, expectedCurrentTitle);
  if (resolvedMediaId !== mediaId) {
    console.log('提示:本地草稿标识已失效,已按完整标题唯一命中现有草稿');
  }

  const uploadedBodyImages: Record<string, string> = {};
  for (const image of bodyImages) uploadedBodyImages[image.src] = await uploadBodyImage(accessToken, image);

  const thumbMediaId = await uploadCover(accessToken, source.coverPath);
  const content = replaceBodyImages(source.articleHtml, uploadedBodyImages);
  validateWechatContentLinks(content);
  validateWechatArticleMiniProgram(content, config.accountExact, source.miniProgramEntryRequired !== false);
  // 原草稿可能是 newspic，更新时必须显式覆盖为 news，不能依赖接口默认值。
  const article = buildWechatNewsArticle(source, content, thumbMediaId);
  await postWechatJson(
    `${config.wechatApi.baseUrl}/cgi-bin/draft/update?access_token=${encodeURIComponent(accessToken)}`,
    { media_id: resolvedMediaId, index: 0, articles: article },
    '更新微信草稿'
  );
  await verifyWechatDraftReadback(accessToken, resolvedMediaId, {
    articleType: 'news',
    title: source.title,
    author: source.author,
    thumbMediaId,
    accountExact: config.accountExact,
    imageCount: load(content, {}, false)('img').length,
    contentSourceUrl: source.contentSourceUrl,
    miniProgramEntryRequired: source.miniProgramEntryRequired,
  });
  return { mediaId: resolvedMediaId, uploadedBodyImages, thumbMediaId };
}

async function createWechatStickerDraft(source: DraftUploadSource): Promise<WechatDraftResult> {
  validateWechatContentLinks(source.stickerContent);
  requireCredentials();
  const accessToken = await getWechatAccessToken();

  const imageMediaIds: string[] = [];
  for (const image of source.stickerImages) {
    imageMediaIds.push(await uploadPermanentImage(accessToken, image.filePath, `上传贴图图片 ${image.src}`));
  }

  const article = buildWechatStickerArticle(source, imageMediaIds);

  const data = await postWechatJson(
    `${config.wechatApi.baseUrl}/cgi-bin/draft/add?access_token=${encodeURIComponent(accessToken)}`,
    { articles: [article] },
    '创建微信贴图草稿'
  );
  const mediaId = getString(data, 'media_id');
  if (!mediaId) throw new Error('创建微信贴图草稿失败,响应缺少 media_id');
  await verifyWechatDraftReadback(accessToken, mediaId, {
    articleType: 'newspic',
    title: source.title,
    imageCount: imageMediaIds.length,
  });
  return { mediaId, uploadedBodyImages: {}, uploadedStickerImages: imageMediaIds };
}

export function buildWechatStickerArticle(
  source: Pick<DraftUploadSource, 'title' | 'stickerContent'>,
  imageMediaIds: readonly string[]
): Record<string, unknown> {
  return {
    article_type: 'newspic',
    title: source.title,
    content: source.stickerContent,
    need_open_comment: config.wechatApi.needOpenComment,
    only_fans_can_comment: config.wechatApi.onlyFansCanComment,
    image_info: {
      image_list: imageMediaIds.map(imageMediaId => ({ image_media_id: imageMediaId })),
    },
  };
}

async function updateWechatStickerDraft(
  source: DraftUploadSource,
  mediaId: string,
  expectedCurrentTitle?: string
): Promise<WechatDraftResult> {
  if (!mediaId.trim()) throw new Error('更新微信草稿需要非空 media_id');
  validateWechatContentLinks(source.stickerContent);
  requireCredentials();
  const accessToken = await getWechatAccessToken();
  const resolvedMediaId = await resolveWechatDraftMediaId(accessToken, mediaId, source.title, expectedCurrentTitle);
  if (resolvedMediaId !== mediaId) {
    console.log('提示:本地草稿标识已失效,已按完整标题唯一命中现有草稿');
  }

  const imageMediaIds: string[] = [];
  for (const image of source.stickerImages) {
    imageMediaIds.push(await uploadPermanentImage(accessToken, image.filePath, `上传贴图图片 ${image.src}`));
  }

  await postWechatJson(
    `${config.wechatApi.baseUrl}/cgi-bin/draft/update?access_token=${encodeURIComponent(accessToken)}`,
    { media_id: resolvedMediaId, index: 0, articles: buildWechatStickerArticle(source, imageMediaIds) },
    '更新微信贴图草稿'
  );
  await verifyWechatDraftReadback(accessToken, resolvedMediaId, {
    articleType: 'newspic',
    title: source.title,
    imageCount: imageMediaIds.length,
  });
  return { mediaId: resolvedMediaId, uploadedBodyImages: {}, uploadedStickerImages: imageMediaIds };
}
