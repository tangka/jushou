import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { config } from './config/index.js';
import { isMain, runCli } from './utils/cli.js';

export function resolveXSeenFile(cwd: string, accountId: string): string {
  const normalizedId = accountId.trim();
  if (!normalizedId) throw new Error('X 素材采集缺少公众号 AppID');
  return path.resolve(cwd, `.data/x-seen-${normalizedId}.json`);
}

// 拉 X watchlist 今日新素材 → <账号>/素材库/(包装 x-collect monitor)。
// 多账号完全隔离:素材库(LIBRARY)与关注清单(X_WATCHLIST)都由 config 按当前账号派生,
// 每号各采各的;同一条源若两号都要,各采一次(成本换干净)。需本地 skill + 系统代理。
export function run(): Promise<void> {
  const xCollectDir = process.env.X_COLLECT_DIR ?? path.join(os.homedir(), '.claude/skills/x-collect');
  const monitor = path.join(xCollectDir, 'dist/monitor/index.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [monitor], {
      stdio: 'inherit',
      env: {
        ...process.env,
        LIBRARY: config.paths.materialsDir,
        X_WATCHLIST: config.paths.watchlist,
        // 展示名允许调整；采集水位只认稳定的公众号 AppID，避免改名后把现有帖子当成首次初始化跳过。
        X_SEEN_FILE: resolveXSeenFile(process.cwd(), config.wechatApi.appid),
        X_COLLECT_DIR: xCollectDir,
      },
    });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`collect 退出码 ${code}`))));
    child.on('error', reject);
  });
}

if (isMain(import.meta.url)) runCli(run);
