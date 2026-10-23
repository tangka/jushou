import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import type { Line, RevenueComposition } from './defs';
import { fmtRatio, fmtYuan, sharePct } from './defs';

const Y_AXIS_HEADROOM = 1.08;

function primaryYAxisMax(series: Line[], markLine?: { y: number; name: string }): number | undefined {
  if (!markLine || !Number.isFinite(markLine.y)) return undefined;

  const values = series
    .filter(s => !s.secondary)
    .flatMap(s => s.data)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  values.push(markLine.y);

  const max = Math.max(0, ...values);
  return max > 0 ? Math.ceil(max * Y_AXIS_HEADROOM) : undefined;
}

export function Chart({
  title,
  desc,
  x,
  series,
  markLine,
  scaleYAxis = false,
  height = 300,
}: {
  title: string;
  desc?: string;
  x: string[];
  series: Line[];
  markLine?: { y: number; name: string };
  scaleYAxis?: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const hasSecondary = series.some(s => s.secondary);
    const yAxisMax = primaryYAxisMax(series, markLine);
    const mainYAxis = {
      type: 'value' as const,
      scale: scaleYAxis,
      ...(yAxisMax ? { max: yAxisMax } : {}),
    };
    chart.setOption({
      title: {
        text: title,
        textStyle: { fontSize: 15 },
        subtext: desc,
        subtextStyle: { fontSize: 11, color: '#94a3b8' },
      },
      grid: { left: 52, right: hasSecondary ? 64 : 44, top: desc ? 74 : 58, bottom: 36 },
      tooltip: { trigger: 'axis' },
      legend: { top: desc ? 46 : 28, textStyle: { fontSize: 11 } },
      xAxis: {
        type: 'category',
        data: x,
        boundaryGap: series.some(s => s.type === 'bar'),
        // 强制显示首尾标签(否则最新一天的日期被 echarts 省略,看着像缺数据)
        axisLabel: { showMinLabel: true, showMaxLabel: true },
      },
      yAxis: hasSecondary ? [mainYAxis, { type: 'value', splitLine: { show: false } }] : mainYAxis,
      series: series.map((s, i) => {
        const t = s.type ?? 'line';
        return {
          name: s.name,
          type: t,
          data: s.data,
          yAxisIndex: s.secondary ? 1 : 0,
          smooth: t === 'line' && !s.dashed && !s.stack,
          connectNulls: true,
          stack: s.stack ? 'total' : undefined,
          ...(s.color
            ? {
                itemStyle: { color: s.color },
                lineStyle: { color: s.color, type: s.dashed ? 'dashed' : 'solid', width: s.width ?? 2 },
              }
            : {}),
          areaStyle: s.noArea
            ? undefined
            : s.stack
              ? { opacity: 0.85 }
              : t === 'line' && !s.dashed && !s.secondary
                ? { opacity: 0.06 }
                : undefined,
          ...(markLine && i === 0
            ? {
                markLine: {
                  symbol: 'none',
                  data: [{ yAxis: markLine.y }],
                  label: { formatter: `${markLine.name} ${markLine.y}`, position: 'insideStartTop', color: '#f43f5e' },
                  lineStyle: { type: 'dashed', color: '#f43f5e' },
                },
              }
            : {}),
        };
      }),
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      chart.dispose();
      window.removeEventListener('resize', onResize);
    };
  }, [title, desc, x, series, markLine, scaleYAxis]);
  return (
    <div
      ref={ref}
      style={{
        height,
        marginTop: 20,
        background: '#fff',
        borderRadius: 12,
        padding: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      }}
    />
  );
}

export function Bar({
  label,
  pct,
  color,
  valueLabel,
}: {
  label: string;
  pct: number;
  color: string;
  valueLabel?: string;
}) {
  const safePct = Number.isFinite(pct) ? pct : 0;
  const widthPct = Math.max(0, Math.min(100, safePct));
  return (
    <div style={{ marginTop: 8, fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
        <span>{label}</span>
        <span>{valueLabel ?? `${safePct.toFixed(0)}%`}</span>
      </div>
      <div style={{ height: 6, background: '#eee', borderRadius: 3, marginTop: 3 }}>
        <div style={{ height: '100%', width: `${widthPct}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

export function RevenueCompositionCard({ data }: { data: RevenueComposition }) {
  const parts = [
    { label: '程序化广告', cents: data.programmatic_cents, color: '#f59e0b' },
    { label: '互选广告', cents: data.freetrade_cents, color: '#0ea5e9' },
    { label: '返佣商品(CPS)', cents: data.cps_cents, color: '#8b5cf6' },
  ];
  const categoryTotal = parts.reduce((sum, item) => sum + item.cents, 0);
  const shareTotal = data.total_cents > 0 ? data.total_cents : categoryTotal;
  const statStyle = {
    minWidth: 120,
    flex: '1 1 120px',
    background: '#f8fafc',
    borderRadius: 8,
    padding: '10px 12px',
  };

  return (
    <div
      style={{
        marginTop: 16,
        background: '#fff',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <b style={{ fontSize: 15 }}>收入构成</b>
          <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 12 }}>抓取日 {data.date}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>累计总收入</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{fmtYuan(data.total_cents)} 元</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        <div style={statStyle}>
          <div style={{ color: '#64748b', fontSize: 12 }}>昨日</div>
          <b>{fmtYuan(data.yesterday_cents)} 元</b>
        </div>
        <div style={statStyle}>
          <div style={{ color: '#64748b', fontSize: 12 }}>近7天</div>
          <b>{fmtYuan(data.week_cents)} 元</b>
        </div>
        <div style={statStyle}>
          <div style={{ color: '#64748b', fontSize: 12 }}>近30天</div>
          <b>{fmtYuan(data.month_cents)} 元</b>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        {parts.map(item => {
          const pctValue = sharePct(item.cents, shareTotal);
          return (
            <Bar
              key={item.label}
              label={`${item.label} ${fmtYuan(item.cents)} 元`}
              pct={pctValue}
              valueLabel={`${pctValue.toFixed(1)}%`}
              color={item.color}
            />
          );
        })}
      </div>
      <div style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>
        日环比 {fmtRatio(data.day_ratio)} · 周环比 {fmtRatio(data.week_ratio)}
      </div>
    </div>
  );
}

// 文章表(可点进单篇趋势),surgeIds 标二次爆发;点表头按该列升/降排序
