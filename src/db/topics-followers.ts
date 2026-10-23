import type { ContentType, Subject } from '../types/topic.js';
import { getDb } from './core.js';

export function setTopic(appmsgid: string, itemidx: number, contentType: ContentType, subject: Subject): void {
  getDb()
    .prepare('UPDATE articles SET content_type = ?, subject = ? WHERE appmsgid = ? AND itemidx = ?')
    .run(contentType, subject, appmsgid, itemidx);
}

export interface ArticleTopic {
  appmsgid: string;
  itemidx: number;
  title: string;
  content_type: string | null;
  subject: string | null;
}

/** 列出全部文章及其当前标签(未打标的 content_type/subject 为 null)。 */
export function getAllArticles(): ArticleTopic[] {
  return getDb()
    .prepare('SELECT appmsgid, itemidx, title, content_type, subject FROM articles ORDER BY publish_time DESC')
    .all() as unknown as ArticleTopic[];
}

/** 一篇文章 + 其最新一次快照(分析用)。 */
export interface ArticleLatest {
  id: number;
  title: string;
  url: string;
  publish_time: number | null;
  media_type: string | null;
  content_type: string | null;
  subject: string | null;
  read_uv: number;
  like_cnt: number;
  zaikan_cnt: number;
  comment_cnt: number;
  share_uv: number;
  collection_uv: number;
  follow_uv: number;
  income_cents: number; // 该篇累计广告收益(分);未关联收益为 0
}

/**
 * 失败重发去重:群发第一次失败、第二次才成功时,后台会留下两条同标题、同一天的文章,
 * 失败那条永远 read=0(且收益常被错挂到它身上)。规则:同标题 + 同一天(北京时区)出现多条、
 * 且组里既有 0 阅读又有 >0 阅读时,判为「失败重发」——只留阅读最高的一条,收益并入,丢弃失败条。
 * 拿不准(全 0 或全有阅读)就都保留,避免误删正常文章。
 */
function dedupeFailedReposts(rows: ArticleLatest[]): ArticleLatest[] {
  const groups = new Map<string, ArticleLatest[]>();
  for (const r of rows) {
    const day = r.publish_time ? Math.floor((r.publish_time + 8 * 3600) / 86400) : 'na';
    const key = `${(r.title ?? '').trim()}__${day}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const kept: ArticleLatest[] = [];
  for (const g of groups.values()) {
    if (g.length === 1 || !(g.some(x => x.read_uv === 0) && g.some(x => x.read_uv > 0))) {
      kept.push(...g);
      continue;
    }
    const incomeSum = g.reduce((s, x) => s + x.income_cents, 0);
    const winner = g.reduce((a, b) =>
      b.read_uv > a.read_uv || (b.read_uv === a.read_uv && (b.publish_time ?? 0) > (a.publish_time ?? 0)) ? b : a
    );
    kept.push({ ...winner, income_cents: incomeSum });
  }
  return kept.sort((a, b) => b.read_uv - a.read_uv);
}

/** 每篇取最新一次快照(按 captured_at)。分析的事实基础(已滤掉失败重发的重复条)。 */
export function getLatestStats(): ArticleLatest[] {
  const rows = getDb()
    .prepare(`
      WITH latest AS (
        SELECT article_id, MAX(captured_at) AS max_at FROM stat_snapshots GROUP BY article_id
      )
      SELECT a.id, a.title, a.url, a.publish_time, a.media_type, a.content_type, a.subject,
             s.read_uv, s.like_cnt, s.zaikan_cnt, s.comment_cnt, s.share_uv, s.collection_uv,
             COALESCE(s.follow_uv, 0) AS follow_uv,
             COALESCE((SELECT SUM(income_cents) FROM article_revenue WHERE article_id = a.id), 0) AS income_cents
      FROM articles a
      JOIN latest l ON l.article_id = a.id
      JOIN stat_snapshots s ON s.article_id = l.article_id AND s.captured_at = l.max_at
      ORDER BY s.read_uv DESC
    `)
    .all() as unknown as ArticleLatest[];
  return dedupeFailedReposts(rows);
}

export interface FollowerDay {
  date: string;
  new_user: number;
  cancel_user: number;
  netgain_user: number;
  cumulate_user: number;
}

/** upsert 账号「用户分析」某天数据(按 date 幂等)。 */
export function upsertFollowerDay(day: FollowerDay, capturedAt: number): void {
  getDb()
    .prepare(`
      INSERT INTO follower_snapshots (date, new_user, cancel_user, netgain_user, cumulate_user, captured_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        new_user = excluded.new_user, cancel_user = excluded.cancel_user,
        netgain_user = excluded.netgain_user, cumulate_user = excluded.cumulate_user,
        captured_at = excluded.captured_at;
    `)
    .run(day.date, day.new_user, day.cancel_user, day.netgain_user, day.cumulate_user, capturedAt);
}

/** 取最近 N 天粉丝数据(按日期倒序)。 */
export function getFollowerDays(limit = 14): FollowerDay[] {
  return getDb()
    .prepare(
      'SELECT date, new_user, cancel_user, netgain_user, cumulate_user FROM follower_snapshots ORDER BY date DESC LIMIT ?'
    )
    .all(limit) as unknown as FollowerDay[];
}

export interface RosterEntry {
  openid: string;
  nick: string;
  avatar: string;
  followTime: number;
}

export interface RosterMember {
  openid: string;
  nick: string;
  avatar: string;
  follow_time: number;
  first_seen_day: string;
  last_seen_day: string;
  unfollowed_day: string | null;
}

export interface RosterSyncResult {
  totalCurrent: number;
  newFollowers: RosterMember[]; // 本次首次出现
  newlyUnfollowed: RosterMember[]; // 本次判定为取关(上次在、这次没了)
  reFollowed: RosterMember[]; // 之前判过取关、这次又回来了
  skippedUnfollowMark: boolean; // 本次拉取可疑(空/锐减),跳过取关判定
}

/**
 * 用本次全量名单同步 follower_roster,并按 openid 差集算出谁取关。
 * - 当前拉到的:upsert(新人记 first_seen;老人刷新 last_seen/nick/avatar;之前判过取关的→复关)。
 * - 上次还在 following、这次没拉到的:判取关(status=unfollowed, unfollowed_day=day)。
 * 安全阀:若本次拉取为空、或不足上次在关注人数的一半(疑似接口失败/限流),**跳过取关判定**,只更新拉到的人,避免误杀全名单。
 */
export function syncFollowerRoster(
  entries: readonly RosterEntry[],
  day: string,
  _capturedAt: number,
  expectedTotal: number | null = null
): RosterSyncResult {
  const db = getDb();
  const currentIds = new Set(entries.map(e => e.openid));
  // 取关判定前记下「上次仍在 following」的 openid 集合(upsert 之前取,新插入的不算)
  const prevFollowing = db
    .prepare("SELECT openid FROM follower_roster WHERE status = 'following'")
    .all() as unknown as {
    openid: string;
  }[];
  // 跳过取关判定的情形(否则漏读会被误判成取关):① 空 ② 不足上次一半(疑似失败/限流)
  //  ③ 拉到数 < 后台真实总数 expectedTotal(没拉全)。游标翻页正常能拉满,故正常情况下都会做判定。
  const incomplete = expectedTotal != null && entries.length < expectedTotal;
  const skip =
    entries.length === 0 || (prevFollowing.length > 0 && entries.length < prevFollowing.length / 2) || incomplete;

  const getOne = db.prepare('SELECT openid, status FROM follower_roster WHERE openid = ?');
  const insert = db.prepare(`
    INSERT INTO follower_roster (openid, nick, avatar, follow_time, first_seen_day, last_seen_day, status, unfollowed_day)
    VALUES (?, ?, ?, ?, ?, ?, 'following', NULL)
  `);
  const update = db.prepare(`
    UPDATE follower_roster SET nick = ?, avatar = ?, follow_time = ?, last_seen_day = ?,
      status = 'following', unfollowed_day = NULL WHERE openid = ?
  `);

  const newIds: string[] = [];
  const reIds: string[] = [];
  for (const e of entries) {
    const row = getOne.get(e.openid) as unknown as { openid: string; status: string } | undefined;
    if (!row) {
      insert.run(e.openid, e.nick, e.avatar, e.followTime, day, day);
      newIds.push(e.openid);
    } else {
      if (row.status === 'unfollowed') reIds.push(e.openid);
      update.run(e.nick, e.avatar, e.followTime, day, e.openid);
    }
  }

  let goneIds: string[] = [];
  if (!skip) {
    // 拉全了(游标翻页),简单差集即可:上次在 following、这次完整名单里没有 = 取关。
    goneIds = prevFollowing.map(r => r.openid).filter(id => !currentIds.has(id));
    const markGone = db.prepare(
      "UPDATE follower_roster SET status = 'unfollowed', unfollowed_day = ? WHERE openid = ?"
    );
    for (const id of goneIds) markGone.run(day, id);
  }

  const fetchMembers = (ids: readonly string[]): RosterMember[] =>
    ids.map(
      id =>
        db
          .prepare(
            'SELECT openid, nick, avatar, follow_time, first_seen_day, last_seen_day, unfollowed_day FROM follower_roster WHERE openid = ?'
          )
          .get(id) as unknown as RosterMember
    );

  return {
    totalCurrent: entries.length,
    newFollowers: fetchMembers(newIds),
    newlyUnfollowed: fetchMembers(goneIds),
    reFollowed: fetchMembers(reIds),
    skippedUnfollowMark: skip,
  };
}

/** 取所有已判定取关的人(按取关日期倒序)。 */
export function getUnfollowedRoster(): RosterMember[] {
  return getDb()
    .prepare(`
      SELECT openid, nick, avatar, follow_time, first_seen_day, last_seen_day, unfollowed_day
      FROM follower_roster WHERE status = 'unfollowed'
      ORDER BY unfollowed_day DESC, follow_time DESC
    `)
    .all() as unknown as RosterMember[];
}

/** 更新某 openid 的头像字段(存本地相对路径,供取关名单嵌图)。 */
export function setRosterAvatar(openid: string, avatar: string): void {
  getDb().prepare('UPDATE follower_roster SET avatar = ? WHERE openid = ?').run(avatar, openid);
}
