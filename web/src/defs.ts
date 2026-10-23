export interface Goal {
  stage: string;
  followers: number;
  perFollowerCents: number;
}
export interface ReadSeries {
  id: number;
  title: string;
  publish_time: number | null;
  points: { day: string; read: number }[];
}
export interface Article {
  id: number;
  title: string;
  publish_time: number | null;
  read_uv: number;
  like_cnt: number;
  zaikan_cnt: number;
  comment_cnt: number;
  share_uv: number;
  collection_uv: number;
  follow_uv: number;
  income_cents: number;
  media_type: string | null;
}

/** 互动率(喜欢度)= (在看+赞+评+分享+收藏) ÷ 阅读。阅读 0 时为 0。 */
export function engRate(a: Article): number {
  return a.read_uv > 0 ? (a.zaikan_cnt + a.like_cnt + a.comment_cnt + a.share_uv + a.collection_uv) / a.read_uv : 0;
}

/** 发布时间(unix 秒)→ 北京时区 YYYY-MM-DD HH:mm;无则 '—'。 */
export function fmtTime(sec: number | null): string {
  if (!sec) return '—';
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}
export function isFiniteNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 比率格式化:0~1 视作小数转百分比,>1 视作已是百分比。 */
export function pct(v: number | null | undefined): string {
  if (!isFiniteNum(v)) return '-';
  const n = Math.abs(v) <= 1 ? v * 100 : v;
  return `${n.toFixed(1)}%`;
}

export function fmtInt(v: number | null | undefined): string {
  return isFiniteNum(v) ? String(v) : '-';
}

export function fmtFixed(v: number | null | undefined, digits: number): string {
  return isFiniteNum(v) ? v.toFixed(digits) : '-';
}

export function fmtYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function fmtRatio(ratio: number): string {
  const normalized = Math.abs(ratio) <= 1 ? ratio * 100 : ratio;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(1)}%`;
}

export function sharePct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export interface RevenueComposition {
  date: string;
  total_cents: number;
  programmatic_cents: number;
  freetrade_cents: number;
  cps_cents: number;
  yesterday_cents: number;
  week_cents: number;
  month_cents: number;
  day_ratio: number;
  week_ratio: number;
  captured_at: number;
}

export interface SlotIncome {
  date: string;
  slotid: string;
  income_cents: number;
}

export interface Summary {
  account: string;
  accountId: string;
  goals: Goal[];
  now: { fans: number; avgPerFollowerCents: number };
  groupRevenue: {
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
  };
  followers: { date: string; cumulate_user: number; netgain_user: number }[];
  revenue: { date: string; income_cents: number }[];
  slotIncome: SlotIncome[];
  slotNames: Record<string, string>;
  revenueComposition: RevenueComposition | null;
  metrics: { date: string; per_follower_cents: number }[];
  articles: Article[];
  readSeries: ReadSeries[];
  readTendency: { date: string; all: number; recommend: number }[];
  readBySource: { date: string; scene: number; read_uv: number }[];
  cumulativeReads: { date: string; total: number }[];
  channels: {
    videos: ChannelVideo[];
    fans: { date: string; add_count: number; reduce_count: number; net_add_count: number; total_count: number }[];
  };
}

export interface DashboardOverviewAccount {
  id: string;
  account: string;
  file: string;
  dashboardUrl: string;
  mp: MpLoginState;
  revenue: {
    totalCents: number;
    groupCents: number;
    groupCount: number;
    appletMembershipCents: number;
    appletMembershipCount: number;
    mpCents: number;
    mpDate: string | null;
    mpFans: number;
    mpFansDate: string | null;
    mpNet7: number;
  };
  channels: {
    fans: number;
    fansDate: string | null;
    net7: number;
    videos: number;
    reads: number;
    yesterdayReads: number;
    follows: number;
    interactions: number;
    incomeCents: number;
  };
}

export interface DashboardOverview {
  accounts: DashboardOverviewAccount[];
  applets: {
    id: string;
    name: string;
    dashboardUrl: string;
    login: 'ok' | 'expired' | 'unknown';
    totalCents: number;
    yesterdayCents: number;
    weekCents: number;
    updatedDate: string | null;
    dateRangeStart: string | null;
    dateRangeEnd: string | null;
    cumulativeUsers: number | null;
    usersDate: string | null;
    userDays: {
      date: string;
      cumulativeUsers: number;
    }[];
  }[];
  dailyIncome: {
    date: string;
    groupCents: number;
    appletMembershipCents: number;
    mpCents: number;
    appletCents: number;
    channelCents: number;
    expenseCents: number;
    totalCents: number;
    netCents: number;
  }[];
  totals: {
    accounts: number;
    applets: number;
    totalCents: number;
    expenseCents: number;
    expenseCount: number;
    annualExpenseCents: number;
    netCents: number;
    groupRevenueCents: number;
    groupOrderCount: number;
    appletMembershipCents: number;
    appletMembershipCount: number;
    mpRevenueCents: number;
    appletRevenueCents: number;
    mpFans: number;
    channelIncomeCents: number;
    channelFans: number;
  };
}

export type MpLoginState = 'ok' | 'expired' | 'down' | 'unknown';
export type ChannelsLoginState = 'ok' | 'expired' | 'none' | 'locked' | 'nochrome' | 'unknown';
export type PlatformKey = 'mp' | 'channels';
export type PlatformHealth = 'ok' | 'attention' | 'muted' | 'warning' | 'unknown';
export type PlatformActionKind = 'navigate' | 'task';

export interface DashboardPlatform {
  key: PlatformKey;
  label: string;
  state: MpLoginState | ChannelsLoginState;
  health: PlatformHealth;
  statusLabel: string;
  actionKind: PlatformActionKind;
  actionLabel: string;
  loginUrl: string | null;
  taskUrl: string | null;
  entryUrl: string | null;
  available: boolean;
}

export interface DashboardAccount {
  id: string;
  file: string;
  account: string;
  envAccount: string;
  dashboardUrl: string;
  isSelected: boolean;
  mp: MpLoginState;
  channels: ChannelsLoginState;
  platforms: DashboardPlatform[];
}

export interface AccountsResponse {
  selected: string | null;
  accounts: DashboardAccount[];
}

export interface DashboardTask {
  id: string;
  title: string;
  state: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  output: string;
}
export interface ChannelVideo {
  object_id: string;
  title: string;
  description: string | null;
  create_time: number | null;
  read_count: number | null;
  yesterday_read_count: number | null;
  full_play_rate: number | null;
  avg_play_time_sec: number | null;
  fast_flip_rate: number | null;
  like_count: number | null;
  fav_count: number | null;
  comment_count: number | null;
  forward_count: number | null;
  follow_count: number | null;
  captured_at?: number;
  series?: ChannelVideoSnapshotPoint[];
}

export interface ChannelVideoSnapshotPoint {
  captured_day: string;
  captured_at: number;
  read_count: number | null;
  yesterday_read_count: number | null;
  full_play_rate: number | null;
  avg_play_time_sec: number | null;
  fast_flip_rate: number | null;
  like_count: number | null;
  fav_count: number | null;
  comment_count: number | null;
  forward_count: number | null;
  follow_count: number | null;
}

export interface ChannelsDashboardAccount {
  id: string;
  account: string;
  file: string;
  dashboardUrl: string;
  revenue: { incomeCents: number };
  stats: {
    fans: number;
    fansDate: string | null;
    net7: number;
    videos: number;
    reads: number;
    yesterdayReads: number;
    follows: number;
    interactions: number;
  };
  fansTrend: { date: string; add_count: number; reduce_count: number; net_add_count: number; total_count: number }[];
  latestVideos: ChannelVideo[];
}

export interface ChannelsDashboard {
  accounts: ChannelsDashboardAccount[];
  totals: {
    accounts: number;
    incomeCents: number;
    fans: number;
    net7: number;
    videos: number;
    reads: number;
    yesterdayReads: number;
    follows: number;
    interactions: number;
  };
}

export interface AppletRevenueOverview {
  captured_day: string;
  appid: string;
  name: string | null;
  yesterday_cents: number;
  week_cents: number;
  total_cents: number;
  date_range_start: string | null;
  date_range_end: string | null;
  captured_at: number;
}

export interface AppletRevenueDay {
  date: string;
  appid: string;
  income_cents: number;
  pull_count: number;
  exposure_count: number;
  click_count: number;
  ecpm_yuan: number | null;
  captured_at: number;
}

export interface AppletUserSnapshot {
  data_date: string;
  appid: string;
  name: string | null;
  cumulative_users: number;
  captured_at: number;
}

export interface AppletsDashboardApplet {
  id: string;
  name: string;
  file: string;
  overview: AppletRevenueOverview | null;
  userOverview: AppletUserSnapshot | null;
  userDays: AppletUserSnapshot[];
  days: AppletRevenueDay[];
}

export interface AppletsDashboard {
  applets: AppletsDashboardApplet[];
  totals: {
    applets: number;
    totalCents: number;
    yesterdayCents: number;
    weekCents: number;
  };
}

export function isSurge(s: ReadSeries): boolean {
  const first = s.points[0]?.read ?? 0;
  const last = s.points[s.points.length - 1]?.read ?? 0;
  return last >= first * 1.5 && s.points.length >= 4;
}

// 7 日移动平均
export function ma7(arr: number[]): number[] {
  return arr.map((_, i) => {
    const w = arr.slice(Math.max(0, i - 6), i + 1);
    return +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(1);
  });
}

export interface Line {
  name: string;
  data: (number | null)[];
  type?: 'line' | 'bar';
  color?: string;
  dashed?: boolean;
  /** 画到右侧次坐标轴(量纲不同的叠加线,如比值) */
  secondary?: boolean;
  /** 堆叠(多渠道占比/构成),同 stack 组的面积叠起来 */
  stack?: boolean;
  /** 纯曲线:不画面积阴影(多条折线对比时用) */
  noArea?: boolean;
  /** 线宽(默认 2);总收益等主线可加粗 */
  width?: number;
}

// echarts 通用图:多 series(主 + 目标/均线)+ 可选水平目标 markLine
