import type { ProseEvidence, ProseFinding } from './prose-patterns.js';

type Span = ProseEvidence & { offset: number; end: number; hard: boolean };
const FIRST_PERSON = '(?:我(?:们)?|咱(?:们)?|我?自己|本人)';
const PERMISSION = `(?:我(?:先|也)?(?:允许|准许|准)自己|(?:请)?(?:容许|允许|准许|准|容|让)${FIRST_PERSON})`;
const MODIFIER = '(?:先|再|小小地|稍微|短暂地|放肆地){0,2}';
const PRIDE = '(?:嘚瑟|得意|骄傲|膨胀)';
const DURATION = '(?:一下|一会儿?|一回|[一二三四五六七八九十\\d]+秒钟?)?';
const HARD_STAGE = new RegExp(`${PERMISSION}${MODIFIER}${PRIDE}${DURATION}`, 'gu');
// 保留已明确否定样本的硬失败级别；同类变体由下方角色结构识别，不靠扩充整句列表。
const REJECTED_EXAMPLE = /锅铲你拿着[，,、\s]*额度我收下/gu;
const STAGE_PATTERNS = [
  new RegExp(`${PERMISSION}${MODIFIER}(?:叉(?:一?会儿?|一下)?腰|鼓(?:个|一下)?掌|喝(?:个|一下)?彩)`, 'gu'),
  /(?:我(?:得|要|决定|打算)?(?:先|也)?|(?:开头|开场|现在|这回)?先)(?:给|为)(?:我?自己|本人)(?:鼓(?:个|一下)?掌|喝(?:个|一下)?彩|点(?:个|一下)?赞)/gu,
  /我(?:先|现在|要先|在这里)(?:宣布|声明)(?:一下)?[：:\s]*(?:今天|此刻|这次)?的?(?:快乐|开心|幸福|兴奋|激动)[^，,。！？!?；;\n]{0,24}/gu,
];
const NEGATED_PREFIX = /(?:不|没|别|无需|何必|何须)(?:会|想|要|能|必|打算|准备|再|先|去|在这里){0,3}$/u;
const OTHER_ACTOR = '你们?|厂商|官方|平台|团队|公司|开发者';
const SELF_ACTOR = '我们?|咱们?';
const ACTOR = `(?:${OTHER_ACTOR}|${SELF_ACTOR})`;
const ASSIGNMENT = /^(.{1,18}?)(?:留给|交给|归)([\p{L}\p{N}_]{1,24}?)(?:就好|好了)?$/u;
const ACTION_ROLE = new RegExp(`^(.{0,12}?)(${ACTOR})(.{1,32})$`, 'u');
const NAMED_ROLE = /^([\p{L}\p{N}_ .-]{1,24}?)(负责|只管|继续|尽管)(.{1,32})$/u;
const ROLE_ACTION = /负责|只管|继续|尽管|拿|收|领|占|揣|享|吃|赚|省|全收|来做/u;
const BENEFIT = /福利|优惠|折扣|好处|甜头|额度|实惠|红利|便宜|礼包|快乐|省下的钱|免费.{0,8}(?:算力|服务|资源)/u;
const RECEIVING = /拿|收|领|占|揣|享|吃|赚|省|归|留给/u;
const ADMINISTRATIVE =
  /^(?:(?:负责|只管|先|就|来|去|把|为|帮)[\s]*)*(?:核对|核查|检查|确认|验证|测试|记录|整理|发放|发送|转发|通知|设计|实现)/u;
const SELF = new RegExp(`^(?:${SELF_ACTOR})$`, 'u');
const CLAUSE = /[^，,。！？!?；;：:\n]+/gu;

function matchSpan(text: string, match: RegExpMatchArray, hard: boolean): Span | undefined {
  const offset = match.index ?? 0;
  const prefix =
    text
      .slice(0, offset)
      .split(/[，,。！？!?；;：:\n]/u)
      .at(-1)
      ?.trim() ?? '';
  if (NEGATED_PREFIX.test(prefix)) return undefined;
  // “他先给自己鼓掌”是叙事动作，不冒充当前作者给读者报幕。
  if (!/^(?:我|咱)/u.test(match[0]) && /(?:他|她|别人|作者|用户)[^，,。！？!?\n]{0,12}$/u.test(prefix))
    return undefined;
  return {
    offset,
    end: offset + match[0].length,
    line: text.slice(0, offset).split('\n').length,
    excerpt: match[0],
    hard,
  };
}

function role(clause: string): { self: boolean; receives: boolean } | undefined {
  const assignment = clause.match(ASSIGNMENT);
  const action = clause.match(ACTION_ROLE);
  const named = clause.match(NAMED_ROLE);
  const actor = assignment?.[2] ?? action?.[2] ?? named?.[1];
  const actionText = action?.[3] ?? (named ? `${named[2]}${named[3]}` : '');
  if (!actor || (!assignment && !ROLE_ACTION.test(actionText))) return undefined;
  const operates = ADMINISTRATIVE.test(actionText);
  return { self: SELF.test(actor), receives: !operates && BENEFIT.test(clause) && RECEIVING.test(clause) };
}

/** 识别角色对偶及收好处的落点，物件/产品名不参与规则；真实分工不因“你/我”被禁。 */
function roleSplits(text: string): Span[] {
  const clauses = Array.from(text.matchAll(CLAUSE), match => {
    const offset = match.index + match[0].length - match[0].trimStart().length;
    const value = match[0].trim();
    return { offset, end: offset + value.length, value, role: role(value) };
  });
  const results: Span[] = [];
  for (let index = 0; index + 1 < clauses.length; index += 1) {
    const first = clauses[index];
    const second = clauses[index + 1];
    if (!first?.role || !second?.role || first.role.self === second.role.self) continue;
    if (!(first.role.self ? first.role.receives : second.role.receives)) continue;
    if (/\n[ \t]*\n/u.test(text.slice(first.end, second.offset))) continue;
    // 否定一个套路不等于正在使用它；范围仅限这两个分句。
    if (/(?:不|没|别|无需)(?:会|想|要|必|再)?(?:负责|只管|继续|尽管|拿|收|领|占|享)/u.test(first.value + second.value))
      continue;
    results.push({
      offset: first.offset,
      end: second.end,
      line: text.slice(0, first.offset).split('\n').length,
      excerpt: text.slice(first.offset, second.end),
      hard: false,
    });
  }
  return results;
}

export function performedEmotion(text: string): ProseFinding | undefined {
  const spans = [
    ...Array.from(text.matchAll(HARD_STAGE), match => matchSpan(text, match, true)),
    ...Array.from(text.matchAll(REJECTED_EXAMPLE), match => matchSpan(text, match, true)),
    ...STAGE_PATTERNS.flatMap(pattern => Array.from(text.matchAll(pattern), match => matchSpan(text, match, false))),
    ...roleSplits(text),
  ].filter((span): span is Span => Boolean(span));
  const unique: Span[] = [];
  for (const span of spans.sort((a, b) => Number(b.hard) - Number(a.hard) || a.offset - b.offset)) {
    if (!unique.some(item => span.offset < item.end && span.end > item.offset)) unique.push(span);
  }
  unique.sort((a, b) => a.offset - b.offset);
  if (!unique.length) return undefined;
  const hard = unique.some(item => item.hard);
  return {
    id: 'performed-emotion',
    severity: hard ? 'block' : 'review',
    message: hard
      ? '请求/给予自己自夸许可的报幕套式或已明确否定的接梗原句，须修改；同时检出的其他动作报幕或角色接梗需按语境复核。'
      : '情绪动作报幕，或“他方造势/行动—作者收好处”的角色对偶。核对是否由具体事件产生，是否只是给作者安排一个表情或金句。',
    evidence: unique.map(({ line, excerpt }) => ({ line, excerpt })),
  };
}
