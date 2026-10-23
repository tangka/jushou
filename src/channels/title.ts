interface ChannelVideoTitleSource {
  description?: unknown;
  shortTitle?: unknown;
}

const TITLE_KEYS = ['shortTitle', 'short_title', 'title', 'name', 'description', 'desc'] as const;

function isInternalIdentifier(value: string): boolean {
  const normalized = value.replaceAll('\\', '/');
  return /^(?:export|finder|object|video)\//i.test(normalized) || /^https?:\/\//i.test(normalized);
}

function parseJsonValue(value: string): unknown {
  if (!/^[{[]/.test(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function firstReadableTitle(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (!trimmed) return '';
    if (/^(?:null|undefined)$/i.test(trimmed)) return '';
    const parsed = parseJsonValue(trimmed);
    if (parsed !== trimmed) return firstReadableTitle(parsed, depth + 1);
    return isInternalIdentifier(trimmed) ? '' : trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const title = firstReadableTitle(item, depth + 1);
      if (title) return title;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  for (const key of TITLE_KEYS) {
    const title = firstReadableTitle(record[key], depth + 1);
    if (title) return title;
  }
  return '';
}

/**
 * 视频号标题优先级:正文描述 → 短标题。
 * export/objectId 是内部标识,只能用于定位记录,绝不能展示给用户。
 */
export function resolveChannelVideoTitle(source: ChannelVideoTitleSource): string {
  return firstReadableTitle(source.description) || firstReadableTitle(source.shortTitle) || '未命名视频';
}
