export interface DailyIncomeInput {
  date: string;
  groupCents?: number;
  mpCents?: number;
  appletCents?: number;
  appletMembershipCents?: number;
  channelCents?: number;
  expenseCents?: number;
}

export interface DailyIncomeDay {
  date: string;
  groupCents: number;
  mpCents: number;
  appletCents: number;
  appletMembershipCents: number;
  channelCents: number;
  expenseCents: number;
  totalCents: number;
  netCents: number;
}

export function mergeDailyIncome(rows: readonly DailyIncomeInput[]): DailyIncomeDay[] {
  const byDate = new Map<string, Omit<DailyIncomeDay, 'date' | 'totalCents' | 'netCents'>>();

  for (const row of rows) {
    const current = byDate.get(row.date) ?? {
      groupCents: 0,
      mpCents: 0,
      appletCents: 0,
      appletMembershipCents: 0,
      channelCents: 0,
      expenseCents: 0,
    };
    current.groupCents += row.groupCents ?? 0;
    current.mpCents += row.mpCents ?? 0;
    current.appletCents += row.appletCents ?? 0;
    current.appletMembershipCents += row.appletMembershipCents ?? 0;
    current.channelCents += row.channelCents ?? 0;
    current.expenseCents += row.expenseCents ?? 0;
    byDate.set(row.date, current);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => {
      const totalCents =
        values.groupCents + values.mpCents + values.appletCents + values.appletMembershipCents + values.channelCents;
      return {
        date,
        ...values,
        totalCents,
        netCents: totalCents - values.expenseCents,
      };
    });
}
