type DateInput = number | string | null | undefined;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** unix 秒 / 字符串 → `YYYY-MM-DD HH:mm`;无法解析则原样返回。 */
export function toDateTime(value: DateInput): string {
  if (value === null || value === undefined || value === '') return '';
  const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** unix 秒 / 字符串 → `YYYY-MM-DD`。 */
export function toDate(value: DateInput): string {
  return toDateTime(value).slice(0, 10);
}

/** 归一化为 unix 秒(数字原样;数字字符串转数字;日期串 Date.parse);无法解析返回 null。 */
export function toUnixSeconds(value: DateInput): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const n = Number(value);
  if (!Number.isNaN(n)) return n;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
