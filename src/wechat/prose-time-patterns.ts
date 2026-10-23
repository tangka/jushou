import type { ProseOccurrence } from './prose-patterns.js';

const NUMBER = '[0-9０-９零〇一二三四五六七八九十两]{1,3}';
const CLOCK = new RegExp(
  `(?<![0-9０-９])(?:${NUMBER}[ \\t]*[:：][ \\t]*${NUMBER}[ \\t]*[:：][ \\t]*${NUMBER}(?:[.．][0-9０-９]+)?|` +
    `${NUMBER}[ \\t]*[时点][ \\t]*${NUMBER}[ \\t]*分[ \\t]*${NUMBER}[ \\t]*秒)`,
  'gu'
);
const DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function clockNumber(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value);
  if (value.includes('十')) {
    const [tens, units] = value.split('十');
    return (tens ? (DIGITS[tens] ?? Number.NaN) : 1) * 10 + (units ? (DIGITS[units] ?? Number.NaN) : 0);
  }
  if ([...value].every(char => DIGITS[char] !== undefined))
    return Number([...value].map(char => DIGITS[char]).join(''));
  return Number.NaN;
}

/** 归一只用于同一时刻去重，证据保留原写法、空格及行号。 */
export function preciseTimes(text: string): ProseOccurrence[] {
  return Array.from(text.matchAll(CLOCK)).flatMap(match => {
    const normalized = match[0].normalize('NFKC').replace(/[ \t]/gu, '');
    const parts = normalized.split(/[:时点分秒]/u).filter(Boolean);
    const hour = clockNumber(parts[0] ?? '');
    const minute = clockNumber(parts[1] ?? '');
    const secondParts = (parts[2] ?? '').split('.');
    const second = clockNumber(secondParts[0] ?? '');
    if (!(hour <= 23 && minute <= 59 && second <= 59)) return [];
    const fraction = (secondParts[1] ?? '').replace(/0+$/u, '');
    return [
      {
        line: text.slice(0, match.index).split('\n').length,
        excerpt: match[0],
        offset: match.index,
        key: `${hour}:${minute}:${second}${fraction ? `.${fraction}` : ''}`,
      },
    ];
  });
}
