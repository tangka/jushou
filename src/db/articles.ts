import type { MediaType } from '../types/topic.js';
import type { ArticleComment } from '../wechat/comments.js';
import { boolInt, getDb, jsonString } from './core.js';

export interface ArticleMeta {
  appmsgid: string;
  itemidx: number;
  title: string;
  url: string;
  account: string;
  publishTime: number | null;
  mediaType: MediaType;
}

export interface SnapshotStats {
  read_uv: number;
  like_cnt: number;
  zaikan_cnt: number;
  comment_cnt: number;
  share_uv: number;
  collection_uv: number;
  follow_uv: number;
}

/** upsert 文章元数据(幂等 on appmsgid+itemidx),返回 article id;不动 content_type/subject。 */
export function upsertArticle(meta: ArticleMeta): number {
  const row = getDb()
    .prepare(`
      INSERT INTO articles (appmsgid, itemidx, title, url, account, publish_time, media_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(appmsgid, itemidx) DO UPDATE SET
        title = excluded.title, url = excluded.url,
        account = excluded.account, publish_time = excluded.publish_time,
        media_type = excluded.media_type
      RETURNING id;
    `)
    .get(
      meta.appmsgid,
      meta.itemidx,
      meta.title,
      meta.url,
      meta.account,
      meta.publishTime,
      meta.mediaType
    ) as unknown as {
    id: number;
  };
  return row.id;
}

/** 写一条互动数据快照(同 article 同日幂等覆盖)。 */
export function upsertSnapshot(articleId: number, capturedAt: number, capturedDay: string, s: SnapshotStats): void {
  getDb()
    .prepare(`
      INSERT INTO stat_snapshots
        (article_id, captured_at, captured_day, read_uv, like_cnt, zaikan_cnt, comment_cnt, share_uv, collection_uv, follow_uv)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_id, captured_day) DO UPDATE SET
        captured_at = excluded.captured_at,
        read_uv = excluded.read_uv, like_cnt = excluded.like_cnt, zaikan_cnt = excluded.zaikan_cnt,
        comment_cnt = excluded.comment_cnt, share_uv = excluded.share_uv, collection_uv = excluded.collection_uv,
        follow_uv = excluded.follow_uv;
    `)
    .run(
      articleId,
      capturedAt,
      capturedDay,
      s.read_uv,
      s.like_cnt,
      s.zaikan_cnt,
      s.comment_cnt,
      s.share_uv,
      s.collection_uv,
      s.follow_uv
    );
}

/** upsert 单篇留言正文(按 article_id + content_id 幂等覆盖)。返回写入条数。 */
export function upsertArticleComments(articleId: number, comments: readonly ArticleComment[]): number {
  if (comments.length === 0) return 0;
  const capturedAt = Math.floor(Date.now() / 1000);
  const stmt = getDb().prepare(`
    INSERT INTO article_comments (
      article_id, content_id, nick_name, content, like_num, is_elected,
      ip_wording, post_time, reply_json, captured_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id, content_id) DO UPDATE SET
      nick_name = excluded.nick_name,
      content = excluded.content,
      like_num = excluded.like_num,
      is_elected = excluded.is_elected,
      ip_wording = excluded.ip_wording,
      post_time = excluded.post_time,
      reply_json = excluded.reply_json,
      captured_at = excluded.captured_at;
  `);
  for (const comment of comments) {
    stmt.run(
      articleId,
      comment.content_id,
      comment.nick_name,
      comment.content,
      comment.like_num,
      boolInt(comment.is_elected),
      comment.ip_wording,
      comment.post_time,
      jsonString(comment.reply ?? null),
      capturedAt
    );
  }
  return comments.length;
}

/** upsert 视频号视频元数据(按 objectId 幂等)。 */

export interface PublishedArticle {
  title: string;
  publish_time: number | null;
}

/** 取 publish_time ≥ sinceTs 的已发布文章(标题 + 发布时间),按时间倒序。供取关 × 内容分析用。 */
export function getArticlesPublishedSince(sinceTs: number): PublishedArticle[] {
  return getDb()
    .prepare('SELECT title, publish_time FROM articles WHERE publish_time >= ? ORDER BY publish_time DESC')
    .all(sinceTs) as unknown as PublishedArticle[];
}
