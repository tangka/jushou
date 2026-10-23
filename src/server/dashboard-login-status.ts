import { statSync } from 'node:fs';
import { probeAppletLogin } from '../applets/session.js';
import { config } from '../config/index.js';
import { type AccountEnv, type MpLoginState, probeMp } from './account-registry.js';

export const DASHBOARD_LOGIN_CACHE_MS = 30_000;
export const DASHBOARD_LOGIN_TIMEOUT_MS = 8_000;

interface LoginCacheEntry {
  version: string;
  state: MpLoginState;
  checkedAt: number;
  pending?: Promise<MpLoginState>;
}

/** 登录徽标独立短缓存；不缓存财务数据，也不把网络超时当成登录过期。 */
export class DashboardLoginCache {
  private readonly entries = new Map<string, LoginCacheEntry>();

  constructor(
    private readonly ttlMs = DASHBOARD_LOGIN_CACHE_MS,
    private readonly timeoutMs = DASHBOARD_LOGIN_TIMEOUT_MS,
    private readonly now: () => number = Date.now
  ) {}

  read(key: string, version: string): MpLoginState {
    const entry = this.entries.get(key);
    if (!entry || entry.version !== version || this.now() - entry.checkedAt >= this.ttlMs) return 'unknown';
    return entry.state;
  }

  refresh(
    key: string,
    version: string,
    probe: (signal: AbortSignal) => Promise<MpLoginState>,
    force = false
  ): Promise<MpLoginState> {
    const previous = this.entries.get(key);
    if (previous?.version === version) {
      if (previous.pending) return previous.pending;
      if (!force && this.now() - previous.checkedAt < this.ttlMs) return Promise.resolve(previous.state);
    }
    const entry: LoginCacheEntry = { version, state: 'unknown', checkedAt: Number.NEGATIVE_INFINITY };
    const controller = new AbortController();
    const pending = new Promise<MpLoginState>(resolve => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve('unknown');
      }, this.timeoutMs);
      Promise.resolve()
        .then(() => probe(controller.signal))
        .then(resolve, () => resolve('unknown'))
        .finally(() => clearTimeout(timer));
    }).then(state => {
      entry.state = state;
      entry.checkedAt = this.now();
      entry.pending = undefined;
      return state;
    });
    entry.pending = pending;
    this.entries.set(key, entry);
    return pending;
  }
}

const loginCache = new DashboardLoginCache();

function loginVersion(loginStatePath: string): string {
  try {
    const stat = statSync(loginStatePath);
    return `${loginStatePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return `${loginStatePath}:missing`;
  }
}

export function cachedMpLogin(account: AccountEnv): MpLoginState {
  return loginCache.read(`mp:${account.id}`, loginVersion(account.loginStatePath));
}

export function cachedAppletLogin(applet: (typeof config.appletRegistry)[number]): MpLoginState {
  return loginCache.read(`applet:${applet.id}`, loginVersion(applet.loginStatePath));
}

/** 全部并行且有时间上限；财务 overview 不调用本函数。扫码改写登录态后自动失效。 */
export async function refreshDashboardLoginStatuses(accounts: AccountEnv[], force = false) {
  const [accountStatuses, appletStatuses] = await Promise.all([
    Promise.all(
      accounts.map(async account => ({
        id: account.id,
        mp: await loginCache.refresh(
          `mp:${account.id}`,
          loginVersion(account.loginStatePath),
          signal => probeMp(account, signal),
          force
        ),
      }))
    ),
    Promise.all(
      config.appletRegistry.map(async applet => ({
        id: applet.id,
        login: await loginCache.refresh(
          `applet:${applet.id}`,
          loginVersion(applet.loginStatePath),
          async signal => (await probeAppletLogin(undefined, applet, signal)).state,
          force
        ),
      }))
    ),
  ]);
  return { accounts: accountStatuses, applets: appletStatuses, checkedAt: new Date().toISOString() };
}
