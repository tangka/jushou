import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import { Chart } from './charts';
import type { DashboardOverview, DashboardOverviewAccount } from './defs';
import { fmtYuan } from './defs';
import { AppletCard } from './home-applet-card';
import { homeAppletRevenueLabels } from './home-applet-revenue';
import { type IncomePeriod, incomeChartSeries, monthlyIncome } from './home-income';
import { InlineMpLogin } from './inline-mp-login';

const page: CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: 24,
  fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
  background: '#f6f7f9',
  minHeight: '100vh',
};

const card: CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  padding: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,.05)',
};

const button: CSSProperties = {
  border: '1px solid #0ea5e9',
  background: '#e0f2fe',
  color: '#0369a1',
  borderRadius: 6,
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('zh-CN')}`;
}

function compactInt(value: number): string {
  return value.toLocaleString('zh-CN');
}

function valueDate(value: string | null): string {
  return value ? `截至 ${value}` : '暂无日期';
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isStaleDataDate(value: string | null): boolean {
  if (!value) return true;
  return value < dateDaysAgo(1);
}

function MoneyMetric({
  label,
  cents,
  sub,
  valueColor = '#0f172a',
}: {
  label: string;
  cents: number;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div style={card}>
      <div style={{ color: '#64748b', fontSize: 12 }}>{label}</div>
      <div style={{ color: valueColor, fontSize: 27, fontWeight: 780, marginTop: 6 }}>¥{fmtYuan(cents)}</div>
      {sub && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

interface CardMetric {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad' | 'muted';
}

function metricColor(tone: CardMetric['tone']): string {
  if (tone === 'good') return '#16a34a';
  if (tone === 'bad') return '#dc2626';
  if (tone === 'muted') return '#94a3b8';
  return '#0f172a';
}

function MetricCell({ metric, compact = false }: { metric: CardMetric; compact?: boolean }) {
  return (
    <div>
      <div style={{ color: '#64748b', fontSize: 12 }}>{metric.label}</div>
      <div
        style={{
          color: metricColor(metric.tone),
          fontSize: compact ? 16 : 20,
          fontWeight: compact ? 720 : 760,
          marginTop: 4,
          whiteSpace: 'nowrap',
        }}
      >
        {metric.value}
      </div>
      {metric.sub && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>{metric.sub}</div>}
    </div>
  );
}

function AccountModuleCard({
  account,
  actionLabel,
  onAction,
  primary,
  topMetrics,
  bottomMetrics,
  extra,
}: {
  account: DashboardOverviewAccount;
  actionLabel: string;
  onAction: () => void;
  primary: CardMetric;
  topMetrics: CardMetric[];
  bottomMetrics: CardMetric[];
  extra?: ReactNode;
}) {
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#0f172a', fontSize: 17, fontWeight: 780 }}>{account.account}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>{account.file}</div>
        </div>
        <button type="button" style={button} onClick={onAction}>
          {actionLabel}
        </button>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ color: '#64748b', fontSize: 12 }}>{primary.label}</div>
        <div style={{ color: '#0f172a', fontSize: 24, fontWeight: 780, marginTop: 4 }}>{primary.value}</div>
        {primary.sub && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>{primary.sub}</div>}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
          marginTop: 14,
        }}
      >
        {topMetrics.map(metric => (
          <MetricCell key={metric.label} metric={metric} />
        ))}
      </div>
      {extra}
      <div style={{ borderTop: '1px solid #edf2f7', marginTop: 14, paddingTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 12 }}>
          {bottomMetrics.map(metric => (
            <MetricCell key={metric.label} metric={metric} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChannelsStoredDataNotice({ account }: { account: DashboardOverviewAccount }) {
  const hasStoredData = Boolean(account.channels.fansDate);
  return (
    <div
      style={{
        marginTop: 14,
        borderTop: '1px solid #e2e8f0',
        paddingTop: 14,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: '#475569', fontSize: 13, fontWeight: 700 }}>
          {hasStoredData ? '未扫码,展示最后同步数据' : '暂无视频号同步数据'}
        </div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>
          {hasStoredData
            ? `当前数据${valueDate(account.channels.fansDate)},扫码后可继续更新`
            : '扫码同步一次后会保留最新结果'}
        </div>
      </div>
      <button
        type="button"
        style={{ ...button, borderColor: '#cbd5e1', background: '#f8fafc', color: '#475569' }}
        onClick={() => {
          window.location.href = `/dashboard/channels/?account=${encodeURIComponent(account.id)}`;
        }}
      >
        查看留存数据
      </button>
    </div>
  );
}

function RevenueAccountCard({ account }: { account: DashboardOverviewAccount }) {
  return (
    <AccountModuleCard
      account={account}
      actionLabel="打开看板"
      onAction={() => {
        window.location.href = account.dashboardUrl;
      }}
      primary={{
        label: '总金额',
        value: `¥${fmtYuan(account.revenue.totalCents)}`,
        sub: '社群 + 小程序会员费 + 公众号',
      }}
      topMetrics={[
        {
          label: '粉丝',
          value: compactInt(account.revenue.mpFans),
          sub: `7 日 ${signed(account.revenue.mpNet7)}`,
          tone: account.revenue.mpNet7 >= 0 ? 'good' : 'bad',
        },
        {
          label: '社群金额',
          value: `¥${fmtYuan(account.revenue.groupCents)}`,
          sub: `${account.revenue.groupCount} 单`,
        },
        { label: '公众号收入', value: `¥${fmtYuan(account.revenue.mpCents)}`, sub: valueDate(account.revenue.mpDate) },
      ]}
      bottomMetrics={[
        { label: '社群订单', value: `${account.revenue.groupCount} 单` },
        { label: '小程序会员费', value: `¥${fmtYuan(account.revenue.appletMembershipCents)}` },
        {
          label: '公众号结算',
          value: account.revenue.mpDate ?? '-',
          tone: account.revenue.mpDate ? undefined : 'muted',
        },
        {
          label: '粉丝日期',
          value: account.revenue.mpFansDate ?? '-',
          tone: account.revenue.mpFansDate ? undefined : 'muted',
        },
      ]}
      extra={account.mp === 'expired' ? <InlineMpLogin account={account} /> : null}
    />
  );
}

function ChannelsCard({ account }: { account: DashboardOverviewAccount }) {
  const stale = isStaleDataDate(account.channels.fansDate);
  return (
    <AccountModuleCard
      account={account}
      actionLabel="打开看板"
      onAction={() => {
        window.location.href = `/dashboard/channels/?account=${encodeURIComponent(account.id)}`;
      }}
      primary={{
        label: '视频号收入',
        value: `¥${fmtYuan(account.channels.incomeCents)}`,
        sub: stale ? valueDate(account.channels.fansDate) : '待结算',
      }}
      topMetrics={[
        {
          label: '粉丝',
          value: compactInt(account.channels.fans),
          sub: `7 日 ${signed(account.channels.net7)}`,
          tone: account.channels.net7 >= 0 ? 'good' : 'bad',
        },
        {
          label: '视频',
          value: compactInt(account.channels.videos),
          sub: `昨日播放 ${compactInt(account.channels.yesterdayReads)}`,
        },
        {
          label: '累计播放',
          value: compactInt(account.channels.reads),
          sub: valueDate(account.channels.fansDate),
          tone: account.channels.fansDate ? undefined : 'muted',
        },
      ]}
      bottomMetrics={[
        { label: '互动', value: compactInt(account.channels.interactions) },
        { label: '涨粉', value: compactInt(account.channels.follows) },
        { label: '数据状态', value: stale ? '最后同步' : '正常', tone: stale ? 'muted' : 'good' },
      ]}
      extra={stale ? <ChannelsStoredDataNotice account={account} /> : null}
    />
  );
}

export function HomeDashboard({ data }: { data: DashboardOverview }) {
  const [incomePeriod, setIncomePeriod] = useState<IncomePeriod>('day');
  const appletRevenueLabels = homeAppletRevenueLabels(data.applets);
  const chartIncome = useMemo(
    () => (incomePeriod === 'month' ? monthlyIncome(data.dailyIncome) : data.dailyIncome),
    [data.dailyIncome, incomePeriod]
  );
  const incomeUnitLabel = incomePeriod === 'month' ? '月' : '日';

  return (
    <main style={page}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>运营首页</h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 5 }}>{data.totals.accounts} 个账号</div>
        </div>
        <button
          type="button"
          style={{ ...button, borderColor: '#cbd5e1', background: '#fff', color: '#0f172a' }}
          onClick={() => window.location.reload()}
        >
          刷新
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginTop: 18,
        }}
      >
        <MoneyMetric
          label={appletRevenueLabels.totalLabel}
          cents={data.totals.totalCents}
          sub={appletRevenueLabels.totalSub}
        />
        <MoneyMetric label="社群金额" cents={data.totals.groupRevenueCents} sub={`${data.totals.groupOrderCount} 单`} />
        <MoneyMetric
          label="小程序会员费"
          cents={data.totals.appletMembershipCents}
          sub={`${data.totals.appletMembershipCount} 单 · 扣平台费后净额`}
        />
        <MoneyMetric
          label="公众号收入"
          cents={data.totals.mpRevenueCents}
          sub={`粉丝 ${compactInt(data.totals.mpFans)}`}
        />
        <MoneyMetric
          label={appletRevenueLabels.appletLabel}
          cents={data.totals.appletRevenueCents}
          sub={appletRevenueLabels.appletSub}
        />
        <MoneyMetric
          label="视频号收入"
          cents={data.totals.channelIncomeCents}
          sub={`粉丝 ${compactInt(data.totals.channelFans)}`}
        />
      </div>

      <section style={{ marginTop: 18 }}>
        <div style={{ color: '#0f172a', fontSize: 16, fontWeight: 760, marginBottom: 10 }}>公众号</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 12,
          }}
        >
          {data.accounts.map(account => (
            <RevenueAccountCard key={account.id} account={account} />
          ))}
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div style={{ color: '#0f172a', fontSize: 16, fontWeight: 760, marginBottom: 10 }}>小程序</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 12,
          }}
        >
          {data.applets.map(applet => (
            <AppletCard key={applet.id} applet={applet} />
          ))}
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div style={{ color: '#0f172a', fontSize: 16, fontWeight: 760, marginBottom: 10 }}>视频号</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 12,
          }}
        >
          {data.accounts.map(account => (
            <ChannelsCard key={account.id} account={account} />
          ))}
        </div>
      </section>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          marginTop: 20,
        }}
      >
        {(
          [
            ['day', '日'],
            ['month', '月'],
          ] as const
        ).map(([period, label]) => {
          const active = incomePeriod === period;
          return (
            <button
              key={period}
              type="button"
              onClick={() => setIncomePeriod(period)}
              style={{
                border: `1px solid ${active ? '#0f172a' : '#cbd5e1'}`,
                background: active ? '#0f172a' : '#fff',
                color: active ? '#fff' : '#475569',
                borderRadius: 6,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <Chart
        title={`整体每${incomeUnitLabel}收支(元)`}
        desc="社群、公众号、小程序广告、小程序会员费、视频号收入；固定成本按周期日摊"
        x={chartIncome.map(day => day.date)}
        series={incomeChartSeries(chartIncome, incomePeriod)}
        height={360}
      />
    </main>
  );
}
