import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { openAppletDb, upsertAppletRevenueDaily, upsertAppletRevenueOverview } from '../db/index.js';
import { type AppletRevenueDailyInput, appletRevenueCaptureSchema } from '../types/applet.js';
import { isMain, runCli } from '../utils/cli.js';
import { toDate } from '../utils/date.js';

function parseCli(argv: readonly string[]): { file: string } {
  let file = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--file') {
      const value = argv[i + 1];
      if (!value) throw new Error('--file 需要传小程序收益 capture JSON 路径');
      file = value;
      i++;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`用法:
  pnpm applet:import-capture -- --file .data/applet-capture.json

JSON 示例:
  {
    "overview": {
      "name": "你懂不懂足球啊",
      "yesterdayIncomeYuan": 0,
      "weekIncomeYuan": 2.43,
      "totalIncomeYuan": 2.43,
      "dateRangeStart": "2026-07-06",
      "dateRangeEnd": "2026-07-12"
    },
    "daily": [
      { "date": "2026-07-12", "incomeYuan": 0, "pullCount": 0, "exposureCount": 0, "clickCount": 0 }
    ]
  }`);
      process.exit(0);
    } else {
      throw new Error(`未知参数:${arg}`);
    }
  }
  if (!file) file = '.data/applet-capture.json';
  return { file };
}

function centsFrom(cents: number | undefined, yuan: number | undefined): number {
  if (cents !== undefined) return Math.round(cents);
  if (yuan !== undefined) return Math.round(yuan * 100);
  return 0;
}

function dailyIncomeCents(row: AppletRevenueDailyInput): number {
  return centsFrom(row.incomeCents, row.incomeYuan);
}

export function resolveCaptureAppletId(configuredAppletId: string, captureAppletId?: string): string {
  const configured = configuredAppletId.trim();
  if (!configured) throw new Error('配置的小程序 appid 不能为空');
  if (captureAppletId === undefined) return configured;

  const captured = captureAppletId.trim();
  if (!captured) throw new Error('capture 中的小程序 appid 不能为空');
  if (captured !== configured) {
    throw new Error(`capture appid 与当前小程序不匹配:${captured} != ${configured}`);
  }
  return configured;
}

export async function run(): Promise<void> {
  const { file } = parseCli(process.argv.slice(2));
  const raw = JSON.parse(await fs.readFile(path.resolve(file), 'utf8')) as unknown;
  const capture = appletRevenueCaptureSchema.parse(raw);
  const appid = resolveCaptureAppletId(config.applets.id, capture.overview?.appid);
  const capturedAt = Math.floor(Date.now() / 1000);
  const capturedDay = toDate(capturedAt);
  openAppletDb();

  if (capture.overview) {
    upsertAppletRevenueOverview(
      {
        capturedDay,
        appid,
        name: capture.overview.name,
        yesterdayCents: centsFrom(capture.overview.yesterdayCents, capture.overview.yesterdayIncomeYuan),
        weekCents: centsFrom(capture.overview.weekCents, capture.overview.weekIncomeYuan),
        totalCents: centsFrom(capture.overview.totalCents, capture.overview.totalIncomeYuan),
        dateRangeStart: capture.overview.dateRangeStart ?? null,
        dateRangeEnd: capture.overview.dateRangeEnd ?? null,
        raw: capture.overview.raw ?? capture.overview,
      },
      capturedAt
    );
  }

  upsertAppletRevenueDaily(
    capture.daily.map(row => ({
      date: row.date,
      appid,
      incomeCents: dailyIncomeCents(row),
      pullCount: row.pullCount,
      exposureCount: row.exposureCount,
      clickCount: row.clickCount,
      ecpmYuan: row.ecpmYuan ?? null,
      raw: row.raw ?? row,
    })),
    capturedAt
  );

  console.log(`小程序收益导入完成:概览 ${capture.overview ? 1 : 0} 条,每日 ${capture.daily.length} 条`);
  console.log(`DB ${config.applets.dbPath}`);
}

if (isMain(import.meta.url)) runCli(run);
