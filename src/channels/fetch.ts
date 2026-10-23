import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Browser, HTTPResponse, Page } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';
import { config } from '../config/index.js';
import { AuthExpiredError } from '../errors.js';
import {
  type ChannelDailyFans,
  type ChannelFansTabDaily,
  type ChannelRawCapture,
  type ChannelRequestBody,
  type ChannelVideo,
  channelFansTrendResponseSchema,
  channelPostListResponseSchema,
  channelRequestBodySchema,
} from '../types/channels.js';
import { assertChannelAccountIdentity } from './account-identity.js';

const TARGETS = {
  post_list: '/post/post_list',
  fans_trend: '/statistic/fans_trend',
} as const;

type ChannelTarget = keyof typeof TARGETS;

const DAY_SECONDS = 86_400;
const STEP_MS = 800;

export interface ChannelsRuntimeStatus {
  ok: boolean;
  reason?: string;
}

export interface FetchChannelsOptions {
  /** 默认 false:首次登录需要 headful 扫码。 */
  headless?: boolean;
  timeoutMs?: number;
}

export interface FetchChannelsResult {
  videos: ChannelVideo[];
  postListTotalCount: number;
  dailyFans: ChannelDailyFans[];
  captures: Record<ChannelTarget, ChannelRawCapture[]>;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number, stepMs = STEP_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(stepMs);
  }
  return predicate();
}

function parsePostData(postData: string | undefined): unknown {
  if (!postData) return null;
  try {
    return JSON.parse(postData) as unknown;
  } catch {
    const params = new URLSearchParams(postData);
    if ([...params.keys()].length === 0) return null;
    const record: Record<string, string> = {};
    for (const [key, value] of params.entries()) record[key] = value;
    return record;
  }
}

function parseRequestBody(response: HTTPResponse): ChannelRequestBody | null {
  const parsed = channelRequestBodySchema.safeParse(parsePostData(response.request().postData()));
  return parsed.success ? parsed.data : null;
}

function toUnixSeconds(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
}

function dateInShanghai(unixSec: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(unixSec * 1000));
}

function fallbackEndTs(): number {
  return Math.floor(Date.now() / 1000) - DAY_SECONDS;
}

function seriesDates(length: number, requestBody: ChannelRequestBody | null): string[] {
  const startTs = toUnixSeconds(requestBody?.startTs ?? requestBody?.beginTs);
  const endTs = toUnixSeconds(requestBody?.endTs);
  if (startTs !== null) return Array.from({ length }, (_, i) => dateInShanghai(startTs + i * DAY_SECONDS));
  const end = endTs ?? fallbackEndTs();
  return Array.from({ length }, (_, i) => dateInShanghai(end - (length - i - 1) * DAY_SECONDS));
}

function numberAt(series: number[], index: number): number {
  return series[index] ?? 0;
}

function dailyTabs(
  tabs: { add: number[]; reduce: number[]; netAdd: number[]; total: number[]; tabType: number; tabTypeName: string }[],
  index: number
): ChannelFansTabDaily[] {
  return tabs.map(tab => ({
    tabType: tab.tabType,
    tabTypeName: tab.tabTypeName,
    add: numberAt(tab.add, index),
    reduce: numberAt(tab.reduce, index),
    netAdd: numberAt(tab.netAdd, index),
    total: numberAt(tab.total, index),
  }));
}

function buildDailyFans(raw: unknown, requestBody: ChannelRequestBody | null): ChannelDailyFans[] {
  const parsed = channelFansTrendResponseSchema.parse(raw);
  const data = parsed.data;
  const length = Math.max(data.add.length, data.reduce.length, data.netAdd.length, data.total.length);
  const dates = seriesDates(length, requestBody);
  return dates.map((date, index) => ({
    date,
    add: numberAt(data.add, index),
    reduce: numberAt(data.reduce, index),
    netAdd: numberAt(data.netAdd, index),
    total: numberAt(data.total, index),
    fansDataByTabtype: dailyTabs(data.fansDataByTabtype, index),
  }));
}

export function getChannelsRuntimeStatus(): ChannelsRuntimeStatus {
  if (config.channels.skip) return { ok: false, reason: 'WECHAT_CHANNELS_SKIP 已设置' };
  if (!fs.existsSync(config.channels.chromePath))
    return { ok: false, reason: `Chrome 不存在:${config.channels.chromePath}` };
  return { ok: true };
}

function newCaptureStore(): Record<ChannelTarget, ChannelRawCapture[]> {
  return { post_list: [], fans_trend: [] };
}

/** fans_trend 原始请求(url + body),用于按更长窗口在页面上下文重发(沿用其 endTs)。 */
interface FansRequestRef {
  value: { url: string; rawBody: string } | null;
}

async function attachCaptureHandler(
  page: Page,
  captures: Record<ChannelTarget, ChannelRawCapture[]>,
  videosById: Map<string, ChannelVideo>,
  fansTrendRows: ChannelDailyFans[],
  totalCountRef: { value: number },
  postListSeenRef: { value: boolean },
  fansReq: FansRequestRef
): Promise<void> {
  page.on('response', (response: HTTPResponse) => {
    const url = response.url();
    const target = (Object.entries(TARGETS) as [ChannelTarget, string][]).find(([, needle]) =>
      url.includes(needle)
    )?.[0];
    if (!target) return;

    if (target === 'fans_trend' && !fansReq.value)
      fansReq.value = { url, rawBody: response.request().postData() ?? '' };

    void response
      .json()
      .then((json: unknown) => {
        const requestBody = parseRequestBody(response);
        captures[target].push({ matchedUrl: url, requestBody, json, capturedAt: Math.floor(Date.now() / 1000) });

        if (target === 'post_list') {
          const parsed = channelPostListResponseSchema.parse(json);
          postListSeenRef.value = true;
          if (parsed.errCode !== 0) throw new Error(parsed.errMsg || `post_list errCode=${parsed.errCode}`);
          totalCountRef.value = Math.max(totalCountRef.value, parsed.data.totalCount);
          for (const video of parsed.data.list) videosById.set(video.objectId, video);
        } else {
          const parsed = channelFansTrendResponseSchema.parse(json);
          if (parsed.errCode !== 0) throw new Error(parsed.errMsg || `fans_trend errCode=${parsed.errCode}`);
          // 页面会发多个 fans_trend(不同窗口/粒度);取「天数最多」的那次,别被聚合成少数桶的响应覆盖
          const rows = buildDailyFans(json, requestBody);
          if (rows.length >= fansTrendRows.length) fansTrendRows.splice(0, fansTrendRows.length, ...rows);
        }
      })
      .catch((error: unknown) => {
        console.warn(`[channels] 响应解析失败:${error instanceof Error ? error.message : String(error)}`);
      });
  });
}

async function gotoAndIgnoreTimeout(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 }).catch(() => {});
}

async function collectPostList(
  page: Page,
  videosById: Map<string, ChannelVideo>,
  totalCountRef: { value: number },
  postListSeenRef: { value: boolean },
  timeoutMs: number
): Promise<void> {
  console.log('[channels] 打开视频列表页…');
  await gotoAndIgnoreTimeout(page, `${config.channels.baseUrl}/platform/post/list`);
  const first = await waitFor(() => postListSeenRef.value, timeoutMs);
  if (!first) {
    // 跳到登录页 = 视频号登录态过期 → 抛 AuthExpiredError,通知会提示「本地重扫」(ADR 0004)
    if (/login|\/auth/i.test(page.url())) {
      throw new AuthExpiredError('视频号登录态已过期,请本地跑 `pnpm channels` 重新扫码(微信扫一扫)。');
    }
    throw new Error('未截获视频号 post_list 响应(可能页面结构变化)');
  }

  // 列表多于首屏时,滚动触发页面自己的翻页 XHR;不手写接口请求。
  let stagnant = 0;
  let lastSize = videosById.size;
  for (let i = 0; i < 10; i++) {
    if (totalCountRef.value > 0 && videosById.size >= totalCountRef.value) break;
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await page.mouse.wheel({ deltaY: 2400 }).catch(() => {});
    await delay(1500);
    if (videosById.size === lastSize) stagnant += 1;
    else stagnant = 0;
    lastSize = videosById.size;
    if (stagnant >= 3) break;
  }
}

async function collectFansTrend(page: Page, fansTrendRows: ChannelDailyFans[], timeoutMs: number): Promise<void> {
  console.log('[channels] 打开粉丝趋势页…');
  await gotoAndIgnoreTimeout(page, `${config.channels.baseUrl}/platform/statistic/follower`);
  const ok = await waitFor(() => fansTrendRows.length > 0, Math.min(timeoutMs, 60_000));
  if (!ok) throw new Error('未截获视频号 fans_trend 响应(可能未登录或页面结构变化)');
}

/**
 * 抓完页面默认窗口后,**沿用页面请求的 endTs**、把 startTs 前推 days 天、保留原 interval,
 * 在页面上下文用页面自己的 fetch 重发 fans_trend(签名/指纹由页面 JS 处理)。
 * 实测 interval=3 即「按天」,该窗口返回 days 个日点;响应由拦截器接住,「长的赢」守卫保留它。
 * 关键:别把 endTs 改成「现在」(当天未结算),否则后台返回异常聚合(见 BUGS:30 天回填)。
 */
async function extendFansWindow(
  page: Page,
  fansReq: FansRequestRef,
  captures: Record<ChannelTarget, ChannelRawCapture[]>,
  days: number,
  timeoutMs: number
): Promise<void> {
  const req = fansReq.value;
  if (!req?.rawBody) return;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(req.rawBody) as Record<string, unknown>;
  } catch {
    return;
  }
  const endTs = Number(obj.endTs);
  if (!Number.isFinite(endTs)) return;
  obj.startTs = String(endTs - days * DAY_SECONDS); // 沿用 endTs,只前推 startTs
  const newBody = JSON.stringify(obj);
  console.log(`[channels] 回填 ${days} 天粉丝趋势…`);
  const before = captures.fans_trend.length;
  await page
    .evaluate(
      async (u: string, b: string) => {
        await fetch(u, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: b,
          credentials: 'include',
        }).catch(() => {});
      },
      req.url,
      newBody
    )
    .catch(() => {});
  await waitFor(() => captures.fans_trend.length > before, Math.min(timeoutMs, 30_000));
}

export async function fetchChannelsData(options: FetchChannelsOptions = {}): Promise<FetchChannelsResult> {
  const status = getChannelsRuntimeStatus();
  if (!status.ok) throw new Error(status.reason ?? '视频号采集不可用');

  await fsp.mkdir(config.channels.userDataDir, { recursive: true });
  const timeoutMs = options.timeoutMs ?? config.channels.captureTimeoutMs;
  console.log(`[channels] 账号=${config.accountExact}`);
  console.log(`[channels] Chrome profile=${path.relative(process.cwd(), config.channels.userDataDir)}`);

  const browser: Browser = await puppeteer.launch({
    executablePath: config.channels.chromePath,
    headless: options.headless ?? false,
    userDataDir: config.channels.userDataDir,
    defaultViewport: { width: 1360, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });

  const captures = newCaptureStore();
  const videosById = new Map<string, ChannelVideo>();
  const fansTrendRows: ChannelDailyFans[] = [];
  const totalCountRef = { value: 0 };
  const postListSeenRef = { value: false };
  const fansReq: FansRequestRef = { value: null };

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    await attachCaptureHandler(page, captures, videosById, fansTrendRows, totalCountRef, postListSeenRef, fansReq);
    await collectPostList(page, videosById, totalCountRef, postListSeenRef, timeoutMs);
    await collectFansTrend(page, fansTrendRows, timeoutMs);
    await extendFansWindow(page, fansReq, captures, config.channels.fansWindowDays, timeoutMs);
  } finally {
    await browser.close().catch(() => {});
  }

  const videos = [...videosById.values()].sort((a, b) => b.createTime - a.createTime);
  const verifiedAccount = assertChannelAccountIdentity(captures.post_list, config.accountExact);
  console.log(`[channels] 账号核对通过:${verifiedAccount}`);
  return { videos, postListTotalCount: totalCountRef.value, dailyFans: fansTrendRows, captures };
}
