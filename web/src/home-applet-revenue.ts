import type { DashboardOverview } from './defs';

interface HomeAppletRevenueLabels {
  totalLabel: string;
  totalSub: string;
  appletLabel: string;
  appletSub: string;
}

export function homeAppletRevenueLabels(applets: DashboardOverview['applets']): HomeAppletRevenueLabels {
  const unavailableCount = applets.filter(applet => !applet.updatedDate).length;
  if (unavailableCount === 0) {
    return {
      totalLabel: '累计收入',
      totalSub: '社群 + 公众号 + 小程序广告 + 小程序会员费 + 视频号',
      appletLabel: '小程序广告收入',
      appletSub: `已汇总 ${applets.length} 个`,
    };
  }

  const availableCount = applets.length - unavailableCount;
  return {
    totalLabel: '累计收入（已取得）',
    totalSub: `含社群、公众号、小程序广告及会员费、视频号；${unavailableCount} 个小程序广告收益暂不可用`,
    appletLabel: '小程序广告收入（已取得）',
    appletSub: `已汇总 ${availableCount}/${applets.length} 个，${unavailableCount} 个暂不可用`,
  };
}
