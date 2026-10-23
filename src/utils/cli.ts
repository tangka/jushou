import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * 该模块是否作为入口被直接执行(`node dist/x.js`)。
 * 用于让脚本既能当 CLI 跑、又能被 sync 编排器 import 复用 run()。
 */
export function isMain(metaUrl: string): boolean {
  if (process.env.WOA_BUNDLED_ENTRY === '1') return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(metaUrl) === entry;
  } catch {
    return false;
  }
}

/** CLI 入口统一收尾:跑 run(),出错打印并以非零码退出。 */
export function runCli(run: () => Promise<void>): void {
  run().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
