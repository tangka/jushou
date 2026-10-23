import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config/index.js';
import {
  getArticlesPublishedSince,
  getFollowerDays,
  getUnfollowedRoster,
  type RosterMember,
  setRosterAvatar,
  syncFollowerRoster,
  upsertFollowerDay,
} from './db/index.js';
import { isMain, runCli } from './utils/cli.js';
import { downloadToFile, mapWithConcurrency } from './utils/download.js';
import { fetchFollowerRoster } from './wechat/followers-roster.js';
import { loadAuthKey, loadMpSession } from './wechat/session.js';
import { fetchUserAnalysis } from './wechat/user-stats.js';

// 抓账号「用户分析」(总粉丝 + 每日新增/取消/净增)→ SQLite follower_snapshots + 关注数据.md。
// 后台 T-1 口径(最新到昨天)。按日期幂等,可每天跑累积时间序列。

const DAY_MS = 86_400_000;

function fmtDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function run(): Promise<void> {
  const authKey = await loadAuthKey();
  const session = await loadMpSession(authKey);

  const end = fmtDate(new Date(Date.now() - DAY_MS)); // T-1
  const begin = fmtDate(new Date(Date.now() - config.statsDays * DAY_MS));

  const { account, days } = await fetchUserAnalysis(session, begin, end);
  if (days.length === 0) throw new Error('用户分析无数据(日期范围内为空)');

  const capturedAt = Math.floor(Date.now() / 1000);
  for (const day of days) upsertFollowerDay(day, capturedAt);

  const latest = days[days.length - 1];
  if (!latest) throw new Error('用户分析无数据');

  // 数据已入 SQLite(follower_snapshots,事实源);这里只另写人读的关注数据.md
  await fs.mkdir(config.dataDir, { recursive: true });
  const recent = [...days].slice(-14).reverse();
  const md = [
    '# 关注数据',
    '',
    `账号:${account}`,
    '',
    `**累计关注(总粉丝):${latest.cumulate_user}**(截至 ${latest.date})`,
    '',
    `更新于 ${new Date().toLocaleString('zh-CN')},区间 ${begin} ~ ${end}。`,
    '',
    '## 近期每日(最近 14 天)',
    '',
    '| 日期 | 新增关注 | 取消关注 | 净增关注 | 累计关注 |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...recent.map(r => `| ${r.date} | ${r.new_user} | ${r.cancel_user} | ${r.netgain_user} | ${r.cumulate_user} |`),
    '',
    '## 字段说明',
    '',
    '- `累计关注`:账号当前总粉丝数。',
    '- `新增/取消/净增`:当日变化。数据源「数据分析 → 用户分析」,T-1 口径。',
    '',
  ].join('\n');
  await fs.writeFile(config.paths.followerOverview, md);

  console.log(`总关注:${latest.cumulate_user}(截至 ${latest.date}),写入 ${days.length} 天`);
  console.log(`DB ${config.dbPath}`);
  console.log(`INDEX ${config.paths.followerOverview}`);

  // 全量名单快照(按 openid)→ 两次差集精确算谁取关。失败不影响上面的用户分析。
  try {
    await syncRosterAndReport(session);
  } catch (error) {
    console.error('[followers] 全量名单/取关分析失败(不影响用户分析):', error instanceof Error ? error.message : error);
  }
}

function fmtTs(unix: number): string {
  if (!unix) return '-';
  const d = new Date(unix * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function esc(s: string): string {
  // Obsidian 表格里 | 要转义,换行压平
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '(空昵称)';
}

const avatarsDir = (): string => path.join(path.dirname(config.dbPath), 'avatars'); // .data/avatars(留存)
const vaultAvatarDir = (): string => path.join(config.dataDir, '取关头像'); // vault,供 md 嵌图

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// 全量粉丝头像落 .data/avatars/<openid>.jpg(已存在则跳过,小并发,best-effort)。
// 趁人还在关注时存下来,等他取关/换头像 URL 失效也还有图。
async function downloadRosterAvatars(entries: readonly { openid: string; avatar: string }[]): Promise<void> {
  const dir = avatarsDir();
  const todo = entries.filter(e => e.avatar?.startsWith('http'));
  let ok = 0;
  await mapWithConcurrency(todo, 8, async e => {
    const dest = path.join(dir, `${e.openid}.jpg`);
    if (await fileExists(dest)) return;
    if (await downloadToFile(e.avatar, dest)) ok++;
  });
  if (ok) console.log(`[followers] 新下载头像 ${ok} 张 → ${dir}`);
}

// 取关者头像入 vault(取关头像/<openid>.jpg)+ 回写 DB 相对路径,供取关名单.md 嵌图。
async function localizeUnfollowerAvatars(members: RosterMember[]): Promise<void> {
  const vdir = vaultAvatarDir();
  for (const m of members) {
    if (m.openid.startsWith('video-ocr:')) continue; // 录屏回填的已是裁切图
    if (!m.avatar?.startsWith('http')) continue; // 已本地化或无
    const rel = `取关头像/${m.openid}.jpg`;
    const dest = path.join(vdir, `${m.openid}.jpg`);
    const cached = path.join(avatarsDir(), `${m.openid}.jpg`);
    let ok = await fileExists(dest);
    if (!ok && (await fileExists(cached))) {
      await fs.mkdir(vdir, { recursive: true });
      await fs.copyFile(cached, dest);
      ok = true;
    }
    if (!ok) ok = await downloadToFile(m.avatar, dest);
    if (ok) {
      setRosterAvatar(m.openid, rel);
      m.avatar = rel; // 本次 md 即用上
    }
  }
}

// 取关 × 当期内容:近 14 天「每日取关数」与「当日发布文章」并排,看相关性。
// 取关具体时刻微信后台不给,只能按天对齐(每日 cancel_user × 当日 publish)。
function buildUnfollowAnalysis(): string[] {
  const sinceTs = Math.floor(Date.now() / 1000) - 14 * 86_400;
  const byDay = new Map<string, string[]>();
  for (const a of getArticlesPublishedSince(sinceTs)) {
    if (!a.publish_time) continue;
    const day = fmtDate(new Date(a.publish_time * 1000));
    const list = byDay.get(day) ?? [];
    list.push(a.title);
    byDay.set(day, list);
  }
  const lines = [
    '## 取关 × 当期内容(近 14 天)',
    '',
    '每日「取消关注」数 × 「当日发布文章」并排,看哪天发了什么、取关多不多(具体取关时刻微信不给,按天对齐)。',
    '',
    '| 日期 | 取消关注 | 当日发布 |',
    '| --- | ---: | --- |',
  ];
  for (const d of getFollowerDays(14)) {
    const titles = byDay.get(d.date) ?? [];
    lines.push(`| ${d.date} | ${d.cancel_user} | ${titles.length ? titles.map(esc).join(' / ') : '—'} |`);
  }
  lines.push('');
  return lines;
}

async function syncRosterAndReport(session: Awaited<ReturnType<typeof loadMpSession>>): Promise<void> {
  const { entries: roster, expectedTotal } = await fetchFollowerRoster(session);
  const today = fmtDate(new Date());
  const capturedAt = Math.floor(Date.now() / 1000);
  const r = syncFollowerRoster(roster, today, capturedAt, expectedTotal);

  const reach = `${roster.length}/${expectedTotal ?? '?'}`;
  console.log(`[followers] 名单拉到 ${reach} 人(拉到/后台未分组cnt)。`);
  if (r.skippedUnfollowMark) {
    console.log(`[followers] 名单 ${reach} 未拉全或异常(空/锐减),已跳过取关判定(只更新拉到的人,不误判)。`);
  } else {
    console.log(
      `[followers] 全量名单 ${r.totalCurrent} 人:本次新增关注 ${r.newFollowers.length}、新发现取关 ${r.newlyUnfollowed.length}、复关 ${r.reFollowed.length}。`
    );
    if (r.newlyUnfollowed.length > 0) {
      for (const m of r.newlyUnfollowed) console.log(`   - 取关:${m.nick}(关注于 ${fmtTs(m.follow_time)})`);
    }
  }

  // 头像:全量粉丝头像落 .data/avatars 留存;取关者头像复制进 vault 供取关名单嵌图。
  await downloadRosterAvatars(roster);
  const gone = getUnfollowedRoster();
  await localizeUnfollowerAvatars(gone);
  // 头像列:本地图(取关头像/x.png)→ 直接嵌图;还是 URL → 标「头像」;否则当特征文字
  const feat = (m: RosterMember): string => {
    if (!m.avatar) return '-';
    if (/\.(png|jpe?g)$/i.test(m.avatar)) return `![](${m.avatar.replace(/ /g, '%20')})`;
    if (m.avatar.startsWith('http')) return '(头像)';
    return esc(m.avatar);
  };
  const src = (m: RosterMember): string => (m.openid.startsWith('video-ocr:') ? '录屏回填' : 'openid差集');
  const row = (m: RosterMember): string =>
    `| ${esc(m.nick)} | ${fmtTs(m.follow_time)} | ${m.unfollowed_day ?? '-'} | ${feat(m)} | ${src(m)} |`;
  const md = [
    '# 取关名单',
    '',
    `按 openid 全量名单两次快照差集判定(精确,不受昵称/OCR 影响)。更新于 ${new Date().toLocaleString('zh-CN')}。`,
    '',
    `**累计判定取关:${gone.length} 人。**`,
    '',
    '| 昵称 | 关注时间 | 判定取关日 | 头像/特征 | 来源 |',
    '| --- | --- | --- | --- | --- |',
    ...gone.map(row),
    '',
    '## 说明',
    '',
    '- 判定口径:某 openid 之前在「当前粉丝」名单、本次全量拉取已不在 = 取关;之后又出现 = 复关(自动撤销)。',
    '- **来源**:`openid差集`= 系统快照自动判定(精确);`录屏回填`= 早于基线、靠录屏比对人工确认的历史取关(无 openid,2026-06-16 回填)。',
    '- 与「关注数据.md」里 API 的`取消关注`数字的差异:那是**取关事件次数**(含取关又复关、跨期),这里是**当前确实已不在的人**(净)。',
    '- 安全阀:某次拉取为空或不足上次一半(疑似限流/失败)时跳过取关判定,不误杀。',
    '',
    ...buildUnfollowAnalysis(),
  ].join('\n');
  await fs.writeFile(config.paths.unfollowOverview, md);
  console.log(`INDEX ${config.paths.unfollowOverview}`);
}

if (isMain(import.meta.url)) runCli(run);
