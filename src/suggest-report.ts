import type { GrowthAnalysis, GrowthGroup, LabelCoverage, MetricSummary } from './suggest-growth.js';
import { growthGroups } from './suggest-growth.js';
import { mdEscape } from './utils/text.js';

const unknown = '未知';
const number = (value: number | null): string => (value === null ? unknown : String(value));
const decimal = (value: number | null): string => (value === null ? unknown : value.toFixed(2));
const percent = (value: number | null): string => (value === null ? unknown : `${(value * 100).toFixed(2)}%`);

function coverage(value: LabelCoverage): string {
  return `${value.complete}/${value.total}（${percent(value.rate)}）`;
}

function total(metric: MetricSummary): string {
  if (metric.sum !== null) return number(metric.sum);
  return metric.observedSum === null
    ? unknown
    : `未知；已知部分${metric.observedSum}（${metric.known}/${metric.total}篇）`;
}

function metricRate(metric: MetricSummary): string {
  return metric.rate === null ? unknown : `${percent(metric.rate)}（${metric.paired}/${metric.total}篇成对数据）`;
}

function groupRows(groups: GrowthGroup[], rankingAllowed: boolean): string[] {
  return groups.map(g => {
    const reason = g.blockers.length
      ? `样本/字段不足：${g.blockers.join('、')}`
      : rankingAllowed
        ? '仅可提出对照假设'
        : '仅观察，不排名';
    return `| ${mdEscape(g.media)} | ${mdEscape(g.label)} | ${g.count}/${g.publishDates} | ${number(g.metrics.read.median)} | ${total(g.metrics.read)} | ${total(g.metrics.follow)} | ${metricRate(g.metrics.follow)} | ${metricRate(g.metrics.share)} | ${metricRate(g.metrics.collection)} | ${reason} |`;
  });
}

export function renderGrowthReport(analysis: GrowthAnalysis, generatedAt: string): string {
  const { policy, cohorts, globalLabels, recentLabels } = analysis;
  const rankingAllowed = analysis.rankingBlocks.length === 0;
  const recentExamples = [...cohorts[0].rows]
    .sort((a, b) => (b.publishDay ?? '').localeCompare(a.publishDay ?? '') || b.id - a.id)
    .slice(0, policy.exampleLimit);
  const weekRows = new Map(cohorts[1].rows.map(row => [row.id, row]));
  return [
    '# 选题建议',
    '',
    `生成时间：${generatedAt}（北京时间） · 账号：${mdEscape(analysis.account)} · 分析截至：${analysis.asOfDay}`,
    `最新统计快照日：${analysis.latestSnapshotDay ?? unknown} · 最新已收录发布日：${analysis.latestPublishDay ?? unknown}`,
    '> 本报告只读取本地内容增长数据，不同步、不调用分类模型、不读取收益。历史相关性不能覆盖用户指令、账号定位、来源核验或载体规则。',
    '',
    '## 先看证据是否够用',
    '',
    analysis.newsOnly
      ? `- ${mdEscape(analysis.account)}默认只写news文章；本报告主体仅统计文章，排除${analysis.excludedMediaCount}篇其他/未知载体，不把历史贴图表现变成默认载体建议。`
      : '- 载体分层观察，不把不同载体的阅读量直接当成同一条件的实验。',
    `- 全体标签完整率：${coverage(globalLabels)}；近${policy.recentDays}天（${analysis.recentFromDay}–${analysis.asOfDay}）完整率：${coverage(recentLabels)}。完整指体裁、对象均已标注；不含标签准确率保证。`,
    `- 未知发布日期：${analysis.unknownPublishCount}篇，不进入同龄队列。没有快照/字段时保留“未知”；真实0与缺失不同。`,
    `- 经验门槛：标签覆盖≥${percent(policy.minLabelCoverage)}、D+3快照覆盖≥${percent(policy.minSnapshotCoverage)}、字段覆盖≥${percent(policy.minMetricCoverage)}；每组至少${policy.minGroupArticles}篇、${policy.minGroupDates}个发布日、${policy.minGroupReads}已知阅读。门槛不是统计显著性。`,
    rankingAllowed
      ? '- 证据门槛通过：同载体合格分组可按D+3阅读中位数对照；同时看关注绝对数、关注率、分享和收藏，不宣布最佳组合或因果。'
      : `- **仅观察，不作优先级排名**：${analysis.rankingBlocks.join('；')}。先补充证据，不从残缺旧样本推断今天应写什么。`,
    '',
    '## 新稿等待同龄观察',
    '',
    '以下内容尚未到D+3观察日，仅列发布时间与预计观察日期（北京时间日历日，不是精确72小时）。未知绩效不补零，不与成熟稿比较。',
    '',
    ...(analysis.immatureArticles.length
      ? [
          '| 发布日 | 标题 | 到D+3观察日 |',
          '| --- | --- | --- |',
          ...analysis.immatureArticles.map(
            row => `| ${row.publishDay} | ${mdEscape(row.title ?? unknown)} | ${row.observationDay} |`
          ),
        ]
      : ['暂无尚未到D+3观察日的已收录内容。']),
    '',
    '## 同龄成熟内容',
    '',
    `取近${policy.lookbackDays}天发表、已到观察日的内容。D+3/D+7只取北京时间发布日加3/7个日历日的真实快照；不是精确72/168小时，不用较新累计量或邻近日期代替。`,
    '总量不完整时只列已知部分；中位数仅由已知阅读计算。率的分子、阅读分母来自同一批成对字段，括号显示覆盖篇数。阅读是各文章UV加总，不是账号去重读者数。',
    '',
    '| 观察窗 / 发布范围 | 篇数 / 有快照 | 阅读总量 | 阅读中位数（已知篇数） | 读后关注数 | 读后关注率 | 分享UV | 分享率 | 收藏UV | 收藏率 |',
    '| --- | ---: | ---: | ---: | ---: | --- | ---: | --- | ---: | --- |',
    ...cohorts.map(
      c =>
        `| D+${c.days}：${c.fromDay}–${c.throughDay} | ${c.rows.length}/${c.snapshotCount} | ${total(c.metrics.read)} | ${number(c.metrics.read.median)}（${c.metrics.read.known}） | ${total(c.metrics.follow)} | ${metricRate(c.metrics.follow)} | ${total(c.metrics.share)} | ${metricRate(c.metrics.share)} | ${total(c.metrics.collection)} | ${metricRate(c.metrics.collection)} |`
    ),
    '',
    'D+3与D+7可能包含不同篇数，不可把两行总量之差当作同一批文章的增长；同篇延后效果看下方样本。',
    '',
    '### 阅读集中度（只描述已知部分）',
    '',
    '均值与最高篇占比的分母仅包含该观察窗有阅读数据的文章，缺快照/字段时不代表整组。最高篇占比用于识别少数高阅读样本对均值的影响，不是题材优先级；并列最高时只列一篇。已知合计为0时占比未知。',
    '',
    '| 观察窗 | 已知阅读篇数/队列篇数 | 已知阅读均值 | 已知最高篇 | 该篇阅读 | 占已知阅读合计 |',
    '| --- | ---: | ---: | --- | ---: | ---: |',
    ...cohorts.map(c => {
      const { knownMean, highestArticle, highestShare } = c.readConcentration;
      return `| D+${c.days} | ${c.metrics.read.known}/${c.rows.length} | ${decimal(knownMean)} | ${mdEscape(highestArticle?.title ?? unknown)} | ${number(highestArticle?.read ?? null)} | ${percent(highestShare)} |`;
    }),
    '',
    '## 分组观察（D+3，载体内比较）',
    '',
    rankingAllowed
      ? '合格组在各载体内按阅读中位数排列；不足组单列并按名称排列。只提供独立维度观察，不拼接载体、体裁、对象、时段的边际冠军。'
      : '因证据门槛未通过，以下按载体与名称排列，不是效果排名。',
    ...(['contentType', 'subject'] as const).flatMap(axis => [
      '',
      `### 按${axis === 'contentType' ? '体裁' : '对象'}`,
      '',
      '| 载体 | 分组 | 篇数/发布日 | 阅读中位数 | 阅读总量 | 关注绝对数 | 关注率 | 分享率 | 收藏率 | 证据状态 |',
      '| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',
      ...groupRows(growthGroups(analysis, axis), rankingAllowed),
    ]),
    '',
    '## 近期成熟样本（按发布日期，不是优劣榜）',
    '',
    '| 发布日 | 标题 | 载体 | D+3阅读 | D+3关注 | D+7阅读 | D+7关注 |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...recentExamples.map(row => {
      const d7 = weekRows.get(row.id)?.snapshot;
      return `| ${row.publishDay ?? unknown} | ${mdEscape(row.title ?? unknown)} | ${mdEscape(row.mediaType ?? unknown)} | ${number(row.snapshot?.read ?? null)} | ${number(row.snapshot?.follow ?? null)} | ${number(d7?.read ?? null)} | ${number(d7?.follow ?? null)} |`;
    }),
    '',
    '## 给选题与写稿的使用边界',
    '',
    '- 阅读量、读后关注绝对数与关注率共同观察；高关注率的小曝光题不能自动取代能带来更多阅读与新增关注的内容。',
    '- 分享、收藏、关注各自展示；不把互动之和解释为去重人数或“粉丝最爱看”。高曝光不自动等于运气，低互动不证明读者来自推荐。',
    '- 不输出“最佳发布时间”。时段、题材、推送位置、发文数量和分发会互相影响；同龄、同载体、相近条件才能作对照。',
    '- 区分总阅读变化与发文数量变化；单篇优劣看成熟同龄窗口，不把今天新稿与旧爆款直接比较。',
    '- 标题与首屏先说明谁遇到什么问题、能获得什么结果；实操必须有真实过程、结果与失败边界，不因标题带产品名就推断效果。',
    '- 新素材只是线索：选题前读完整来源、核时间与确认状态，检查已发布/现有草稿；不宣布未经核验新闻，不把未命中主题当成优先补空。',
    '',
  ].join('\n');
}
