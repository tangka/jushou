import { z } from 'zod';

export const toutiaoCaptureTargetSchema = z.enum(['item_list', 'item_stats', 'comments', 'fans', 'income', 'unknown']);
export type ToutiaoCaptureTarget = z.infer<typeof toutiaoCaptureTargetSchema>;

export const toutiaoRawCaptureSchema = z
  .object({
    target: toutiaoCaptureTargetSchema.optional().default('unknown'),
    matchedUrl: z.string().optional().default(''),
    requestBody: z.unknown().optional().default(null),
    json: z.unknown(),
    capturedAt: z.coerce
      .number()
      .int()
      .optional()
      .default(() => Math.floor(Date.now() / 1000)),
  })
  .passthrough();
export type ToutiaoRawCapture = z.infer<typeof toutiaoRawCaptureSchema>;

export interface ToutiaoMetrics {
  readCount: number | null;
  commentCount: number | null;
  likeCount: number | null;
  shareCount: number | null;
  favoriteCount: number | null;
  followCount: number | null;
  incomeCents: number | null;
}

export interface ToutiaoItem {
  itemId: string;
  title: string;
  url: string;
  itemType: string;
  publishTime: number | null;
  status: string;
  abstract: string;
  metrics: ToutiaoMetrics;
  raw: unknown;
}

export interface ToutiaoComment {
  commentId: string;
  itemId: string;
  nickName: string;
  content: string;
  likeCount: number | null;
  replyCount: number | null;
  createTime: number | null;
  status: string;
  raw: unknown;
}
