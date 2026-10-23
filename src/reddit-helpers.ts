import path from 'node:path';
import { config } from './config/index.js';
import type { RedditSeenFile } from './reddit-types.js';
export function nowInShanghaiDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeBlock(value: string): string {
  return value
    .replace(/\r/g, '')
    .split('\n')
    .map(line => normalizeWhitespace(line))
    .filter(Boolean)
    .join('\n');
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function parseCount(value: string | undefined): number {
  const text = (value ?? '').replace(/,/g, '').trim().toLowerCase();
  const kilo = text.match(/([\d.]+)\s*k/);
  const kiloRaw = kilo?.[1];
  if (kiloRaw) {
    const parsed = Number(kiloRaw);
    return Number.isFinite(parsed) ? Math.round(parsed * 1000) : 0;
  }
  const plain = text.match(/([\d.]+)/);
  const plainRaw = plain?.[1];
  if (!plainRaw) return 0;
  const parsed = Number(plainRaw);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export function parseRedditId(fullname: string, permalink: string): string {
  const fromFullname = fullname.match(/^t3_([A-Za-z0-9]+)$/)?.[1];
  if (fromFullname) return fromFullname;
  return permalink.match(/\/comments\/([A-Za-z0-9]+)\//)?.[1] ?? '';
}

export function absoluteUrl(value: string): string {
  return new URL(value, config.reddit.baseUrl).toString();
}

export function subredditTopUrl(name: string): string {
  return `${config.reddit.baseUrl}/r/${encodeURIComponent(name)}/top/?t=week`;
}

export function seenKey(name: string): string {
  return name.toLowerCase();
}

export function safePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function titleBlocked(title: string): boolean {
  const haystack = title.toLowerCase();
  return config.reddit.titleDenyKeywords.some(keyword => haystack.includes(keyword.toLowerCase()));
}

export function materialDir(date: string, sub: string, id: string): string {
  return path.join(config.paths.materialsDir, date, `${date}_reddit_${safePathPart(sub)}_${safePathPart(id)}`);
}

export function newSeenFile(): RedditSeenFile {
  return { version: 1, account: config.accountExact, subs: {} };
}
