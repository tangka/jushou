import type { CSSProperties } from 'react';
import type { DashboardOverview } from './defs';
import { fmtYuan } from './defs';
import { InlineAppletLogin } from './inline-applet-login';

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

interface CardMetric {
  label: string;
  value: string;
  tone?: 'muted';
}

function valueDate(value: string | null): string {
  return value ? `截至 ${value}` : '暂无日期';
}

function rangeText(start: string | null, end: string | null, fallback: string | null): string {
  if (start && end) return `${start} ~ ${end}`;
  return valueDate(fallback);
}

function metricColor(tone: CardMetric['tone']): string {
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
    </div>
  );
}

function UserSparkline({ points }: { points: DashboardOverview['applets'][number]['userDays'] }) {
  if (points.length < 2) return null;
  const width = 320;
  const height = 52;
  const min = Math.min(...points.map(point => point.cumulativeUsers));
  const max = Math.max(...points.map(point => point.cumulativeUsers));
  const range = Math.max(1, max - min);
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - 5 - ((point.cumulativeUsers - min) / range) * (height - 10);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const growth = points.at(-1)?.cumulativeUsers ?? 0;
  const start = points[0]?.cumulativeUsers ?? growth;
  const delta = growth - start;

  return (
    <div style={{ borderTop: '1px solid #edf2f7', marginTop: 14, paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: '#64748b', fontSize: 12 }}>
        <span>累计用户趋势 · 近 30 天</span>
        <span style={{ color: delta >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
          {delta >= 0 ? '+' : ''}
          {delta.toLocaleString('zh-CN')}
        </span>
      </div>
      <svg
        role="img"
        aria-label="累计用户趋势"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: 52, marginTop: 5 }}
      >
        <path d={path} fill="none" stroke="#16a34a" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function AppletCard({ applet }: { applet: DashboardOverview['applets'][number] }) {
  const hasRevenueData = applet.updatedDate !== null;
  const revenueValue = (cents: number) => (hasRevenueData ? `¥${fmtYuan(cents)}` : '暂不可用');

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#0f172a', fontSize: 17, fontWeight: 780 }}>{applet.name || '小程序'}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>独立模块</div>
        </div>
        <button
          type="button"
          style={button}
          onClick={() => {
            window.location.href = applet.dashboardUrl;
          }}
        >
          打开看板
        </button>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 16,
          marginTop: 14,
        }}
      >
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>小程序广告收入</div>
          <div style={{ color: hasRevenueData ? '#0f172a' : '#94a3b8', fontSize: 24, fontWeight: 780, marginTop: 4 }}>
            {revenueValue(applet.totalCents)}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>
            {hasRevenueData
              ? rangeText(applet.dateRangeStart, applet.dateRangeEnd, applet.updatedDate)
              : '收益接口暂不可用'}
          </div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 12 }}>累计用户</div>
          <div style={{ color: '#16a34a', fontSize: 24, fontWeight: 780, marginTop: 4 }}>
            {applet.cumulativeUsers === null ? '-' : applet.cumulativeUsers.toLocaleString('zh-CN')}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>{valueDate(applet.usersDate)}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
        <MetricCell
          metric={{
            label: '昨日收入',
            value: revenueValue(applet.yesterdayCents),
            tone: hasRevenueData ? undefined : 'muted',
          }}
        />
        <MetricCell
          metric={{
            label: '近 7 日',
            value: revenueValue(applet.weekCents),
            tone: hasRevenueData ? undefined : 'muted',
          }}
        />
        <MetricCell
          metric={{
            label: '累计收入',
            value: revenueValue(applet.totalCents),
            tone: hasRevenueData ? undefined : 'muted',
          }}
        />
      </div>
      <UserSparkline points={applet.userDays} />
      {applet.login === 'expired' ? <InlineAppletLogin applet={applet} /> : null}
      <div style={{ borderTop: '1px solid #edf2f7', marginTop: 14, paddingTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 12 }}>
          <MetricCell
            metric={{
              label: '更新日期',
              value: applet.updatedDate ?? '-',
              tone: applet.updatedDate ? undefined : 'muted',
            }}
            compact
          />
          <MetricCell
            metric={{
              label: '区间开始',
              value: applet.dateRangeStart ?? '-',
              tone: applet.dateRangeStart ? undefined : 'muted',
            }}
            compact
          />
          <MetricCell
            metric={{
              label: '区间结束',
              value: applet.dateRangeEnd ?? '-',
              tone: applet.dateRangeEnd ? undefined : 'muted',
            }}
            compact
          />
        </div>
      </div>
    </div>
  );
}
