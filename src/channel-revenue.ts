import process from 'node:process';
import { config } from './config/index.js';
import {
  getChannelRevenueSnapshots,
  getChannelRevenueSummary,
  reopenDb,
  setChannelRevenueSnapshot,
} from './db/index.js';
import { isMain, runCli } from './utils/cli.js';

const yuan = (cents: number): string => (cents / 100).toFixed(2);

function parseAmountCents(raw: string | undefined): number {
  const value = raw?.trim() ?? '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error(`金额非法:${raw ?? '(空)'}`);
  const [yuanPart = '0', centsPart = ''] = value.split('.');
  const cents = Number(yuanPart) * 100 + Number(centsPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`金额非法:${raw ?? '(空)'}`);
  return cents;
}

export interface ParsedChannelRevenueSet {
  totalCents: number;
  periodStart: string;
  periodEnd: string;
  note?: string;
}

export function parseChannelRevenueSetArgs(args: readonly string[]): ParsedChannelRevenueSet {
  const totalCents = parseAmountCents(args[0]);
  const periodStart = args[1]?.trim() ?? '';
  const periodEnd = args[2]?.trim() ?? '';
  if (!periodStart || !periodEnd) {
    throw new Error('缺收益区间;示例 pnpm channels:revenue -- set 0.46 2026-07-01 2026-07-15');
  }
  const note = args.slice(3).join(' ').trim() || undefined;
  return { totalCents, periodStart, periodEnd, note };
}

function printSummary(): void {
  const summary = getChannelRevenueSummary();
  console.log(
    `视频号收益累计:¥${yuan(summary.totalCents)} · ${summary.periodCount} 个区间 · ${summary.snapshotCount} 个快照`
  );
  for (const row of getChannelRevenueSnapshots(10)) {
    const note = row.note ? ` · ${row.note}` : '';
    console.log(`  ${row.period_start} ~ ${row.period_end}:¥${yuan(row.total_cents)}${note}`);
  }
}

export async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const [command, ...args] = argv;
  reopenDb(config.dbPath);

  if (!command || command === 'list') {
    printSummary();
    return;
  }
  if (command !== 'set') throw new Error(`未知命令:${command};支持 set / list`);

  const input = parseChannelRevenueSetArgs(args);
  setChannelRevenueSnapshot({ ...input, source: 'wechat-channels-manual' });
  console.log(
    `已记录 ${config.accountExact} 视频号收益:${input.periodStart} ~ ${input.periodEnd} · ¥${yuan(input.totalCents)}`
  );
  printSummary();
}

if (isMain(import.meta.url)) runCli(run);
