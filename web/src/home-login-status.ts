import type { Dispatch, SetStateAction } from 'react';
import type { DashboardOverview, MpLoginState } from './defs';

interface HomeLoginStatus {
  accounts: { id: string; mp: MpLoginState }[];
  applets: { id: string; login: DashboardOverview['applets'][number]['login'] }[];
}

/** 登录探测独立于财务数据加载；超时或失败不清空已经显示的看板。 */
export async function refreshHomeLoginStatus(
  setHome: Dispatch<SetStateAction<DashboardOverview | null>>,
  signal: AbortSignal
): Promise<void> {
  try {
    const response = await fetch('/api/dashboard/login-status', { signal });
    if (!response.ok) return;
    const status = (await response.json()) as HomeLoginStatus;
    if (signal.aborted) return;
    setHome(current => {
      if (!current) return current;
      return {
        ...current,
        accounts: current.accounts.map(account => ({
          ...account,
          mp: status.accounts.find(item => item.id === account.id)?.mp ?? account.mp,
        })),
        applets: current.applets.map(applet => ({
          ...applet,
          login: status.applets.find(item => item.id === applet.id)?.login ?? applet.login,
        })),
      };
    });
  } catch {
    // 登录检查失败不代表收入不可用，也不应推断为登录过期。
  }
}
