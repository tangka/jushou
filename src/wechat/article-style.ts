import type { PublishThemeConfig } from '../config/index.js';
import { claudeEngineeringOverrides, claudeLabOverrides } from './article-style-claude.js';
import { geminiFluidOverrides } from './article-style-gemini.js';
import { grokEditorialOverrides } from './article-style-grok.js';

export type ArticleStyleName =
  | 'default'
  | 'claude-journal'
  | 'claude-lab'
  | 'claude-engineering'
  | 'codex-atmosphere'
  | 'grok-editorial'
  // 仅供历史草稿回读，不再用于新稿推荐或默认路由。
  | 'gemini-fluid';

export type ResolvedArticleStyle = {
  name: ArticleStyleName;
  theme: PublishThemeConfig;
};

/** 代码区域固定使用深底浅字，避免微信黑色主题只提亮文字却保留浅色背景。 */
export function darkModeCodeOverrides(): string {
  return `
.article code {
  border-color: #444a54;
  background: #20242b;
  color: #f7f8fa;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.article pre {
  border-color: #444a54;
  background: #171a1f;
  color: #f7f8fa;
}
.article pre code {
  background: transparent;
  color: #f7f8fa;
}
`;
}

/** 草稿按篇声明优先；没有声明时才回落到账号默认。 */
export function effectiveArticleStyle(
  articleStyle: string | undefined,
  accountStyle: string | undefined
): string | undefined {
  return articleStyle?.trim() || accountStyle?.trim() || undefined;
}

const CLAUDE_JOURNAL_THEME: PublishThemeConfig = {
  name: 'Claude Editorial Journal',
  pageBg: '#0b0b0a',
  articleBg: '#121211',
  text: '#f4f1e9',
  muted: '#9d9b93',
  accent: '#dd7857',
  accentText: '#f09a78',
  accentSoft: '#24221f',
  border: '#3e3d39',
  codeBg: '#1b1b19',
  quoteBg: '#1b1b19',
};

const CODEX_ATMOSPHERE_THEME: PublishThemeConfig = {
  name: 'Codex Atmosphere',
  pageBg: '#edf2ef',
  articleBg: '#fbfcfb',
  text: '#101513',
  muted: '#5d6a64',
  accent: '#0a7b58',
  accentText: '#086148',
  accentSoft: '#e4f1ea',
  border: '#cbd8d1',
  codeBg: '#eef4f1',
  quoteBg: '#111815',
};

const CLAUDE_LAB_THEME: PublishThemeConfig = {
  name: 'Claude Lab',
  pageBg: '#050b10',
  articleBg: '#08121a',
  text: '#f8fafc',
  muted: '#91a5b1',
  accent: '#22d3ee',
  accentText: '#67e8f9',
  accentSoft: '#10242e',
  border: '#29414d',
  codeBg: '#03090d',
  quoteBg: '#050c11',
};

const CLAUDE_ENGINEERING_THEME: PublishThemeConfig = {
  name: 'Claude Engineering',
  pageBg: '#e7e1d6',
  articleBg: '#f3f0e8',
  text: '#11110f',
  muted: '#67645d',
  accent: '#7c8961',
  accentText: '#a1462e',
  accentSoft: '#e6dfd3',
  border: '#aaa69b',
  codeBg: '#e9e3d8',
  quoteBg: '#f3f0e8',
};

const GROK_EDITORIAL_THEME: PublishThemeConfig = {
  name: 'Grok Editorial',
  pageBg: '#eef7ff',
  articleBg: '#fbfdff',
  text: '#11141a',
  muted: '#606a78',
  accent: '#4189f4',
  accentText: '#315fc8',
  accentSoft: '#edf5ff',
  border: '#cfd7e2',
  codeBg: '#edf3f8',
  quoteBg: '#11141a',
};

const LEGACY_GEMINI_FLUID_THEME: PublishThemeConfig = {
  name: 'Gemini Fluid (Legacy)',
  pageBg: '#f3f6fc',
  articleBg: '#ffffff',
  text: '#1f1f1f',
  muted: '#5f6368',
  accent: '#0b57d0',
  accentText: '#0b57d0',
  accentSoft: '#e8f0fe',
  border: '#d9e2f2',
  codeBg: '#f1f5fc',
  quoteBg: '#eef3ff',
};

export function resolveArticleStyle(
  value: string | undefined,
  fallbackTheme: PublishThemeConfig
): ResolvedArticleStyle {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized || normalized === 'default') return { name: 'default', theme: fallbackTheme };
  if (normalized === 'claude-journal') return { name: 'claude-journal', theme: CLAUDE_JOURNAL_THEME };
  if (normalized === 'claude-lab') return { name: 'claude-lab', theme: CLAUDE_LAB_THEME };
  if (normalized === 'claude-engineering') return { name: 'claude-engineering', theme: CLAUDE_ENGINEERING_THEME };
  if (normalized === 'codex-atmosphere') return { name: 'codex-atmosphere', theme: CODEX_ATMOSPHERE_THEME };
  if (normalized === 'grok-editorial') return { name: 'grok-editorial', theme: GROK_EDITORIAL_THEME };
  if (normalized === 'gemini' || normalized === 'gemini-fluid') {
    return { name: 'gemini-fluid', theme: LEGACY_GEMINI_FLUID_THEME };
  }
  throw new Error(
    `不支持的 publish_style:${value}。当前支持:default、claude-journal、claude-lab、claude-engineering、codex-atmosphere、grok-editorial`
  );
}

export function articleStyleOverrides(style: ArticleStyleName): string {
  if (style === 'claude-journal')
    return `
.article {
  padding: 28px 8px 34px;
  border-top: 10px solid #dd7857;
  font-family: "Songti SC", "STSong", Georgia, serif;
  font-size: 17px;
  line-height: 1.95;
  letter-spacing: 0.015em;
}
.article h1 {
  margin: 0 0 32px;
  padding: 0 0 24px;
  border-bottom: 1px solid #484640;
  font-family: Georgia, "Songti SC", "STSong", serif;
  font-size: 30px;
  line-height: 1.3;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.article h2 {
  margin: 42px 0 20px;
  padding: 18px 0 0;
  border-top: 1px solid #484640;
  border-left: 0;
  color: #f4f1e9;
  font-family: Georgia, "Songti SC", "STSong", serif;
  font-size: 24px;
  line-height: 1.42;
  font-weight: 650;
}
.article h3 {
  color: #f09a78;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  font-size: 17px;
  letter-spacing: 0.08em;
}
.article p,
.article li {
  color: #ddd9cf;
}
.article strong {
  color: #f4f1e9;
  text-decoration-color: #dd7857;
}
.article blockquote {
  padding: 18px 0;
  border-top: 1px solid #484640;
  border-bottom: 1px solid #484640;
  border-left: 0;
  background: #121211;
  color: #9d9b93;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
  font-size: 14px;
  letter-spacing: 0.04em;
}
.article img {
  border: 1px solid #3e3d39;
  border-radius: 3px;
  background: #f3f0e8;
}
.article hr {
  background: #dd7857;
}
`;
  if (style === 'codex-atmosphere')
    return `
.article {
  padding: 24px 8px 38px;
  border-top: 1px solid #d9e3dd;
  background-color: #fbfcfb;
  background-image: linear-gradient(180deg, #f5faf7 0%, #ffffff 28%, #ffffff 74%, #f1f6f3 100%);
  color: inherit;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  font-size: 17px;
  line-height: 1.92;
  letter-spacing: 0.008em;
}
.article h1 {
  margin: 0 0 34px;
  padding: 38px 24px 40px;
  border: 0;
  border-radius: 22px;
  background-color: #4d9b73;
  background-image: radial-gradient(circle at 16% 6%, rgba(90, 159, 121, 0.65) 0%, rgba(90, 159, 121, 0) 44%), linear-gradient(132deg, #5a9f79 0%, #4d9b73 43%, #3e8f6b 68%, #155f5b 100%);
  box-shadow: inset 0 0 42px rgba(255, 255, 255, 0.2), 0 12px 34px rgba(20, 82, 61, 0.12);
  color: #ffffff;
  font-size: 30px;
  line-height: 1.28;
  font-weight: 850;
  letter-spacing: -0.035em;
  text-align: center;
  text-shadow: 0 2px 18px rgba(0, 53, 38, 0.2);
}
.article > p:first-of-type {
  margin-bottom: 24px;
  color: inherit;
  font-size: 19px;
  line-height: 1.82;
  font-weight: 560;
}
.article h2 {
  margin: 44px 0 20px;
  padding: 15px 0 12px;
  border-top: 5px solid currentColor;
  border-right: 0;
  border-bottom: 1px solid #bfd2c8;
  border-left: 0;
  color: inherit;
  font-size: 23px;
  line-height: 1.42;
  font-weight: 830;
  letter-spacing: -0.02em;
}
.article h3 {
  margin-top: 32px;
  color: inherit;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.06em;
}
.article p,
.article li {
  color: inherit;
}
.article strong {
  color: inherit;
  font-weight: 820;
  text-decoration-color: #58b98b;
  text-decoration-thickness: 0.16em;
  text-underline-offset: 0.13em;
}
.article blockquote {
  margin: 26px 0;
  padding: 18px 20px;
  border: 0;
  border-radius: 12px;
  background: #111815;
  color: #f5f8f6;
  box-shadow: 0 8px 24px rgba(16, 24, 21, 0.1);
  font-size: 16px;
  line-height: 1.78;
}
.article blockquote p,
.article blockquote strong {
  color: #f5f8f6;
}
.article code {
  border-color: #c3d8cd;
  background: #e7f1ec;
  color: inherit;
  font-weight: 650;
}
.article pre {
  border: 0;
  border-radius: 12px;
  background: #101715;
  box-shadow: 0 9px 26px rgba(16, 24, 21, 0.11);
}
.article pre code {
  color: #e9f4ee;
}
.article img {
  margin: 28px auto;
  border: 0;
  border-radius: 18px;
  background: transparent;
  box-shadow: 0 12px 32px rgba(20, 73, 55, 0.11);
}
.article hr {
  width: 72px;
  height: 4px;
  margin: 38px 0;
  background: linear-gradient(90deg, #0a7b58 0%, #7c74dc 100%);
}
.article th {
  border-color: #101513;
  background: #101513;
  color: #f5f8f6;
}
.article td {
  border-color: #cbd8d1;
  background: #f7faf8;
  color: inherit;
}
.article a {
  border-bottom-color: currentColor;
  color: inherit;
}
.article a.weapp_text_link {
  display: table;
  margin: 0 auto;
  padding: 10px 16px;
  border: 0;
  border-radius: 999px;
  background: #0a7b58;
  color: #ffffff;
  font-weight: 760;
}
`;
  if (style === 'default')
    return `
.article {
  background: transparent;
}
.article,
.article h1,
.article h2,
.article h3,
.article p,
.article li,
.article strong,
.article blockquote,
.article code,
.article pre,
.article pre code,
.article th,
.article td,
.article a {
  color: inherit;
}
.article h1 {
  border-bottom-color: currentColor;
}
.article h2,
.article blockquote {
  border-left-color: currentColor;
}
.article a {
  border-bottom-color: currentColor;
}
`;
  if (style === 'claude-lab') return claudeLabOverrides();
  if (style === 'claude-engineering') return claudeEngineeringOverrides();
  if (style === 'grok-editorial') return grokEditorialOverrides();
  if (style === 'gemini-fluid') return geminiFluidOverrides();
  return '';
}
