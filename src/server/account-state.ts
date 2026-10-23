import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { config } from '../config/index.js';

const loginStateSchema = z
  .object({
    loginAccount: z
      .object({ nickname: z.string().optional().default(''), avatar: z.string().optional().default('') })
      .optional(),
  })
  .passthrough();

export interface StoredAccount {
  nickname: string;
  avatar: string;
}

/** 从 login-state.json 读上次登录的账号名/头像(同步、无网络);缺省回退账号配置名。 */
export function readStoredAccount(options: { loginStatePath?: string; fallbackName?: string } = {}): StoredAccount {
  const loginStatePath = options.loginStatePath ?? config.loginStatePath;
  const fallbackName = options.fallbackName ?? config.accountExact;
  try {
    const raw = JSON.parse(readFileSync(loginStatePath, 'utf8')) as unknown;
    const acc = loginStateSchema.parse(raw).loginAccount;
    return { nickname: acc?.nickname || fallbackName, avatar: acc?.avatar ?? '' };
  } catch {
    return { nickname: fallbackName, avatar: '' };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 把账号名注入 <title>、把头像注入 favicon(<link rel=icon>)。 */
export function injectAccountBranding(html: string, account: StoredAccount): string {
  const title = escapeHtml(account.nickname);
  let out = /<title>[^<]*<\/title>/i.test(html)
    ? html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`)
    : html.replace(/<head>/i, `<head><title>${title}</title>`);
  if (account.avatar) {
    const icon = `<link rel="icon" href="${escapeHtml(account.avatar)}">`;
    // 去掉已有 favicon,再插入头像图标
    out = out.replace(/<link[^>]*rel=["']?(?:shortcut )?icon["']?[^>]*>/gi, '');
    out = out.replace(/<head>/i, `<head>${icon}`);
  }
  return out;
}
