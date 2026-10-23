import { type CSSProperties, useEffect } from 'react';
import { ChannelVideoDetail, ChannelVideoTable } from './channel-video-table';
import { Chart } from './charts';
import type { ChannelsDashboard, ChannelsDashboardAccount } from './defs';
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

interface CardMetric {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad' | 'muted';
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('zh-CN')}`;
}

function compactInt(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('zh-CN');
}

function valueDate(value: string | null): string {
  return value ? `截至 ${value}` : '暂无日期';
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

function TotalMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={card}>
      <div style={{ color: '#64748b', fontSize: 12 }}>{label}</div>
      <div style={{ color: '#0f172a', fontSize: 27, fontWeight: 780, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function VideoAccountCard({ account }: { account: ChannelsDashboardAccount }) {
  const topMetrics: CardMetric[] = [
    {
      label: '粉丝',
      value: compactInt(account.stats.fans),
      sub: `7 日 ${signed(account.stats.net7)}`,
      tone: account.stats.net7 >= 0 ? 'good' : 'bad',
    },
    {
      label: '视频',
      value: compactInt(account.stats.videos),
      sub: `昨日播放 ${compactInt(account.stats.yesterdayReads)}`,
    },
    { label: '累计播放', value: compactInt(account.stats.reads), sub: valueDate(account.stats.fansDate) },
  ];
  const bottomMetrics: CardMetric[] = [
    { label: '互动', value: compactInt(account.stats.interactions) },
    { label: '涨粉', value: compactInt(account.stats.follows) },
    { label: '结算状态', value: '待结算', tone: 'muted' },
  ];

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#0f172a', fontSize: 17, fontWeight: 780 }}>{account.account}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>{account.file}</div>
        </div>
        <a href={account.dashboardUrl} style={{ ...button, textDecoration: 'none', display: 'inline-block' }}>
          公众号看板
        </a>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ color: '#64748b', fontSize: 12 }}>视频号收入</div>
        <div style={{ color: '#0f172a', fontSize: 24, fontWeight: 780, marginTop: 4 }}>
          ¥{fmtYuan(account.revenue.incomeCents)}
        </div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>待结算</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 }}>
        {topMetrics.map(metric => (
          <MetricCell key={metric.label} metric={metric} />
        ))}
      </div>
      <div style={{ borderTop: '1px solid #edf2f7', marginTop: 14, paddingTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {bottomMetrics.map(metric => (
            <MetricCell key={metric.label} metric={metric} compact />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChannelsDashboardPage({
  data,
  path,
  onNavigate,
}: {
  data: ChannelsDashboard;
  path: string;
  onNavigate: (to: string) => void;
}) {
  useEffect(() => {
    document.title = '视频号看板';
  }, []);

  const account = data.accounts[0] ?? null;
  if (!account) {
    return (
      <main style={page}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>视频号看板</h1>
        <div style={{ ...card, marginTop: 18, color: '#64748b' }}>暂无账号数据</div>
      </main>
    );
  }

  const dates = account.fansTrend.map(point => point.date);
  const fanSeries = [
    {
      name: '累计粉丝',
      data: account.fansTrend.map(point => point.total_count),
      color: '#5470c6',
      noArea: true,
    },
    {
      name: '每日净增',
      data: account.fansTrend.map(point => point.net_add_count),
      type: 'bar' as const,
      color: '#10b981',
      secondary: true,
    },
  ];
  const videos = account.latestVideos;
  const accountQuery = `?account=${encodeURIComponent(account.id)}`;
  const selectedObjectId = path.match(/\/dashboard\/channels\/v\/([^/?#]+)/)?.[1];
  const selectedVideo = selectedObjectId
    ? videos.find(video => video.object_id === decodeURIComponent(selectedObjectId))
    : null;

  if (selectedVideo) {
    return (
      <ChannelVideoDetail
        account={account}
        video={selectedVideo}
        onBack={() => onNavigate(`/dashboard/channels/${accountQuery}`)}
      />
    );
  }

  return (
    <main style={page}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>{account.account} · 视频号看板</h1>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 5 }}>{account.file}</div>
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
        <TotalMetric label="视频号收入" value={`¥${fmtYuan(account.revenue.incomeCents)}`} sub="按后台区间收益" />
        <TotalMetric label="粉丝" value={compactInt(account.stats.fans)} sub={`7 日 ${signed(account.stats.net7)}`} />
        <TotalMetric
          label="视频"
          value={compactInt(account.stats.videos)}
          sub={`昨日播放 ${compactInt(account.stats.yesterdayReads)}`}
        />
        <TotalMetric label="累计播放" value={compactInt(account.stats.reads)} sub={valueDate(account.stats.fansDate)} />
        <TotalMetric label="互动" value={compactInt(account.stats.interactions)} />
        <TotalMetric label="涨粉" value={compactInt(account.stats.follows)} />
      </div>

      <section style={{ marginTop: 18 }}>
        <VideoAccountCard account={account} />
      </section>

      {dates.length > 0 && (
        <Chart
          title="视频号粉丝(累计 + 每日净增)"
          desc="数据源:视频号助手 fans_trend(本机 Chrome 登录态驱动,不入 Docker)"
          x={dates}
          series={fanSeries}
          height={340}
        />
      )}

      <div style={{ ...card, marginTop: 18, overflowX: 'auto' }}>
        <div style={{ color: '#0f172a', fontSize: 16, fontWeight: 760, marginBottom: 12 }}>最近视频</div>
        <ChannelVideoTable
          videos={videos}
          onPick={video => onNavigate(`/dashboard/channels/v/${encodeURIComponent(video.object_id)}${accountQuery}`)}
        />
      </div>
    </main>
  );
}
