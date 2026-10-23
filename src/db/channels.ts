import { resolveChannelVideoTitle } from '../channels/title.js';
import type { ChannelAccountSnapshot, ChannelDailyFans, ChannelVideo } from '../types/channels.js';
import { boolInt, getDb, jsonString } from './core.js';

export function upsertChannelVideo(video: ChannelVideo, capturedAt: number): void {
  getDb()
    .prepare(`
      INSERT INTO channel_videos (
        object_id, export_id, description, short_title_json, create_time, media_type, status, visible_type,
        object_type, flag, object_nonce, permission_flag, comment_close, can_set_original_sound_title,
        show_original, ringset_count, snscover_count, statusref_count, sticky_op_status,
        disable_info_json, original_info_json, args_info_json, raw_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id) DO UPDATE SET
        export_id = excluded.export_id,
        description = excluded.description,
        short_title_json = excluded.short_title_json,
        create_time = excluded.create_time,
        media_type = excluded.media_type,
        status = excluded.status,
        visible_type = excluded.visible_type,
        object_type = excluded.object_type,
        flag = excluded.flag,
        object_nonce = excluded.object_nonce,
        permission_flag = excluded.permission_flag,
        comment_close = excluded.comment_close,
        can_set_original_sound_title = excluded.can_set_original_sound_title,
        show_original = excluded.show_original,
        ringset_count = excluded.ringset_count,
        snscover_count = excluded.snscover_count,
        statusref_count = excluded.statusref_count,
        sticky_op_status = excluded.sticky_op_status,
        disable_info_json = excluded.disable_info_json,
        original_info_json = excluded.original_info_json,
        args_info_json = excluded.args_info_json,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at;
    `)
    .run(
      video.objectId,
      video.exportId,
      video.desc.description,
      jsonString(video.desc.shortTitle),
      video.createTime,
      video.desc.mediaType,
      video.status,
      video.visibleType,
      video.objectType,
      video.flag,
      video.objectNonce,
      video.permissionFlag,
      video.commentClose,
      boolInt(video.canSetOriginalsoundTitle),
      boolInt(video.showOriginal),
      video.ringsetCount,
      video.snscoverCount,
      video.statusrefCount,
      video.stickyOpStatus,
      jsonString(video.disableInfo),
      jsonString(video.originalInfo),
      jsonString(video.argsInfo),
      jsonString(video),
      capturedAt
    );
}

/** upsert 视频号视频指标快照(同视频同日覆盖,跨日追加)。 */
export function upsertChannelVideoSnapshot(video: ChannelVideo, capturedAt: number, capturedDay: string): void {
  getDb()
    .prepare(`
      INSERT INTO channel_video_snapshots (
        object_id, captured_at, captured_day, read_count, yesterday_read_count, full_play_rate,
        avg_play_time_sec, fast_flip_rate, like_count, fav_count, comment_count,
        forward_count, forward_sns_count, forward_all_chat_count, forward_aggregation_count,
        follow_count, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id, captured_day) DO UPDATE SET
        captured_at = excluded.captured_at,
        read_count = excluded.read_count,
        yesterday_read_count = excluded.yesterday_read_count,
        full_play_rate = excluded.full_play_rate,
        avg_play_time_sec = excluded.avg_play_time_sec,
        fast_flip_rate = excluded.fast_flip_rate,
        like_count = excluded.like_count,
        fav_count = excluded.fav_count,
        comment_count = excluded.comment_count,
        forward_count = excluded.forward_count,
        forward_sns_count = excluded.forward_sns_count,
        forward_all_chat_count = excluded.forward_all_chat_count,
        forward_aggregation_count = excluded.forward_aggregation_count,
        follow_count = excluded.follow_count,
        raw_json = excluded.raw_json;
    `)
    .run(
      video.objectId,
      capturedAt,
      capturedDay,
      video.readCount,
      video.yesterdayReadCount,
      video.fullPlayRate,
      video.avgPlayTimeSec,
      video.fastFlipRate,
      video.likeCount,
      video.favCount,
      video.commentCount,
      video.forwardCount,
      video.forwardSnsCount,
      video.forwardAllChatCount,
      video.forwardAggregationCount,
      video.followCount,
      jsonString(video)
    );
}

/** upsert 视频号粉丝趋势日序列(按 date 幂等)。 */
export function upsertChannelDailyFans(days: ChannelDailyFans[], capturedAt: number): void {
  const stmt = getDb().prepare(`
    INSERT INTO channel_daily_fans (
      date, add_count, reduce_count, net_add_count, total_count, fans_data_by_tabtype_json, captured_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      add_count = excluded.add_count,
      reduce_count = excluded.reduce_count,
      net_add_count = excluded.net_add_count,
      total_count = excluded.total_count,
      fans_data_by_tabtype_json = excluded.fans_data_by_tabtype_json,
      captured_at = excluded.captured_at;
  `);
  for (const day of days) {
    stmt.run(day.date, day.add, day.reduce, day.netAdd, day.total, jsonString(day.fansDataByTabtype), capturedAt);
  }
}

/** upsert 视频号账号首页概览(按采集日幂等)。 */
export function upsertChannelAccountSnapshot(snapshot: ChannelAccountSnapshot): void {
  getDb()
    .prepare(`
      INSERT INTO channel_account_snapshots (
        captured_day, captured_at, finder_username, nickname, uniq_id, fans_count, feeds_count,
        yesterday_browse, yesterday_like, yesterday_comment, yesterday_forward, yesterday_fav,
        yesterday_follow, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(captured_day) DO UPDATE SET
        captured_at = excluded.captured_at,
        finder_username = excluded.finder_username,
        nickname = excluded.nickname,
        uniq_id = excluded.uniq_id,
        fans_count = excluded.fans_count,
        feeds_count = excluded.feeds_count,
        yesterday_browse = excluded.yesterday_browse,
        yesterday_like = excluded.yesterday_like,
        yesterday_comment = excluded.yesterday_comment,
        yesterday_forward = excluded.yesterday_forward,
        yesterday_fav = excluded.yesterday_fav,
        yesterday_follow = excluded.yesterday_follow,
        raw_json = excluded.raw_json;
    `)
    .run(
      snapshot.capturedDay,
      snapshot.capturedAt,
      snapshot.finderUsername,
      snapshot.nickname,
      snapshot.uniqId,
      snapshot.fansCount,
      snapshot.feedsCount,
      snapshot.yesterdayBrowse,
      snapshot.yesterdayLike,
      snapshot.yesterdayComment,
      snapshot.yesterdayForward,
      snapshot.yesterdayFav,
      snapshot.yesterdayFollow,
      jsonString(snapshot.raw)
    );
}

export interface ChannelArticleCandidate {
  id: number;
  title: string;
  url: string;
  publish_time: number;
  media_type: string | null;
}

/** 视频号 ↔ 公众号文章按发布时间就近匹配的候选集。 */
export function getChannelArticleCandidates(): ChannelArticleCandidate[] {
  return getDb()
    .prepare(`
      SELECT id, title, url, publish_time, media_type
      FROM articles
      WHERE publish_time IS NOT NULL
      ORDER BY publish_time DESC
    `)
    .all() as unknown as ChannelArticleCandidate[];
}

/** 视频号:每条视频 + 其最新一次快照(看板用)。按发布时间倒序。 */
export interface ChannelVideoLatest {
  object_id: string;
  title: string;
  description: string | null;
  create_time: number | null;
  read_count: number;
  yesterday_read_count: number;
  full_play_rate: number;
  avg_play_time_sec: number;
  fast_flip_rate: number;
  like_count: number;
  fav_count: number;
  comment_count: number;
  forward_count: number;
  follow_count: number;
  captured_at: number;
}

type ChannelVideoLatestRow = Omit<ChannelVideoLatest, 'title'> & {
  short_title_json: string | null;
};

export function getChannelVideosLatest(): ChannelVideoLatest[] {
  const rows = getDb()
    .prepare(`
      WITH latest AS (
        SELECT object_id, MAX(captured_at) AS max_at FROM channel_video_snapshots GROUP BY object_id
      )
      SELECT v.object_id, v.description, v.short_title_json, v.create_time,
             s.read_count, s.yesterday_read_count, s.full_play_rate, s.avg_play_time_sec,
             s.fast_flip_rate, s.like_count, s.fav_count, s.comment_count, s.forward_count,
             s.follow_count, s.captured_at
      FROM channel_videos v
      JOIN latest l ON l.object_id = v.object_id
      JOIN channel_video_snapshots s ON s.object_id = v.object_id AND s.captured_at = l.max_at
      ORDER BY v.create_time DESC
    `)
    .all() as unknown as ChannelVideoLatestRow[];

  return rows.map(({ short_title_json, ...row }) => ({
    ...row,
    title: resolveChannelVideoTitle({
      description: row.description,
      shortTitle: short_title_json,
    }),
  }));
}

export interface ChannelVideoSnapshotPoint {
  captured_day: string;
  captured_at: number;
  read_count: number;
  yesterday_read_count: number;
  full_play_rate: number;
  avg_play_time_sec: number;
  fast_flip_rate: number;
  like_count: number;
  fav_count: number;
  comment_count: number;
  forward_count: number;
  follow_count: number;
}

/** 视频号:单条视频的跨日指标快照,按日期正序返回。 */
export function getChannelVideoSeries(objectIds: string[]): Record<string, ChannelVideoSnapshotPoint[]> {
  const ids = [...new Set(objectIds)].filter(Boolean);
  if (ids.length === 0) return {};

  const placeholders = ids.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`
      SELECT object_id, captured_day, captured_at, read_count, yesterday_read_count, full_play_rate,
             avg_play_time_sec, fast_flip_rate, like_count, fav_count, comment_count, forward_count, follow_count
      FROM channel_video_snapshots
      WHERE object_id IN (${placeholders})
      ORDER BY object_id, captured_day ASC, captured_at ASC
    `)
    .all(...ids) as unknown as (ChannelVideoSnapshotPoint & { object_id: string })[];

  const out: Record<string, ChannelVideoSnapshotPoint[]> = {};
  for (const row of rows) {
    const { object_id, ...point } = row;
    if (!out[object_id]) out[object_id] = [];
    out[object_id].push(point);
  }
  return out;
}

/** 视频号:每日粉丝趋势(倒序,最新在前;前端按需 reverse)。 */
export interface ChannelFansDay {
  date: string;
  add_count: number;
  reduce_count: number;
  net_add_count: number;
  total_count: number;
}

export function getChannelDailyFans(limit = 90): ChannelFansDay[] {
  return getDb()
    .prepare(`
      SELECT date, add_count, reduce_count, net_add_count, total_count
      FROM channel_daily_fans ORDER BY date DESC LIMIT ?
    `)
    .all(limit) as unknown as ChannelFansDay[];
}

export interface ChannelAccountLatest {
  captured_day: string;
  captured_at: number;
  finder_username: string;
  nickname: string;
  uniq_id: string;
  fans_count: number;
  feeds_count: number;
  yesterday_browse: number;
  yesterday_like: number;
  yesterday_comment: number;
  yesterday_forward: number;
  yesterday_fav: number;
  yesterday_follow: number;
}

export function getChannelAccountLatest(): ChannelAccountLatest | null {
  return (
    (getDb()
      .prepare(`
        SELECT captured_day, captured_at, finder_username, nickname, uniq_id, fans_count, feeds_count,
               yesterday_browse, yesterday_like, yesterday_comment, yesterday_forward, yesterday_fav,
               yesterday_follow
        FROM channel_account_snapshots
        ORDER BY captured_at DESC
        LIMIT 1
      `)
      .get() as ChannelAccountLatest | undefined) ?? null
  );
}

/** 设置一篇的选题双轴(打标用,可重复调用覆盖)。 */
