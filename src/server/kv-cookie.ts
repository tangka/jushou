import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';

/** 一条 set-cookie 解析后的属性集合(name/value + path/expires/...)。 */
export type CookieEntity = Record<string, string | number>;

/** KV 里一个 authKey 对应的存储值:与原项目格式一致,enrich 直接读。 */
export interface StoredCookie {
  token: string;
  cookies: CookieEntity[];
}

function cookieFile(authKey: string): string {
  return path.join(config.kvBase, 'cookie', authKey);
}

async function readCookieFile(file: string): Promise<StoredCookie | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as StoredCookie;
  } catch {
    return null;
  }
}

async function siblingKvBases(): Promise<string[]> {
  const parent = path.dirname(config.kvBase);
  const bases = [config.kvBase];
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name !== 'kv' && !entry.name.startsWith('kv-')) continue;
      bases.push(path.join(parent, entry.name));
    }
  } catch {
    // 扫不到兄弟 KV 时退化为只读当前账号 KV。
  }
  return [...new Set(bases)];
}

/** 写入 `<NITRO_KV_BASE>/cookie/<authKey>`(纯 JSON 文件)。 */
export async function setMpCookie(authKey: string, data: StoredCookie): Promise<boolean> {
  try {
    const file = cookieFile(authKey);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('写入 KV cookie 失败:', err);
    return false;
  }
}

/** 读 `<NITRO_KV_BASE>/cookie/<authKey>`;单入口服务下会按 authKey 兼容读取其他账号 KV。 */
export async function getMpCookie(authKey: string): Promise<StoredCookie | null> {
  const current = await readCookieFile(cookieFile(authKey));
  if (current) return current;

  for (const base of await siblingKvBases()) {
    if (base === config.kvBase) continue;
    const value = await readCookieFile(path.join(base, 'cookie', authKey));
    if (value) return value;
  }
  return null;
}
