import { z } from 'zod';
import type { ChannelRawCapture } from '../types/channels.js';

const bindInfoSchema = z.array(
  z
    .object({
      bizInfo: z
        .object({
          name: z.string().optional().default(''),
        })
        .passthrough()
        .optional(),
    })
    .passthrough()
);

export function channelAccountNames(captures: readonly Pick<ChannelRawCapture, 'json'>[]): string[] {
  const names = new Set<string>();
  for (const capture of captures) {
    const parsed = z
      .object({
        data: z
          .object({
            bindInfo: z.unknown().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .safeParse(capture.json);
    if (!parsed.success) continue;

    const bindInfo = bindInfoSchema.safeParse(parsed.data.data?.bindInfo);
    if (!bindInfo.success) continue;
    for (const item of bindInfo.data) {
      const name = item.bizInfo?.name.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

/**
 * 视频号页面可以让扫码者切到另一个绑定账号。任何落库前必须用 post_list.bindInfo
 * 核对当前账号；无法核对、出现多个账号或账号不匹配时都 fail closed。
 */
export function assertChannelAccountIdentity(
  captures: readonly Pick<ChannelRawCapture, 'json'>[],
  expectedAccount: string
): string {
  const expected = expectedAccount.trim();
  const actual = channelAccountNames(captures);
  if (actual.length === 0) {
    throw new Error(`无法核对视频号账号(期望:${expected}),拒绝写入`);
  }
  if (actual.length !== 1 || actual[0] !== expected) {
    throw new Error(`视频号账号不匹配:期望 ${expected},实际 ${actual.join('、')};拒绝写入`);
  }
  return actual[0];
}
