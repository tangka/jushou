/**
 * 解码常见 HTML 实体。微信接口返回的标题可能是实体编码(如 `It&#39;s`、`A&amp;B`),
 * 落库/写 md 前需解码,否则报告里显示乱码、且与流量主返回的明文标题对不上。
 */
export function decodeHtmlEntities(input: unknown): string {
  return String(input ?? '')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // 放最后,避免把已解码内容里的 & 二次误解
}

/** 文件名安全化:去掉非法字符、压缩空白、截断到 90 字。 */
export function safeName(input: unknown, fallback = 'untitled'): string {
  const cleaned = String(input || fallback)
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

/** CSV 字段转义:含 `"` / `,` / 换行 时加引号并双写引号。 */
export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * Obsidian 表格内文本转义:`|` → `\|`(否则被当成列分隔符导致错位,见 CLAUDE.md),并压缩空白。
 */
export function mdEscape(value: unknown): string {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

/** frontmatter 值用 JSON 字符串安全输出(等价于带引号转义的 YAML 标量)。 */
export function yamlString(value: unknown): string {
  return JSON.stringify(value === null || value === undefined ? '' : String(value));
}

/** 统计 HTML 中 `<img>` 数量。 */
export function countImageRefs(html: unknown): number {
  return (String(html || '').match(/<img\b/gi) || []).length;
}

/** 从微信图片 URL / content-type 猜测扩展名。 */
export function guessImageExt(url: string, contentType = ''): string {
  const fmt = new URL(url).searchParams.get('wx_fmt');
  if (fmt)
    return (
      fmt
        .replace('jpeg', 'jpg')
        .replace(/[^a-z0-9]/gi, '')
        .toLowerCase() || 'jpg'
    );
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  return 'jpg';
}
