import fs from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { config, USER_AGENT } from '../config/index.js';
import { UpstreamError } from '../errors.js';
import {
  type AccountSearchResp,
  type ArticleDetail,
  type ArticleListResp,
  accountSearchRespSchema,
  articleDetailSchema,
  articleListRespSchema,
} from '../types/wechat.js';
import { guessImageExt } from '../utils/text.js';

/** 打代理接口取 JSON,校验 HTTP 状态,再用 zod 校验结构(禁 any)。 */
async function fetchJson<T>(url: URL, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) throw new UpstreamError(resp.status, `${resp.status} ${resp.statusText}: ${url.toString()}`);
  const data: unknown = await resp.json();
  return schema.parse(data);
}

function proxyUrl(pathname: string): URL {
  return new URL(pathname, config.baseUrl);
}

/** 搜索公众号。 */
export function searchAccount(authKey: string, keyword: string, size = 10): Promise<AccountSearchResp> {
  const url = proxyUrl('/api/public/v1/account');
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('size', String(size));
  return fetchJson(url, accountSearchRespSchema, { headers: { 'X-Auth-Key': authKey } });
}

/** 拉一页文章列表。 */
export function listArticlesPage(authKey: string, account: string, begin: number, size = 10): Promise<ArticleListResp> {
  const url = proxyUrl('/api/public/v1/article');
  url.searchParams.set('account', account);
  url.searchParams.set('begin', String(begin));
  url.searchParams.set('size', String(size));
  return fetchJson(url, articleListRespSchema, { headers: { 'X-Auth-Key': authKey } });
}

/** 取一篇文章正文详情。 */
export function downloadArticle(link: string): Promise<ArticleDetail> {
  const url = proxyUrl('/api/public/v1/download');
  url.searchParams.set('format', 'json');
  url.searchParams.set('url', link);
  return fetchJson(url, articleDetailSchema);
}

/** 下载图片到 destDir,返回保存的文件名(扩展名据 wx_fmt / content-type 推断)。 */
export async function downloadImage(url: string, destDir: string, filenameBase: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { Referer: 'https://mp.weixin.qq.com/', 'User-Agent': USER_AGENT },
  });
  if (!resp.ok) throw new UpstreamError(resp.status, `image ${resp.status}: ${url}`);
  const bytes = Buffer.from(await resp.arrayBuffer());
  const ext = guessImageExt(url, resp.headers.get('content-type') || '');
  const filename = `${filenameBase}.${ext}`;
  await fs.writeFile(path.join(destDir, filename), bytes);
  return filename;
}
