import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { z } from 'zod';
import { DEFAULT_REDDIT_TRANSLATION_MODEL } from '../reddit-translator.js';
import { parseAdSlotNamesConfig } from './ad-slot-names.js';
import { createArticlePaths } from './article-paths.js';
import { initializeOperatorEnvironment } from './operator-profile.js';

export { parseAdSlotNamesConfig };

const cwd = process.cwd();
// 显式进程环境 > 私有账号配置 > 私有共享配置 > 对应旧 env > 默认值。
const operatorEnvironment = initializeOperatorEnvironment();
export const ENV_DIR = operatorEnvironment.envDir;

// 固定常量(非用户可配,但集中于此,禁止散落在各模块硬编码)
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
export const MP_BASE_URL = 'https://mp.weixin.qq.com';
export const WECHAT_API_BASE_URL = 'https://api.weixin.qq.com';
export const CHANNELS_BASE_URL = 'https://channels.weixin.qq.com';
export const TOUTIAO_BASE_URL = 'https://mp.toutiao.com';
export const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const ACCOUNT_SUBDIR = '微信公众号';
export const OVERVIEW_FILENAME = '文章数据总览.md';
// 账号根目录下的子目录(多账号完全隔离:每号一个自包含目录,其下各一套)
export const ARTICLES_SUBDIR = '已发布'; // 已发布文章库(采集导出,一文一文件夹;与「待发布」草稿对称)
export const DATA_SUBDIR = '数据'; // 总览/报表/数据产物
export const DRAFTS_SUBDIR = '待发布'; // 二期创作待发布草稿,人工发布后由 prune-drafts 回收
export const MATERIALS_SUBDIR = '素材库'; // 选材池(X / web 采集)
export const THEMES_SUBDIR = '主题'; // 选题方向笔记

// 逐篇打微信后台的最小间隔:CLAUDE.md 约定 ≥1.5s,低于则限流
const MIN_REQUEST_INTERVAL_MS = 1500;
const DEFAULT_REDDIT_PROXY_PORT = 7897;
const DEFAULT_REDDIT_TITLE_DENY_KEYWORDS = [
  'politics',
  'political',
  'government',
  'election',
  'trump',
  'biden',
  'congress',
  'senate',
  'military',
  'war',
  'export control',
  'national security',
  'china',
  'nsfw',
  'porn',
  'jailbreak',
  'uncensored',
  'bypass',
  'crack',
  'dan',
  '政治',
  '政府',
  '大选',
  '特朗普',
  '拜登',
  '战争',
  '军事',
  '出口管制',
  '国家安全',
  '对华',
  '越狱',
  '破解',
  '色情',
] as const;
const DEFAULT_REDDIT_DEFAULT_SUBS: readonly string[] = [];

const goalSchema = z.object({
  stage: z.string().min(1),
  followers: z.number().int().positive(),
  perFollowerCents: z.number().positive(),
});
export type Goal = z.infer<typeof goalSchema>;

const publishThemeSchema = z.object({
  name: z.string().min(1),
  pageBg: z.string().min(1),
  articleBg: z.string().min(1),
  text: z.string().min(1),
  muted: z.string().min(1),
  accent: z.string().min(1),
  accentText: z.string().min(1),
  accentSoft: z.string().min(1),
  border: z.string().min(1),
  codeBg: z.string().min(1),
  quoteBg: z.string().min(1),
});
export type PublishThemeConfig = z.infer<typeof publishThemeSchema>;

const DEFAULT_GOALS: readonly Goal[] = [
  { stage: '短期', followers: 1000, perFollowerCents: 1 },
  { stage: '中期', followers: 5000, perFollowerCents: 1.2 },
  { stage: '远期', followers: 10_000, perFollowerCents: 1.5 },
];

const DEFAULT_PUBLISH_THEME: PublishThemeConfig = {
  name: '默认正文主题',
  pageBg: '#f7f7f8',
  articleBg: '#ffffff',
  text: '#0d0d0d',
  muted: '#6e7178',
  accent: '#0d0d0d',
  accentText: '#0d0d0d',
  accentSoft: '#f3f3f5',
  border: '#e6e6e9',
  codeBg: '#f6f6f7',
  quoteBg: '#f8f8f9',
};

// 可选 URL:空字符串视作未设(compose/.env 常把未填变量传成 "")
const optionalUrl = z.preprocess(v => (v === '' ? undefined : v), z.string().url().optional());
const optionalString = z.preprocess(v => (v === '' ? undefined : v), z.string().min(1).optional());

function envFlag(value: string | undefined, defaultValue = false): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function splitEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,\n|]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function defaultRedditProxy(): string {
  const host = fs.existsSync('/.dockerenv') ? 'host.docker.internal' : '127.0.0.1';
  return `http://${host}:${DEFAULT_REDDIT_PROXY_PORT}`;
}

function parseJsonConfig(value: string, name: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${name} 需为合法 JSON:${error instanceof Error ? error.message : String(error)}`);
  }
}

function zodMessage(error: unknown): string {
  return error instanceof z.ZodError ? error.issues.map(i => i.message).join('; ') : String(error);
}

export function parseGoalsConfig(value: string | undefined): readonly Goal[] {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_GOALS;
  try {
    const goals = trimmed.startsWith('[')
      ? z.array(goalSchema).parse(parseJsonConfig(trimmed, 'WECHAT_GOALS'))
      : trimmed.split(/[;\n]/).map(item => {
          const [stage, followersRaw, perFollowerRaw] = item.split(':').map(part => part.trim());
          return goalSchema.parse({
            stage,
            followers: Number(followersRaw),
            perFollowerCents: Number(perFollowerRaw),
          });
        });
    if (goals.length === 0) throw new Error('至少需要 1 个目标');
    return goals;
  } catch (error) {
    throw new Error(`WECHAT_GOALS 配置无效:${zodMessage(error)}`);
  }
}

export function parsePublishThemeConfig(value: string | undefined): PublishThemeConfig {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_PUBLISH_THEME;
  try {
    const patch = publishThemeSchema.partial().parse(parseJsonConfig(trimmed, 'WECHAT_PUBLISH_THEME'));
    return { ...DEFAULT_PUBLISH_THEME, ...patch };
  } catch (error) {
    throw new Error(`WECHAT_PUBLISH_THEME 配置无效:${zodMessage(error)}`);
  }
}

const envSchema = z.object({
  // 不设则默认派生 http://127.0.0.1:<PORT>;本地服务统一用 3333,多账号通过 account 参数切配置。
  WECHAT_EXPORTER_BASE_URL: z.string().url().optional(),
  WECHAT_ACCOUNT_KEYWORD: z.string().min(1).default('default-account'),
  WECHAT_ACCOUNT_EXACT: z.string().min(1).optional(),
  // 视频号/短视频标题里的展示名,例如「今天 <label> 动态」;不设则用 WECHAT_ACCOUNT_EXACT。
  WECHAT_CHANNEL_LABEL: optionalString,
  // 公众号封面生成脚本。相对路径按 ~/Code/scripts/wechat-cards/ 解析;不要在生成器里按账号名分支。
  WECHAT_COVER_SCRIPT: optionalString,
  // 账号差异配置。优先写各账号 .env.<账号>,不要写进源码。
  WECHAT_GOALS: optionalString,
  WECHAT_AD_SLOT_NAMES: optionalString,
  WECHAT_PUBLISH_THEME: optionalString,
  // 账号级正文默认风格。草稿 frontmatter 的 publish_style 仍可按篇覆盖。
  WECHAT_PUBLISH_STYLE: optionalString,
  OBSIDIAN_VAULT: z.string().min(1).default(path.join(os.homedir(), 'wechat-vault')),
  // 账号根目录 override(可选);默认派生 <vault>/微信公众号/<账号>/
  WECHAT_ACCOUNT_ROOT: z.string().min(1).optional(),
  // 登录态 + KV cookie override(可选);默认按账号派生(每号各自扫码登录,互不覆盖)
  WECHAT_LOGIN_STATE: z.string().min(1).optional(),
  NITRO_KV_BASE: z.string().min(1).optional(),
  // SQLite 路径 override(可选);默认派生 .data/stats-<账号>.db(多账号各自独立库,完全隔离)
  STATS_DB: z.string().min(1).optional(),
  // 公司级支出台账独立于公众号账号,避免多账号聚合时重复计算。
  COMPANY_DB: z.string().min(1).optional(),
  // 小程序不是公众号子账号,使用独立登录态 / KV / SQLite。
  APPLET_ID: optionalString,
  APPLET_CONFIGS: optionalString,
  APPLET_NAME: optionalString,
  APPLET_LOGIN_STATE: optionalString,
  APPLET_KV_BASE: optionalString,
  APPLET_STATS_DB: optionalString,
  WECHAT_REQUEST_INTERVAL_MS: z.coerce.number().int().min(MIN_REQUEST_INTERVAL_MS).default(MIN_REQUEST_INTERVAL_MS),
  // 视频号采集:本地 Chrome 驱动,登录态与公众号隔离。Docker/无 Chrome 环境可显式跳过。
  CHROME: optionalString,
  CHROME_PATH: optionalString,
  WECHAT_CHANNELS_SKIP: z.string().optional(),
  WECHAT_CHANNELS_CAPTURE_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(120_000),
  WECHAT_CHANNELS_JOIN_WINDOW_MINUTES: z.coerce.number().int().min(1).default(30),
  // 粉丝趋势回填天数:抓完页面默认窗口后,沿用其 endTs 把 startTs 前推此天数重发(页面 fetch 自带签名)
  WECHAT_CHANNELS_FANS_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  // 视频号发表:ego-browser 任务空间、页面可见账号文本、目标合集。每号写 env,不要在源码按账号分支。
  WECHAT_CHANNELS_EGO_TASK_SPACE: optionalString,
  WECHAT_CHANNELS_EGO_VERIFY_TEXT: optionalString,
  // 兼容旧默认合集;新流程优先区分日常/周刊合集。
  WECHAT_CHANNELS_COLLECTION_NAME: optionalString,
  WECHAT_CHANNELS_DAILY_COLLECTION_NAME: optionalString,
  WECHAT_CHANNELS_WEEKLY_COLLECTION_NAME: optionalString,
  PORT: z.coerce.number().int().positive().default(3333),
  // 失败通知 webhook(飞书,ADR 0004);留空则只本地日志
  NOTIFY_WEBHOOK_URL: optionalUrl,
  // 官方公众号 API:上传图片 + 写入草稿箱。只用于草稿箱,不做发布/群发。
  WECHAT_APPID: optionalString,
  WECHAT_APPSECRET: optionalString,
  WX_APPID: optionalString,
  WX_APPSECRET: optionalString,
  WECHAT_DRAFT_AUTHOR: optionalString,
  WECHAT_DRAFT_NEED_OPEN_COMMENT: z.coerce.number().int().min(0).max(1).default(1),
  WECHAT_DRAFT_ONLY_FANS_CAN_COMMENT: z.coerce.number().int().min(0).max(1).default(0),
  WECHAT_DRAFT_COVER_MATERIAL_TYPE: z.enum(['image', 'thumb']).default('image'),
  // 自动出稿是否生成正文末尾「# 评论区补充」模拟评论段;默认关闭,正文不放评论。
  DRAFT_INCLUDE_COMMENT_SECTION: z.string().optional(),
  // enrich 刷新窗口:默认只补抓近 30 天发布的文章;0 可显式启用全历史。
  WECHAT_REFRESH_DAYS: z.coerce.number().int().min(0).default(30),
  // enrich 抓评论正文:单篇接口页大小、最新评论兜底页大小、总览每篇摘选条数
  WECHAT_COMMENT_FETCH_COUNT: z.coerce.number().int().min(1).max(100).default(50),
  WECHAT_COMMENT_LATEST_COUNT: z.coerce.number().int().min(1).max(100).default(20),
  WECHAT_COMMENT_HIGHLIGHTS_LIMIT: z.coerce.number().int().min(1).max(10).default(3),
  // 抓「用户分析」(粉丝)回看天数
  WECHAT_STATS_DAYS: z.coerce.number().int().min(1).default(30),
  // 抓「按广告位逐日收入」的回看天数;接口可到今天,当天/昨日可能未结算完整
  WECHAT_REVENUE_SLOT_DAYS: z.coerce.number().int().min(1).max(180).default(35),
  // scheduler 每天定点跑一次 sync 的时刻(HH:mm,本地时区)。
  // 定在上午——微信「用户分析/收益」T-1 数据约次日上午才结算稳定;凌晨跑会抓到未结算的残缺值(见 BUGS.md)。
  SYNC_DAILY_AT: z
    .string()
    .regex(/^(off|([01]?\d|2[0-3]):[0-5]\d)$/, '需为 HH:mm(如 10:30)或 off(禁用容器内定时,交给本机 launchd)')
    .default('10:30'),
  // 选题打标:默认走本机 Codex SDK,不用额外模型 token;OpenRouter 作为显式备用 provider
  TAG_PROVIDER: z.enum(['openrouter', 'codex']).default('codex'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().min(1).default('anthropic/claude-opus-4.8'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  // 仅给 OpenRouter 请求挂的 HTTP(S) 代理(WeChat 是国内请求,不走代理);回落 HTTPS_PROXY
  OPENROUTER_PROXY: optionalUrl,
  // Reddit 监听采集:本地 Chrome + 代理访问 old.reddit。Docker/无 Chrome 环境默认跳过。
  REDDIT_COLLECT_SKIP: z.string().optional(),
  REDDIT_PROXY: optionalUrl,
  REDDIT_MIN_SCORE: z.coerce.number().int().min(1).default(200),
  REDDIT_TOP_LIMIT: z.coerce.number().int().min(1).max(50).default(15),
  REDDIT_COMMENTS_LIMIT: z.coerce.number().int().min(0).max(20).default(5),
  REDDIT_REQUEST_INTERVAL_MS: z.coerce.number().int().min(MIN_REQUEST_INTERVAL_MS).default(MIN_REQUEST_INTERVAL_MS),
  REDDIT_USER_AGENT: z.string().min(1).default(USER_AGENT),
  REDDIT_TITLE_DENY_KEYWORDS: optionalString,
  REDDIT_DEFAULT_SUBS: optionalString,
  REDDIT_CODEX_MODEL: z.string().min(1).default(DEFAULT_REDDIT_TRANSLATION_MODEL),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // fail fast:配置错误立刻退出,带清晰信息(ADR 0006)
  const issues = parsed.error.issues.map(i => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
  throw new Error(`环境变量校验失败:\n${issues}`);
}
const env = parsed.data;

const accountKeyword = env.WECHAT_ACCOUNT_KEYWORD;
const accountExact = env.WECHAT_ACCOUNT_EXACT ?? accountKeyword;
const accountParent = path.join(env.OBSIDIAN_VAULT, ACCOUNT_SUBDIR);
// 多账号完全隔离:每号一个自包含根目录 <vault>/微信公众号/<账号>/,其下文章/数据/待发布/素材库/主题各一份
const accountRoot = env.WECHAT_ACCOUNT_ROOT ?? path.join(accountParent, accountExact);
const accountDir = path.join(accountRoot, ARTICLES_SUBDIR); // 已发布文章库(一文一文件夹)
const dataDir = path.join(accountRoot, DATA_SUBDIR); // 总览/报表/数据产物
const redditDefaultSubs = (() => {
  const fromEnv = splitEnvList(env.REDDIT_DEFAULT_SUBS);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_REDDIT_DEFAULT_SUBS;
})();
const redditDenyKeywords = (() => {
  const fromEnv = splitEnvList(env.REDDIT_TITLE_DENY_KEYWORDS);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_REDDIT_TITLE_DENY_KEYWORDS;
})();

const accountGoals = parseGoalsConfig(env.WECHAT_GOALS);
const accountAdSlotNames = parseAdSlotNamesConfig(env.WECHAT_AD_SLOT_NAMES);
const accountPublishTheme = parsePublishThemeConfig(env.WECHAT_PUBLISH_THEME);
const channelsCollectionName = env.WECHAT_CHANNELS_COLLECTION_NAME ?? '';
const channelsDailyCollectionName = env.WECHAT_CHANNELS_DAILY_COLLECTION_NAME ?? channelsCollectionName;
const channelsWeeklyCollectionName = env.WECHAT_CHANNELS_WEEKLY_COLLECTION_NAME ?? '';
const appletConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  loginStatePath: z.string().min(1),
  kvBase: z.string().min(1),
  dbPath: z.string().min(1),
});
const appletRegistry = (() => {
  const fallback = [
    {
      id: env.APPLET_ID ?? 'default-applet',
      name: env.APPLET_NAME ?? '小程序',
      loginStatePath: env.APPLET_LOGIN_STATE ?? '.data/login-state-applets.json',
      kvBase: env.APPLET_KV_BASE ?? '.data/kv-applets',
      dbPath: env.APPLET_STATS_DB ?? '.data/stats-applets.db',
    },
  ];
  const rows = env.APPLET_CONFIGS
    ? z.array(appletConfigSchema).min(1).parse(parseJsonConfig(env.APPLET_CONFIGS, 'APPLET_CONFIGS'))
    : fallback;
  return rows.map(row => ({
    ...row,
    loginStatePath: path.resolve(cwd, row.loginStatePath),
    kvBase: path.resolve(cwd, row.kvBase),
    dbPath: path.resolve(cwd, row.dbPath),
  }));
})();
const selectedApplet = appletRegistry.find(applet => applet.id === (env.APPLET_ID ?? appletRegistry[0]?.id));
if (!selectedApplet) throw new Error(`APPLET_ID 不存在:${env.APPLET_ID}`);

export const config = {
  baseUrl: env.WECHAT_EXPORTER_BASE_URL ?? `http://127.0.0.1:${env.PORT}`,
  envDir: ENV_DIR,
  serverPort: env.PORT,
  accountKeyword,
  accountExact,
  channelLabel: env.WECHAT_CHANNEL_LABEL ?? accountExact,
  coverScript: env.WECHAT_COVER_SCRIPT ?? 'cover.ts',
  vaultPath: env.OBSIDIAN_VAULT,
  accountRoot,
  accountDir,
  dataDir,
  loginStatePath: path.resolve(cwd, env.WECHAT_LOGIN_STATE ?? `.data/login-state-${accountExact}.json`),
  kvBase: path.resolve(cwd, env.NITRO_KV_BASE ?? `.data/kv-${accountExact}`),
  dbPath: path.resolve(cwd, env.STATS_DB ?? `.data/stats-${accountExact}.db`),
  companyDbPath: path.resolve(cwd, env.COMPANY_DB ?? '.data/company.db'),
  applets: selectedApplet,
  appletRegistry,
  notifyWebhookUrl: env.NOTIFY_WEBHOOK_URL ?? '',
  wechatApi: {
    baseUrl: WECHAT_API_BASE_URL,
    appid: env.WECHAT_APPID ?? env.WX_APPID ?? '',
    appsecret: env.WECHAT_APPSECRET ?? env.WX_APPSECRET ?? '',
    tokenCachePath: path.resolve(cwd, `.data/wechat-api-token-${accountExact}.json`),
    draftAuthor: env.WECHAT_DRAFT_AUTHOR ?? accountExact,
    needOpenComment: env.WECHAT_DRAFT_NEED_OPEN_COMMENT,
    onlyFansCanComment: env.WECHAT_DRAFT_ONLY_FANS_CAN_COMMENT,
    coverMaterialType: env.WECHAT_DRAFT_COVER_MATERIAL_TYPE,
  },
  draftGeneration: {
    includeCommentSection: envFlag(env.DRAFT_INCLUDE_COMMENT_SECTION, false),
  },
  refreshDays: env.WECHAT_REFRESH_DAYS,
  comments: {
    fetchCount: env.WECHAT_COMMENT_FETCH_COUNT,
    latestCount: env.WECHAT_COMMENT_LATEST_COUNT,
    highlightsLimit: env.WECHAT_COMMENT_HIGHLIGHTS_LIMIT,
  },
  statsDays: env.WECHAT_STATS_DAYS,
  revenueSlotDays: env.WECHAT_REVENUE_SLOT_DAYS,
  syncDailyAt: (() => {
    const [hour, minute] = env.SYNC_DAILY_AT.split(':').map(Number);
    return { hour: hour ?? 0, minute: minute ?? 0, raw: env.SYNC_DAILY_AT };
  })(),
  openrouter: {
    apiKey: env.OPENROUTER_API_KEY ?? '',
    model: env.OPENROUTER_MODEL,
    baseUrl: env.OPENROUTER_BASE_URL,
    // 显式 OPENROUTER_PROXY 优先,否则回落系统 HTTPS_PROXY / https_proxy
    proxy: env.OPENROUTER_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '',
  },
  tag: {
    provider: env.TAG_PROVIDER,
  },
  requestIntervalMs: env.WECHAT_REQUEST_INTERVAL_MS,
  channels: {
    baseUrl: CHANNELS_BASE_URL,
    chromePath: env.CHROME ?? env.CHROME_PATH ?? DEFAULT_CHROME_PATH,
    userDataDir: path.resolve(cwd, `.data/chrome-channels-${accountExact}`),
    skip: envFlag(env.WECHAT_CHANNELS_SKIP),
    captureTimeoutMs: env.WECHAT_CHANNELS_CAPTURE_TIMEOUT_MS,
    joinWindowSeconds: env.WECHAT_CHANNELS_JOIN_WINDOW_MINUTES * 60,
    fansWindowDays: env.WECHAT_CHANNELS_FANS_DAYS,
    egoTaskSpace: env.WECHAT_CHANNELS_EGO_TASK_SPACE ?? `wechat-channels:${accountExact}`,
    egoVerifyText: env.WECHAT_CHANNELS_EGO_VERIFY_TEXT ?? accountExact,
    collectionName: channelsCollectionName,
    dailyCollectionName: channelsDailyCollectionName,
    weeklyCollectionName: channelsWeeklyCollectionName,
  },
  reddit: {
    baseUrl: 'https://old.reddit.com',
    rssBaseUrl: 'https://www.reddit.com',
    chromePath: env.CHROME ?? env.CHROME_PATH ?? DEFAULT_CHROME_PATH,
    userDataDir: path.resolve(cwd, `.data/chrome-reddit-${accountExact}`),
    skip: envFlag(env.REDDIT_COLLECT_SKIP),
    proxy:
      env.REDDIT_PROXY ??
      env.OPENROUTER_PROXY ??
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      defaultRedditProxy(),
    minScore: env.REDDIT_MIN_SCORE,
    topLimit: env.REDDIT_TOP_LIMIT,
    commentsLimit: env.REDDIT_COMMENTS_LIMIT,
    requestIntervalMs: env.REDDIT_REQUEST_INTERVAL_MS,
    userAgent: env.REDDIT_USER_AGENT,
    titleDenyKeywords: redditDenyKeywords,
    defaultSubs: redditDefaultSubs,
    seenPath: path.resolve(cwd, `.data/reddit-seen-${accountExact}.json`),
    translationModel: env.REDDIT_CODEX_MODEL,
  },
  // 账号级总览/报表产物落 dataDir(数据-<账号>/);单篇文章按「一篇一文件夹」落 accountDir,见 articlePaths()
  paths: {
    richCsv: path.join(dataDir, 'articles-rich.csv'),
    overview: path.join(dataDir, OVERVIEW_FILENAME),
    followerOverview: path.join(dataDir, '关注数据.md'),
    unfollowOverview: path.join(dataDir, '取关名单.md'),
    readTendency: path.join(dataDir, '阅读数据.md'),
    channelsOverview: path.join(dataDir, '视频号数据.md'),
    toutiaoOverview: path.join(dataDir, '头条号数据.md'),
    revenueOverview: path.join(dataDir, '收益数据.md'),
    businessReport: path.join(dataDir, '经营分析.md'),
    suggestion: path.join(dataDir, '选题建议.md'),
    // 以下都落账号根目录(完全隔离,不再与其他号共享)
    themesDir: path.join(accountRoot, THEMES_SUBDIR),
    materialsDir: path.join(accountRoot, MATERIALS_SUBDIR),
    draftsDir: path.join(accountRoot, DRAFTS_SUBDIR),
    // X 采集关注列表(每号独立):collect 包装传给 x-collect monitor
    watchlist: path.join(accountRoot, 'watchlist.json'),
    // Reddit 采集关注列表(每号独立):不存在时用 config.reddit.defaultSubs
    redditWatchlist: path.join(accountRoot, 'reddit-watchlist.json'),
    // 手动维护的内容地图(MOC):静态导航人工写,「待发布」区由 build-content-map 自动重写
    contentMap: path.join(accountRoot, '内容地图.md'),
    // 人工维护的运营北极星 / 账号定位(business 等以 wikilink 引用)
    goalDoc: path.join(accountRoot, '运营目标.md'),
    positioningDoc: path.join(accountRoot, '账号定位.md'),
  },
  // 运营目标(北极星):双轴 粉丝量 × 每粉收益(分/天),按当前账号 env 取 WECHAT_GOALS。
  goals: accountGoals,
  // 广告位中文名:官方已核实名称兜底,账号配置优先;未知 slotid 仍回退编号。
  adSlotNames: accountAdSlotNames,
  publishTheme: accountPublishTheme,
  publishStyle: env.WECHAT_PUBLISH_STYLE,
} as const;

export type Config = typeof config;

export function articlePaths(base: string) {
  return createArticlePaths(accountDir, base);
}
