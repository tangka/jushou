import type { DashboardOverview, Line } from './defs';

export type IncomePeriod = 'day' | 'month';

type DailyIncomeRow = DashboardOverview['dailyIncome'][number];

const DAY_MS = 86_400_000;

function yuan(cents: number): number {
  return +(cents / 100).toFixed(2);
}

function shiftDate(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return new Date(timestamp + days * DAY_MS).toISOString().slice(0, 10);
}

export function sevenDayIncomeAverage(rows: DailyIncomeRow[]): (number | null)[] {
  const totals = new Map(rows.map(row => [row.date, row.totalCents]));

  return rows.map(row => {
    const window = Array.from({ length: 7 }, (_, index) => totals.get(shiftDate(row.date, -index)));
    if (window.some(value => value === undefined)) return null;
    return yuan(window.reduce<number>((sum, value) => sum + (value ?? 0), 0) / window.length);
  });
}

export function monthlyIncome(rows: DailyIncomeRow[]): DailyIncomeRow[] {
  const byMonth = new Map<string, DailyIncomeRow>();

  for (const row of rows) {
    const month = row.date.slice(0, 7);
    const current = byMonth.get(month);
    if (!current) {
      byMonth.set(month, { ...row, date: month });
      continue;
    }

    current.groupCents += row.groupCents;
    current.appletMembershipCents += row.appletMembershipCents;
    current.mpCents += row.mpCents;
    current.appletCents += row.appletCents;
    current.channelCents += row.channelCents;
    current.expenseCents += row.expenseCents;
    current.totalCents += row.totalCents;
    current.netCents += row.netCents;
  }

  return [...byMonth.values()];
}

export function incomeChartSeries(rows: DailyIncomeRow[], period: IncomePeriod): Line[] {
  const lines: Line[] = [
    { name: '总收入', data: rows.map(row => yuan(row.totalCents)), color: '#0f172a', noArea: true, width: 3.5 },
    { name: '社群', data: rows.map(row => yuan(row.groupCents)), color: '#16a34a', noArea: true },
    { name: '公众号', data: rows.map(row => yuan(row.mpCents)), color: '#0ea5e9', noArea: true },
    { name: '小程序广告', data: rows.map(row => yuan(row.appletCents)), color: '#f59e0b', noArea: true },
    { name: '小程序会员费', data: rows.map(row => yuan(row.appletMembershipCents)), color: '#0891b2', noArea: true },
    { name: '视频号', data: rows.map(row => yuan(row.channelCents)), color: '#8b5cf6', noArea: true },
    {
      name: '支出',
      data: rows.map(row => yuan(row.expenseCents)),
      color: '#ef4444',
      dashed: true,
      noArea: true,
      width: 3,
    },
  ];

  if (period === 'day') {
    lines.splice(1, 0, {
      name: '7日平均',
      data: sevenDayIncomeAverage(rows),
      color: '#64748b',
      dashed: true,
      noArea: true,
      width: 2.5,
    });
  }

  return lines;
}
