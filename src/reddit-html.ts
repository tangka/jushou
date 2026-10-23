import * as cheerio from 'cheerio';
import { config } from './config/index.js';
import {
  absoluteUrl,
  normalizeBlock,
  normalizeWhitespace,
  parseCount,
  parseRedditId,
  truncate,
} from './reddit-helpers.js';
import type { RedditComment, RedditListItem, RedditPostDetails } from './reddit-types.js';

export function parseHtmlListing(html: string): RedditListItem[] {
  const $ = cheerio.load(html);
  const out: RedditListItem[] = [];
  $('div.thing').each((_index, element) => {
    if (out.length >= config.reddit.topLimit) return false;
    const node = $(element);
    const titleNode = node.find('a.title').first();
    const title = normalizeWhitespace(titleNode.text());
    const permalinkRaw = node.attr('data-permalink') ?? node.find('a.comments').first().attr('href') ?? '';
    if (!title || !permalinkRaw) return;

    const permalink = absoluteUrl(permalinkRaw);
    const id = parseRedditId(node.attr('data-fullname') ?? '', permalink);
    if (!id) return;

    const author = normalizeWhitespace(node.attr('data-author') ?? node.find('a.author').first().text()) || '[deleted]';
    const score = parseCount(
      node.attr('data-score') ??
        node.find('.score.unvoted').first().attr('title') ??
        node.find('.score.unvoted').first().text()
    );
    const comments = parseCount(node.attr('data-comments-count') ?? node.find('a.comments').first().text());
    const domain = node.attr('data-domain') ?? '';
    const className = node.attr('class') ?? '';
    const titleHref = titleNode.attr('href') ?? '';
    const externalUrl =
      titleHref.startsWith('http') && !titleHref.includes('/comments/') ? absoluteUrl(titleHref) : undefined;

    out.push({
      id,
      title,
      score,
      comments,
      scoreKnown: true,
      commentsKnown: true,
      permalink,
      author,
      is_self: className.split(/\s+/).includes('self') || domain.startsWith('self.'),
      nsfw: className.split(/\s+/).includes('over18') || /\bnsfw\b/i.test(title),
      created_at: node.find('time').first().attr('datetime') ?? node.find('time').first().attr('title'),
      external_url: externalUrl,
    });
  });
  return out;
}

export function parseHtmlPostDetails(html: string): RedditPostDetails {
  const $ = cheerio.load(html);
  const selftext = truncate(normalizeBlock($('div.thing.link .usertext-body .md').first().text()), 4000);
  const comments: RedditComment[] = [];

  $('div.comment').each((_index, element) => {
    const node = $(element);
    const body = truncate(normalizeBlock(node.find('.usertext-body .md').first().text()), 1200);
    if (!body || body === '[deleted]' || body === '[removed]') return;
    const author = normalizeWhitespace(node.attr('data-author') ?? node.find('a.author').first().text()) || '[deleted]';
    const score = parseCount(
      node.find('.score.unvoted').first().attr('title') ?? node.find('.score.unvoted').first().text()
    );
    comments.push({ author, score, body });
  });

  comments.sort((a, b) => b.score - a.score);
  return { selftext, comments: comments.slice(0, config.reddit.commentsLimit) };
}
