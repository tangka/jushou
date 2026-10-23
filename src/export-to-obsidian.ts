import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { articlePaths, config } from './config/index.js';
import { RateLimitError } from './errors.js';
import { type DetailEntry, readDetailEntries } from './report.js';
import type { ArticleListItem } from './types/wechat.js';
import { isMain, runCli } from './utils/cli.js';
import { toDate, toDateTime } from './utils/date.js';
import { decodeHtmlEntities, safeName, yamlString } from './utils/text.js';
import { downloadArticle, downloadImage, listArticlesPage } from './wechat/proxy.js';
import { loadAuthKey } from './wechat/session.js';

const turndown = new TurndownService({ codeBlockStyle: 'fenced', headingStyle: 'atx', bulletListMarker: '-' });
export const MAX_EXPORT_ARTICLES = 100;

/** 把正文 HTML 里的远程图片下到该篇 media/,改写为本篇内相对引用 `media/x`;失败保留原链并标记。 */
async function normalizeContentImages(html: string, mediaDir: string, base: string): Promise<string> {
  const $ = cheerio.load(`<main>${html || ''}</main>`);
  let index = 1;
  for (const img of $('img').toArray()) {
    const el = $(img);
    const src = el.attr('data-src') || el.attr('src');
    if (!src || !/^https?:\/\//.test(src)) continue;
    try {
      const filename = await downloadImage(src, mediaDir, `${base}-${String(index).padStart(2, '0')}`);
      el.attr('src', `media/${filename}`);
      el.removeAttr('data-src');
      index += 1;
    } catch (error) {
      el.attr('src', src);
      el.attr('data-download-error', error instanceof Error ? error.message : String(error));
    }
  }
  return $('main').html() || html || '';
}

function assertArticleListOk(resp: Awaited<ReturnType<typeof listArticlesPage>>): void {
  if (resp.base_resp?.ret === 0) return;
  const message = resp.base_resp?.err_msg || 'article list failed';
  if (resp.base_resp?.ret === 200013 || /freq control|限流|操作频繁/i.test(message)) {
    throw new RateLimitError(`文章列表限流:${message}`);
  }
  throw new Error(message);
}

export function latestArticleGate<T>(articles: readonly T[], max = MAX_EXPORT_ARTICLES): T[] {
  return articles.slice(0, max);
}

async function fetchAllArticles(
  authKey: string,
  account: string,
  max = MAX_EXPORT_ARTICLES
): Promise<ArticleListItem[]> {
  const articles: ArticleListItem[] = [];
  let begin = 0;
  while (articles.length < max) {
    const pageSize = Math.min(10, max - articles.length);
    const resp = await listArticlesPage(authKey, account, begin, pageSize);
    assertArticleListOk(resp);
    const page = resp.articles ?? [];
    if (page.length === 0) break;
    articles.push(...latestArticleGate(page, max - articles.length));
    const messageCount = page.filter(item => Number(item.itemidx || item.idx || 1) === 1).length;
    begin += messageCount || page.length;
  }
  return articles;
}

function dedupe(articles: ArticleListItem[]): ArticleListItem[] {
  const seen = new Set<string>();
  return articles.filter(article => {
    const key = articleIdentityKey(article);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 稳定文章键:优先 appmsgid+itemidx，链接只作旧数据兜底。 */
export function articleIdentityKey(article: ArticleListItem): string {
  const appmsgid = article.appmsgid ?? article.aid;
  const itemidx = article.itemidx ?? article.idx ?? 1;
  return appmsgid === undefined ? `link:${article.link}` : `id:${String(appmsgid)}:${String(itemidx)}`;
}

interface ExistingArticleIndex {
  keys: Set<string>;
  baseOwners: Map<string, string>;
}

/** 已有文章稳定键 + 文件夹占用关系，从各篇 raw.json 读取。 */
async function loadExistingArticleIndex(): Promise<ExistingArticleIndex> {
  const entries = await readDetailEntries().catch(() => [] as DetailEntry[]);
  return {
    keys: new Set(entries.map(e => articleIdentityKey(e.listItem))),
    baseOwners: new Map(entries.map(e => [e.dirBase, articleIdentityKey(e.listItem)])),
  };
}

/** 同日同标题但不同 appmsgid 时追加稳定后缀，避免互相覆盖。 */
export function resolveArticleBase(
  preferredBase: string,
  article: ArticleListItem,
  baseOwners: ReadonlyMap<string, string>
): string {
  const key = articleIdentityKey(article);
  const owner = baseOwners.get(preferredBase);
  if (!owner || owner === key) return preferredBase;
  const appmsgid = article.appmsgid ?? article.aid ?? 'unknown';
  const itemidx = article.itemidx ?? article.idx ?? 1;
  return safeName(`${preferredBase}-${String(appmsgid)}_${String(itemidx)}`, preferredBase);
}

export async function run(options: { incremental?: boolean } = {}): Promise<void> {
  const incremental = options.incremental ?? false;
  await fs.mkdir(config.accountDir, { recursive: true });

  const authKey = await loadAuthKey();
  const accountNickname = config.accountExact;
  const uniqueArticles = latestArticleGate(dedupe(await fetchAllArticles(authKey, config.accountExact)));
  const existing = await loadExistingArticleIndex();

  let done = 0;
  let fetched = 0;
  for (const article of uniqueArticles) {
    done += 1;

    // 增量:已抓过的文章跳过(文件夹已存在,正文基本不变)
    if (incremental && existing.keys.has(articleIdentityKey(article))) continue;

    const detail = await downloadArticle(article.link);

    const published = toDate(detail.ori_create_time || detail.ori_send_time || article.create_time);
    const title = decodeHtmlEntities(detail.title || article.title || 'untitled');
    if (!published) {
      console.warn(`[${done}/${uniqueArticles.length}] 跳过(缺发布时间):${title}`);
      continue;
    }
    fetched += 1;
    const preferredBase = safeName(`${published}-${title}`, `article-${done}`);
    const base = resolveArticleBase(preferredBase, article, existing.baseOwners);
    const { dir, md, rawJson, mediaDir } = articlePaths(base);
    await fs.mkdir(mediaDir, { recursive: true });

    const contentHtml = await normalizeContentImages(detail.content_noencode || detail.content || '', mediaDir, base);
    const textBody = /<[a-z][\s\S]*>/i.test(contentHtml) ? turndown.turndown(contentHtml) : contentHtml.trim();

    // 图集/图片消息:多张图在 picture_page_info_list(正文 HTML 无 <img>),单独下载并拼成图片块
    const galleryParts: string[] = [];
    let gi = 1;
    for (const pic of detail.picture_page_info_list ?? []) {
      const url = pic.cdn_url;
      if (!url || !/^https?:\/\//.test(url)) continue;
      try {
        const fn = await downloadImage(url, mediaDir, `${base}-${String(gi).padStart(2, '0')}`);
        galleryParts.push(`![](media/${fn})`);
      } catch {
        galleryParts.push(`![](${url})`); // 下载失败保留原链
      }
      gi++;
    }
    const body = [textBody, galleryParts.join('\n\n')].filter(Boolean).join('\n\n');

    let coverPath = '';
    const coverUrl = detail.cdn_url || detail.cover || article.cover;
    if (coverUrl && /^https?:\/\//.test(coverUrl)) {
      try {
        coverPath = `media/${await downloadImage(coverUrl, mediaDir, `${base}-cover`)}`;
      } catch {
        // 封面下载失败不阻断正文
      }
    }

    const digest = detail.desc || article.digest || '';
    const quote = digest ? `> ${digest.replace(/\n/g, '  \n> ')}\n\n` : '';
    const sourceUrl = detail.link || article.link;
    const markdown = `---
source_platform: wechat_mp
account: ${yamlString(detail.nick_name || accountNickname)}
title: ${yamlString(title)}
author: ${yamlString(detail.author || article.author || '')}
published: ${yamlString(toDateTime(detail.ori_create_time || detail.ori_send_time || article.create_time))}
source_url: ${yamlString(sourceUrl)}
cover: ${yamlString(coverPath || coverUrl || '')}
digest: ${yamlString(digest)}
tags:
  - wechat
  - 公众号
---

# ${title}

${quote}${body}

---

原文链接: ${sourceUrl}
`;

    await fs.writeFile(md, markdown);
    await fs.writeFile(rawJson, JSON.stringify({ listItem: { ...article, link: sourceUrl }, detail }, null, 2));
    existing.keys.add(articleIdentityKey(article));
    existing.baseOwners.set(base, articleIdentityKey(article));
    console.log(`[${done}/${uniqueArticles.length}] ${title}  → ${dir.replace(config.accountDir, '.')}`);
  }

  console.log(`EXPORT_OK ${config.accountDir}`);
  console.log(`ARTICLES ${uniqueArticles.length}${incremental ? ` (新抓 ${fetched})` : ''}`);
}

if (isMain(import.meta.url)) runCli(() => run({ incremental: process.env.WECHAT_INCREMENTAL === '1' }));
