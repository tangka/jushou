import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config/index.js';
import type { RevenueOverviewValues, RevenueSlotDaily } from './db/index.js';
import {
  backfillArticleRevenueLinks,
  getArticleRevenueRanking,
  getDailyMetrics,
  getRevenueDays,
  recordNewMilestones,
  refreshDailyMetrics,
  upsertArticleRevenue,
  upsertRevenueDay,
  upsertRevenueIncomeDay,
  upsertRevenueOverview,
  upsertRevenueSlotDaily,
} from './db/index.js';
import { notifyMilestone } from './notify.js';
import { buildRows, readDetailEntries } from './report.js';
import { isMain, runCli } from './utils/cli.js';
import { fetchAdRevenueReport, fetchAdSlotDailyIncome, fetchArticleRevenue } from './wechat/ad-stats.js';
import { loadAuthKey, loadMpSession } from './wechat/session.js';

// 抓「流量主 → 文章收入」每日总收益(全部广告位合计)→ SQLite revenue_snapshots + 收益数据.md。
// T-1 口径;昨日数据约次日中午产出(后台 get_delay_warning 会提示)。income 原始单位分,展示转元。

const DAY_MS = 86_400_000;

function fmtDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const yuan = (cents: number): string => (cents / 100).toFixed(2);

function share(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0.0%';
}

function fmtRatio(ratio: number): string {
  const normalized = Math.abs(ratio) <= 1 ? ratio * 100 : ratio;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(1)}%`;
}

function compositionBase(overview: RevenueOverviewValues): number {
  const byCategory = overview.programmatic_cents + overview.freetrade_cents + overview.cps_cents;
  return overview.total_cents > 0 ? overview.total_cents : byCategory;
}

function isZeroOverview(overview: RevenueOverviewValues): boolean {
  return (
    overview.total_cents === 0 &&
    overview.programmatic_cents === 0 &&
    overview.freetrade_cents === 0 &&
    overview.cps_cents === 0 &&
    overview.yesterday_cents === 0 &&
    overview.week_cents === 0 &&
    overview.month_cents === 0
  );
}

export function aggregateSlotIncomeDays(
  rows: readonly RevenueSlotDaily[],
  begin: string,
  end: string
): Array<{ date: string; income_cents: number }> {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (row.date < begin || row.date > end) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.income_cents);
  }
  return [...byDate.entries()]
    .map(([date, income_cents]) => ({ date, income_cents }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function compositionRows(overview: RevenueOverviewValues): string[] {
  const total = compositionBase(overview);
  return [
    `| 程序化广告(流量主分成) | ${yuan(overview.programmatic_cents)} | ${share(overview.programmatic_cents, total)} |`,
    `| 互选广告 | ${yuan(overview.freetrade_cents)} | ${share(overview.freetrade_cents, total)} |`,
    `| 返佣商品(CPS) | ${yuan(overview.cps_cents)} | ${share(overview.cps_cents, total)} |`,
  ];
}

function slotDisplayName(slotid: string): string {
  return config.adSlotNames[slotid] ?? slotid;
}

function slotCompositionRows(
  rows: readonly RevenueSlotDaily[],
  yesterday: string,
  last7Dates: ReadonlySet<string>
): string[] {
  const slotIds = [...new Set([...Object.keys(config.adSlotNames), ...rows.map(r => r.slotid)])].sort((a, b) =>
    slotDisplayName(a).localeCompare(slotDisplayName(b), 'zh')
  );
  return slotIds.map(slotid => {
    let yesterdayCents = 0;
    let weekCents = 0;
    for (const row of rows) {
      if (row.slotid !== slotid) continue;
      if (row.date === yesterday) yesterdayCents += row.income_cents;
      if (last7Dates.has(row.date)) weekCents += row.income_cents;
    }
    return `| ${slotDisplayName(slotid).replace(/\|/g, '\\|')} | ${yuan(yesterdayCents)} | ${yuan(weekCents)} |`;
  });
}

export async function run(): Promise<void> {
  const session = await loadMpSession(await loadAuthKey());

  const nowMs = Date.now();
  const captureDate = fmtDate(new Date(nowMs));
  const end = fmtDate(new Date(nowMs - DAY_MS)); // T-1
  const begin = fmtDate(new Date(nowMs - config.statsDays * DAY_MS));
  const slotBegin = fmtDate(new Date(nowMs - (config.revenueSlotDays - 1) * DAY_MS));
  const slotEnd = captureDate; // income 接口允许抓到今天;展示汇总仍按 T-1 看
  const last7Dates = new Set(Array.from({ length: 7 }, (_, i) => fmtDate(new Date(nowMs - (i + 1) * DAY_MS))));

  const report = await fetchAdRevenueReport(session, begin, end);
  const capturedAt = Math.floor(Date.now() / 1000);
  if (report.slotIds.length === 0 && isZeroOverview(report.revenueOverview)) {
    upsertRevenueOverview({ date: captureDate, ...report.revenueOverview, captured_at: capturedAt });
    const md = [
      '# 收益数据',
      '',
      `账号:${config.accountExact}`,
      '',
      '**当前公众号流量主收益:0.00 元**',
      '',
      `更新于 ${new Date().toLocaleString('zh-CN')}。`,
      '',
      '## 收入构成',
      '',
      '| 分类 | 累计收入(元) | 占比 |',
      '| --- | ---: | ---: |',
      ...compositionRows(report.revenueOverview),
      '',
      '## 说明',
      '',
      '- 后台 overview 接口可访问,返回累计/昨日/近 7 天/近 30 天均为 0。',
      '- 后台未返回广告位,因此不继续抓广告位明细/文章收益明细。',
      '',
    ].join('\n');
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(config.paths.revenueOverview, md);
    console.log(`收益概览:0.00 元(${captureDate}),该账号暂无广告位明细`);
    console.log(`DB ${config.dbPath}`);
    console.log(`INDEX ${config.paths.revenueOverview}`);
    return;
  }
  const slotIncome = await fetchAdSlotDailyIncome(session, slotBegin, slotEnd);
  const fallbackIncomeDays = aggregateSlotIncomeDays(slotIncome, begin, end);
  const usesIncomeFallback = report.days.length === 0 && fallbackIncomeDays.length > 0;

  upsertRevenueOverview({ date: captureDate, ...report.revenueOverview, captured_at: capturedAt });
  if (report.days.length === 0 && !usesIncomeFallback) {
    throw new Error('流量主收益无数据(区间内为空,多半限流或当日数据未产出)');
  }
  if (usesIncomeFallback) {
    for (const day of fallbackIncomeDays) upsertRevenueIncomeDay(day.date, day.income_cents, capturedAt);
    console.log(`[revenue] overview 未返回广告位列表，已从 income 接口回退 ${fallbackIncomeDays.length} 天`);
  } else {
    for (const day of report.days) upsertRevenueDay(day, capturedAt);
  }
  upsertRevenueSlotDaily(slotIncome, capturedAt);

  // 按文章的广告收益(写入时即按标题解析 article_id,关联选题→收益)
  const articles = await fetchArticleRevenue(session, begin, end);
  for (const a of articles) upsertArticleRevenue(a, capturedAt);
  // 兜底回填:历史行 + 本轮标题暂时对不上的,统一再解析一次,并统计仍未关联数
  const { unmatched } = backfillArticleRevenueLinks();

  const incomeDays = usesIncomeFallback ? fallbackIncomeDays : report.days;
  const recent = usesIncomeFallback ? getRevenueDays(30) : [...report.days].slice(-30).reverse();
  const totalCents = incomeDays.reduce((s, d) => s + d.income_cents, 0);

  // 收益榜文章名挂文章库本地链接:用 appmsgid+itemidx 稳定匹配(绕开 API/详情标题的标点、词序差异),
  // 只收有正文 .md 的篇;对不上或无正文则纯文本,不造断链。
  const keyToMd = new Map<string, string>();
  await Promise.all(
    buildRows(await readDetailEntries()).map(async r => {
      const ok = await fs
        .access(path.join(config.accountDir, r.markdown))
        .then(() => true)
        .catch(() => false);
      if (ok) keyToMd.set(`${r.appmsgid}_${r.itemidx}`, r.markdown);
    })
  );
  const articleCell = (a: { title: string; appmsgid: string | null; itemidx: number | null }): string => {
    const esc = a.title.replace(/\|/g, '\\|');
    const mdPath = a.appmsgid !== null ? keyToMd.get(`${a.appmsgid}_${a.itemidx}`) : undefined;
    return mdPath ? `[[${mdPath}\\|${esc}]]` : esc;
  };
  const ranking = getArticleRevenueRanking();

  // 人均收益:每天「当天收益 ÷ 累计粉丝」存库(daily_metrics)+ 写 md
  refreshDailyMetrics(capturedAt);
  const metrics = getDailyMetrics(30);
  const avgPer = metrics.length ? metrics.reduce((s, m) => s + m.per_follower_cents, 0) / metrics.length : 0;

  // 运营目标进度:当前粉丝取最新一天累计、当前每粉收益取近 N 天均值,逐「数字」对照 config.goals。
  const curFollowers = metrics[0]?.cumulate_user ?? 0;
  const pct = (cur: number, target: number): string => (target > 0 ? `${Math.round((cur / target) * 100)}%` : '—');
  const hitKeys: string[] = []; // 已达标的目标数字(key 含目标值,上调后视为新目标重新提醒)
  const goalRows = config.goals.map(g => {
    const fHit = curFollowers >= g.followers;
    const pHit = avgPer >= g.perFollowerCents;
    if (fHit) hitKeys.push(`${g.stage}·粉丝·${g.followers}`);
    if (pHit) hitKeys.push(`${g.stage}·每粉收益·${g.perFollowerCents}分`);
    const fCell = fHit ? `${g.followers} ✅` : `${g.followers}(${pct(curFollowers, g.followers)})`;
    const pCell = pHit ? `${g.perFollowerCents} ✅` : `${g.perFollowerCents}(${pct(avgPer, g.perFollowerCents)})`;
    const dailyYuan = ((g.followers * g.perFollowerCents) / 100).toFixed(1);
    return `| ${g.stage} | ${fCell} | ${pCell} | ${dailyYuan} 元/天 | ${fHit && pHit ? '✅' : '🚧'} |`;
  });
  // 达标即提醒刷新目标:只对「本轮新达成」的数字推一次(库去重),目标上调后会重新提醒。
  const freshHits = recordNewMilestones(hitKeys, capturedAt);
  if (freshHits.length > 0) {
    await notifyMilestone(
      `🎉 公众号运营目标达成:${freshHits.join('、')}\n` +
        `当前 ${curFollowers} 粉 / 近 ${metrics.length} 天均 ${avgPer.toFixed(2)} 分/天。\n` +
        '→ 该刷新运营目标了(上调已达标项或晋级):改当前账号 WECHAT_GOALS + 运营目标.md。'
    );
  }
  const goalHint = hitKeys.length
    ? `> ⚠️ **已达标:${hitKeys.join('、')}** — 该刷新运营目标(上调已达标项或晋级下一档:改当前账号 \`WECHAT_GOALS\` + 运营目标.md)。`
    : '> 两轴均未达标,继续:涨粉靠贴图爆款(进推荐池)、提每粉收益靠评论区 4:3 图。';

  const md = [
    '# 收益数据',
    '',
    `账号:${config.accountExact}`,
    '',
    `**区间合计(${begin} ~ ${end}):${yuan(totalCents)} 元**`,
    '',
    `更新于 ${new Date().toLocaleString('zh-CN')}。`,
    '',
    '## 收入构成',
    '',
    `**累计总收入:${yuan(report.revenueOverview.total_cents)} 元** · 昨日 ${yuan(report.revenueOverview.yesterday_cents)} 元 · 近 7 天 ${yuan(report.revenueOverview.week_cents)} 元 · 近 30 天 ${yuan(report.revenueOverview.month_cents)} 元`,
    '',
    `日环比:${fmtRatio(report.revenueOverview.day_ratio)} · 周环比:${fmtRatio(report.revenueOverview.week_ratio)}`,
    '',
    '| 分类 | 累计收入(元) | 占比 |',
    '| --- | ---: | ---: |',
    ...compositionRows(report.revenueOverview),
    '',
    '### 按广告位(昨日/近7天)',
    '',
    '| 广告位 | 昨日收入(元) | 近7天收入(元) |',
    '| --- | ---: | ---: |',
    ...slotCompositionRows(slotIncome, end, last7Dates),
    '',
    '## 近期每日(最近 30 天,全部广告位合计)',
    '',
    ...(usesIncomeFallback
      ? [
          '> 微信 overview 未返回广告位列表，本次收益由 income 接口回退；已有曝光/点击数据保留，新日期无该维度时显示 0。',
          '',
        ]
      : []),
    '| 日期 | 收入(元) | 曝光 | 点击 | 广告请求 |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...recent.map(r => `| ${r.date} | ${yuan(r.income_cents)} | ${r.exposure} | ${r.click} | ${r.req_succ} |`),
    '',
    '## 运营目标进度(北极星:粉丝量 × 每粉收益)',
    '',
    `当前:**${curFollowers} 粉** / 近 ${metrics.length} 天均 **${avgPer.toFixed(2)} 分/天**(两轴均达标才算 ✅)`,
    '',
    '| 阶段 | 粉丝(达标) | 每粉收益分/天(达标) | 日收入目标 | 状态 |',
    '| --- | ---: | ---: | ---: | :---: |',
    ...goalRows,
    '',
    goalHint,
    '',
    '## 人均收益(当天收益 ÷ 当天累计粉丝)',
    '',
    `**平均每粉收益:${avgPer.toFixed(2)} 分/天**(近 ${metrics.length} 天各日「每粉收益」的均值)`,
    '',
    '| 日期 | 累计粉丝 | 当天收益(元) | 每粉收益(分) |',
    '| --- | ---: | ---: | ---: |',
    ...metrics.map(
      m => `| ${m.date} | ${m.cumulate_user} | ${yuan(m.income_cents)} | ${m.per_follower_cents.toFixed(2)} |`
    ),
    '',
    `## 文章收益榜(${begin} ~ ${end} 累计,按收益降序)`,
    '',
    '| 文章 | 发布 | 收益(元) |',
    '| --- | --- | ---: |',
    ...ranking.map(a => `| ${articleCell(a)} | ${a.send_date} | ${yuan(a.income_cents)} |`),
    '',
    '## 字段说明',
    '',
    '- 数据源「流量主 → 数据统计 → 文章收入」。`income` 原始单位分,已转元。',
    '- 每日总收益:全部广告位合计;文章收益榜:区间内每篇文章的广告收益累计。',
    '- T-1 口径;昨日数据约次日中午产出,当天/昨天可能偏低或为空。',
    `- 选题关联:收益按标题接 \`articles\`(经营分析按选题切收益);本轮仍未关联 **${unmatched}** 篇(多半标题对不上,见经营分析附录)。`,
    '',
  ].join('\n');

  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.paths.revenueOverview, md);

  const latest = recent[0];
  console.log(`收益区间合计:${yuan(totalCents)} 元(${begin} ~ ${end}),写入 ${incomeDays.length} 天`);
  console.log(`广告位收益:${slotIncome.length} 行(${slotBegin} ~ ${slotEnd})`);
  if (latest) console.log(`最新一天 ${latest.date}:${yuan(latest.income_cents)} 元`);
  console.log(`文章收益:${articles.length} 篇,未关联选题 ${unmatched} 篇`);
  console.log(`DB ${config.dbPath}`);
  console.log(`INDEX ${config.paths.revenueOverview}`);
}

if (isMain(import.meta.url)) runCli(run);
