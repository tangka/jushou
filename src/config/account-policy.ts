import { z } from 'zod';
import { getOperatorAccount, loadOperatorProfile } from './operator-profile.js';

const miniProgramSchema = z
  .object({
    required: z.boolean().default(false),
    textOnly: z.boolean().default(false),
    appid: z
      .string()
      .regex(/^wx[a-z0-9]{16}$/iu)
      .optional(),
    path: z.string().trim().min(1).optional(),
    nickname: z.string().trim().min(1).optional(),
  })
  .refine(value => Boolean(value.appid) === Boolean(value.path), '小程序目标必须同时配置 appid 和 path');

const policySchema = z.object({
  dailyPublication: z.enum(['draft', 'publish']).default('draft'),
  newsOnly: z.boolean().default(false),
  routingGuards: z
    .array(
      z.object({
        owner: z.string().trim().min(1),
        pattern: z
          .string()
          .min(1)
          .refine(value => {
            try {
              new RegExp(value, 'u');
              return true;
            } catch {
              return false;
            }
          }, '选题规则不是合法正则表达式'),
      })
    )
    .default([]),
  miniProgram: miniProgramSchema.optional(),
});

/** 未配置账号不继承任何作者专属入口、载体限制或发表授权。 */
export function accountPolicy(account: string | undefined) {
  return policySchema.parse(getOperatorAccount(account)?.policy ?? {});
}

export function accountEditorialInstruction(account: string | undefined, key: string, fallback: string): string {
  const value = getOperatorAccount(account)?.editorial?.[key];
  if (value === undefined) return fallback;
  return z.string().trim().min(1).parse(value);
}

export function configuredDailyAccounts(): Record<string, 'draft' | 'publish'> {
  const profile = loadOperatorProfile();
  return Object.fromEntries(
    profile.accounts.map(account => [account.id, policySchema.parse(account.policy).dailyPublication])
  );
}

export function appletMembershipImports(): Array<{ service: string; marker: string }> {
  // 禁止 GLOB 元字符，保证配置是完整字段前缀，不会扩大收益归类范围。
  const schema = z.array(
    z.object({
      service: z.string().trim().min(1),
      marker: z
        .string()
        .trim()
        .min(1)
        .regex(/^[^*?[\]；]+:$/u),
    })
  );
  return schema.parse(loadOperatorProfile().business.appletMembershipImports ?? []);
}
