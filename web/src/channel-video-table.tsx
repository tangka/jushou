import * as echarts from 'echarts';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type { ChannelsDashboardAccount, ChannelVideo, ChannelVideoSnapshotPoint } from './defs';
import { fmtFixed, fmtTime, ma7, pct } from './defs';

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

function compactInt(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('zh-CN');
}

function videoTitle(video: ChannelVideo): string {
  return video.title?.trim() || video.description?.trim() || '未命名视频';
}

function videoInteractions(video: ChannelVideo): number {
  return (video.like_count ?? 0) + (video.fav_count ?? 0) + (video.comment_count ?? 0) + (video.forward_count ?? 0);
}

function snapshotInteractions(point: ChannelVideoSnapshotPoint): number {
  return (point.like_count ?? 0) + (point.fav_count ?? 0) + (point.comment_count ?? 0) + (point.forward_count ?? 0);
}

function TotalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={card}>
      <div style={{ color: '#64748b', fontSize: 12 }}>{label}</div>
      <div style={{ color: '#0f172a', fontSize: 27, fontWeight: 780, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function PlaybackTrendChart({ points }: { points: ChannelVideoSnapshotPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const reads = points.map(point => point.read_count ?? 0);
    chart.setOption({
      title: { text: '逐日播放', textStyle: { fontSize: 15 } },
      legend: { top: 28, textStyle: { fontSize: 11 } },
      grid: { left: 56, right: 24, top: 64, bottom: 36 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: points.map(point => point.captured_day) },
      yAxis: { type: 'value', name: '播放' },
      color: ['#36d399', '#f59e0b'],
      series: [
        {
          name: '播放',
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.12 },
          data: reads,
          markPoint: { data: [{ type: 'max', name: '峰值' }] },
        },
        {
          name: '7日平均',
          type: 'line',
          smooth: true,
          data: ma7(reads),
          lineStyle: { width: 2 },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      chart.dispose();
      window.removeEventListener('resize', onResize);
    };
  }, [points]);

  return (
    <div
      ref={ref}
      style={{
        height: 380,
        marginTop: 16,
        background: '#fff',
        borderRadius: 12,
        padding: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      }}
    />
  );
}

type VideoSortKey =
  | 'title'
  | 'create_time'
  | 'read_count'
  | 'yesterday_read_count'
  | 'full_play_rate'
  | 'avg_play_time_sec'
  | 'fast_flip_rate'
  | 'interactions'
  | 'follow_count';

const VIDEO_COLS: { key: VideoSortKey; label: string; title?: string }[] = [
  { key: 'title', label: '视频' },
  { key: 'create_time', label: '发布时间' },
  { key: 'read_count', label: '播放' },
  { key: 'yesterday_read_count', label: '昨日' },
  { key: 'full_play_rate', label: '完播率', title: '看完整条的比例,越高越好' },
  { key: 'avg_play_time_sec', label: '均播秒' },
  { key: 'fast_flip_rate', label: '快划率', title: '刷到后没看几秒就划走的比例,越高越差' },
  { key: 'interactions', label: '互动' },
  { key: 'follow_count', label: '涨粉' },
];

function videoSortValue(video: ChannelVideo, key: VideoSortKey): number {
  if (key === 'title') return 0;
  if (key === 'interactions') return videoInteractions(video);
  return video[key] ?? -1;
}

function VideoCell({ video, sortKey }: { video: ChannelVideo; sortKey: VideoSortKey }) {
  if (sortKey === 'title') return <>{videoTitle(video)}</>;
  if (sortKey === 'create_time') return <>{fmtTime(video.create_time)}</>;
  if (sortKey === 'full_play_rate' || sortKey === 'fast_flip_rate') return <>{pct(video[sortKey])}</>;
  if (sortKey === 'avg_play_time_sec') return <>{fmtFixed(video.avg_play_time_sec, 1)}</>;
  if (sortKey === 'interactions') return <>{compactInt(videoInteractions(video))}</>;
  return <>{compactInt(video[sortKey])}</>;
}

export function ChannelVideoTable({
  videos,
  onPick,
}: {
  videos: ChannelVideo[];
  onPick: (video: ChannelVideo) => void;
}) {
  const [sortKey, setSortKey] = useState<VideoSortKey>('read_count');
  const [asc, setAsc] = useState(false);
  const clickHeader = (key: VideoSortKey) => {
    if (key === sortKey) setAsc(value => !value);
    else {
      setSortKey(key);
      setAsc(key === 'title');
    }
  };
  const sorted = [...videos].sort((a, b) => {
    const cmp =
      sortKey === 'title'
        ? videoTitle(a).localeCompare(videoTitle(b), 'zh')
        : videoSortValue(a, sortKey) - videoSortValue(b, sortKey);
    return asc ? cmp : -cmp;
  });

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ color: '#64748b', textAlign: 'left' }}>
          {VIDEO_COLS.map(col => (
            <th
              key={col.key}
              onClick={() => clickHeader(col.key)}
              title={col.title ?? '点击按此列排序'}
              style={{
                padding: col.key === 'title' ? '0 8px 10px 0' : '0 8px 10px',
                textAlign: col.key === 'title' || col.key === 'create_time' ? 'left' : 'right',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {col.label}
              <span style={{ color: sortKey === col.key ? '#0ea5e9' : '#cbd5e1', marginLeft: 4 }}>
                {sortKey === col.key ? (asc ? '▲' : '▼') : '↕'}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(video => (
          <tr
            key={video.object_id}
            onClick={() => onPick(video)}
            style={{ borderTop: '1px solid #edf2f7', cursor: 'pointer' }}
            title="点击看播放趋势"
          >
            {VIDEO_COLS.map(col => (
              <td
                key={col.key}
                style={{
                  padding: col.key === 'title' ? '11px 8px 11px 0' : '11px 8px',
                  maxWidth: col.key === 'title' ? 360 : undefined,
                  overflow: col.key === 'title' ? 'hidden' : undefined,
                  textOverflow: col.key === 'title' ? 'ellipsis' : undefined,
                  whiteSpace: 'nowrap',
                  textAlign: col.key === 'title' || col.key === 'create_time' ? 'left' : 'right',
                  fontVariantNumeric: col.key === 'title' ? undefined : 'tabular-nums',
                }}
              >
                <VideoCell video={video} sortKey={col.key} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ChannelVideoDetail({
  account,
  video,
  onBack,
}: {
  account: ChannelsDashboardAccount;
  video: ChannelVideo;
  onBack: () => void;
}) {
  useEffect(() => {
    document.title = `${account.account} · 视频号趋势`;
  }, [account.account]);

  const points = video.series ?? [];

  return (
    <main style={page}>
      <button type="button" style={button} onClick={onBack}>
        ← 返回
      </button>
      <h1 style={{ margin: '16px 0 0', fontSize: 22, color: '#0f172a' }}>{videoTitle(video)}</h1>
      <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>
        {account.account} · 发布时间 {fmtTime(video.create_time)}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 12,
          marginTop: 18,
        }}
      >
        <TotalMetric label="播放" value={compactInt(video.read_count)} />
        <TotalMetric label="昨日播放" value={compactInt(video.yesterday_read_count)} />
        <TotalMetric label="完播率" value={pct(video.full_play_rate)} />
        <TotalMetric label="均播秒" value={fmtFixed(video.avg_play_time_sec, 1)} />
        <TotalMetric label="互动" value={compactInt(videoInteractions(video))} />
        <TotalMetric label="涨粉" value={compactInt(video.follow_count)} />
      </div>

      {points.length > 0 ? (
        <PlaybackTrendChart points={points} />
      ) : (
        <div style={{ ...card, marginTop: 18, color: '#64748b' }}>这条视频还没攒够多日快照,同步几天后会出现趋势。</div>
      )}

      {points.length > 0 && (
        <div style={{ ...card, marginTop: 18, overflowX: 'auto' }}>
          <div style={{ color: '#0f172a', fontSize: 16, fontWeight: 760, marginBottom: 12 }}>历史快照</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: '0 8px 10px 0' }}>日期</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>播放</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>昨日</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>完播率</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>均播秒</th>
                <th style={{ padding: '0 8px 10px', textAlign: 'right' }}>互动</th>
                <th style={{ padding: '0 0 10px 8px', textAlign: 'right' }}>涨粉</th>
              </tr>
            </thead>
            <tbody>
              {points.map(point => (
                <tr key={`${video.object_id}:${point.captured_day}`} style={{ borderTop: '1px solid #edf2f7' }}>
                  <td style={{ padding: '11px 8px 11px 0', whiteSpace: 'nowrap' }}>{point.captured_day}</td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>{compactInt(point.read_count)}</td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>{compactInt(point.yesterday_read_count)}</td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>{pct(point.full_play_rate)}</td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>{fmtFixed(point.avg_play_time_sec, 1)}</td>
                  <td style={{ padding: '11px 8px', textAlign: 'right' }}>{compactInt(snapshotInteractions(point))}</td>
                  <td style={{ padding: '11px 0 11px 8px', textAlign: 'right' }}>{compactInt(point.follow_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
