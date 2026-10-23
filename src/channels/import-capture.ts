import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import {
  upsertChannelAccountSnapshot,
  upsertChannelDailyFans,
  upsertChannelVideo,
  upsertChannelVideoSnapshot,
} from '../db/index.js';
import {
  type ChannelAccountSnapshot,
  type ChannelDailyFans,
  type ChannelFansTabDaily,
  type ChannelRawCapture,
  type ChannelRequestBody,
  type ChannelVideo,
  channelAuthDataResponseSchema,
  channelFansTrendResponseSchema,
  channelPostListResponseSchema,
  channelPostTotalDataResponseSchema,
} from '../types/channels.js';
import { isMain, runCli } from '../utils/cli.js';
import { toDate } from '../utils/date.js';
import { assertChannelAccountIdentity } from './account-identity.js';

type ChannelTarget = 'post_list' | 'fans_trend' | 'auth_data' | 'new_post_total_data';

type CaptureInput =
  | {
      captures?: Partial<Record<ChannelTarget, ChannelRawCapture[]>>;
      post_list?: ChannelRawCapture | { json: unknown; requestBody?: ChannelRequestBody | null };
      fans_trend?: ChannelRawCapture | { json: unknown; requestBody?: ChannelRequestBody | null };
      auth_data?: ChannelRawCapture | { json: unknown; requestBody?: ChannelRequestBody | null };
      new_post_total_data?: ChannelRawCapture | { json: unknown; requestBody?: ChannelRequestBody | null };
    }
  | Partial<Record<ChannelTarget, ChannelRawCapture | { json: unknown; requestBody?: ChannelRequestBody | null }>>;

const DAY_SECONDS = 86_400;

function parseCli(argv: readonly string[]): { file: string } {
  let file = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--file') {
      const value = argv[i + 1];
      if (!value) throw new Error('--file 需要传 Codex 浏览器采集 JSON 路径');
      file = value;
      i++;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`用法:
  pnpm channels:import-capture -- --file .data/channels-codex-capture-${config.accountExact}.json

说明:
  - 导入 Codex 内置浏览器从视频号后台抓到的 post_list / fans_trend JSON。
  - 只落视频列表指标和粉丝趋势,不下载、不保存视频本体。`);
      process.exit(0);
    } else {
      throw new Error(`未知参数:${arg}`);
    }
  }
  if (!file) file = `.data/channels-codex-capture-${config.accountExact}.json`;
  return { file };
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

function asArray(value: unknown): ChannelRawCapture[] {
  if (!value) return [];
  return Array.isArray(value) ? (value as ChannelRawCapture[]) : [value as ChannelRawCapture];
}

function normalizeCaptures(input: CaptureInput): Record<ChannelTarget, ChannelRawCapture[]> {
  const record = input as {
    captures?: Partial<Record<ChannelTarget, ChannelRawCapture[]>>;
    post_list?: ChannelRawCapture;
    fans_trend?: ChannelRawCapture;
    auth_data?: ChannelRawCapture;
    new_post_total_data?: ChannelRawCapture;
  };
  return {
    post_list: asArray(record.captures?.post_list ?? record.post_list),
    fans_trend: asArray(record.captures?.fans_trend ?? record.fans_trend),
    auth_data: asArray(record.captures?.auth_data ?? record.auth_data),
    new_post_total_data: asArray(record.captures?.new_post_total_data ?? record.new_post_total_data),
  };
}

function videosFromCaptures(captures: ChannelRawCapture[]): { videos: ChannelVideo[]; totalCount: number } {
  const videosById = new Map<string, ChannelVideo>();
  let totalCount = 0;
  for (const capture of captures) {
    const parsed = channelPostListResponseSchema.parse(capture.json);
    if (parsed.errCode !== 0) throw new Error(parsed.errMsg || `post_list errCode=${parsed.errCode}`);
    totalCount = Math.max(totalCount, parsed.data.totalCount);
    for (const video of parsed.data.list) videosById.set(video.objectId, video);
  }
  return { videos: [...videosById.values()].sort((a, b) => b.createTime - a.createTime), totalCount };
}

function fansFromCaptures(captures: ChannelRawCapture[]): ChannelDailyFans[] {
  let best: ChannelDailyFans[] = [];
  for (const capture of captures) {
    const parsed = channelFansTrendResponseSchema.parse(capture.json);
    if (parsed.errCode !== 0) throw new Error(parsed.errMsg || `fans_trend errCode=${parsed.errCode}`);
    const rows = buildDailyFans(capture.json, capture.requestBody);
    if (rows.length >= best.length) best = rows;
  }
  return best;
}

function lastMetric(totalData: Record<string, unknown>, key: string): number {
  const values = totalData[key];
  if (!Array.isArray(values) || values.length === 0) return 0;
  const value = values[values.length - 1];
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function accountSnapshotFromCaptures(
  authCaptures: ChannelRawCapture[],
  totalCaptures: ChannelRawCapture[],
  capturedAt: number,
  capturedDay: string
): ChannelAccountSnapshot | null {
  const auth = authCaptures.at(-1);
  if (!auth) return null;
  const parsedAuth = channelAuthDataResponseSchema.parse(auth.json);
  if (parsedAuth.errCode !== 0) throw new Error(parsedAuth.errMsg || `auth_data errCode=${parsedAuth.errCode}`);

  const total = totalCaptures.at(-1);
  const parsedTotal = total ? channelPostTotalDataResponseSchema.parse(total.json) : null;
  if (parsedTotal && parsedTotal.errCode !== 0)
    throw new Error(parsedTotal.errMsg || `new_post_total_data errCode=${parsedTotal.errCode}`);

  const finderUser = parsedAuth.data.finderUser;
  const totalData = parsedTotal?.data.totalData ?? {};
  return {
    capturedDay,
    capturedAt,
    finderUsername: finderUser.finderUsername,
    nickname: finderUser.nickname,
    uniqId: finderUser.uniqId,
    fansCount: finderUser.fansCount,
    feedsCount: finderUser.feedsCount,
    yesterdayBrowse: lastMetric(totalData, 'browse'),
    yesterdayLike: lastMetric(totalData, 'like'),
    yesterdayComment: lastMetric(totalData, 'comment'),
    yesterdayForward: lastMetric(totalData, 'forward'),
    yesterdayFav: lastMetric(totalData, 'fav'),
    yesterdayFollow: lastMetric(totalData, 'follow'),
    raw: { auth_data: auth.json, new_post_total_data: total?.json ?? null },
  };
}

export async function run(): Promise<void> {
  const { file } = parseCli(process.argv.slice(2));
  const raw = JSON.parse(await fs.readFile(path.resolve(file), 'utf8')) as CaptureInput;
  const captures = normalizeCaptures(raw);
  const verifiedAccount = assertChannelAccountIdentity(captures.post_list, config.accountExact);
  const { videos, totalCount } = videosFromCaptures(captures.post_list);
  const dailyFans = fansFromCaptures(captures.fans_trend);
  const capturedAt = Math.floor(Date.now() / 1000);
  const capturedDay = toDate(capturedAt);
  const accountSnapshot = accountSnapshotFromCaptures(
    captures.auth_data,
    captures.new_post_total_data,
    capturedAt,
    capturedDay
  );

  for (const video of videos) {
    upsertChannelVideo(video, capturedAt);
    upsertChannelVideoSnapshot(video, capturedAt, capturedDay);
  }
  upsertChannelDailyFans(dailyFans, capturedAt);
  if (accountSnapshot) upsertChannelAccountSnapshot(accountSnapshot);

  console.log(`视频号采集导入:${file}`);
  console.log(`视频号账号核对通过:${verifiedAccount}`);
  if (accountSnapshot) console.log(`视频号账号:${accountSnapshot.nickname} 粉丝=${accountSnapshot.fansCount}`);
  console.log(`视频号视频:${videos.length}/${totalCount || videos.length}`);
  console.log(`视频号粉丝趋势:${dailyFans.length} 天`);
  console.log(`DB ${config.dbPath}`);
}

if (isMain(import.meta.url)) runCli(run);
