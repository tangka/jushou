import type { ProseEvidence, ProseFinding } from './prose-patterns.js';

const LIMITS = { paragraphHan: 24, factBlockHan: 12, repeatedClosures: 3, closureShare: 0.5 } as const;
const REACTION =
  /哈哈|好好好|好家伙|嘿|行啊|离谱|爽|封神|就是神|神了|高兴|满意|喜欢|嫌弃|服了|真香|得意|嘚瑟|惊喜|解渴|划算|省心|值得|实在|够了|就对了|真好|痛快/u;
// 这里只识别事实/操作线索，不宣称这些句子已核实。
const FACT_CUE =
  /\d|[一二三四五六七八九十两]+(?:元|天|次|张|小时)|公告|发布|推出|上线|更新|支持|显示|记录|宣布|到账|归零|实测|(?:从|由).{1,24}(?:改|变|降|涨)成?/u;
const EXPLANATION = /也就是说|换句话说|大意是|意思是|因为|毕竟|意味着/u;
const CLOSURE =
  /^(?:所以|因此|总之|看来|这回|这下|这就|好好好)|可以了|明白了|(?:这(?:才|样|下)?|终于|总算).{0,8}(?:像样|踏实|够意思|没白等|服气)|(?:这个|这套|这种).{0,8}我(?:认|买账|服)/u;
type Sentence = { text: string; question: boolean };

function sentences(text: string): Sentence[] {
  return Array.from(text.matchAll(/([^。！？!?]+)([。！？!?]+|$)/gu), match => ({
    text: match[1]?.trim() ?? '',
    question: /[？?]/u.test(match[2] ?? ''),
  })).filter(item => item.text);
}
const hook = (sentence: Sentence | undefined) =>
  Boolean(sentence && (sentence.question || REACTION.test(sentence.text)));
const closure = (sentence: Sentence | undefined) =>
  Boolean(sentence && (sentence.question || REACTION.test(sentence.text) || CLOSURE.test(sentence.text)));

function paragraphs(text: string): ProseEvidence[] {
  const result: ProseEvidence[] = [];
  let current: ProseEvidence | undefined;
  const flush = () => {
    if (current) result.push(current);
    current = undefined;
  };
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim() || /^[ \t]*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\|)/u.test(line)) {
      flush();
      continue;
    }
    if (current) current.excerpt += `\n${line.trim()}`;
    else current = { line: index + 1, excerpt: line.trim() };
  }
  flush();
  return result;
}

/** 比较段落功能组合，并识别拆成短段的同一循环；不通过相似段长推断质量。 */
export function paragraphTemplate(text: string): ProseFinding | undefined {
  const blocks = paragraphs(text);
  const eligible = blocks.filter(item => (item.excerpt.match(/\p{Script=Han}/gu)?.length ?? 0) >= LIMITS.paragraphHan);
  const shapes = new Map<string, ProseEvidence[]>();
  const add = (shape: string, paragraph: ProseEvidence) => shapes.set(shape, [...(shapes.get(shape) ?? []), paragraph]);
  for (const paragraph of eligible) {
    const parts = sentences(paragraph.excerpt);
    if (parts.length < 2) continue;
    const middle = parts
      .slice(1, -1)
      .map(item => item.text)
      .join('。');
    const earlier = parts
      .slice(0, -1)
      .map(item => item.text)
      .join('。');
    if (
      parts.length >= 3 &&
      hook(parts[0]) &&
      (FACT_CUE.test(middle) || EXPLANATION.test(middle)) &&
      closure(parts.at(-1))
    ) {
      add('反应开场→解释/事实→评价收尾', paragraph);
    } else if (FACT_CUE.test(earlier) && closure(parts.at(-1))) {
      add('事实铺陈→评价收尾', paragraph);
    }
  }
  const repeated = [...shapes.entries()].filter(
    ([, items]) => items.length >= LIMITS.repeatedClosures && items.length / eligible.length >= LIMITS.closureShare
  );
  const splitCycles: ProseEvidence[] = [];
  for (let index = 0; index + 2 < blocks.length; index += 1) {
    const first = blocks[index];
    const middle = blocks[index + 1];
    const last = blocks[index + 2];
    if (!first || !middle || !last) continue;
    const lead = sentences(first.excerpt);
    const ending = sentences(last.excerpt);
    if (
      lead.length !== 1 ||
      ending.length !== 1 ||
      !hook(lead[0]) ||
      !closure(ending[0]) ||
      !FACT_CUE.test(middle.excerpt) ||
      (middle.excerpt.match(/\p{Script=Han}/gu)?.length ?? 0) < LIMITS.factBlockHan
    )
      continue;
    splitCycles.push({ line: first.line, excerpt: [first.excerpt, middle.excerpt, last.excerpt].join('\n\n') });
    index += 2;
  }
  if (
    splitCycles.length >= LIMITS.repeatedClosures &&
    (splitCycles.length * 3) / blocks.length >= LIMITS.closureShare
  ) {
    repeated.push(['拆段后的反应→事实→评价循环', splitCycles]);
  }
  if (!repeated.length) return undefined;
  return {
    id: 'paragraph-template',
    severity: 'review',
    message:
      `段落闭合形状重复：${repeated.map(([shape, items]) => `${items.length} 组“${shape}”`).join('；')}。` +
      '逐组比较各处推进的内容或情绪；不能只换情绪词、改句长或拆段消除提醒。',
    evidence: repeated.flatMap(([, items]) => items).sort((a, b) => a.line - b.line),
  };
}
