import { z } from 'zod';

// 小程序流量主先按独立收入源建模,避免污染公众号流量主的选题收益矩阵。
// 导入格式兼容手工整理的 capture JSON;后续接真实接口时仍落同一组结构。

const moneySchema = z.union([z.number(), z.string()]).transform(value => {
  if (typeof value === 'number') return value;
  const normalized = value.replace(/[¥￥,，]/g, '').trim();
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error(`金额非法:${value}`);
  return n;
});

export const appletRevenueDailySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    incomeCents: z.coerce.number().int().optional(),
    incomeYuan: moneySchema.optional(),
    pullCount: z.coerce.number().int().optional().default(0),
    exposureCount: z.coerce.number().int().optional().default(0),
    clickCount: z.coerce.number().int().optional().default(0),
    ecpmYuan: moneySchema.optional(),
    raw: z.unknown().optional(),
  })
  .passthrough();
export type AppletRevenueDailyInput = z.infer<typeof appletRevenueDailySchema>;

export const appletRevenueOverviewSchema = z
  .object({
    appid: z.string().trim().min(1).optional(),
    name: z.string().optional().default(''),
    yesterdayCents: z.coerce.number().int().optional(),
    yesterdayIncomeYuan: moneySchema.optional(),
    weekCents: z.coerce.number().int().optional(),
    weekIncomeYuan: moneySchema.optional(),
    totalCents: z.coerce.number().int().optional(),
    totalIncomeYuan: moneySchema.optional(),
    dateRangeStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
    dateRangeEnd: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .nullable(),
    raw: z.unknown().optional(),
  })
  .passthrough();
export type AppletRevenueOverviewInput = z.infer<typeof appletRevenueOverviewSchema>;

export const appletRevenueCaptureSchema = z
  .object({
    overview: appletRevenueOverviewSchema.optional(),
    daily: z.array(appletRevenueDailySchema).optional().default([]),
  })
  .passthrough();
export type AppletRevenueCaptureInput = z.infer<typeof appletRevenueCaptureSchema>;
