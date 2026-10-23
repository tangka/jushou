/**
 * 读 Markdown frontmatter 里某个字段的值(字符串)。无合法 frontmatter 或字段缺失返回 undefined。
 * 兼容 JSON 风格带引号值(upsertFrontmatter 写出的)与裸值(手写 / skill 产出)。
 */
export function readFrontmatterField(markdown: string, key: string): string | undefined {
  if (!markdown.startsWith('---\n')) return undefined;
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) return undefined;

  for (const line of markdown.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match || match[1] !== key) continue;
    const raw = (match[2] ?? '').trim();
    if (raw.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'string') return parsed;
      } catch {
        // 不是合法 JSON 字符串,退回去引号裸值
      }
    }
    return raw.replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

/**
 * 在已有 Markdown 的 frontmatter 里 upsert 指定字段:存在则就地替换、不存在则追加。
 * 不是合法 frontmatter(无开头 `---`)时原样返回。值用 JSON 编码,保证转义安全。
 */
export function upsertFrontmatter(markdown: string, fields: Record<string, unknown>): string {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) return markdown;

  const body = markdown.slice(end + 5);
  const lines = markdown.slice(4, end).split('\n');
  const pending = new Map<string, string>(
    Object.entries(fields).map(([key, value]) => [key, `${key}: ${JSON.stringify(value ?? '')}`])
  );

  const next: string[] = [];
  for (const line of lines) {
    const key = line.match(/^([A-Za-z0-9_]+):/)?.[1];
    const replacement = key ? pending.get(key) : undefined;
    if (replacement !== undefined && key) {
      next.push(replacement);
      pending.delete(key);
    } else {
      next.push(line);
    }
  }
  next.push(...pending.values());
  return `---\n${next.join('\n')}\n---\n${body}`;
}
