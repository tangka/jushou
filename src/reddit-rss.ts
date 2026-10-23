import * as cheerio from 'cheerio';
import { config } from './config/index.js';
import { normalizeBlock, normalizeWhitespace, parseRedditId, truncate } from './reddit-helpers.js';
import type { RedditComment, RedditListItem, RedditPostDetails } from './reddit-types.js';

export function isRedditBlockPage(html: string): boolean {
  return (
    html.includes("You've been blocked by network security") ||
    html.includes('Your request has been blocked due to a network policy') ||
    html.includes('whoa there, pardner')
  );
}

function redditUrl(value: string): string {
  return new URL(value, config.reddit.rssBaseUrl).toString();
}

export function subredditTopRssUrl(name: string): string {
  return `${config.reddit.rssBaseUrl}/r/${encodeURIComponent(name)}/top/.rss?t=week`;
}

export function postCommentsRssUrl(permalink: string): string {
  const url = new URL(permalink, config.reddit.rssBaseUrl);
  const base = new URL(config.reddit.rssBaseUrl);
  url.protocol = base.protocol;
  url.host = base.host;
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  url.pathname = `${url.pathname}.rss`;
  url.search = 'sort=top';
  return url.toString();
}

function cleanAuthor(value: string): string {
  const normalized = normalizeWhitespace(value);
  return normalized.replace(/^\/?u\//i, '') || '[deleted]';
}

function contentText(contentHtml: string, maxLength: number): string {
  const $ = cheerio.load(contentHtml);
  const markdown = $('.md').first();
  const text = markdown.length > 0 ? markdown.text() : $.root().text();
  return truncate(normalizeBlock(text), maxLength);
}

function isCommentsUrl(value: string): boolean {
  try {
    const url = new URL(value, config.reddit.rssBaseUrl);
    return url.hostname.endsWith('reddit.com') && /\/comments\/[A-Za-z0-9]+/.test(url.pathname);
  } catch {
    return false;
  }
}

function externalUrlFromContent(contentHtml: string): string | undefined {
  const $ = cheerio.load(contentHtml);
  for (const link of $('a').toArray()) {
    const node = $(link);
    if (normalizeWhitespace(node.text()) !== '[link]') continue;
    const href = node.attr('href');
    if (!href || isCommentsUrl(href)) continue;
    return redditUrl(href);
  }
  return undefined;
}

export function parseRssListing(xml: string): RedditListItem[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: RedditListItem[] = [];
  $('entry').each((_index, element) => {
    if (out.length >= config.reddit.topLimit) return false;
    const node = $(element);
    const title = normalizeWhitespace(node.children('title').first().text());
    const permalinkRaw = node.children('link').first().attr('href') ?? '';
    const id = parseRedditId(node.children('id').first().text(), permalinkRaw);
    if (!title || !id || !permalinkRaw) return;

    const contentHtml = node.children('content').first().text();
    const externalUrl = externalUrlFromContent(contentHtml);
    out.push({
      id,
      title,
      score: 0,
      comments: 0,
      scoreKnown: false,
      commentsKnown: false,
      permalink: redditUrl(permalinkRaw),
      author: cleanAuthor(node.find('author > name').first().text()),
      is_self: externalUrl === undefined,
      nsfw: /\bnsfw\b/i.test(title),
      created_at: node.children('published').first().text() || node.children('updated').first().text(),
      external_url: externalUrl,
    });
  });
  return out;
}

export function parseRssPostDetails(xml: string): RedditPostDetails {
  const $ = cheerio.load(xml, { xmlMode: true });
  let selftext = '';
  const comments: RedditComment[] = [];

  $('entry').each((index, element) => {
    const node = $(element);
    const body = contentText(node.children('content').first().text(), index === 0 ? 4000 : 1200);
    if (index === 0) {
      selftext = body;
      return;
    }
    if (!body || body === '[deleted]' || body === '[removed]') return;
    comments.push({
      author: cleanAuthor(node.find('author > name').first().text()),
      score: 0,
      body,
    });
  });

  return { selftext, comments: comments.slice(0, config.reddit.commentsLimit) };
}
