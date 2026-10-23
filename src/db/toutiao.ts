import type { ToutiaoCaptureTarget, ToutiaoComment, ToutiaoItem, ToutiaoRawCapture } from '../types/toutiao.js';
import { getDb, jsonString } from './core.js';

export function upsertToutiaoRawCapture(target: ToutiaoCaptureTarget, capture: ToutiaoRawCapture): void {
  getDb()
    .prepare(`
      INSERT INTO toutiao_raw_captures (target, matched_url, captured_at, request_body_json, response_json)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(target, capture.matchedUrl, capture.capturedAt, jsonString(capture.requestBody), jsonString(capture.json));
}

export function upsertToutiaoItem(item: ToutiaoItem, capturedAt: number): void {
  getDb()
    .prepare(`
      INSERT INTO toutiao_items (
        item_id, title, url, item_type, publish_time, status, abstract, raw_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        item_type = excluded.item_type,
        publish_time = excluded.publish_time,
        status = excluded.status,
        abstract = excluded.abstract,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at;
    `)
    .run(
      item.itemId,
      item.title,
      item.url,
      item.itemType,
      item.publishTime,
      item.status,
      item.abstract,
      jsonString(item.raw),
      capturedAt
    );
}

export function upsertToutiaoItemSnapshot(item: ToutiaoItem, capturedAt: number, capturedDay: string): void {
  getDb()
    .prepare(`
      INSERT INTO toutiao_item_snapshots (
        item_id, captured_at, captured_day, read_count, comment_count, like_count,
        share_count, favorite_count, follow_count, income_cents, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id, captured_day) DO UPDATE SET
        captured_at = excluded.captured_at,
        read_count = excluded.read_count,
        comment_count = excluded.comment_count,
        like_count = excluded.like_count,
        share_count = excluded.share_count,
        favorite_count = excluded.favorite_count,
        follow_count = excluded.follow_count,
        income_cents = excluded.income_cents,
        raw_json = excluded.raw_json;
    `)
    .run(
      item.itemId,
      capturedAt,
      capturedDay,
      item.metrics.readCount,
      item.metrics.commentCount,
      item.metrics.likeCount,
      item.metrics.shareCount,
      item.metrics.favoriteCount,
      item.metrics.followCount,
      item.metrics.incomeCents,
      jsonString(item.raw)
    );
}

export function upsertToutiaoComment(comment: ToutiaoComment, capturedAt: number): void {
  getDb()
    .prepare(`
      INSERT INTO toutiao_comments (
        comment_id, item_id, nick_name, content, like_count, reply_count, create_time, status, raw_json, captured_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        item_id = excluded.item_id,
        nick_name = excluded.nick_name,
        content = excluded.content,
        like_count = excluded.like_count,
        reply_count = excluded.reply_count,
        create_time = excluded.create_time,
        status = excluded.status,
        raw_json = excluded.raw_json,
        captured_at = excluded.captured_at;
    `)
    .run(
      comment.commentId,
      comment.itemId,
      comment.nickName,
      comment.content,
      comment.likeCount,
      comment.replyCount,
      comment.createTime,
      comment.status,
      jsonString(comment.raw),
      capturedAt
    );
}

export interface ToutiaoItemLatest {
  item_id: string;
  title: string | null;
  url: string | null;
  item_type: string | null;
  publish_time: number | null;
  status: string | null;
  abstract: string | null;
  read_count: number | null;
  comment_count: number | null;
  like_count: number | null;
  share_count: number | null;
  favorite_count: number | null;
  follow_count: number | null;
  income_cents: number | null;
  captured_at: number | null;
}

export function getToutiaoItemsLatest(): ToutiaoItemLatest[] {
  return getDb()
    .prepare(`
      WITH latest AS (
        SELECT item_id, MAX(captured_at) AS max_at FROM toutiao_item_snapshots GROUP BY item_id
      )
      SELECT i.item_id, i.title, i.url, i.item_type, i.publish_time, i.status, i.abstract,
             s.read_count, s.comment_count, s.like_count, s.share_count, s.favorite_count,
             s.follow_count, s.income_cents, s.captured_at
      FROM toutiao_items i
      LEFT JOIN latest l ON l.item_id = i.item_id
      LEFT JOIN toutiao_item_snapshots s ON s.item_id = i.item_id AND s.captured_at = l.max_at
      ORDER BY COALESCE(i.publish_time, i.updated_at) DESC
    `)
    .all() as unknown as ToutiaoItemLatest[];
}

export interface ToutiaoCommentLatest {
  comment_id: string;
  item_id: string;
  nick_name: string | null;
  content: string | null;
  like_count: number | null;
  reply_count: number | null;
  create_time: number | null;
  status: string | null;
  captured_at: number;
}

export function getToutiaoCommentsLatest(limit = 50): ToutiaoCommentLatest[] {
  return getDb()
    .prepare(`
      SELECT comment_id, item_id, nick_name, content, like_count, reply_count, create_time, status, captured_at
      FROM toutiao_comments
      ORDER BY COALESCE(create_time, captured_at) DESC
      LIMIT ?
    `)
    .all(limit) as unknown as ToutiaoCommentLatest[];
}
