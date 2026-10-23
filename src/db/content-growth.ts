import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const countSchema = z.number().int().nonnegative().nullable();

const articleSchema = z.object({
  id: z.number().int(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  publishDay: daySchema.nullable(),
  mediaType: z.string().nullable(),
  contentType: z.string().nullable(),
  subject: z.string().nullable(),
});

const snapshotSchema = z.object({
  articleId: z.number().int(),
  capturedDay: daySchema,
  capturedAt: z.number().int(),
  read: countSchema,
  follow: countSchema,
  share: countSchema,
  collection: countSchema,
});

export type GrowthArticle = z.infer<typeof articleSchema>;
export type GrowthSnapshot = z.infer<typeof snapshotSchema>;
export interface ContentGrowthData {
  articles: GrowthArticle[];
  snapshots: GrowthSnapshot[];
  latestSnapshotDay: string | null;
}

/** 独立只读连接；不初始化/迁移数据库，不读取任何收益表或收益字段。 */
export function readContentGrowthData(dbPath: string, fromDay: string, asOfDay: string): ContentGrowthData {
  daySchema.parse(fromDay);
  daySchema.parse(asOfDay);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('BEGIN');
    const articles = articleSchema.array().parse(
      db
        .prepare(`
          SELECT id, title, url, date(publish_time, 'unixepoch', '+8 hours') AS publishDay,
                 media_type AS mediaType, content_type AS contentType, subject
          FROM articles
          WHERE publish_time IS NULL OR date(publish_time, 'unixepoch', '+8 hours') <= ?
          ORDER BY publish_time DESC, id DESC
        `)
        .all(asOfDay)
    );
    const snapshots = snapshotSchema.array().parse(
      db
        .prepare(`
          WITH ranked AS (
            SELECT s.article_id AS articleId, s.captured_day AS capturedDay,
                   s.captured_at AS capturedAt, s.read_uv AS read, s.follow_uv AS follow,
                   s.share_uv AS share, s.collection_uv AS collection,
                   ROW_NUMBER() OVER (
                     PARTITION BY s.article_id, s.captured_day ORDER BY s.captured_at DESC, s.id DESC
                   ) AS rn
            FROM stat_snapshots s JOIN articles a ON a.id = s.article_id
            WHERE date(a.publish_time, 'unixepoch', '+8 hours') BETWEEN ? AND ?
              AND s.captured_day <= ?
              AND s.captured_day IN (
                date(a.publish_time, 'unixepoch', '+8 hours', '+3 days'),
                date(a.publish_time, 'unixepoch', '+8 hours', '+7 days')
              )
          )
          SELECT articleId, capturedDay, capturedAt, read, follow, share, collection
          FROM ranked WHERE rn = 1
        `)
        .all(fromDay, asOfDay, asOfDay)
    );
    const latest = z
      .object({ day: daySchema.nullable() })
      .parse(db.prepare('SELECT MAX(captured_day) AS day FROM stat_snapshots WHERE captured_day <= ?').get(asOfDay));
    db.exec('COMMIT');
    return { articles, snapshots, latestSnapshotDay: latest.day };
  } finally {
    db.close();
  }
}
