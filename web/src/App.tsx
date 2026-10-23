import { useEffect, useState } from 'react';
import { AccountManager } from './accounts';
import { AppletsDashboardPage } from './applets-dashboard';
import { ChannelsDashboardPage } from './channels-dashboard';
import { Bar, Chart } from './charts';
import type { AppletsDashboard, Article, ChannelsDashboard, DashboardOverview, Summary } from './defs';
import { fmtYuan, isSurge, ma7 } from './defs';
import { HomeDashboard } from './home';
import { refreshHomeLoginStatus } from './home-login-status';
import { ArticleDetail, ArticleTable, SLOT_COLORS } from './tables';

export function App() {
  const [d, setD] = useState<Summary | null>(null);
  const [home, setHome] = useState<DashboardOverview | null>(null);
  const [channelsHome, setChannelsHome] = useState<ChannelsDashboard | null>(null);
  const [appletsHome, setAppletsHome] = useState<AppletsDashboard | null>(null);
  const [err, setErr] = useState('');
  const [path, setPath] = useState(`${window.location.pathname}${window.location.search}`);
  const accountParam = new URLSearchParams(window.location.search).get('account');
  const isChannelsPath = path.split('?')[0].startsWith('/dashboard/channels');
  const isAppletsPath = path.split('?')[0].startsWith('/dashboard/applets');
  useEffect(() => {
    const endpoint = isChannelsPath
      ? `/api/dashboard/channels${window.location.search}`
      : isAppletsPath
        ? `/api/dashboard/applets${window.location.search}`
        : accountParam
          ? `/api/dashboard/summary${window.location.search}`
          : '/api/dashboard/overview';
    setErr('');
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(json => {
        if (isChannelsPath) {
          const channels = json as ChannelsDashboard;
          setChannelsHome(channels);
          const id = channels.accounts[0]?.id;
          if (!accountParam && id) {
            const nextPath = `${window.location.pathname}?account=${encodeURIComponent(id)}`;
            window.history.replaceState(null, '', nextPath);
            setPath(nextPath);
          }
        } else if (isAppletsPath) {
          const applets = json as AppletsDashboard;
          setAppletsHome(applets);
        } else if (accountParam) {
          setD(json as Summary);
        } else {
          setHome(json as DashboardOverview);
          void refreshHomeLoginStatus(setHome, controller.signal);
        }
      })
      .catch(e => {
        if (!controller.signal.aborted) setErr(String(e));
      });
    const onPop = () => setPath(`${window.location.pathname}${window.location.search}`);
    window.addEventListener('popstate', onPop);
    return () => {
      controller.abort();
      window.removeEventListener('popstate', onPop);
    };
  }, [accountParam, isAppletsPath, isChannelsPath]);
  const navigate = (to: string) => {
    window.history.pushState(null, '', to);
    setPath(to);
  };
  if (err) return <div style={{ padding: 40, color: '#c00' }}>加载失败:{err}</div>;
  if (isChannelsPath) {
    if (!channelsHome) return <div style={{ padding: 40 }}>加载中…</div>;
    return <ChannelsDashboardPage data={channelsHome} path={path} onNavigate={navigate} />;
  }
  if (isAppletsPath) {
    if (!appletsHome) return <div style={{ padding: 40 }}>加载中…</div>;
    return <AppletsDashboardPage data={appletsHome} />;
  }
  if (!accountParam) {
    if (!home) return <div style={{ padding: 40 }}>加载中…</div>;
    return <HomeDashboard data={home} />;
  }
  if (!d) return <div style={{ padding: 40 }}>加载中…</div>;
  const accountQuery = `?account=${encodeURIComponent(d.accountId)}`;
  const m = path.match(/\/dashboard\/a\/(\d+)/);
  if (m) {
    const id = Number(m[1]);
    const article = d.articles.find(a => a.id === id);
    if (article)
      return (
        <ArticleDetail
          article={article}
          series={d.readSeries.find(r => r.id === id)}
          onBack={() => navigate(`/dashboard/${accountQuery}`)}
        />
      );
  }
  const goalPct = (cur: number, target: number) => Math.min(100, (cur / target) * 100);
  const surgeIds = new Set(d.readSeries.filter(isSurge).map(s => s.id));
  const g0 = d.goals[0]; // 短期目标
  const fmap = new Map(d.followers.map(f => [f.date, f.cumulate_user]));
  const gainMap = new Map(d.followers.map(f => [f.date, f.netgain_user])); // 当日净增关注
  const readMap = new Map(d.readTendency.map(n => [n.date, n.all])); // 当日阅读量(全部)

  // 阅读来源(渠道)透视:占比堆叠图 + 粉丝阅读率
  const SCENES = [
    { s: 0, name: '公众号消息', c: '#16a34a' }, // 粉丝(只推给粉丝,最纯)
    { s: 4, name: '公众号主页', c: '#38bdf8' }, // 主页(粉丝+看一看路人混)
    { s: 1, name: '聊天会话', c: '#14b8a6' },
    { s: 2, name: '朋友圈', c: '#8b5cf6' },
    { s: 7, name: '搜一搜', c: '#ec4899' },
    { s: 5, name: '其他', c: '#94a3b8' },
    { s: 6, name: '推荐(看一看)', c: '#f59e0b' }, // 路人/算法,堆最上
  ];
  const srcDates = [...new Set(d.readBySource.map(r => r.date))].sort();
  const srcMap = new Map(d.readBySource.map(r => [`${r.date}|${r.scene}`, r.read_uv]));
  const totByDate = new Map(
    srcDates.map(dt => [dt, SCENES.reduce((sum, sc) => sum + (srcMap.get(`${dt}|${sc.s}`) ?? 0), 0)])
  );
  const srcSeries = SCENES.map(sc => ({
    name: sc.name,
    color: sc.c,
    stack: true,
    data: srcDates.map(dt => {
      const t = totByDate.get(dt) ?? 0;
      return t ? +(((srcMap.get(`${dt}|${sc.s}`) ?? 0) / t) * 100).toFixed(1) : 0;
    }),
  }));
  // 粉丝阅读 = 公众号消息(scene 0,只推给粉丝,最纯净;主页会被看一看路人逛进来带高,不算)
  const fanRead = srcDates.map(dt => srcMap.get(`${dt}|0`) ?? 0);
  // 收益目标线:每日 = 当日累计粉丝 × 短期每粉目标(分)/ 100 → 元
  const revTarget = d.revenue.map(r => {
    const fans = fmap.get(r.date);
    return fans ? +((fans * g0.perFollowerCents) / 100).toFixed(2) : null;
  });
  const slotDates = [...new Set(d.slotIncome.map(r => r.date))].sort();
  const slotIds = [...new Set(d.slotIncome.map(r => r.slotid))].sort((a, b) =>
    (d.slotNames[a] ?? a).localeCompare(d.slotNames[b] ?? b, 'zh')
  );
  const slotIncomeMap = new Map(d.slotIncome.map(r => [`${r.date}|${r.slotid}`, r.income_cents]));
  // 各广告位逐日收入:每位一条纯曲线(无面积阴影),并入「每日收益」图
  const slotSeries = slotIds.map((slotid, i) => ({
    name: d.slotNames[slotid] ?? slotid,
    data: slotDates.map(dt => +((slotIncomeMap.get(`${dt}|${slotid}`) ?? 0) / 100).toFixed(2)),
    color: SLOT_COLORS[i % SLOT_COLORS.length],
    type: 'line' as const,
    noArea: true,
  }));
  // 总收益曲线 = 当日各广告位之和(与广告位曲线同一 x 轴)
  const slotTotalSeries = {
    name: '总收益',
    data: slotDates.map(
      dt => +(slotIds.reduce((s, id) => s + (slotIncomeMap.get(`${dt}|${id}`) ?? 0), 0) / 100).toFixed(2)
    ),
    color: '#0f172a', // 深色:总收益醒目且不与各广告位(含 #f59e0b)撞色
    type: 'line' as const,
    noArea: true,
    width: 3.5, // 主线加粗
  };
  // 收益目标线落在「广告位日期」轴上(与曲线同一 x)
  const revTargetBySlotDate = slotDates.map(dt => {
    const fans = fmap.get(dt);
    return fans ? +((fans * g0.perFollowerCents) / 100).toFixed(2) : null;
  });
  const byMedia = (kw: string) => d.articles.filter(a => (a.media_type ?? '').includes(kw));
  const videoRows = byMedia('视频');
  const groups: [string, Article[]][] = [
    ['文章', byMedia('文章')],
    ['贴图', byMedia('贴图')],
    ['视频', videoRows],
  ];

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: 24,
        fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif',
        background: '#f6f7f9',
        minHeight: '100vh',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>
          {d.account} · 数据看板{' '}
          <span style={{ color: '#888', fontSize: 14, fontWeight: 400 }}>
            粉丝 {d.now.fans} / 人均 {d.now.avgPerFollowerCents} 分
            {d.groupRevenue && d.groupRevenue.totalCount > 0 && (
              <>
                {' / 社群 ¥'}
                {fmtYuan(d.groupRevenue.groupCents)}
                {`(${d.groupRevenue.groupCount}单)`}
                {' / 小程序会员费 ¥'}
                {fmtYuan(d.groupRevenue.appletMembershipCents)}
              </>
            )}
          </span>
        </h1>
        <button
          type="button"
          style={{
            border: '1px solid #cbd5e1',
            background: '#fff',
            color: '#0f172a',
            borderRadius: 6,
            padding: '7px 10px',
            cursor: 'pointer',
            fontSize: 13,
          }}
          onClick={() => {
            window.location.href = '/dashboard/';
          }}
        >
          首页
        </button>
      </div>

      <AccountManager selectedAccountId={d.accountId} />

      <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
        {d.goals.map(g => (
          <div
            key={g.stage}
            style={{
              flex: 1,
              background: '#fff',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 1px 4px rgba(0,0,0,.06)',
            }}
          >
            <b>{g.stage}</b>
            <Bar label={`粉丝 ${d.now.fans}/${g.followers}`} pct={goalPct(d.now.fans, g.followers)} color="#36d399" />
            <Bar
              label={`每粉 ${d.now.avgPerFollowerCents}/${g.perFollowerCents} 分`}
              pct={goalPct(d.now.avgPerFollowerCents, g.perFollowerCents)}
              color="#a5b4fc"
            />
          </div>
        ))}
      </div>

      {/* 1. 粉丝累计 + 短期目标线 */}
      <Chart
        title="粉丝(累计)"
        desc="【结果】账号总粉丝数 · 北极星之一 · 红线=短期目标"
        x={d.followers.map(f => f.date)}
        series={[{ name: '累计粉丝', data: d.followers.map(f => f.cumulate_user), color: '#36d399' }]}
        markLine={{ y: g0.followers, name: '短期目标' }}
      />
      {/* 2. 每日净增 + 7 日均线 */}
      <Chart
        title="每日净增关注"
        desc="【结果】当日新增−取消关注 · 橙线=7日均(抹平波动看趋势)"
        x={d.followers.map(f => f.date)}
        series={[
          { name: '净增', data: d.followers.map(f => f.netgain_user), type: 'bar', color: '#36d399' },
          { name: '7日平均', data: ma7(d.followers.map(f => f.netgain_user)), type: 'line', color: '#f59e0b' },
        ]}
      />
      {/* 3. 每日收益 + 短期目标线;有广告位明细时按广告位堆叠柱(堆叠高=当日总收入) */}
      {slotDates.length > 0 ? (
        <Chart
          title="每日收益(元)· 按广告位"
          desc="【结果】流量主当日广告收入,按广告位堆叠 · 红虚线=当日粉丝×每粉目标的应得线 · 名称来自账号配置"
          x={slotDates}
          series={[
            slotTotalSeries,
            ...slotSeries,
            { name: '短期目标', data: revTargetBySlotDate, color: '#f43f5e', dashed: true },
          ]}
          height={340}
        />
      ) : (
        <Chart
          title="每日收益(元)"
          desc="【结果】流量主当日广告收入 · 红虚线=当日粉丝×每粉目标的应得线"
          x={d.revenue.map(r => r.date)}
          series={[
            { name: '收益', data: d.revenue.map(r => +(r.income_cents / 100).toFixed(2)), color: '#f59e0b' },
            { name: '短期目标', data: revTarget, color: '#f43f5e', dashed: true },
          ]}
        />
      )}
      {/* 4. 每粉收益 + 短期目标线 */}
      <Chart
        title="每粉收益(分/天)"
        desc="【结果·北极星】当日收益÷当日累计粉丝 · 北极星之二 · 衡量变现效率(与粉丝量无关)"
        x={d.metrics.map(m2 => m2.date)}
        series={[{ name: '每粉收益', data: d.metrics.map(m2 => m2.per_follower_cents), color: '#a5b4fc' }]}
        markLine={{ y: g0.perFollowerCents, name: '短期目标' }}
      />
      {/* 5. 每日净阅读量(各文当日 read 增量之和,含老文长尾)*/}
      {d.readTendency?.length > 0 && (
        <Chart
          title="每日阅读量 + 每粉阅读(看当日触达质量)"
          desc="【先行指标】蓝=当日全账号阅读人数(后台口径) · 橙[右轴]=阅读÷净增粉,越低=涨粉转化越高效"
          x={d.readTendency.map(n => n.date)}
          series={[
            { name: '阅读量(全部)', data: d.readTendency.map(n => n.all), color: '#0ea5e9' },
            {
              name: '阅读/新增粉丝',
              data: d.readTendency.map(n => {
                const g = gainMap.get(n.date);
                return g && g > 0 ? +(n.all / g).toFixed(1) : null;
              }),
              color: '#f59e0b',
              secondary: true,
            },
          ]}
        />
      )}
      {/* 6. 累计阅读量(各文截至当日最新 read 之和,单调不减)*/}
      {d.cumulativeReads?.length > 0 && (
        <Chart
          title="累计阅读量 + 每粉累计阅读(看正相关)"
          desc="【结果】绿=逐日阅读累加(历史总触达) · 紫[右轴]=累计阅读÷累计粉丝,越高=破圈/非粉阅读越强"
          x={d.cumulativeReads.map(n => n.date)}
          series={[
            { name: '累计阅读', data: d.cumulativeReads.map(n => n.total), color: '#14b8a6' },
            {
              name: '累计阅读/累计粉丝',
              data: d.cumulativeReads.map(n => {
                const f = fmap.get(n.date);
                return f ? +(n.total / f).toFixed(1) : null;
              }),
              color: '#8b5cf6',
              secondary: true,
            },
          ]}
        />
      )}
      {/* 7. 每次阅读收益(分):当日收益 ÷ 当日阅读量,看单次阅读的变现效率。从有收入的第一天(06-05)起 */}
      {d.revenue?.length > 0 && (
        <Chart
          title="每次阅读收益(分/次)= 当日收益 ÷ 当日阅读"
          desc="【转化效率】单次阅读的变现效率 · 看一看路人多会摊薄它(分母涨快) · 回升=阅读质量/广告匹配变好"
          x={d.revenue.map(r => r.date)}
          series={[
            {
              name: '分/次',
              data: d.revenue.map(r => {
                const reads = readMap.get(r.date);
                return reads && reads > 0 ? +(r.income_cents / reads).toFixed(3) : null;
              }),
              color: '#ec4899',
            },
          ]}
        />
      )}

      {/* 8. 每日阅读来源占比(渠道构成):看多少是粉丝、多少是看一看路人 */}
      {srcDates.length > 0 && (
        <Chart
          title="每日阅读来源占比(渠道构成)"
          desc="【先行指标】各渠道占当日阅读% · 绿=公众号消息(粉丝) · 橙=推荐(看一看路人) · 看一眼就知当天靠粉丝还是靠算法"
          x={srcDates}
          series={srcSeries}
        />
      )}
      {/* 9. 粉丝阅读率:公众号消息(只推给粉丝)÷ 累计粉丝 = 纯净的粉丝打开率/喜欢信号 */}
      {srcDates.length > 0 && (
        <Chart
          title="粉丝阅读率(公众号消息 ÷ 累计粉丝)"
          desc="【粉丝喜欢】绿=公众号消息阅读(只推给粉丝) · 红[右轴]=÷累计粉丝的打开率,纯净粉丝信号,反映粉丝真实活跃/喜欢"
          x={srcDates}
          series={[
            { name: '粉丝阅读', type: 'bar', color: '#16a34a', data: fanRead },
            {
              name: '粉丝阅读率%',
              secondary: true,
              color: '#f43f5e',
              data: srcDates.map((dt, i) => {
                const f = fmap.get(dt);
                return f ? +((fanRead[i] / f) * 100).toFixed(1) : null;
              }),
            },
          ]}
        />
      )}

      {/* 过程 vs 结果:发力点分析 */}
      <div
        style={{
          marginTop: 20,
          background: '#fff',
          borderRadius: 12,
          padding: '16px 20px',
          boxShadow: '0 1px 4px rgba(0,0,0,.06)',
          fontSize: 13,
          lineHeight: 1.9,
        }}
      >
        <b style={{ fontSize: 15 }}>过程 vs 结果:发力点在哪</b>
        <div
          style={{
            margin: '10px 0',
            padding: '10px 14px',
            background: '#f8fafc',
            borderRadius: 8,
            fontSize: 13.5,
            color: '#0f172a',
          }}
        >
          创作动作(选题/载体/钩子/评论区)<span style={{ color: '#0ea5e9' }}> → </span>阅读量
          <span style={{ color: '#0ea5e9' }}> → </span>涨粉 + 变现
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
            　　真·过程(可控)　　　　　　　　　先行指标　　　　最终结果(滞后)
          </div>
        </div>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#334155' }}>
          <li>
            <b>① 真·过程</b>
            (图上没有,是你的动作,✅完全可控):选题、载体(贴图/文章)、标题钩子、封面、发布节奏、评论区留人。
          </li>
          <li>
            <b>② 先行指标</b>(过程最早的可量化反馈,🟡靠①撬动):<b>每日阅读量</b> + 其中推荐(看一看)占比——能不能进推荐池。
          </li>
          <li>
            <b>③ 转化效率</b>(过程诊断,🟡靠钩子/评论区调):<b>阅读/新增粉</b>(涨粉转化,越低越好)、<b>每次阅读收益</b>
            (变现转化,越高越好)。
          </li>
          <li>
            <b>④ 最终结果</b>(记分牌,❌只能等下游兑现):每日净增 → 粉丝累计、每日收益、每粉收益、累计阅读。
          </li>
        </ul>
        <div style={{ marginTop: 8, color: '#0f172a' }}>
          <b>怎么用:②×③ = ④。</b> 别盯着 ④ 焦虑(没有旋钮直接拧大粉丝/收益)。发力点只在 <b>②</b>
          (做能进推荐池的选题,抬阅读量这个总闸)和 <b>③</b>(提涨粉转化 + 变现转化)。 上次测算:1 万粉需 ~100
          万次累计阅读、150 元/天需 ~17.8 万次/天阅读——<b>都是阅读量的下游</b>。
        </div>
      </div>

      {/* 指标对比指南:曲线两两对照各自说明什么 */}
      <div
        style={{
          marginTop: 20,
          background: '#fff',
          borderRadius: 12,
          padding: '16px 20px',
          boxShadow: '0 1px 4px rgba(0,0,0,.06)',
          fontSize: 13,
          lineHeight: 1.9,
        }}
      >
        <b style={{ fontSize: 15 }}>曲线怎么对比着看</b>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: '#334155' }}>
          <li>
            <b>阅读量 ↔ 净增粉</b>:阅读冲高但净增没跟上 → 选题能曝光、留不住人(钩子/封面差);两者齐涨 = 破圈好稿。
          </li>
          <li>
            <b>阅读量 ↔ 每次阅读收益</b>:阅读暴涨而每次收益跌 = 看一看路人多、变现被稀释;阅读平稳但每次收益升 =
            精准/粉丝读者占比高。
          </li>
          <li>
            <b>每日收益 ↔ 每粉收益</b>:收益涨但每粉没涨 = 纯靠粉丝量堆;每粉收益涨 = 真变现效率提升(北极星之二)。
          </li>
          <li>
            <b>累计阅读 ↔ 累计粉丝(紫线)</b>:比值持续走高 = 单个粉丝撬动的阅读越来越多 = 算法推荐在帮你破圈。
          </li>
          <li>
            <b>阅读/新增粉(越低越好) ↔ 每次阅读收益(越高越好)</b>:同一天两者都漂亮 = 这天的内容「既涨粉又赚钱」=
            甜区选题,值得复制。
          </li>
        </ul>
      </div>

      {/* 5+6. 按载体分表(各自 read 降序、全列、可点进趋势)*/}
      {groups.map(([name, rows]) =>
        rows.length > 0 ? (
          <div key={name}>
            <h2 style={{ fontSize: 18, marginTop: 28 }}>
              {name}(共 {rows.length} 篇 · 点击看阅读趋势)
            </h2>
            <ArticleTable
              rows={rows}
              surgeIds={surgeIds}
              onPick={a => navigate(`/dashboard/a/${a.id}${accountQuery}`)}
            />
          </div>
        ) : null
      )}
      <p style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
        🔥 = 发布数天后阅读仍显著增长(疑似被「看一看/推荐」二次引爆)
      </p>
    </div>
  );
}
