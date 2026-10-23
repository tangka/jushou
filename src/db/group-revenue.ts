import { appletMembershipImports } from '../config/account-policy.js';
import { getDb } from './core.js';

// 每次从本机配置构造参数化条件；无规则时所有手工流水保持原分类。
function membershipPredicate(): { sql: string; params: string[] } {
  const imports = appletMembershipImports();
  return {
    sql: imports.length
      ? `kind = 'service' AND (${imports.map(() => '(service = ? AND (note GLOB ? OR note GLOB ?))').join(' OR ')})`
      : '0',
    params: imports.flatMap(({ service, marker }) => [service, `${marker}?*:?*`, `*；${marker}?*:?*`]),
  };
}

/** 付费群收款类型:入群门槛 | 付费服务。 */
export type GroupRevenueKind = 'entry' | 'service';

export interface GroupOrderInput {
  date: string; // YYYY-MM-DD
  account: string;
  kind: GroupRevenueKind;
  amountCents: number;
  channel?: string; // wx | ali | ''
  service?: string; // kind=service 时的服务名
  note?: string;
}

export interface GroupOrder {
  id: number;
  date: string;
  account: string | null;
  kind: string;
  amount_cents: number;
  channel: string | null;
  service: string | null;
  note: string | null;
  created_at: number;
}

/** 记一笔付费群收款(一单一行)。 */
export function addGroupOrder(input: GroupOrderInput): void {
  getDb()
    .prepare(`
      INSERT INTO group_revenue (date, account, kind, amount_cents, channel, service, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.date,
      input.account,
      input.kind,
      input.amountCents,
      input.channel ?? '',
      input.service ?? null,
      input.note ?? null,
      Math.floor(Date.now() / 1000)
    );
}

/** 最近 N 笔收款(按日期、创建时间倒序)。 */
export function getGroupOrders(limit = 50): GroupOrder[] {
  return getDb()
    .prepare(`
      SELECT id, date, account, kind, amount_cents, channel, service, note, created_at
      FROM group_revenue ORDER BY date DESC, created_at DESC LIMIT ?
    `)
    .all(limit) as unknown as GroupOrder[];
}

export interface GroupRevenueSummary {
  entryCount: number;
  entryCents: number;
  serviceCount: number;
  serviceCents: number;
  totalCount: number;
  totalCents: number;
  groupCount: number;
  groupCents: number;
  appletMembershipCount: number;
  appletMembershipCents: number;
}

export interface GroupRevenueDay {
  date: string;
  /** 原手工流水合计,为兼容已有调用方保留。 */
  amount_cents: number;
  groupCents: number;
  appletMembershipCents: number;
}

/** 最近 N 个有收款记录的日期,按日期倒序。 */
export function getGroupRevenueDays(limit = 90): GroupRevenueDay[] {
  const { sql, params } = membershipPredicate();
  const rows = getDb()
    .prepare(`
      SELECT date, COALESCE(SUM(amount_cents), 0) AS amount_cents,
        COALESCE(SUM(CASE WHEN ${sql} THEN amount_cents ELSE 0 END), 0) AS appletMembershipCents
      FROM group_revenue
      GROUP BY date
      ORDER BY date DESC
      LIMIT ?
    `)
    .all(...params, limit) as unknown as Omit<GroupRevenueDay, 'groupCents'>[];
  return rows.map(row => ({ ...row, groupCents: row.amount_cents - row.appletMembershipCents }));
}

/** 收款汇总:入群门槛 / 付费服务 / 合计(单数 + 金额分)。 */
export function getGroupRevenueSummary(): GroupRevenueSummary {
  const { sql, params } = membershipPredicate();
  const row = getDb()
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN kind = 'entry'   THEN 1 ELSE 0 END), 0)            AS entryCount,
        COALESCE(SUM(CASE WHEN kind = 'entry'   THEN amount_cents ELSE 0 END), 0) AS entryCents,
        COALESCE(SUM(CASE WHEN kind = 'service' THEN 1 ELSE 0 END), 0)            AS serviceCount,
        COALESCE(SUM(CASE WHEN kind = 'service' THEN amount_cents ELSE 0 END), 0) AS serviceCents,
        COALESCE(SUM(CASE WHEN ${sql} THEN 1 ELSE 0 END), 0) AS appletMembershipCount,
        COALESCE(SUM(CASE WHEN ${sql} THEN amount_cents ELSE 0 END), 0) AS appletMembershipCents,
        COUNT(*)                                                                  AS totalCount,
        COALESCE(SUM(amount_cents), 0)                                            AS totalCents
      FROM group_revenue
    `)
    .get(...params, ...params) as unknown as Omit<GroupRevenueSummary, 'groupCount' | 'groupCents'>;
  return {
    ...row,
    groupCount: row.totalCount - row.appletMembershipCount,
    groupCents: row.totalCents - row.appletMembershipCents,
  };
}
