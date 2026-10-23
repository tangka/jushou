import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';
import { config, DEFAULT_CHROME_PATH, MP_BASE_URL, parseAdSlotNamesConfig, parseGoalsConfig } from '../config/index.js';
import {
  discoverOperatorEnvironments,
  getOperatorAccount,
  loadOperatorProfile,
  operatorProcessEnvForAccount,
  operatorProfilePath,
} from '../config/operator-profile.js';
import { kvCookieSchema, loginStateSchema } from '../types/wechat.js';
import { proxyMpRequest } from './proxy-request.js';

const CHANNELS_POST_LIST = 'https://channels.weixin.qq.com/platform/post/list';
const LEGACY_DEFAULT_ACCOUNT_ID = 'default';

export type MpLoginState = 'ok' | 'expired' | 'down' | 'unknown';
export type ChannelsLoginState = 'ok' | 'expired' | 'none' | 'locked' | 'nochrome' | 'unknown';
export type PlatformKey = 'mp' | 'channels';
export type PlatformHealth = 'ok' | 'attention' | 'muted' | 'warning' | 'unknown';
export type PlatformActionKind = 'navigate' | 'task';

export interface AccountPlatform {
  key: PlatformKey;
  label: string;
  state: MpLoginState | ChannelsLoginState;
  health: PlatformHealth;
  statusLabel: string;
  actionKind: PlatformActionKind;
  actionLabel: string;
  loginUrl: string | null;
  taskUrl: string | null;
  entryUrl: string | null;
  available: boolean;
}

export interface AccountEnv {
  id: string;
  file: string;
  account: string;
  envAccount: string;
  dashboardUrl: string;
  dbPath: string;
  loginStatePath: string;
  kvBase: string;
  chromePath: string;
  goals: readonly { stage: string; followers: number; perFollowerCents: number }[];
  adSlotNames: Readonly<Record<string, string>>;
}

export interface AccountStatus
  extends Pick<AccountEnv, 'id' | 'file' | 'account' | 'envAccount' | 'dashboardUrl' | 'goals' | 'adSlotNames'> {
  isSelected: boolean;
  mp: MpLoginState;
  channels: ChannelsLoginState;
  platforms: AccountPlatform[];
}

const spawnContexts = new WeakMap<AccountEnv, { envDir: string; profilePath?: string }>();

function accountIdFromName(value: string): string {
  return (
    value
      .trim()
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'account'
  );
}

function toAccountEnv(root: string, resolved: ReturnType<typeof discoverOperatorEnvironments>[number]): AccountEnv {
  const { env, envAccount } = resolved;
  const file = envAccount ? `.env.${envAccount}` : '.env';
  const account = env.WECHAT_ACCOUNT_EXACT || env.WECHAT_ACCOUNT_KEYWORD || envAccount || file;
  const id = resolved.account?.id ?? accountIdFromName(envAccount || account);
  const singleEntry = config.baseUrl;
  return {
    id,
    file,
    account,
    envAccount,
    dashboardUrl: `${singleEntry}/dashboard/?account=${encodeURIComponent(id)}`,
    dbPath: path.resolve(root, env.STATS_DB ?? `.data/stats-${account}.db`),
    loginStatePath: path.resolve(root, env.WECHAT_LOGIN_STATE ?? `.data/login-state-${account}.json`),
    kvBase: path.resolve(root, env.NITRO_KV_BASE ?? `.data/kv-${account}`),
    chromePath: env.CHROME ?? env.CHROME_PATH ?? DEFAULT_CHROME_PATH,
    goals: parseGoalsConfig(env.WECHAT_GOALS),
    adSlotNames: parseAdSlotNamesConfig(env.WECHAT_AD_SLOT_NAMES),
  };
}

function accountQuery(id: string): string {
  return `?account=${encodeURIComponent(id)}`;
}

function channelsProfilePath(root: string, account: string): string {
  return path.resolve(root, '.data', `chrome-channels-${account}`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function discoverAccounts(root = process.cwd(), envDir = config.envDir): AccountEnv[] {
  const file = operatorProfilePath(root);
  return discoverOperatorEnvironments({ root, envDir }).map(resolved => {
    const account = toAccountEnv(root, resolved);
    spawnContexts.set(account, { envDir: resolved.envDir, profilePath: fs.existsSync(file) ? file : undefined });
    return account;
  });
}

export function findAccount(id: string, root = process.cwd(), envDir = config.envDir): AccountEnv | null {
  return discoverAccounts(root, envDir).find(account => account.id === id) ?? null;
}

export function resolveAccount(
  id: string | null | undefined,
  root = process.cwd(),
  envDir = config.envDir
): AccountEnv | null {
  const accounts = discoverAccounts(root, envDir);
  if (id) {
    if (id === LEGACY_DEFAULT_ACCOUNT_ID) return accounts[0] ?? null;
    const normalizedId = accountIdFromName(id);
    const configuredId = getOperatorAccount(id, loadOperatorProfile(root))?.id;
    return (
      accounts.find(
        account =>
          account.id === id || account.id === normalizedId || account.id === configuredId || account.envAccount === id
      ) ?? null
    );
  }
  return accounts[0] ?? null;
}

function cookieString(cookies: { name: string; value?: string }[]): string {
  return cookies
    .filter(c => c.value && c.value !== 'EXPIRED')
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

export async function probeMp(account: AccountEnv, signal?: AbortSignal): Promise<MpLoginState> {
  try {
    const loginRaw = JSON.parse(await fsp.readFile(account.loginStatePath, 'utf8')) as unknown;
    const { authKey } = loginStateSchema.parse(loginRaw);
    const cookieRaw = JSON.parse(await fsp.readFile(path.join(account.kvBase, 'cookie', authKey), 'utf8')) as unknown;
    const { token, cookies } = kvCookieSchema.parse(cookieRaw);
    const html = await proxyMpRequest({
      method: 'GET',
      endpoint: `${MP_BASE_URL}/cgi-bin/home`,
      query: { t: 'home/index', token, lang: 'zh_CN' },
      cookie: cookieString(cookies),
      signal,
    }).then(r => r.text());
    const nickname = html.match(/wx\.cgiData\.nick_name\s*?=\s*?"(?<v>[^"]+)"/)?.groups?.v ?? '';
    return nickname === account.account ? 'ok' : 'expired';
  } catch (error) {
    if (error instanceof Error && /ENOENT/.test(error.message)) return 'expired';
    return 'unknown';
  }
}

export function accountEnvForSpawn(account: AccountEnv): NodeJS.ProcessEnv {
  const context = spawnContexts.get(account);
  const profile = loadOperatorProfile(process.cwd(), context?.profilePath);
  return {
    ...operatorProcessEnvForAccount(account.envAccount, profile),
    WECHAT_ACCOUNT: account.envAccount,
    WECHAT_ENV_DIR: context?.envDir ?? config.envDir,
    ...(context?.profilePath ? { WECHAT_OPERATOR_PROFILE: context.profilePath } : {}),
  };
}

export async function getAccountStatuses(
  selectedId: string | null | undefined = null,
  root = process.cwd()
): Promise<AccountStatus[]> {
  const accounts = discoverAccounts(root);
  const effectiveSelectedId =
    selectedId && accounts.some(account => account.id === selectedId) ? selectedId : (accounts[0]?.id ?? null);
  return Promise.all(
    accounts.map(async account => {
      const mp = await probeMp(account);
      const channels: ChannelsLoginState = 'unknown';
      return {
        id: account.id,
        file: account.file,
        account: account.account,
        envAccount: account.envAccount,
        dashboardUrl: account.dashboardUrl,
        goals: account.goals,
        adSlotNames: account.adSlotNames,
        isSelected: account.id === effectiveSelectedId,
        mp,
        channels,
        platforms: buildPlatforms(account, mp, channels),
      };
    })
  );
}

export async function assertAccountDb(account: AccountEnv): Promise<void> {
  await fsp.access(account.dbPath);
}

export async function probeChannels(account: AccountEnv, root = process.cwd()): Promise<ChannelsLoginState> {
  const profile = channelsProfilePath(root, account.account);
  if (!fs.existsSync(profile)) return 'none';
  if (!fs.existsSync(account.chromePath)) return 'nochrome';

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath: account.chromePath,
      headless: true,
      userDataDir: profile,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
  } catch {
    return 'locked';
  }

  try {
    const page = await browser.newPage();
    await page.goto(CHANNELS_POST_LIST, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
    await delay(2500);
    return /login|\/auth/i.test(page.url()) ? 'expired' : 'ok';
  } catch {
    return 'unknown';
  } finally {
    await browser.close().catch(() => {});
  }
}

function mpStatus(state: MpLoginState): Pick<AccountPlatform, 'health' | 'statusLabel' | 'available'> {
  if (state === 'ok') return { health: 'ok', statusLabel: '已登录', available: true };
  if (state === 'expired') return { health: 'attention', statusLabel: '需扫码', available: true };
  if (state === 'down') return { health: 'warning', statusLabel: '服务未启动', available: false };
  return { health: 'unknown', statusLabel: '未知', available: true };
}

function channelsBrowserStatus(): Pick<AccountPlatform, 'health' | 'statusLabel' | 'available'> {
  return { health: 'muted', statusLabel: 'Codex操作', available: true };
}

function buildPlatforms(account: AccountEnv, mp: MpLoginState, channels: ChannelsLoginState): AccountPlatform[] {
  const query = accountQuery(account.id);
  const mpMeta = mpStatus(mp);
  const channelsMeta = channelsBrowserStatus();
  return [
    {
      key: 'mp',
      label: '公众号',
      state: mp,
      ...mpMeta,
      actionKind: 'navigate',
      actionLabel: mp === 'ok' ? '重扫' : '扫码',
      loginUrl: `/${query}&relogin=1`,
      taskUrl: null,
      entryUrl: account.dashboardUrl,
    },
    {
      key: 'channels',
      label: '视频号',
      state: channels,
      ...channelsMeta,
      actionKind: 'navigate',
      actionLabel: 'Codex采集/分发',
      loginUrl: CHANNELS_POST_LIST,
      taskUrl: null,
      entryUrl: null,
    },
  ];
}
