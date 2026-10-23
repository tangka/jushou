import fs from 'node:fs/promises';
import { config } from './config/index.js';
import { upsertReadTendency } from './db/index.js';
import { isMain, runCli } from './utils/cli.js';
import { fetchReadTendency, SCENE_ALL, SCENE_RECOMMEND } from './wechat/read-tendency.js';
import { loadAuthKey, loadMpSession } from './wechat/session.js';

// 抓后台「图文分析 → 阅读趋势」(逐日 × 渠道阅读人数)→ SQLite read_tendency + 阅读数据.md。
// 后台权威口径(与导出 xls 一致),T-1。按 (date, scene) 幂等,可每天跑累积时间序列。

const DAY_MS = 86_400_000;

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
}

export async function run(): Promise<void> {
  const authKey = await loadAuthKey();
  const session = await loadMpSession(authKey);

  const end = fmtDate(new Date()); // 含当天(T-1 当天行为 0,getDailyReadTendency 会削尾)
  const begin = fmtDate(new Date(Date.now() - config.statsDays * DAY_MS));

  const rows = await fetchReadTendency(session, begin, end);
  if (rows.length === 0) throw new Error('阅读趋势无数据(日期范围内为空)');

  const capturedAt = Math.floor(Date.now() / 1000);
  upsertReadTendency(rows, capturedAt);

  // 透视成逐日「全部 + 推荐」给人看;事实源在 SQLite。
  const byDate = new Map<string, { all: number; rec: number }>();
  for (const r of rows) {
    const e = byDate.get(r.date) ?? { all: 0, rec: 0 };
    if (r.scene === SCENE_ALL) e.all = r.read_uv;
    if (r.scene === SCENE_RECOMMEND) e.rec = r.read_uv;
    byDate.set(r.date, e);
  }
  const daily = [...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  while (daily.length && daily[daily.length - 1]?.all === 0) daily.pop(); // 削掉未结算尾日
  const recent = daily.slice(-14).reverse();

  await fs.mkdir(config.dataDir, { recursive: true });
  const md = [
    '# 阅读数据',
    '',
    `数据源「数据分析 → 内容分析 → 阅读趋势」,逐日阅读**人数**(去重),T-1 口径。`,
    `更新于 ${new Date().toLocaleString('zh-CN')},区间 ${begin} ~ ${end}。`,
    '',
    '## 近期每日(最近 14 天)',
    '',
    '| 日期 | 阅读人数(全部) | 其中推荐(看一看) | 推荐占比 |',
    '| --- | ---: | ---: | ---: |',
    ...recent.map(
      r => `| ${r.date} | ${r.all} | ${r.rec} | ${r.all ? `${((r.rec / r.all) * 100).toFixed(0)}%` : '—'} |`
    ),
    '',
    '## 说明',
    '',
    '- `阅读人数`:当日阅读该账号内容的去重人数(后台权威口径,scene=9999 全部)。',
    '- `推荐`:其中来自微信「看一看/推荐」(scene=6)的阅读人数——破圈主力,占比高说明被算法推荐池青睐。',
    '',
  ].join('\n');
  await fs.writeFile(config.paths.readTendency, md);

  const last = daily[daily.length - 1];
  console.log(`阅读趋势写入 ${daily.length} 天;最新 ${last?.date} 全部=${last?.all} 推荐=${last?.rec}`);
  console.log(`DB ${config.dbPath}`);
  console.log(`INDEX ${config.paths.readTendency}`);
}

if (isMain(import.meta.url)) runCli(run);
