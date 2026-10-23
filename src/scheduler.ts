import { config } from './config/index.js';
import { startServer } from './server/index.js';
import { run as runSync } from './sync.js';
import { isMain } from './utils/cli.js';

// 容器内常驻进程(1D):① 起扫码登录服务(随时可重新登录)② 每天定点跑一次同步。
// 定点(默认 10:30)而非每隔 N 小时:微信「用户分析/收益」是 T-1 口径、约次日上午才结算稳定,
// 凌晨跑会抓到未结算的残缺值(新增/取关偏小、与净增不闭合),覆盖掉好数据(见 BUGS.md)。
// 不在启动时跑(重启时刻可能正处凌晨未结算期);首次/临时刷新手动 `pnpm sync`。
// 失败已在 sync 内部按 ADR 0004 通知,这里只兜底不让进程退出。

async function safeSync(): Promise<void> {
  try {
    await runSync();
  } catch (error) {
    console.error('[scheduler] 本次同步以失败收尾:', error instanceof Error ? error.message : error);
  }
}

/** 从 now 起到下一个 hour:minute 的毫秒数(本地时区;当天已过则顺延到明天)。 */
export function msUntilNextDaily(hour: number, minute: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** 排下一次定点同步;跑完(无论成败)再排下一天,避免间隔漂移。 */
function scheduleDaily(): void {
  const { hour, minute, raw } = config.syncDailyAt;
  const delay = msUntilNextDaily(hour, minute);
  const at = new Date(Date.now() + delay);
  console.log(`下次定时同步:${at.toLocaleString('zh-CN')}(每天 ${raw});临时刷新用 pnpm sync。`);
  setTimeout(() => {
    void safeSync().finally(scheduleDaily);
  }, delay);
}

if (isMain(import.meta.url)) {
  startServer();
  if (config.syncDailyAt.raw === 'off') {
    // 容器内定时禁用:只服务看板/登录,同步交给本机 launchd(可跑视频号/Reddit 等需 Chrome 的步骤)。
    console.log('定时同步:已禁用(SYNC_DAILY_AT=off);本服务只提供扫码登录 + 看板,同步由本机定时负责。');
  } else {
    console.log('定时同步:每天定点跑一次,不在启动时跑。先用浏览器扫码登录一次。');
    scheduleDaily();
  }
}
