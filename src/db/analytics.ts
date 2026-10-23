import { decodeHtmlEntities } from '../utils/text.js';
import { getDb } from './core.js';

export interface ReadTendencyRow {
  date: string;
  scene: number;
  read_uv: number;
  share_uv: number;
}

/** upsert 阅读趋势逐日 × 渠道行(按 (date, scene) 幂等,T-1 隔日重抓覆盖)。 */
export function upsertReadTendency(rows: ReadTendencyRow[], capturedAt: number): void {
  const stmt = getDb().prepare(`
    INSERT INTO read_tendency (date, scene, read_uv, share_uv, captured_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, scene) DO UPDATE SET
      read_uv = excluded.read_uv, share_uv = excluded.share_uv, captured_at = excluded.captured_at;
  `);
  for (const r of rows) stmt.run(r.date, r.scene, r.read_uv, r.share_uv, capturedAt);
}

export interface DailyReadTendency {
  date: string;
  /** 全账号当日阅读人数(scene 9999) */
  all: number;
  /** 其中来自「推荐」(看一看/算法)的阅读人数(scene 6) */
  recommend: number;
}

/**
 * 每日阅读量(后台权威口径,接口直抓):全部 + 推荐(看一看)两路。
 * 默认剔除当天(T-1 未结算、read_uv=0 的尾行),避免画一根掉到 0 的假尾。
 */
export function getDailyReadTendency(): DailyReadTendency[] {
  const rows = getDb()
    .prepare(`
      SELECT date,
             CAST(SUM(CASE WHEN scene = 9999 THEN read_uv ELSE 0 END) AS INTEGER) AS all_uv,
             CAST(SUM(CASE WHEN scene = 6    THEN read_uv ELSE 0 END) AS INTEGER) AS rec_uv
      FROM read_tendency
      GROUP BY date ORDER BY date
    `)
    .all() as unknown as { date: string; all_uv: number; rec_uv: number }[];
  // 去掉末尾 all=0 的未结算日(只削尾,中间真为 0 的日子保留)
  while (rows.length && rows[rows.length - 1]?.all_uv === 0) rows.pop();
  return rows.map(r => ({ date: r.date, all: r.all_uv, recommend: r.rec_uv }));
}

export interface ReadSourcePoint {
  date: string;
  scene: number;
  read_uv: number;
}

/**
 * 每日阅读量「按渠道(scene)」明细,供前端透视成来源占比/堆叠图。
 * 排除 scene 9999(全部),只取已结算日(全部>0 的日期);前端按 SCENE_LABELS 命名。
 */
export function getDailyReadBySource(): ReadSourcePoint[] {
  return getDb()
    .prepare(`
      SELECT date, scene, CAST(read_uv AS INTEGER) AS read_uv FROM read_tendency
      WHERE scene != 9999
        AND date IN (SELECT date FROM read_tendency WHERE scene = 9999 AND read_uv > 0)
      ORDER BY date, scene
    `)
    .all() as unknown as ReadSourcePoint[];
}

export interface CumulativeRead {
  date: string;
  total: number;
}

/**
 * 每日「累计阅读量」:后台逐日「全部」阅读人数(read_tendency,scene 9999)逐日累加。
 * 与「每日阅读量」同源同起点(回看窗口取决于抓取范围,默认 statsDays);单调不减。
 * 口径=区间内逐日阅读人次之和(同一人多日读会重复计),非历史去重总量。
 */
export function getCumulativeReads(): CumulativeRead[] {
  const rows = getDb()
    .prepare('SELECT date, read_uv FROM read_tendency WHERE scene = 9999 ORDER BY date')
    .all() as unknown as {
    date: string;
    read_uv: number;
  }[];
  while (rows.length && rows[rows.length - 1]?.read_uv === 0) rows.pop(); // 削未结算尾日
  let running = 0;
  return rows.map(r => {
    running += r.read_uv;
    return { date: r.date, total: running };
  });
}

/** 记录已达标的目标 key,返回本轮「新」达成的(之前没记过的),用于只提醒一次。 */
export function recordNewMilestones(keys: string[], hitAt: number): string[] {
  const db = getDb();
  const existing = new Set(
    (db.prepare('SELECT goal_key FROM goal_milestones').all() as unknown as { goal_key: string }[]).map(r => r.goal_key)
  );
  const fresh = keys.filter(k => !existing.has(k));
  const ins = db.prepare('INSERT OR IGNORE INTO goal_milestones (goal_key, hit_at) VALUES (?, ?)');
  for (const k of fresh) ins.run(k, hitAt);
  return fresh;
}

export interface ArticleRevenue {
  title: string;
  send_date: string;
  orig_status: number;
  income_cents: number;
}

/** 标题归一(关联用):解 HTML 实体 + NFKC + 去首尾 + 折叠内部空白。导出供测试与 resolveArticleId 复用。 */
export function normalizeTitle(s: string): string {
  return decodeHtmlEntities(s).normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/**
 * 标题「模糊键」:归一后再去掉所有空白/标点/符号并小写。
 * 用于救回两个来源标题仅标点差异的情况(如 `,` vs `;`、直引号 vs 弯引号、结尾句号)。
 * 注意:字序不同(打字错位)不会被它救回——那种风险太大,留给人工。
 */
export function looseTitleKey(s: string): string {
  return normalizeTitle(s)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** unix 秒 → 本地 YYYY-MM-DD(对齐 publisher 的 send_date 口径)。 */
function dayOf(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 用归一标题在 articles 里找对应文章 id;同标题多篇(同日多推/改标题重发)时,
 * 优先 publish_time 当天 == send_date 的那篇,否则取第一篇;查不到返回 null。
 */
export function resolveArticleId(title: string, sendDate: string): number | null {
  const norm = normalizeTitle(title);
  const rows = getDb().prepare('SELECT id, title, publish_time FROM articles').all() as unknown as {
    id: number;
    title: string;
    publish_time: number | null;
  }[];
  let hits = rows.filter(r => normalizeTitle(r.title) === norm);
  // 归一仍对不上 → 退一步用「模糊键」(去标点/空白)再试;仅当唯一命中一篇才采用,避免误配
  if (hits.length === 0) {
    const lk = looseTitleKey(title);
    if (lk.length >= 4) {
      const loose = rows.filter(r => looseTitleKey(r.title) === lk);
      if (new Set(loose.map(r => r.id)).size === 1) hits = loose;
    }
  }
  const first = hits[0];
  if (!first) return null;
  const sameDay = hits.find(r => r.publish_time !== null && dayOf(r.publish_time) === sendDate);
  return (sameDay ?? first).id;
}

/** upsert 单篇文章广告收益(按 send_date+title 幂等);写入时解析并填 article_id。 */
export function upsertArticleRevenue(a: ArticleRevenue, capturedAt: number): void {
  const articleId = resolveArticleId(a.title, a.send_date);
  getDb()
    .prepare(`
      INSERT INTO article_revenue (send_date, title, orig_status, income_cents, captured_at, article_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(send_date, title) DO UPDATE SET
        orig_status = excluded.orig_status, income_cents = excluded.income_cents,
        captured_at = excluded.captured_at,
        -- 解析不出新关联时保留旧值:别让重跑把已关联(含人工订正字序错位标题)的覆盖成 null
        article_id = COALESCE(excluded.article_id, article_revenue.article_id);
    `)
    .run(a.send_date, a.title, a.orig_status, a.income_cents, capturedAt, articleId);
}

/** 回填所有 article_id 为空的收益行(兼容加列前已落数据)。返回命中/未命中计数。 */
export function backfillArticleRevenueLinks(): { matched: number; unmatched: number } {
  const rows = getDb()
    .prepare('SELECT send_date, title FROM article_revenue WHERE article_id IS NULL')
    .all() as unknown as {
    send_date: string;
    title: string;
  }[];
  const update = getDb().prepare('UPDATE article_revenue SET article_id = ? WHERE send_date = ? AND title = ?');
  let matched = 0;
  for (const r of rows) {
    const id = resolveArticleId(r.title, r.send_date);
    if (id === null) continue;
    update.run(id, r.send_date, r.title);
    matched++;
  }
  return { matched, unmatched: rows.length - matched };
}

/** 仍未关联到选题的收益行数(report 里诚实暴露)。 */
export function countUnlinkedRevenue(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM article_revenue WHERE article_id IS NULL')
    .get() as unknown as {
    c: number;
  };
  return row.c;
}

/** 取文章收益榜(收益降序)。 */
export function getArticleRevenue(limit = 50): ArticleRevenue[] {
  return getDb()
    .prepare(
      'SELECT title, send_date, orig_status, income_cents FROM article_revenue ORDER BY income_cents DESC, send_date DESC LIMIT ?'
    )
    .all(limit) as unknown as ArticleRevenue[];
}

/** 经营分析事实表一行:一篇文章 + 最新互动 + 关联到的广告收益(未拉到为 null)。 */
export interface TopicEcoRow {
  id: number;
  title: string;
  publish_time: number | null;
  media_type: string | null;
  content_type: string | null;
  subject: string | null;
  read_uv: number;
  follow_uv: number;
  like_cnt: number;
  income_cents: number | null;
}

/**
 * 选题 × 阅读/涨粉/收益 的事实表:每篇文章 LEFT JOIN 其最新互动快照 + 关联到的文章收益。
 * 收益按 article_id 关联(见 resolveArticleId);未拉到收益的篇 income_cents 为 null。
 */
export function getTopicEconomics(): TopicEcoRow[] {
  return getDb()
    .prepare(`
      WITH latest AS (
        SELECT article_id, MAX(captured_at) AS max_at FROM stat_snapshots GROUP BY article_id
      )
      SELECT a.id, a.title, a.publish_time, a.media_type, a.content_type, a.subject,
             COALESCE(s.read_uv, 0)   AS read_uv,
             COALESCE(s.follow_uv, 0) AS follow_uv,
             COALESCE(s.like_cnt, 0)  AS like_cnt,
             r.income_cents           AS income_cents
      FROM articles a
      LEFT JOIN latest l ON l.article_id = a.id
      LEFT JOIN stat_snapshots s ON s.article_id = l.article_id AND s.captured_at = l.max_at
      LEFT JOIN article_revenue r ON r.article_id = a.id
      ORDER BY a.publish_time DESC
    `)
    .all() as unknown as TopicEcoRow[];
}

export interface TrendPoint {
  title: string;
  captured_day: string;
  read_uv: number;
}

/** 所有快照(按文章、时间排序),用于趋势:read_uv 随天的增长。 */
export function getTrendPoints(): TrendPoint[] {
  return getDb()
    .prepare(`
      SELECT a.title, s.captured_day, s.read_uv
      FROM stat_snapshots s JOIN articles a ON a.id = s.article_id
      ORDER BY a.id, s.captured_day
    `)
    .all() as unknown as TrendPoint[];
}
