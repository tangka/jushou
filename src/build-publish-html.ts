import fs from 'node:fs/promises';
import path from 'node:path';
import juice from 'juice';
import MarkdownIt from 'markdown-it';
import { config } from './config/index.js';
import { isMain, runCli } from './utils/cli.js';
import { readFrontmatterField } from './utils/frontmatter.js';
import { compactListWhitespace } from './utils/html.js';
import { wrapArticleCodeBlocks } from './wechat/article-code-layout.js';
import { articleImageCss, groupArticleImages } from './wechat/article-image-layout.js';
import { validateArticleReadability } from './wechat/article-readability.js';
import {
  type ArticleStyleName,
  articleStyleOverrides,
  darkModeCodeOverrides,
  effectiveArticleStyle,
  resolveArticleStyle,
} from './wechat/article-style.js';

type MarkdownItRenderer = {
  render(markdown: string): string;
};

type JuiceOptions = {
  removeStyleTags?: boolean;
  preserveMediaQueries?: boolean;
  preserveImportant?: boolean;
};

type JuiceModule = {
  inlineContent(html: string, css: string, options?: JuiceOptions): string;
};

type PublishTheme = typeof config.publishTheme;

type ParsedMarkdown = {
  title: string;
  postType: string | undefined;
  publishStyle: string | undefined;
  body: string;
};

type DraftBuildResult = 'built' | 'skipped';

const markdown: MarkdownItRenderer = new MarkdownIt({ html: true, linkify: true, typographer: true });
const juiceModule = juice as JuiceModule;

function getMarkdown(): MarkdownItRenderer {
  return markdown;
}

function getJuice(): JuiceModule {
  return juiceModule;
}

function isIgnoredMarkdown(fileName: string): boolean {
  if (!fileName.endsWith('.md')) return true;
  if (fileName.startsWith('_') || fileName.startsWith('.')) return true;
  return /^(评论|留言).*\.md$/u.test(fileName);
}

export async function findMainMarkdown(dir: string, draftName: string): Promise<string | undefined> {
  const sameName = `${draftName}.md`;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const fileNames = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(fileName => !isIgnoredMarkdown(fileName))
    .sort();
  if (fileNames.includes(sameName)) return path.join(dir, sameName);
  const fallback = fileNames[0];
  return fallback ? path.join(dir, fallback) : undefined;
}

function stripFrontmatter(markdownText: string): string {
  if (!markdownText.startsWith('---\n')) return markdownText;
  const end = markdownText.indexOf('\n---\n', 4);
  if (end < 0) return markdownText;
  return markdownText.slice(end + 5);
}

export function parseMarkdown(markdownText: string, fallbackTitle: string): ParsedMarkdown {
  return {
    title: readFrontmatterField(markdownText, 'title')?.trim() || fallbackTitle,
    postType: readFrontmatterField(markdownText, 'post_type')?.trim(),
    publishStyle: readFrontmatterField(markdownText, 'publish_style')?.trim(),
    body: stripFrontmatter(markdownText).trim(),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeObsidianImageTarget(raw: string): string {
  return raw.split('|')[0]?.trim() ?? raw.trim();
}

function imageTag(src: string, alt = ''): string {
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
}

function normalizeImageRefs(markdownText: string): string {
  return markdownText
    .replace(/!\[\[([^\]\n]+)\]\]/gu, (_match, rawTarget: string) => imageTag(normalizeObsidianImageTarget(rawTarget)))
    .replace(/!\[([^\]\n]*)\]\((media\/[^)\n]+)\)/gu, (_match, alt: string, src: string) => imageTag(src.trim(), alt));
}

function normalizeHeadingTitle(value: string): string {
  return value
    .replaceAll(/[`*_~]/gu, '')
    .replaceAll(/\s+/gu, '')
    .trim();
}

export function stripLeadingTitleHeading(body: string, title: string): string {
  const lines = body.split('\n');
  const firstMeaningfulIndex = lines.findIndex(line => line.trim().length > 0);
  if (firstMeaningfulIndex < 0) return body;

  const first = lines[firstMeaningfulIndex];
  if (!first) return body;
  const match = first.trim().match(/^#\s+(.+)$/u);
  if (!match) return body;
  const headingTitle = match[1]?.trim();
  if (!headingTitle || normalizeHeadingTitle(headingTitle) !== normalizeHeadingTitle(title)) return body;

  lines.splice(firstMeaningfulIndex, 1);
  return lines.join('\n').trim();
}

function articleCss(theme: PublishTheme, style: ArticleStyleName): string {
  return `
.article {
  box-sizing: border-box;
  padding: 4px 8px 24px;
  background: ${theme.articleBg};
  color: ${theme.text};
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.86;
  letter-spacing: 0;
}
.article h1 {
  margin: 0 0 28px;
  padding: 0 0 16px;
  border-bottom: 2px solid ${theme.accent};
  color: ${theme.text};
  font-size: 26px;
  line-height: 1.36;
  font-weight: 800;
}
.article h2 {
  margin: 38px 0 16px;
  padding: 0 0 0 13px;
  border-left: 4px solid ${theme.accent};
  color: ${theme.text};
  font-size: 21px;
  line-height: 1.45;
  font-weight: 750;
}
.article h3 {
  margin: 30px 0 12px;
  color: ${theme.accentText};
  font-size: 18px;
  line-height: 1.5;
  font-weight: 750;
}
.article p {
  margin: 0 0 18px;
}
.article strong {
  padding: 0;
  background: transparent;
  color: inherit;
  font-weight: 800;
  text-decoration: underline;
  text-decoration-color: ${theme.border};
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.16em;
}
.article a {
  color: ${theme.accentText};
  text-decoration: none;
  border-bottom: 1px solid ${theme.accent};
}
.article blockquote {
  margin: 24px 0;
  padding: 14px 18px;
  border-left: 4px solid ${theme.accent};
  background: ${theme.quoteBg};
  color: ${theme.muted};
}
.article blockquote p {
  margin: 0 0 10px;
}
.article blockquote p:last-child {
  margin-bottom: 0;
}
.article code {
  padding: 2px 5px;
  border: 1px solid ${theme.border};
  border-radius: 4px;
  background: ${theme.codeBg};
  color: ${theme.accentText};
  font-size: 0.92em;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
.article pre {
  margin: 22px 0;
  padding: 16px;
  overflow-x: auto;
  border: 1px solid ${theme.border};
  border-radius: 8px;
  background: ${theme.codeBg};
  line-height: 1.64;
}
.article pre code {
  padding: 0;
  border: 0;
  background: transparent;
  color: ${theme.text};
  font-size: 14px;
}
.article ul,
.article ol {
  margin: 0 0 20px;
  padding-left: 1.35em;
}
.article li {
  margin: 7px 0;
  padding-left: 2px;
}
${articleImageCss(theme.border)}
.article .image-column img {
  box-sizing: border-box;
  width: 100% !important;
  max-width: 100% !important;
  min-width: 0 !important;
  height: auto !important;
}
.article hr {
  height: 1px;
  margin: 32px 0;
  border: 0;
  background: ${theme.border};
}
.article table {
  width: 100%;
  margin: 22px 0;
  border-collapse: collapse;
  font-size: 14px;
}
.article th,
.article td {
  padding: 9px 10px;
  border: 1px solid ${theme.border};
  text-align: left;
  vertical-align: top;
}
.article th {
  background: ${theme.accentSoft};
  color: ${theme.text};
  font-weight: 750;
}
${articleStyleOverrides(style)}
${darkModeCodeOverrides()}
`;
}

export function renderArticle(title: string, body: string, publishStyle?: string): string {
  const style = resolveArticleStyle(effectiveArticleStyle(publishStyle, config.publishStyle), config.publishTheme);
  const bodyWithoutDuplicateTitle = stripLeadingTitleHeading(body, title);
  const normalizedMarkdown = normalizeImageRefs(`# ${title}\n\n${bodyWithoutDuplicateTitle}`);
  const rawArticle = `<article id="article-content" class="article">${getMarkdown().render(normalizedMarkdown)}</article>`;
  const articleHtml = getJuice().inlineContent(groupArticleImages(rawArticle), articleCss(style.theme, style.name), {
    removeStyleTags: true,
    preserveMediaQueries: false,
    preserveImportant: true,
  });
  return validateArticleReadability(wrapArticleCodeBlocks(compactListWhitespace(articleHtml)), style.name);
}

function pageCss(theme: PublishTheme): string {
  return `
* { box-sizing: border-box; }
body {
  margin: 0;
  background: ${theme.pageBg};
  color: ${theme.text};
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
}
.toolbar {
  position: fixed;
  z-index: 10;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 10px 14px;
  border-bottom: 1px solid ${theme.border};
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.06);
}
.copy-btn {
  appearance: none;
  border: 0;
  border-radius: 999px;
  background: ${theme.accent};
  color: #fff;
  cursor: pointer;
  font-size: 15px;
  font-weight: 750;
  line-height: 1;
  padding: 12px 18px;
}
.copy-btn:active {
  transform: translateY(1px);
}
.notice {
  max-width: 560px;
  color: ${theme.muted};
  font-size: 12px;
  line-height: 1.45;
}
.page {
  max-width: 700px;
  margin: 0 auto;
  padding: 82px 14px 40px;
}
.toast {
  position: fixed;
  z-index: 11;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.92);
  color: #fff;
  font-size: 14px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
}
.toast.show {
  opacity: 1;
}
@media (max-width: 640px) {
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }
  .page {
    padding-top: 124px;
  }
  .copy-btn {
    width: 100%;
  }
}
`;
}

function clientScript(): string {
  return `
const button = document.getElementById('copy-button');
const toast = document.getElementById('toast');
const article = document.getElementById('article-content');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 1800);
}

async function copyWithClipboardApi() {
  if (!navigator.clipboard || !window.ClipboardItem) return false;
  const html = article.outerHTML;
  const text = article.innerText;
  const item = new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([text], { type: 'text/plain' }),
  });
  await navigator.clipboard.write([item]);
  return true;
}

function copyWithSelection() {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNode(article);
  selection.removeAllRanges();
  selection.addRange(range);
  const ok = document.execCommand('copy');
  selection.removeAllRanges();
  return ok;
}

button.addEventListener('click', async () => {
  try {
    const copied = await copyWithClipboardApi();
    if (!copied && !copyWithSelection()) throw new Error('copy failed');
    showToast('已复制富文本,可粘贴到公众号编辑器');
  } catch {
    showToast('复制失败,请手动选中文章内容复制');
  }
});
`;
}

function renderPage(title: string, articleHtml: string, theme: PublishTheme): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · publish</title>
  <style>${pageCss(theme)}</style>
</head>
<body>
  <div class="toolbar">
    <button id="copy-button" class="copy-btn" type="button">📋 复制全文</button>
    <div class="notice">已知限制:复制富文本进公众号时,本地图片(media/)不会自动带过去;文字和排版会正常带入,图片需手动插入或后续接图床。</div>
  </div>
  <main class="page">
${articleHtml}
  </main>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script>${clientScript()}</script>
</body>
</html>
`;
}

async function buildDraft(dir: string, draftName: string): Promise<DraftBuildResult> {
  const mainMd = await findMainMarkdown(dir, draftName);
  if (!mainMd) {
    console.log(`  - 跳过(无主 md):${draftName}`);
    return 'skipped';
  }

  const content = await fs.readFile(mainMd, 'utf8');
  const parsed = parseMarkdown(content, draftName);
  if (parsed.postType === '贴图') {
    console.log(`  - 跳过(贴图):${draftName}`);
    return 'skipped';
  }
  if (!parsed.body) {
    console.log(`  - 跳过(无正文):${draftName}`);
    return 'skipped';
  }

  const publishStyle = effectiveArticleStyle(parsed.publishStyle, config.publishStyle);
  const style = resolveArticleStyle(publishStyle, config.publishTheme);
  const articleHtml = renderArticle(parsed.title, parsed.body, publishStyle);
  const pageHtml = renderPage(parsed.title, articleHtml, style.theme);
  const output = path.join(dir, 'publish.html');
  await fs.writeFile(output, pageHtml);
  console.log(`  ✓ ${draftName} → ${output}`);
  return 'built';
}

export async function run(): Promise<void> {
  const draftsDir = config.paths.draftsDir;
  const entries = await fs.readdir(draftsDir, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) {
    console.log(`待发布目录为空或不存在,跳过:${draftsDir}`);
    return;
  }

  let built = 0;
  let skipped = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const dir = path.join(draftsDir, entry.name);
    const result = await buildDraft(dir, entry.name);
    if (result === 'built') built++;
    else skipped++;
  }

  console.log(`公众号排版 HTML 生成完成:${built} 篇,跳过 ${skipped} 篇。主题:${config.publishTheme.name}`);
}

if (isMain(import.meta.url)) runCli(run);
