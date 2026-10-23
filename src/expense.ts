import process from 'node:process';
import {
  addExpense,
  type ExpensePeriod,
  getExpenseAmortizedTotal,
  getExpenseDailyCents,
  getExpenseSummary,
  getExpenses,
  reopenExpenseDb,
} from './db/index.js';
import { isMain, runCli } from './utils/cli.js';

const yuan = (cents: number): string => (cents / 100).toFixed(2);

const PERIOD_LABELS: Readonly<Record<ExpensePeriod, string>> = {
  'one-off': '一次性',
  monthly: '每月',
  annual: '每年',
};

export function todayBeijing(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function parseAmountCents(raw: string | undefined): number {
  const normalized = raw?.trim() ?? '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`金额非法:${raw ?? '(空)'};示例 pnpm expense add 30 小程序 向云端实时海拔表 annual 年费`);
  }
  const [yuanPart = '0', centsPart = ''] = normalized.split('.');
  const amountCents = Number(yuanPart) * 100 + Number(centsPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error(`金额非法:${raw ?? '(空)'};金额必须至少 0.01 元`);
  }
  return amountCents;
}

function parsePeriod(raw: string | undefined): ExpensePeriod {
  const normalized = (raw ?? 'one-off').trim().toLowerCase();
  if (normalized === 'one-off' || normalized === 'once' || normalized === '一次性') return 'one-off';
  if (normalized === 'monthly' || normalized === 'month' || normalized === '每月') return 'monthly';
  if (normalized === 'annual' || normalized === 'yearly' || normalized === '每年') return 'annual';
  throw new Error(`周期非法:${raw};支持 one-off / monthly / annual`);
}

export interface ParsedExpenseAdd {
  amountCents: number;
  category: string;
  item: string;
  period: ExpensePeriod;
  note?: string;
}

export function parseExpenseAddArgs(args: readonly string[]): ParsedExpenseAdd {
  const amountCents = parseAmountCents(args[0]);
  const category = args[1]?.trim();
  const item = args[2]?.trim();
  if (!category) throw new Error('缺类别;示例 pnpm expense add 30 小程序 向云端实时海拔表 annual 年费');
  if (!item) throw new Error('缺项目名;示例 pnpm expense add 30 小程序 向云端实时海拔表 annual 年费');
  const period = parsePeriod(args[3]);
  const note = args.slice(4).join(' ').trim() || undefined;
  return { amountCents, category, item, period, note };
}

function printSummary(): void {
  const summary = getExpenseSummary();
  const today = todayBeijing();
  console.log('\n📉 公司支出');
  console.log(`  登记:${summary.totalCount} 项 / 名义金额 ¥${yuan(summary.totalCents)}`);
  console.log(
    `  当前日摊:¥${yuan(getExpenseDailyCents(today))} / 截至今日累计日摊 ¥${yuan(getExpenseAmortizedTotal(today))}`
  );
  console.log(`  年费:${summary.annualCount} 项 / 名义金额 ¥${yuan(summary.annualCents)}\n`);

  const rows = getExpenses(20);
  if (rows.length === 0) {
    console.log('  (暂无支出,用 `pnpm expense add <金额> <类别> <项目> [周期] [备注]` 记一笔)\n');
    return;
  }
  console.log('  最近流水:');
  for (const row of rows) {
    const extra = row.note ? ` · ${row.note}` : '';
    const dateRange = row.end_date ? `${row.date} ~ ${row.end_date}` : row.date;
    console.log(
      `    ${dateRange}  -¥${yuan(row.amount_cents)}  [${row.category}·${PERIOD_LABELS[row.period]}]  ${row.item}${extra}`
    );
  }
  console.log('');
}

export async function run(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  reopenExpenseDb();

  if (!cmd || cmd === 'list') {
    printSummary();
    return;
  }

  if (cmd === 'add') {
    const input = parseExpenseAddArgs(rest);
    const date = todayBeijing();
    const inserted = addExpense({
      date,
      ...input,
    });
    if (!inserted) {
      console.log(`↪ 相同支出已存在,未重复记账:${date} · ${input.category} · ${input.item}`);
      printSummary();
      return;
    }
    console.log(
      `✅ 已记公司支出:${date} · ${input.category} · ${input.item} · ¥${yuan(input.amountCents)} · ${PERIOD_LABELS[input.period]}`
    );
    printSummary();
    return;
  }

  throw new Error(`未知命令:${cmd};支持 add / list(空)`);
}

if (isMain(import.meta.url)) runCli(run);
