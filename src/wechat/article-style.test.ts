import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdown, renderArticle } from '../build-publish-html.js';
import type { PublishThemeConfig } from '../config/index.js';
import { effectiveArticleStyle, resolveArticleStyle } from './article-style.js';

const fallbackTheme: PublishThemeConfig = {
  name: 'fallback',
  pageBg: '#fff',
  articleBg: '#fff',
  text: '#111',
  muted: '#666',
  accent: '#222',
  accentText: '#222',
  accentSoft: '#eee',
  border: '#ddd',
  codeBg: '#eee',
  quoteBg: '#eee',
};

test('parseMarkdown reads article-level publish_style', () => {
  const parsed = parseMarkdown('---\ntitle: 测试\npublish_style: claude-journal\n---\n\n正文', 'fallback');
  assert.equal(parsed.publishStyle, 'claude-journal');
});

test('article-level style overrides the account default', () => {
  assert.equal(effectiveArticleStyle('claude-lab', 'grok-editorial'), 'claude-lab');
  assert.equal(effectiveArticleStyle(undefined, 'grok-editorial'), 'grok-editorial');
  assert.equal(effectiveArticleStyle('  ', 'grok-editorial'), 'grok-editorial');
});

test('claude-journal resolves a dark editorial theme', () => {
  const style = resolveArticleStyle('claude-journal', fallbackTheme);
  assert.equal(style.name, 'claude-journal');
  assert.equal(style.theme.articleBg, '#121211');
  assert.equal(style.theme.accent, '#dd7857');
});

test('renderArticle inlines claude-journal typography', () => {
  const html = renderArticle('测试标题', '正文段落', 'claude-journal');
  assert.match(html, /background:\s*#121211/u);
  assert.match(html, /border-top:\s*10px solid #dd7857/u);
  assert.match(html, /Songti SC/u);
});

test('image columns keep full images inside their width after Markdown rendering and CSS inlining', () => {
  const html = renderArticle(
    '并排图',
    '<div class="image-column" style="width:50%;box-sizing:border-box">\n![完整参考图](media/reference.jpg)\n</div>\n\n![单张图](media/single.jpg)',
    'default'
  );
  const images = [...html.matchAll(/<img\b[^>]*>/gu)].map(match => match[0]);
  assert.equal(images.length, 2);
  assert.match(images[0] ?? '', /src="media\/reference\.jpg"/u);
  assert.match(images[0] ?? '', /alt="完整参考图"/u);
  for (const rule of [
    'box-sizing: border-box',
    'width: 100% !important',
    'min-width: 0 !important',
    'height: auto !important',
  ]) {
    assert.ok(images[0]?.includes(rule), `并排图片应内联 ${rule}`);
  }
  assert.doesNotMatch(images[0] ?? '', /object-fit:\s*cover/u);
  assert.doesNotMatch(images[1] ?? '', /!important/u);
});

test('codex-atmosphere resolves the mint editorial theme', () => {
  const style = resolveArticleStyle('codex-atmosphere', fallbackTheme);
  assert.equal(style.name, 'codex-atmosphere');
  assert.equal(style.theme.articleBg, '#fbfcfb');
  assert.equal(style.theme.accent, '#0a7b58');
});

test('renderArticle inlines the complete Codex atmosphere typography', () => {
  const html = renderArticle('测试标题', '开场段落\n\n## 第一节\n\n> 关键判断', 'codex-atmosphere');
  assert.match(html, /background-color:\s*#4d9b73/u);
  assert.match(html, /border-radius:\s*22px/u);
  assert.match(html, /font-size:\s*19px/u);
  assert.match(html, /background:\s*#111815/u);
});

test('Codex atmosphere inherits readable text colors in WeChat dark mode', () => {
  const html = renderArticle(
    '测试标题',
    '开场段落\n\n## 第一节\n\n### 三级标题\n\n普通正文和**重点文字**，包含 `AGENTS.md`。',
    'codex-atmosphere'
  );
  const rootStyle = html.match(/<article[^>]*style="([^"]+)"/u)?.[1] ?? '';
  const paragraphStyles = [...html.matchAll(/<p[^>]*style="([^"]+)"/gu)].map(match => match[1] ?? '');
  const h2Style = html.match(/<h2[^>]*style="([^"]+)"/u)?.[1] ?? '';
  const h3Style = html.match(/<h3[^>]*style="([^"]+)"/u)?.[1] ?? '';
  const strongStyle = html.match(/<strong[^>]*style="([^"]+)"/u)?.[1] ?? '';
  const codeStyle = html.match(/<code[^>]*style="([^"]+)"/u)?.[1] ?? '';

  assert.match(rootStyle, /color:\s*inherit/u);
  assert.ok(paragraphStyles.length >= 2);
  assert.ok(paragraphStyles.every(style => /color:\s*inherit/u.test(style)));
  assert.match(h2Style, /color:\s*inherit/u);
  assert.match(h2Style, /border-top:\s*5px solid currentColor/u);
  assert.match(h3Style, /color:\s*inherit/u);
  assert.match(strongStyle, /color:\s*inherit/u);
  assert.match(codeStyle, /background:\s*#20242b/u);
  assert.match(codeStyle, /color:\s*#f7f8fa/u);
});

test('light article styles let WeChat control foreground colors in dark mode', () => {
  const body =
    '开场段落\n\n## 二级标题\n\n### 三级标题\n\n普通正文和**重点文字**，包含 `inline-code`。\n\n> 引用段落\n\n```text\ncommand --check\n```\n\n| 项目 | 结果 |\n| --- | --- |\n| 暗黑模式 | 通过 |\n\n[微信文章](https://mp.weixin.qq.com/s/demo)';
  const cases = [
    {
      style: 'default',
      inheritedTags: ['article', 'h1', 'h2', 'h3', 'p', 'strong', 'blockquote', 'th', 'td', 'a'],
    },
    {
      style: 'claude-engineering',
      inheritedTags: ['article', 'h1', 'h2', 'h3', 'p', 'strong', 'blockquote', 'td', 'a'],
    },
    {
      style: 'grok-editorial',
      inheritedTags: ['article', 'h2', 'h3', 'p', 'strong', 'th', 'td', 'a'],
    },
  ] as const;

  for (const { style, inheritedTags } of cases) {
    const html = renderArticle('测试标题', body, style);
    for (const tag of inheritedTags) {
      const inlineStyle = html.match(new RegExp(`<${tag}[^>]*style="([^"]+)"`, 'u'))?.[1] ?? '';
      assert.match(inlineStyle, /color:\s*inherit/u, `${style} ${tag} 应继承微信前景色`);
    }
  }
});

test('default article does not leave a pale canvas behind inherited dark-mode text', () => {
  const html = renderArticle('测试标题', '普通正文', 'default');
  const article = html.match(/<article[^>]*style="([^"]+)"/u)?.[1] ?? '';
  assert.match(article, /color:\s*inherit/u);
  assert.match(article, /background:\s*transparent/u);
});

test('all article styles keep code readable in WeChat dark mode', () => {
  const body = '正文里的 `inline-code`。\n\n```text\ncommand --check\n```';
  const styles = [
    'default',
    'claude-journal',
    'claude-lab',
    'claude-engineering',
    'codex-atmosphere',
    'grok-editorial',
  ] as const;

  for (const style of styles) {
    const html = renderArticle('测试标题', body, style);
    const inlineCodeStyle = html.match(/<p[^>]*>[^<]*<code[^>]*style="([^"]+)"/u)?.[1] ?? '';
    const preStyle = html.match(/<section class="wechat-code-block"[^>]*style="([^"]+)"/u)?.[1] ?? '';
    const blockCodeStyle = html.match(/<span class="wechat-code-text[^"]*"[^>]*style="([^"]+)"/u)?.[1] ?? '';

    assert.match(inlineCodeStyle, /background:\s*#20242b/u, `${style} 行内代码应使用稳定深色底`);
    assert.match(inlineCodeStyle, /color:\s*#f7f8fa/u, `${style} 行内代码应使用高对比浅色字`);
    assert.match(preStyle, /background:\s*#171a1f/u, `${style} 代码块应使用稳定深色底`);
    assert.match(preStyle, /color:\s*#f7f8fa/u, `${style} 代码块应使用高对比浅色字`);
    assert.match(blockCodeStyle, /background:\s*transparent/u, `${style} 块内代码不应叠加浅色底`);
    assert.match(blockCodeStyle, /color:\s*#f7f8fa/u, `${style} 块内代码应使用高对比浅色字`);
  }
});

test('renderArticle strips a Markdown-formatted duplicate title heading', () => {
  const title = 'Codex总跑偏？OpenAI员工晒出10条AGENTS.md规则';
  const body = '# Codex总跑偏？OpenAI员工晒出10条 `AGENTS.md` 规则\n\n开场段落';
  const html = renderArticle(title, body, 'codex-atmosphere');
  assert.equal(html.match(/<h1\b/gu)?.length, 1);
});

test('Codex atmosphere centers the Mini Program text entry', () => {
  const body =
    '<a class="weapp_text_link js_weapp_entry" data-miniprogram-appid="wx1111111111111111" data-miniprogram-path="pages/index/index">打开示例工具</a>';
  const html = renderArticle('测试标题', body, 'codex-atmosphere');
  assert.match(html, /display:\s*table/u);
  assert.match(html, /margin:\s*0 auto/u);
});

test('claude-lab resolves and inlines the terminal evidence language', () => {
  const style = resolveArticleStyle('claude-lab', fallbackTheme);
  const html = renderArticle('测试标题', '环境说明\n\n## 原始输出\n\n> FAIL：认证失败', 'claude-lab');
  assert.equal(style.theme.articleBg, '#08121a');
  assert.match(html, /border-top:\s*8px solid #22d3ee/u);
  assert.match(html, /SFMono-Regular/u);
  assert.match(html, /border-left:\s*5px solid #86efac/u);
});

test('claude-engineering resolves and inlines the warm engineering magazine language', () => {
  const style = resolveArticleStyle('claude-engineering', fallbackTheme);
  const html = renderArticle('测试标题', '实验摘要\n\n## 验证结果\n\n> 本次不能判定通过', 'claude-engineering');
  assert.equal(style.theme.articleBg, '#f3f0e8');
  assert.match(html, /border-top:\s*12px solid currentColor/u);
  assert.match(html, /border-left:\s*9px solid #7c8961/u);
  assert.match(html, /Songti SC/u);
});

test('grok-editorial resolves and inlines the official editorial language', () => {
  const style = resolveArticleStyle('grok-editorial', fallbackTheme);
  const html = renderArticle(
    '测试标题',
    '开场段落\n\n## 关键变化\n\n> 这是需要人工接管的黑色对话块。\n\n![官方界面](media/official.png)\n\n---',
    'grok-editorial'
  );
  assert.equal(style.name, 'grok-editorial');
  assert.equal(style.theme.articleBg, '#fbfdff');
  assert.equal(style.theme.accent, '#4189f4');
  assert.doesNotMatch(html, /radial-gradient/u);
  assert.match(html, /background:\s*#11141a/u);
  assert.match(html, /border:\s*1px solid #cbd5df/u);
  assert.match(html, /box-shadow:\s*14px 0 0 #7668dc, 28px 0 0 #64b98a/u);
  assert.doesNotMatch(html, /linear-gradient/u);
  assert.doesNotMatch(html, /border-radius:\s*(?:18|24|28)px/u);
});

test('Gemini Fluid remains available only for legacy draft rendering', () => {
  const alias = resolveArticleStyle('gemini', fallbackTheme);
  const legacy = resolveArticleStyle('gemini-fluid', fallbackTheme);
  const html = renderArticle('历史标题', '历史正文', 'gemini-fluid');

  assert.equal(alias.name, 'gemini-fluid');
  assert.equal(legacy.name, 'gemini-fluid');
  assert.equal(legacy.theme.name, 'Gemini Fluid (Legacy)');
  assert.match(html, /linear-gradient/u);
  assert.throws(
    () => resolveArticleStyle('unknown-style', fallbackTheme),
    error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /当前支持:[^\n]*gemini-fluid/u);
      return true;
    },
    '当前支持列表不应再推荐 legacy 样式'
  );
});

test('all article styles preserve a readable horizontal gutter inside WeChat', () => {
  const cases = [
    ['default', '4px 8px 24px'],
    ['claude-journal', '28px 8px 34px'],
    ['claude-lab', '26px 8px 38px'],
    ['claude-engineering', '28px 8px 38px'],
    ['codex-atmosphere', '24px 8px 38px'],
    ['grok-editorial', '26px 8px 40px'],
  ] as const;

  for (const [style, expectedPadding] of cases) {
    const html = renderArticle('测试标题', '正文段落', style);
    const rootStyle = html.match(/<article[^>]*style="([^"]+)"/u)?.[1];
    assert.ok(rootStyle, `${style} 应内联根容器样式`);
    assert.match(rootStyle, new RegExp(`padding:\\s*${expectedPadding.replaceAll(' ', '\\s+')}`, 'u'));
  }
});

test('unknown article style fails closed', () => {
  assert.throws(() => resolveArticleStyle('unknown-style', fallbackTheme), /不支持的 publish_style/u);
});
