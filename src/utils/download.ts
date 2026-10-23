import fsp from 'node:fs/promises';
import path from 'node:path';

// 下载远程文件到本地(best-effort)。用于把粉丝头像 URL(wx.qlogo.cn)落盘留存,
// 防止取关/换头像后 URL 失效拿不到。失败返回 false,不抛(调用方批量时不应因单个失败中断)。
export async function downloadToFile(url: string, dest: string, timeoutMs = 15_000): Promise<boolean> {
  if (!url || !url.startsWith('http')) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return false;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) return false;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, buf);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 以小并发跑一批 async 任务(默认 8),收集结果。用于批量下载头像不打爆网络。 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      const item = items[i];
      if (item === undefined) break;
      results[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}
