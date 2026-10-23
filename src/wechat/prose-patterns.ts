import { authorProse } from './editorial-process-guard.js';
import { performedEmotion } from './prose-rhetoric.js';
import { paragraphTemplate } from './prose-rhythm.js';
import { preciseTimes } from './prose-time-patterns.js';

export type ProseEvidence = { line: number; excerpt: string };
export type ProseFinding = {
  id: 'performed-emotion' | 'precision-overload' | 'transition-overload' | 'paragraph-template';
  severity: 'block' | 'review';
  message: string;
  evidence: ProseEvidence[];
};

// 修改识别、排除范围或阈值时必须递增；复核记录不能沿用旧规则版本。
export const PROSE_PATTERN_VERSION = '2026-10-20.2';
const LIMITS = {
  precisionCount: 3,
  clusterCharacters: 800,
  transitionCount: 3,
  transitionsPerThousand: 3.5,
} as const;

// 按“改述、推论、作者导览、评价确认”组合，不收集整句作为命中表。
const TRANSITION =
  /紧接着|也就是说|换句话说|换言之|(?:换|改)(?:个|一种)(?:说法|讲法|角度)|翻译成(?:人话|大白话|白话)|这(?:也|就|其实){0,2}(?:意味着|说明|等于|相当于)|由此可见|这(?:一)?点我(?:尤其|特别|最)?(?:满意|喜欢|在意)|(?:这个细节|这一点|这一处)(?:尤其|特别|最|格外)?(?:让|令)我[^，,。！？!?\n]{1,8}|往下看|(?:接下来)?再来(?:看看|说说)|再往(?:前|下)(?:推|说)一步/gu;

export type ProseOccurrence = ProseEvidence & { offset: number; key?: string };

function occurrences(text: string, pattern: RegExp): ProseOccurrence[] {
  return Array.from(text.matchAll(pattern), match => ({
    line: text.slice(0, match.index).split('\n').length,
    excerpt: match[0],
    offset: match.index,
  }));
}

function clustered(items: ProseOccurrence[], minimum: number, distinct = false): ProseOccurrence[] {
  const selected = new Set<ProseOccurrence>();
  for (const first of items) {
    const window = items.filter(
      item => item.offset >= first.offset && item.offset - first.offset <= LIMITS.clusterCharacters
    );
    const count = distinct ? new Set(window.map(item => item.key ?? item.excerpt)).size : window.length;
    if (count >= minimum) for (const item of window) selected.add(item);
  }
  return [...selected];
}

function evidence(items: ProseEvidence[]): ProseEvidence[] {
  return items.map(({ line, excerpt }) => ({ line, excerpt }));
}

export function inspectProsePatterns(markdown: string): ProseFinding[] {
  // 与原门禁共用引文/代码边界，保持行号；纯 text 围栏中的作者文字仍检查。
  const text = authorProse(
    markdown.replace(/<a\b(?=[^>]*\bdata-miniprogram-appid)[^>]*>[\s\S]*?<\/a>/giu, value =>
      value.replace(/[^\n]/gu, ' ')
    )
  ).replace(/^[ \t]*#{1,6}[ \t]+.*$/gmu, '');
  const findings: ProseFinding[] = [];
  const performed = performedEmotion(text);
  if (performed) findings.push(performed);
  const times = clustered(preciseTimes(text), LIMITS.precisionCount, true);
  if (times.length) {
    findings.push({
      id: 'precision-overload',
      severity: 'review',
      message:
        '局部堆叠至少三个不同秒级时刻。逐项说明秒数如何改变判断、操作或故障因果；只为展示监测完整性应移至内部记录。',
      evidence: evidence(times),
    });
  }
  const transitions = occurrences(text, TRANSITION);
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  if (
    transitions.length >= LIMITS.transitionCount &&
    (clustered(transitions, LIMITS.transitionCount).length > 0 ||
      (transitions.length * 1000) / Math.max(han, 1) >= LIMITS.transitionsPerThousand)
  ) {
    findings.push({
      id: 'transition-overload',
      severity: 'review',
      message: '衔接与确认句密集。逐项检查是否确有因果/时间转折，还是把已说清的事实又确认一遍。',
      evidence: evidence(transitions),
    });
  }
  const template = paragraphTemplate(text);
  if (template) findings.push(template);
  return findings;
}

export function formatProseFindings(findings: ProseFinding[]): string {
  return findings
    .map(
      finding =>
        `- [${finding.id}] ${finding.message}\n` +
        finding.evidence.map(item => `  第 ${item.line} 行：${item.excerpt}`).join('\n')
    )
    .join('\n');
}
