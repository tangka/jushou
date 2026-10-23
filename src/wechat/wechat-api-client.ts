import { config } from '../config/index.js';
import { getWechatAccessToken, postWechatJson, WechatApiError } from './draft-api.js';

export async function callWechatJsonApi(
  endpoint: string,
  body: Record<string, unknown>,
  action: string
): Promise<Record<string, unknown>> {
  const accessToken = await getWechatAccessToken();
  return postWechatJson(
    `${config.wechatApi.baseUrl}${endpoint}?access_token=${encodeURIComponent(accessToken)}`,
    body,
    action
  );
}

export function isWechatMissingMediaError(error: unknown): boolean {
  return error instanceof WechatApiError && error.errcode === 40007;
}
