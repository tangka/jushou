import fs from 'node:fs/promises';
import { config } from './config/index.js';
import {
  countUnlinkedRevenue,
  getDailyMetrics,
  getFollowerDays,
  getRevenueDays,
  getTopicEconomics,
  type TopicEcoRow,
} from './db/index.js';
import { isMain, runCli } from './utils/cli.js';
import { mdEscape } from './utils/text.js';

// 经营分析(替代旧 analyze 的「阅读复盘」):围绕三阶段目标(运营目标.md),把
// 选题 × (阅读 / 涨粉 / 收益) 打通 → 经营分析.md。收益按 article_id 关联(见 db.resolveArticleId)。

// 三阶段目标(粉丝量 × 每粉收益分/天),读 config.goals(与 CLAUDE.md / 运营目标.md / 收益数据.md 同源);
// 到达上一阶段则瞄准下一阶段。改目标只动 config,这里自动跟随。
export interface Stage {
  name: string;
  fans: number;
  perFollowerCents: number;
}
export const STAGES: Stage[] = config.goals.map(g => ({
  name: g.stage,
  fans: g.followers,
  perFollowerCents: g.perFollowerCents,
}));

/** 选当前应瞄准的阶段:第一个「粉丝或每粉收益未达标」的阶段;全达成返回最后一阶段。 */
export function pickNextStage(fans: number, perFollowerCents: number): Stage {
  for (const s of STAGES) if (fans < s.fans || perFollowerCents < s.perFollowerCents) return s;
  return STAGES[STAGES.length - 1] ?? { name: '远期', fans: 10_000, perFollowerCents: 1.5 };
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

const yuan = (cents: number): string => (cents / 100).toFixed(2);
const round1 = (n: number): string => n.toFixed(1);

// ── 选题效果矩阵:按某键分组,聚合阅读/涨粉/收益 ──────────────────────────────

export interface GroupEco {
  key: string;
  count: number;
  avgRead: number;
  sumFollow: number;
  /** 有收益数据的篇数(income_cents 非 null) */
  revenuePieces: number;
  /** 这些篇的收益合计(分) */
  sumIncomeCents: number;
  /** 这些篇的阅读合计(算 eCPM 用) */
  sumReadWithIncome: number;
}

/** 按 keyOf 分组聚合;按收益合计降序,次按平均阅读降序。 */
export function groupEconomics(rows: TopicEcoRow[], keyOf: (r: TopicEcoRow) => string): GroupEco[] {
  const buckets = new Map<string, TopicEcoRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const arr = buckets.get(k);
    if (arr) arr.push(r);
    else buckets.set(k, [r]);
  }
  return [...buckets.entries()]
    .map(([key, items]) => {
      const withIncome = items.filter(i => i.income_cents !== null);
      return {
        key,
        count: items.length,
        avgRead: Math.round(avg(items.map(i => i.read_uv))),
        sumFollow: items.reduce((a, i) => a + i.follow_uv, 0),
        revenuePieces: withIncome.length,
        sumIncomeCents: withIncome.reduce((a, i) => a + (i.income_cents ?? 0), 0),
        sumReadWithIncome: withIncome.reduce((a, i) => a + i.read_uv, 0),
      };
    })
    .sort((a, b) => b.sumIncomeCents - a.sumIncomeCents || b.avgRead - a.avgRead);
}

/** 单篇均收益(元):有收益数据的篇上平均;无收益数据返回 null。 */
export function avgIncomeYuan(g: GroupEco): number | null {
  return g.revenuePieces === 0 ? null : g.sumIncomeCents / g.revenuePieces / 100;
}

/** eCPM(元/千阅读):收益合计 / 阅读合计 × 1000;无收益或无阅读返回 null。 */
export function ecpmYuan(g: GroupEco): number | null {
  if (g.revenuePieces === 0 || g.sumReadWithIncome === 0) return null;
  return ((g.sumIncomeCents / g.sumReadWithIncome) * 1000) / 100;
}

/** 涨粉人效:每篇读后关注。 */
export function followPerPiece(g: GroupEco): number {
  return g.count === 0 ? 0 : g.sumFollow / g.count;
}

// eCPM 在小样本(低阅读)上极不稳定(几十次阅读 + 几分钱就能算出虚高值),
// 下诊断结论时要求该组带收益的阅读量 ≥ 此阈值,否则不参与「人效最高」评比。
const MIN_ECPM_READS = 100;
/** 选 eCPM 最高且样本量够的组(过滤低阅读噪声);都不够则 null。 */
export function ecpmLeaderOf(groups: GroupEco[]): GroupEco | null {
  return (
    groups
      .filter(g => g.sumReadWithIncome >= MIN_ECPM_READS && ecpmYuan(g) !== null)
      .sort((a, b) => (ecpmYuan(b) ?? 0) - (ecpmYuan(a) ?? 0))[0] ?? null
  );
}

const DASH = '—';
function ecoTable(label: string, groups: GroupEco[]): string[] {
  return [
    `| ${label} | 篇数 | 均阅读 | 读后关注 | 收益合计(元) | 单篇均收益(元) | eCPM(元/千阅读) |`,
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...groups.map(g => {
      const inc = g.revenuePieces === 0 ? DASH : yuan(g.sumIncomeCents);
      const aiv = avgIncomeYuan(g);
      const ecpm = ecpmYuan(g);
      return `| ${mdEscape(g.key)} | ${g.count} | ${g.avgRead} | ${g.sumFollow} | ${inc} | ${aiv === null ? DASH : aiv.toFixed(2)} | ${ecpm === null ? DASH : ecpm.toFixed(2)} |`;
    }),
  ];
}

export async function run(): Promise<void> {
  const rows = getTopicEconomics();
  if (rows.length === 0) {
    console.log('库里还没有文章,先跑 export/enrich/sync。');
    return;
  }

  const hasRevenue = rows.some(r => r.income_cents !== null);

  // ── 1. 目标进度仪表盘 ──
  const followerDays = getFollowerDays(8);
  const latestFollower = followerDays[0];
  const fans = latestFollower?.cumulate_user ?? 0;
  const netPerDay = avg(followerDays.map(d => d.netgain_user));

  const revenueDays = getRevenueDays(8);
  const latestRevenue = revenueDays[0];
  // 每粉收益:近 N 天各日「当天收益÷累计粉丝」的均值(与收益数据.md 同源 daily_metrics)
  const metrics = getDailyMetrics(30);
  const perFollowerAvg = metrics.length ? avg(metrics.map(m => m.per_follower_cents)) : 0;

  const stage = pickNextStage(fans, perFollowerAvg);
  const fansGap = Math.max(0, stage.fans - fans);
  const perGap = Math.max(0, stage.perFollowerCents - perFollowerAvg);
  const fansEtaDays = netPerDay > 0 && fansGap > 0 ? Math.ceil(fansGap / netPerDay) : null;
  const dailyYuanTarget = ((stage.fans * stage.perFollowerCents) / 100).toFixed(1);

  const dashboard = [
    '## 一、目标进度仪表盘',
    '',
    `当前瞄准:**${stage.name}阶段(${stage.fans} 粉 / ${stage.perFollowerCents} 分每粉每日 ≈ ${dailyYuanTarget} 元/天)**`,
    '',
    '| 指标 | 现状 | 目标 | 差距 | 近况 |',
    '| --- | ---: | ---: | ---: | --- |',
    `| 关注(总粉丝) | ${fans} | ${stage.fans} | ${fansGap} | 近 ${followerDays.length} 日均净增 ${round1(netPerDay)}/日${fansEtaDays ? `,约 ${fansEtaDays} 天达标` : ''} |`,
    `| 每粉收益(分/天) | ${hasRevenue ? perFollowerAvg.toFixed(2) : DASH} | ${stage.perFollowerCents} | ${hasRevenue ? perGap.toFixed(2) : DASH} | ${hasRevenue ? `近 ${metrics.length} 日均;最新 ${latestRevenue?.date ?? ''} ${latestRevenue ? yuan(latestRevenue.income_cents) : ''} 元/天` : '收益未拉取,跑 `pnpm revenue`'} |`,
    '',
    '> 经验值:日收入 ≈ 粉丝量 × 每粉收益。粉丝靠贴图爆款走量,每粉收益靠评论区图 + 穿插文章(见下「双轮诊断」)。',
    '',
  ];

  // ── 2. 选题效果矩阵 ──
  const byMedia = groupEconomics(rows, r => r.media_type ?? '(未知)');
  const byType = groupEconomics(rows, r => r.content_type ?? '(未打标)');
  const bySubject = groupEconomics(rows, r => r.subject ?? '(未打标)');

  const unlinked = countUnlinkedRevenue();
  const matrix = [
    '## 二、选题效果矩阵(选题 × 阅读/涨粉/收益)',
    '',
    hasRevenue
      ? '按收益合计降序;收益已按标题关联到选题。eCPM 在低阅读组上会虚高(几十次阅读不可信),下方诊断只采阅读量够的组。'
      : '⚠️ 收益尚未拉取(`article_revenue` 为空),收益/eCPM 列显示 — ;跑 `pnpm revenue` 后即填充。',
    '',
    '### 按载体(media_type)',
    ...ecoTable('载体', byMedia),
    '',
    '### 按体裁(content_type)',
    ...ecoTable('体裁', byType),
    '',
    '### 按对象(subject)',
    ...ecoTable('对象', bySubject),
    '',
  ];

  // ── 3. 双轮诊断 ──
  const followLeader = [...byMedia].sort((a, b) => followPerPiece(b) - followPerPiece(a))[0];
  const incomeLeader = byMedia.find(g => g.revenuePieces > 0) ?? null;
  const ecpmLeader = ecpmLeaderOf(byMedia);
  const tietu = byMedia.find(g => g.key === '贴图');
  const wenzhang = byMedia.find(g => g.key === '文章');

  const diag: string[] = ['## 三、双轮诊断', ''];
  if (followLeader) {
    diag.push(
      `- **涨粉靠谁**:载体「${followLeader.key}」每篇读后关注最高(${round1(followPerPiece(followLeader))}/篇)。`
    );
  }
  if (hasRevenue && incomeLeader) {
    diag.push(
      `- **收益绝对额靠谁**:载体「${incomeLeader.key}」收益合计最高(${yuan(incomeLeader.sumIncomeCents)} 元)。`
    );
  }
  if (hasRevenue && ecpmLeader) {
    diag.push(
      `- **人效/eCPM 最高**:载体「${ecpmLeader.key}」(${ecpmYuan(ecpmLeader)?.toFixed(2)} 元/千阅读;已剔除阅读 < ${MIN_ECPM_READS} 的小样本噪声)。`
    );
  }
  // 验证 运营目标.md 假设:文章 eCPM 应高于贴图(广告位多)
  if (hasRevenue && tietu && wenzhang && ecpmYuan(tietu) !== null && ecpmYuan(wenzhang) !== null) {
    const et = ecpmYuan(tietu) ?? 0;
    const ew = ecpmYuan(wenzhang) ?? 0;
    diag.push(
      ew > et
        ? `- **文章 vs 贴图人效**:✅ 验证假设——文章 eCPM(${ew.toFixed(2)})> 贴图(${et.toFixed(2)}),文章人效更高,值得深聊的选题穿插文章。`
        : `- **文章 vs 贴图人效**:⚠️ 与假设相反——贴图 eCPM(${et.toFixed(2)})≥ 文章(${ew.toFixed(2)}),当前贴图人效也不输,重心继续压贴图。`
    );
  } else if (!hasRevenue) {
    diag.push('- **收益维度**:待 `pnpm revenue` 拉到数据后,这里给出「收益靠谁 / 文章 vs 贴图人效」诊断。');
  }
  diag.push('');

  // ── 4. 行动建议 ──
  const actions: string[] = ['## 四、行动建议', ''];
  if (tietu && followPerPiece(tietu) >= followPerPiece(followLeader ?? tietu) * 0.99) {
    actions.push('- 贴图涨粉最强 → 继续主推贴图爆款(中文钩子标题、Codex 额度/重置类),把粉丝推过当前阶段线。');
  }
  if (hasRevenue && ecpmLeader && ecpmLeader.key === '文章') {
    actions.push('- 文章 eCPM 占优 → 值得深聊的选题做成文章,提人均收益(评论区图 + 文中广告位)。');
  }
  if (perGap > 0 && hasRevenue) {
    actions.push(
      `- 每粉收益差 ${perGap.toFixed(2)} 分 → 光涨粉不够,同步抠人均收益:爆款篇加正文配图和留言区短评(短评不进正文)。`
    );
  }
  if (!hasRevenue) {
    actions.push('- 先把收益拉通:扫码登录后 `pnpm revenue`,让选题×收益矩阵真正有数。');
  }
  if (unlinked > 0) {
    actions.push(`- 有 ${unlinked} 篇收益未能关联到选题(标题对不上),见附录,需要时手工核对标题。`);
  }
  actions.push('');

  // ── 附录:未关联收益(若有)──
  const appendix =
    unlinked > 0
      ? [
          '## 附录:未关联到选题的收益',
          '',
          `- 共 ${unlinked} 篇:标题与 \`articles\` 对不上(改标题重发 / 采集未覆盖)。`,
          '',
        ]
      : [];

  const now = new Date().toLocaleString('sv-SE').slice(0, 16); // 本地时区(toISOString 会偏 UTC)
  const md = [
    '# 经营分析',
    '',
    `生成时间:${now} · 文章 ${rows.length} 篇 · 数据来自一期采集 + 流量主收益`,
    '> 对齐 [[运营目标]];选题 × 阅读/涨粉/收益。每天 `pnpm sync` 自动刷新。',
    '',
    ...dashboard,
    ...matrix,
    ...diag,
    ...actions,
    ...appendix,
  ].join('\n');

  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.paths.businessReport, md);
  console.log(`BUSINESS ${config.paths.businessReport}`);
}

if (isMain(import.meta.url)) runCli(run);
