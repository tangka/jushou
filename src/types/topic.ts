import { z } from 'zod';

// 选题双轴固定词表(ADR 0005)。改词表即改这里,分析/打标都引用此处,禁止散落硬编码。

/** 体裁:号内拉开阅读差距的第一轴。 */
export const CONTENT_TYPES = ['快讯', '实用', '教程', '观点', '深度', '实战', '友商评测', '话题'] as const;

/** 对象:写的是哪个产品/厂商。 */
export const SUBJECTS = ['Codex', 'Claude', 'Cursor', 'Gemini', 'OpenAI', 'Anthropic', '其他'] as const;

export const contentTypeSchema = z.enum(CONTENT_TYPES);
export const subjectSchema = z.enum(SUBJECTS);

export type ContentType = z.infer<typeof contentTypeSchema>;
export type Subject = z.infer<typeof subjectSchema>;

/** 发布载体:由微信 item_show_type 推出(0=文章 / 8=贴图 / 5=视频,其余=其他)。 */
export const MEDIA_TYPES = ['文章', '贴图', '视频', '其他'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export function mediaTypeOf(itemShowType: number | string | undefined): MediaType {
  switch (Number(itemShowType)) {
    case 0:
      return '文章';
    case 8:
      return '贴图';
    case 5:
      return '视频';
    default:
      return '其他';
  }
}
