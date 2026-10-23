import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';
import { z } from 'zod';
import { config } from './config/index.js';
import {
  materialDir,
  newSeenFile,
  nowInShanghaiDate,
  seenKey,
  subredditTopUrl,
  titleBlocked,
} from './reddit-helpers.js';
import { parseHtmlListing, parseHtmlPostDetails } from './reddit-html.js';
import {
  isRedditBlockPage,
  parseRssListing,
  parseRssPostDetails,
  postCommentsRssUrl,
  subredditTopRssUrl,
} from './reddit-rss.js';
import { translateRedditSegments } from './reddit-translator.js';
import type {
  RedditListItem,
  RedditPostDetails,
  RedditPostJson,
  RedditRuntimeStatus,
  RedditSeenFile,
  RedditSeenSub,
  RedditWatchSub,
} from './reddit-types.js';
import { isMain, runCli } from './utils/cli.js';
import { sleep } from './utils/retry.js';

type RedditListingSource = 'html' | 'rss';

interface RedditListingResult {
  items: RedditListItem[];
  source: RedditListingSource;
}

const subredditNameSchema = z.string().regex(/^[A-Za-z0-9_]{2,21}$/);
const watchlistSchema = z.object({
  subs: z.array(z.object({ name: subredditNameSchema, minScore: z.number().int().min(1).optional() })),
});

const seenSubSchema = z.object({
  ids: z.array(z.string().min(1)),
  seeded_at: z.string().optional(),
  updated_at: z.string().optional(),
});
const seenFileSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  subs: z.record(z.string(), seenSubSchema),
});

export function getRedditRuntimeStatus(): RedditRuntimeStatus {
  if (config.reddit.skip) return { ok: false, reason: 'REDDIT_COLLECT_SKIP 已设置' };
  if (!fs.existsSync(config.reddit.chromePath))
    return { ok: false, reason: `Chrome 不存在:${config.reddit.chromePath}` };
  return { ok: true };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(file: string): Promise<unknown | null> {
  const raw = await fsp.readFile(file, 'utf8').catch(() => null);
  if (raw === null) return null;
  return JSON.parse(raw) as unknown;
}

async function readWatchlist(): Promise<RedditWatchSub[]> {
  const raw = await readJsonFile(config.paths.redditWatchlist);
  if (raw === null) {
    return config.reddit.defaultSubs.map(name => ({ name, minScore: config.reddit.minScore }));
  }
  const parsed = watchlistSchema.parse(raw);
  return parsed.subs.map(sub => ({ name: sub.name, minScore: sub.minScore ?? config.reddit.minScore }));
}

async function readSeen(): Promise<RedditSeenFile> {
  const raw = await readJsonFile(config.reddit.seenPath);
  if (raw === null) return newSeenFile();
  const parsed = seenFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[reddit] seen 文件无法解析,将重新建立:${config.reddit.seenPath}`);
    return newSeenFile();
  }
  return parsed.data;
}

async function writeSeen(seen: RedditSeenFile): Promise<void> {
  await fsp.mkdir(path.dirname(config.reddit.seenPath), { recursive: true });
  await fsp.writeFile(config.reddit.seenPath, `${JSON.stringify(seen, null, 2)}\n`);
}

function ensureSeenSub(seen: RedditSeenFile, sub: string, nowIso: string): RedditSeenSub {
  const key = seenKey(sub);
  const existing = seen.subs[key];
  if (existing) return existing;
  const created: RedditSeenSub = { ids: [], seeded_at: nowIso, updated_at: nowIso };
  seen.subs[key] = created;
  return created;
}

function addSeenId(seen: RedditSeenFile, sub: string, id: string, nowIso: string): void {
  const seenSub = ensureSeenSub(seen, sub, nowIso);
  if (!seenSub.ids.includes(id)) seenSub.ids.push(id);
  seenSub.updated_at = nowIso;
}

async function gotoAndRead(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(800);
  return page.content();
}

async function gotoAndReadRss(page: Page, url: string): Promise<string> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(800);
  const text = String(
    await page.evaluate('document.querySelector("pre")?.textContent ?? document.documentElement.outerHTML')
  );
  if ((response?.status() ?? 0) >= 400)
    throw new Error(`Reddit RSS ${response?.status() ?? 'unknown'}: ${text.slice(0, 300)}`);
  if (isRedditBlockPage(text)) throw new Error(`Reddit RSS 返回安全拦截页:${url}`);
  return text;
}

async function launchBrowser(): Promise<Browser> {
  await fsp.mkdir(config.reddit.userDataDir, { recursive: true });
  return puppeteer.launch({
    executablePath: config.reddit.chromePath,
    headless: true,
    userDataDir: config.reddit.userDataDir,
    defaultViewport: { width: 1360, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check', `--proxy-server=${config.reddit.proxy}`],
  });
}

async function newRedditPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.setUserAgent(config.reddit.userAgent);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  return page;
}

function buildTextSegments(item: RedditListItem, details: RedditPostDetails): string[] {
  const segments = [`Title: ${item.title}`];
  if (details.selftext) segments.push(`Post:\n${details.selftext}`);
  if (details.comments.length > 0) {
    segments.push(
      `Top comments:\n${details.comments
        .map((comment, index) => `${index + 1}. u/${comment.author} (${comment.score}): ${comment.body}`)
        .join('\n\n')}`
    );
  }
  return segments;
}

async function tryTranslate(segments: string[]): Promise<string[]> {
  try {
    return await translateRedditSegments(segments, {
      model: config.reddit.translationModel,
    });
  } catch (error) {
    console.warn(`[reddit] 翻译失败,仅保留英文:${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function buildMarkdown(
  item: RedditListItem,
  sub: string,
  textEn: string[],
  textZh: string[],
  collectedAt: string
): string {
  const zhSection = textZh.length > 0 ? textZh.join('\n\n') : '';
  const scoreLabel = (item.scoreKnown ?? true) ? String(item.score) : '未知';
  const commentsLabel = (item.commentsKnown ?? true) ? String(item.comments) : '未知';
  return `# ${item.title}

**时间：** ${item.created_at ?? collectedAt}
**Subreddit：** r/${sub}
**点赞：** ${scoreLabel} · **回复：** ${commentsLabel}
**URL：** ${item.permalink}

---

## 原文

${textEn.join('\n\n')}

## 译文

${zhSection}
`;
}

async function writeMaterial(
  date: string,
  sub: string,
  item: RedditListItem,
  details: RedditPostDetails,
  textEn: string[],
  textZh: string[],
  collectedAt: string
): Promise<void> {
  const dir = materialDir(date, sub, item.id);
  await fsp.mkdir(dir, { recursive: true });
  const postJson: RedditPostJson = {
    source_type: 'reddit',
    source_id: item.id,
    reddit_id: item.id,
    url: item.permalink,
    created_at: item.created_at ?? collectedAt,
    collected_at: collectedAt,
    subreddit: sub,
    title: item.title,
    author: { name: `r/${sub}`, handle: `u/${item.author}` },
    text_en: textEn,
    text_zh: textZh,
    metrics: {
      views: 0,
      reply: item.comments,
      retweet: 0,
      like: item.score,
      score: item.score,
      comments: item.comments,
    },
    is_retweet: false,
    quoted: null,
    media: [],
    target_lang: 'zh',
    is_self: item.is_self,
    external_url: item.external_url,
    comments: details.comments,
  };
  await fsp.writeFile(path.join(dir, 'post.json'), `${JSON.stringify(postJson, null, 2)}\n`);
  await fsp.writeFile(path.join(dir, 'content.md'), buildMarkdown(item, sub, textEn, textZh, collectedAt));
}

async function readListing(page: Page, sub: string): Promise<RedditListingResult> {
  const listingHtml = await gotoAndRead(page, subredditTopUrl(sub));
  const htmlItems = parseHtmlListing(listingHtml);
  if (htmlItems.length > 0) return { items: htmlItems, source: 'html' };

  const reason = isRedditBlockPage(listingHtml) ? 'Reddit 返回安全拦截页' : 'old.reddit 未解析到帖子';
  console.warn(`[reddit] r/${sub} ${reason},改用 RSS fallback。`);
  const rssItems = parseRssListing(await gotoAndReadRss(page, subredditTopRssUrl(sub)));
  if (rssItems.length === 0) throw new Error(`r/${sub} RSS fallback 未解析到帖子`);
  console.warn(`[reddit] r/${sub} RSS 不含 score,本次跳过 minScore 精确过滤。`);
  return { items: rssItems, source: 'rss' };
}

async function readRssPostDetails(page: Page, item: RedditListItem): Promise<RedditPostDetails> {
  return parseRssPostDetails(await gotoAndReadRss(page, postCommentsRssUrl(item.permalink)));
}

async function readPostDetails(
  page: Page,
  item: RedditListItem,
  source: RedditListingSource
): Promise<RedditPostDetails> {
  if (source === 'rss') return readRssPostDetails(page, item);
  const html = await gotoAndRead(page, item.permalink);
  if (!isRedditBlockPage(html)) return parseHtmlPostDetails(html);
  console.warn(`[reddit] 帖子页被 Reddit 拦截,改用评论 RSS fallback:${item.permalink}`);
  return readRssPostDetails(page, item);
}

async function collectSub(
  page: Page,
  sub: RedditWatchSub,
  seen: RedditSeenFile,
  date: string,
  nowIso: string
): Promise<number> {
  const key = seenKey(sub.name);
  const hadSeen = Object.hasOwn(seen.subs, key);
  console.log(`[reddit] r/${sub.name} top/week, minScore=${sub.minScore}`);
  const listing = await readListing(page, sub.name);
  const items = listing.items;

  if (!hadSeen) {
    const seenSub = ensureSeenSub(seen, sub.name, nowIso);
    seenSub.ids = [...new Set([...seenSub.ids, ...items.map(item => item.id)])];
    seenSub.updated_at = nowIso;
    console.log(`[reddit] r/${sub.name} 首次运行,seed ${items.length} 条水位,不回采历史。`);
    return 0;
  }

  const seenIds = new Set(seen.subs[key]?.ids ?? []);
  let collected = 0;
  for (const item of items) {
    if ((item.scoreKnown ?? true) && item.score < sub.minScore) continue;
    if (seenIds.has(item.id)) continue;
    if (item.nsfw || titleBlocked(item.title)) {
      addSeenId(seen, sub.name, item.id, nowIso);
      seenIds.add(item.id);
      console.log(`[reddit] 跳过敏感/黑名单标题 r/${sub.name}/${item.id}: ${item.title}`);
      continue;
    }

    const dir = materialDir(date, sub.name, item.id);
    if (await fileExists(path.join(dir, 'post.json'))) {
      addSeenId(seen, sub.name, item.id, nowIso);
      seenIds.add(item.id);
      console.log(`[reddit] 已存在,补写 seen: ${path.relative(config.paths.materialsDir, dir)}`);
      continue;
    }

    await sleep(config.reddit.requestIntervalMs);
    const details = await readPostDetails(page, item, listing.source);
    const textEn = buildTextSegments(item, details);
    const textZh = await tryTranslate(textEn);
    await writeMaterial(date, sub.name, item, details, textEn, textZh, nowIso);
    addSeenId(seen, sub.name, item.id, nowIso);
    seenIds.add(item.id);
    collected += 1;
    console.log(`[reddit] 已落库 r/${sub.name}/${item.id}: ${item.title}`);
  }
  return collected;
}

export async function run(): Promise<void> {
  const status = getRedditRuntimeStatus();
  if (!status.ok) {
    console.log(`[reddit] 跳过:${status.reason ?? '本地 Chrome 不可用'}`);
    return;
  }

  const watchlist = await readWatchlist();
  if (watchlist.length === 0) {
    console.log('[reddit] reddit-watchlist.json 为空,跳过。');
    return;
  }

  const seen = await readSeen();
  const date = nowInShanghaiDate();
  const nowIso = new Date().toISOString();
  await fsp.mkdir(config.paths.materialsDir, { recursive: true });
  console.log(
    `[reddit] 账号=${config.accountExact}, watchlist=${config.paths.redditWatchlist}, seen=${config.reddit.seenPath}`
  );
  console.log(`[reddit] Chrome=${config.reddit.chromePath}, proxy=${config.reddit.proxy}`);
  console.log(`[reddit] 翻译=Codex SDK, model=${config.reddit.translationModel}`);

  const browser = await launchBrowser();
  let total = 0;
  try {
    const page = await newRedditPage(browser);
    for (const [i, sub] of watchlist.entries()) {
      total += await collectSub(page, sub, seen, date, nowIso);
      if (i < watchlist.length - 1) await sleep(config.reddit.requestIntervalMs);
    }
  } finally {
    await browser.close().catch(() => {});
    await writeSeen(seen);
  }
  console.log(`[reddit] 完成,新增 ${total} 条素材。`);
}

if (isMain(import.meta.url)) runCli(run);
