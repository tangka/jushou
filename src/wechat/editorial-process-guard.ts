type TermGroup = { anyOf: readonly string[] };

export type EditorialProcessRequirement = {
  id: string;
  description?: string;
  scope: 'title' | 'body' | 'all';
  allOf: readonly TermGroup[];
};

type ProcessRule = { id: string; description: string; pattern: RegExp };

// 只识别当前稿件的作者过程说明，不把“本机”“测试”“审计”等产品词单独禁用。
const ARTICLE_SUBJECT = '(?:本稿|本文|本篇(?:文章|稿件)?|这篇(?:文章|稿件|稿子)?)';
const LOCAL_CONTEXT = '(?:在|用)(?:本机|本地|当前环境|本地环境|自己的电脑)(?:上)?';
const NO_EXECUTION = '(?:未曾|尚未|并未|没有|没|未)(?:实际|亲自)?';
const PROCESS_RULES: readonly ProcessRule[] = [
  {
    id: 'author-no-execution',
    description: '当前稿件未执行操作的作者过程说明',
    pattern: new RegExp(
      `${ARTICLE_SUBJECT}(?:中)?(?:[，,:：\\s]*(?:我|我们|笔者))?` +
        `(?:并|也|还|仍|暂时)?(?:${LOCAL_CONTEXT}${NO_EXECUTION}|${NO_EXECUTION}${LOCAL_CONTEXT})` +
        '(?:实际|亲自)?(?:执行|运行)',
      'u'
    ),
  },
  {
    id: 'author-no-hands-on',
    description: '当前稿件没有实测的独立作者声明',
    pattern: new RegExp(`${ARTICLE_SUBJECT}${NO_EXECUTION}实测(?=[，,。！？!?；;：:\\n]|$)`, 'u'),
  },
  {
    id: 'author-claim-disclaimer',
    description: '当前稿件如何声明操作结果的作者过程说明',
    pattern: new RegExp(
      `${ARTICLE_SUBJECT}(?:因此|所以)?(?:不会|不能|不)` +
        '(?:把[^。！？!?；;\\n]{1,32}写成|声称|宣称)' +
        '[^。！？!?；;\\n]{0,20}(?:测试|审计|验证)(?:已经|已)?(?:通过|完成|成功)',
      'u'
    ),
  },
];

const CODE_LANGUAGE =
  /^(?:bash|sh|zsh|shell|javascript|js|jsx|typescript|ts|tsx|python|py|ruby|rb|go|rust|rs|java|c|cpp|csharp|cs|swift|kotlin|php|sql|json|jsonc|yaml|yml|toml|xml|html|css|scss|diff|dockerfile|makefile|powershell|ps1|console)$/iu;
const SOURCE_QUOTE_INTENT =
  /(?:引用|直译|翻译|保留)[^。！？!?；;\n]{0,24}(?:原话|原文|引文|译文)|(?:原话|原文|引文|译文)[^。！？!?；;\n]{0,24}(?:引用|直译|翻译|保留)/u;

function blank(value: string): string {
  return value.replace(/[^\n]/gu, ' ');
}

/** 只排除具体引文或代码范围，后续作者句仍逐句检查；引文保真沿用独立审稿门禁。 */
export function authorProse(markdown: string): string {
  const withoutBlocks = markdown
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, blank)
    .replace(/<!--[\s\S]*?-->/gu, blank)
    .replace(/<(pre|code|blockquote)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, blank);
  let fence: { marker: string; length: number; code: boolean } | undefined;
  const lines = withoutBlocks.split('\n').map(line => {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker?.[1]) {
      const token = marker[1];
      if (!fence) {
        fence = {
          marker: token[0] ?? '',
          length: token.length,
          code: CODE_LANGUAGE.test(marker[2]?.trim().split(/\s+/u)[0] ?? ''),
        };
      } else if (token[0] === fence.marker && token.length >= fence.length && !marker[2]?.trim()) {
        fence = undefined;
      }
      return blank(line);
    }
    if (fence?.code || /^[ \t]{0,3}>/u.test(line)) return blank(line);
    return line;
  });
  return lines
    .join('\n')
    .replace(/(`+)[^`\n]*?\1/gu, blank)
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, blank)
    .replace(/!\[\[[^\]\n]+\]\]|!\[[^\]\n]*\]\([^\n)]*\)/gu, blank)
    .replace(/\[([^\]\n]+)\]\([^\n)]*\)/gu, '$1')
    .replace(/<[^>]*>/gu, tag => tag.replace(/[^\n]/gu, ''))
    .replace(/[*_]/gu, '');
}

function processRulesIn(value: string): readonly ProcessRule[] {
  const normalized = value.normalize('NFKC').replace(/[ \t]+/gu, '');
  return PROCESS_RULES.filter(rule => rule.pattern.test(normalized));
}

/** 合同的描述和检索词都属于必写要求，不能借 sourceIds 把作者操作状态变成来源事实。 */
export function collectEditorialProcessRequirementErrors(
  requirements: readonly EditorialProcessRequirement[]
): string[] {
  const errors: string[] = [];
  for (const requirement of requirements) {
    if (requirement.scope === 'title') continue;
    const description = requirement.description ?? '';
    const unquotedRules = processRulesIn(authorProse(description));
    // 明确引用原文且问题句只在具体引文中时，不要求篡改原话；来源真实性仍须独立审稿。
    const quotedRules = SOURCE_QUOTE_INTENT.test(description)
      ? processRulesIn(description).filter(rule => !unquotedRules.includes(rule))
      : [];
    const candidates = [
      description,
      ...requirement.allOf.flatMap(group => group.anyOf),
      requirement.allOf.map(group => group.anyOf.join(' / ')).join(' '),
    ];
    const matched = PROCESS_RULES.filter(
      rule => !quotedRules.includes(rule) && candidates.some(value => processRulesIn(value).includes(rule))
    );
    for (const rule of matched) {
      errors.push(
        `必写项 ${requirement.id} 包含${rule.description}，不能要求进入 body/all 或充当来源锚点；` +
          '执行状态保留在内部工作记录，必写项应描述来源事实、产品行为或真实经历。'
      );
    }
  }
  return errors;
}

export function collectEditorialProcessProseErrors(markdown: string): string[] {
  const errors: string[] = [];
  for (const [index, line] of authorProse(markdown).split('\n').entries()) {
    for (const rule of processRulesIn(line)) {
      errors.push(`第 ${index + 1} 行包含${rule.description}；请从公开正文移除，内部工作记录可保留。`);
    }
  }
  return errors;
}
