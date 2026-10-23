import * as echarts from 'echarts';
import { useEffect, useRef, useState } from 'react';
import type { Article, ReadSeries } from './defs';
import { engRate, fmtTime, isSurge } from './defs';

export type SortKey =
  | 'title'
  | 'publish_time'
  | 'read_uv'
  | 'zaikan_cnt'
  | 'share_uv'
  | 'follow_uv'
  | 'engagement'
  | 'income_cents';
const TABLE_COLS: { key: SortKey; label: string }[] = [
  { key: 'title', label: '标题' },
  { key: 'publish_time', label: '发布时间' },
  { key: 'read_uv', label: '阅读' },
  { key: 'zaikan_cnt', label: '在看' },
  { key: 'share_uv', label: '分享' },
  { key: 'follow_uv', label: '读后关注' },
  { key: 'engagement', label: '互动率' }, // 喜欢度
  { key: 'income_cents', label: '收益(元)' },
];

/** 排序用数值(标题走字符串、互动率现算、其余取字段)。 */
export function sortVal(a: Article, k: SortKey): number {
  if (k === 'engagement') return engRate(a);
  if (k === 'title') return 0;
  if (k === 'publish_time') return a.publish_time ?? 0;
  return a[k];
}

export function ArticleTable({
  rows,
  surgeIds,
  onPick,
}: {
  rows: Article[];
  surgeIds: Set<number>;
  onPick: (a: Article) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('read_uv');
  const [asc, setAsc] = useState(false); // 数值默认降序
  const clickHeader = (k: SortKey) => {
    if (k === sortKey) setAsc(a => !a);
    else {
      setSortKey(k);
      setAsc(k === 'title');
    } // 标题默认升序(A→Z),数值默认降序
  };
  const sorted = [...rows].sort((a, b) => {
    const cmp = sortKey === 'title' ? a.title.localeCompare(b.title, 'zh') : sortVal(a, sortKey) - sortVal(b, sortKey);
    return asc ? cmp : -cmp;
  });
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        background: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        fontSize: 14,
        marginTop: 10,
      }}
    >
      <thead style={{ background: '#eef0f2' }}>
        <tr>
          {TABLE_COLS.map(c => (
            <th
              key={c.key}
              onClick={() => clickHeader(c.key)}
              style={{
                textAlign: c.key === 'title' ? 'left' : 'right',
                padding: '9px 10px',
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
              title={
                c.key === 'engagement' ? '互动率=(在看+赞+评+分享+收藏)÷阅读,衡量喜欢度。点击排序' : '点击按此列排序'
              }
            >
              {c.label}
              <span style={{ color: sortKey === c.key ? '#0ea5e9' : '#cbd5e1', marginLeft: 4 }}>
                {sortKey === c.key ? (asc ? '▲' : '▼') : '↕'}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map(a => (
          <tr
            key={a.id}
            onClick={() => onPick(a)}
            style={{ borderTop: '1px solid #f0f0f0', cursor: 'pointer' }}
            title="点击看逐日阅读趋势"
          >
            <td
              style={{
                padding: '8px 10px',
                maxWidth: 320,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {surgeIds.has(a.id) && <span title="二次爆发">🔥 </span>}
              {a.title}
            </td>
            <td
              style={{
                textAlign: 'right',
                padding: '8px 10px',
                color: '#64748b',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmtTime(a.publish_time)}
            </td>
            <td style={{ textAlign: 'right', padding: '8px 10px' }}>{a.read_uv}</td>
            <td style={{ textAlign: 'right', padding: '8px 10px' }}>{a.zaikan_cnt}</td>
            <td style={{ textAlign: 'right', padding: '8px 10px' }}>{a.share_uv}</td>
            <td style={{ textAlign: 'right', padding: '8px 10px' }}>{a.follow_uv}</td>
            <td style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 600, color: '#0ea5e9' }}>
              {(engRate(a) * 100).toFixed(2)}%
            </td>
            <td style={{ textAlign: 'right', padding: '8px 10px' }}>{(a.income_cents / 100).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const SLOT_COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#14b8a6', '#64748b'];

// ── 二级页:单篇阅读趋势 ──
export function ArticleDetail({
  article,
  series,
  onBack,
}: {
  article: Article;
  series?: ReadSeries;
  onBack: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !series) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      title: { text: '逐日阅读', textStyle: { fontSize: 15 } },
      grid: { left: 56, right: 24, top: 48, bottom: 36 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: series.points.map(p => p.day) },
      yAxis: { type: 'value', name: '阅读' },
      color: ['#36d399'],
      series: [
        {
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.12 },
          data: series.points.map(p => p.read),
          markPoint: { data: [{ type: 'max', name: '峰值' }] },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      chart.dispose();
      window.removeEventListener('resize', onResize);
    };
  }, [series]);
  const first = series?.points[0]?.read ?? 0;
  const last = series?.points[series.points.length - 1]?.read ?? 0;
  const surge = series ? isSurge(series) : false;
  return (
    <div
      style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: 24,
        fontFamily: 'system-ui, "PingFang SC", sans-serif',
        background: '#f6f7f9',
        minHeight: '100vh',
      }}
    >
      <button
        type="button"
        onClick={onBack}
        style={{
          border: 'none',
          background: '#fff',
          padding: '8px 16px',
          borderRadius: 8,
          cursor: 'pointer',
          boxShadow: '0 1px 4px rgba(0,0,0,.06)',
          fontSize: 14,
        }}
      >
        ← 返回
      </button>
      <h2 style={{ fontSize: 19, marginTop: 16 }}>{article.title}</h2>
      <div style={{ color: '#666', fontSize: 14, marginTop: 4 }}>
        {article.media_type ?? '—'} · 阅读 {article.read_uv} · 读后关注 {article.follow_uv} · 收益{' '}
        {(article.income_cents / 100).toFixed(2)} 元
        {surge && (
          <b style={{ color: '#e8915f' }}>
            {' '}
            · 🔥 二次爆发 {first}→{last}
          </b>
        )}
      </div>
      {series ? (
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
      ) : (
        <div style={{ marginTop: 24, color: '#888', background: '#fff', borderRadius: 12, padding: 24 }}>
          这篇还没攒够多日快照(需 ≥3 天),过几天再来看趋势。
        </div>
      )}
    </div>
  );
}
