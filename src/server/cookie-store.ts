import { type CookieEntity, getMpCookie, type StoredCookie, setMpCookie } from './kv-cookie.js';

/** 一个账号的 set-cookie 集合 + token。负责解析/拼接 cookie 字符串。 */
export class AccountCookie {
  private readonly _token: string;
  private _cookie: CookieEntity[];

  constructor(token: string, cookies: string[]) {
    this._token = token;
    this._cookie = AccountCookie.parse(cookies);
  }

  static create(token: string, cookies: CookieEntity[]): AccountCookie {
    const value = new AccountCookie(token, []);
    value._cookie = cookies;
    return value;
  }

  get token(): string {
    return this._token;
  }

  toString(): string {
    return this._cookie
      .filter(c => c.value && c.value !== 'EXPIRED')
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
  }

  toJSON(): StoredCookie {
    return { token: this._token, cookies: this._cookie };
  }

  /** 把 response.headers.getSetCookie() 的字符串数组解析为属性对象数组(按 name 去重)。 */
  static parse(cookies: string[]): CookieEntity[] {
    const cookieMap = new Map<string, CookieEntity>();
    for (const cookie of cookies) {
      const parts = cookie.split(';').map(s => s.trim());
      const nameValue = parts[0];
      if (!nameValue) continue;

      const eq = nameValue.indexOf('=');
      if (eq < 0) continue;
      const name = nameValue.slice(0, eq).trim();
      if (!name) continue;

      const entity: CookieEntity = { name, value: nameValue.slice(eq + 1).trim() };
      for (const part of parts.slice(1)) {
        const partEq = part.indexOf('=');
        const key = (partEq < 0 ? part : part.slice(0, partEq)).trim().toLowerCase();
        const val = partEq < 0 ? '' : part.slice(partEq + 1).trim();
        if (!key) continue;
        entity[key] = val || 'true';
        if (key === 'expires' && val) {
          const ts = Date.parse(val);
          if (!Number.isNaN(ts)) entity.expires_timestamp = ts;
        }
      }
      cookieMap.set(name, entity);
    }
    return Array.from(cookieMap.values());
  }
}

/** 所有 authKey 的 cookie 仓库:内存 LRU + KV 持久化。 */
class CookieStore {
  private readonly store = new Map<string, AccountCookie>();
  private readonly maxSize = 1000;

  private async getAccountCookie(authKey: string): Promise<AccountCookie | null> {
    const cached = this.store.get(authKey);
    if (cached) {
      // LRU:命中移到末尾
      this.store.delete(authKey);
      this.store.set(authKey, cached);
      return cached;
    }
    const value = await getMpCookie(authKey);
    if (!value) return null;
    const account = AccountCookie.create(value.token, value.cookies);
    this.evictIfNeeded();
    this.store.set(authKey, account);
    return account;
  }

  async getCookie(authKey: string): Promise<string | null> {
    const account = await this.getAccountCookie(authKey);
    return account ? account.toString() : null;
  }

  async getToken(authKey: string): Promise<string | null> {
    const account = await this.getAccountCookie(authKey);
    return account ? account.token : null;
  }

  async setCookie(authKey: string, token: string, cookies: string[]): Promise<boolean> {
    const account = new AccountCookie(token, cookies);
    this.store.delete(authKey);
    this.evictIfNeeded();
    this.store.set(authKey, account);
    return setMpCookie(authKey, account.toJSON());
  }

  private evictIfNeeded(): void {
    while (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

export const cookieStore = new CookieStore();
