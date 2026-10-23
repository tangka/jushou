import { type CSSProperties, useEffect } from 'react';
import { Chart } from './charts';
import type { AppletsDashboard, AppletsDashboardApplet } from './defs';
import { fmtYuan } from './defs';

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
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#0f172a',
  borderRadius: 6,
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

function rangeText(applet: AppletsDashboardApplet): string {
  const overview = applet.overview;
  if (!overview) return '收益接口暂不可用';
  if (!overview?.date_range_start || !overview.date_range_end) {
    return overview.captured_day;
  }
  return `${overview.date_range_start} ~ ${overview.date_range_end}`;
}

function TotalMetric({
  label,
  value,
  sub,
  valueColor = '#0f172a',
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div style={card}>
      <div style={{ color: '#64748b', fontSize: 12 }}>{label}</div>
      <div style={{ color: valueColor, fontSize: 27, fontWeight: 780, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export function AppletsDashboardPage({ data }: { data: AppletsDashboard }) {
  useEffect(() => {
    document.title = '小程序看板';
  }, []);

  const applet = data.applets[0] ?? null;
  if (!applet) {
    return (
      <main style={page}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>小程序看板</h1>
        <div style={{ ...card, marginTop: 18, color: '#64748b' }}>暂无小程序数据</div>
      </main>
    );
  }

  const overview = applet.overview;
  const userOverview = applet.userOverview;
  const userDays = applet.userDays;
  const days = applet.days;
  const revenueValue = (cents: number | undefined) => (overview ? `¥${fmtYuan(cents ?? 0)}` : '暂不可用');

  return (
    <main style={page}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>{applet.name} · 小程序看板</h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 5 }}>
            {applet.file} · {rangeText(applet)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={button} onClick={() => window.location.reload()}>
            刷新
          </button>
          <button
            type="button"
            style={button}
            onClick={() => {
              window.location.href = '/dashboard/';
            }}
          >
            首页
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginTop: 18,
        }}
      >
        <TotalMetric
          label="累计用户"
          value={userOverview ? userOverview.cumulative_users.toLocaleString('zh-CN') : '-'}
          sub={userOverview ? `截至 ${userOverview.data_date}` : '暂无数据'}
          valueColor="#16a34a"
        />
        <TotalMetric
          label="累计收入"
          value={revenueValue(overview?.total_cents)}
          sub={rangeText(applet)}
          valueColor={overview ? '#0f172a' : '#94a3b8'}
        />
        <TotalMetric
          label="昨日收入"
          value={revenueValue(overview?.yesterday_cents)}
          valueColor={overview ? '#0f172a' : '#94a3b8'}
        />
        <TotalMetric
          label="近 7 日收入"
          value={revenueValue(overview?.week_cents)}
          valueColor={overview ? '#0f172a' : '#94a3b8'}
        />
        <TotalMetric
          label="更新日期"
          value={overview?.captured_day ?? '暂不可用'}
          valueColor={overview ? '#0f172a' : '#94a3b8'}
        />
      </div>

      {userDays.length > 0 ? (
        <Chart
          title="累计用户趋势(人)"
          desc="数据源:微信小程序后台「累计用户数」每日历史值;缺失日期保持空值"
          x={userDays.map(day => day.data_date)}
          series={[
            {
              name: '累计用户',
              data: userDays.map(day => day.cumulative_users),
              color: '#16a34a',
              width: 3,
            },
          ]}
          scaleYAxis
          height={340}
        />
      ) : (
        <div style={{ ...card, marginTop: 18, color: '#64748b', fontSize: 13 }}>暂无累计用户历史数据。</div>
      )}

      {days.length > 0 ? (
        <Chart
          title="小程序每日收入(元)"
          desc="数据源:小程序流量主 capture JSON;与公众号流量主收益独立统计"
          x={days.map(day => day.date)}
          series={[
            {
              name: '收入',
              data: days.map(day => +(day.income_cents / 100).toFixed(2)),
              color: '#0ea5e9',
            },
          ]}
          height={340}
        />
      ) : (
        <div style={{ ...card, marginTop: 18, color: '#64748b', fontSize: 13 }}>
          {overview
            ? '暂无每日明细。当前只导入了概览时,首页和本页会显示累计/昨日/近 7 日收入。'
            : '收益接口暂不可用；已保留累计用户数据，收入未按 0 记录。'}
        </div>
      )}

      {days.length > 0 && (
        <div style={{ ...card, marginTop: 18, overflowX: 'auto' }}>
          <div style={{ color: '#0f172a', fontSize: 16, fontWeight: 760, marginBottom: 12 }}>每日明细</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '0 8px 10px 0' }}>日期</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>收入</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>拉取量</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>曝光量</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>点击量</th>
                <th style={{ padding: '0 0 10px 8px', textAlign: 'right' }}>eCPM</th>
              </tr>
            </thead>
            <tbody>
              {days.map(day => (
                <tr key={`${day.date}-${day.appid}`} style={{ borderTop: '1px solid #edf2f7' }}>
                  <td style={{ padding: '11px 8px 11px 0', color: '#0f172a', fontWeight: 650 }}>{day.date}</td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>¥{fmtYuan(day.income_cents)}</td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>{day.pull_count.toLocaleString('zh-CN')}</td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>
                    {day.exposure_count.toLocaleString('zh-CN')}
                  </td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>{day.click_count.toLocaleString('zh-CN')}</td>
                  <td style={{ padding: '11px 0 11px 8px', textAlign: 'right' }}>
                    {day.ecpm_yuan === null ? '-' : `¥${day.ecpm_yuan.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
