import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { findMainMarkdown, parseMarkdown } from '../build-publish-html.js';
import { config } from '../config/index.js';
import { isMain, runCli } from '../utils/cli.js';
import { readFrontmatterField } from '../utils/frontmatter.js';
import type { ToutiaoQueueItem } from './queue.js';

interface CliOptions {
  queueFile: string;
  stateFile: string;
  limit: number;
  publish: boolean;
}

interface PublishState {
  done: Record<string, { at: string; title: string; url: string }>;
  failed: Record<string, { at: string; title: string; reason: string }>;
}

const TOUTIAO_PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish';

function parseCli(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    queueFile: path.resolve(process.cwd(), '.data/toutiao/publish-queue.json'),
    stateFile: path.resolve(process.cwd(), '.data/toutiao/publish-state.json'),
    limit: 1,
    publish: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--queue') {
      const value = argv[i + 1];
      if (!value) throw new Error('--queue 需要传队列 JSON 路径');
      options.queueFile = path.resolve(value);
      i++;
    } else if (arg === '--state') {
      const value = argv[i + 1];
      if (!value) throw new Error('--state 需要传状态 JSON 路径');
      options.stateFile = path.resolve(value);
      i++;
    } else if (arg === '--limit') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--limit 需要传正整数');
      options.limit = value;
      i++;
    } else if (arg === '--publish') {
      options.publish = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`用法:
  pnpm toutiao:publish-next
  pnpm toutiao:publish-next -- --limit 3
  pnpm toutiao:publish-next -- --publish --limit 1

说明:
  - 默认只打开 Chrome 并填入下一篇,不点击发布。
  - --publish 会点击发布按钮,这是公开发文动作,执行前需要用户明确确认。`);
      process.exit(0);
    } else {
      throw new Error(`未知参数:${arg}`);
    }
  }
  return options;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  return fs
    .readFile(file, 'utf8')
    .then(text => JSON.parse(text) as T)
    .catch(() => fallback);
}

function itemKey(item: ToutiaoQueueItem): string {
  return item.sourceUrl || item.mdPath;
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---\n', 4);
  return end >= 0 ? markdown.slice(end + 5) : markdown;
}

function stripLeadingTitle(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  const index = lines.findIndex(line => line.trim());
  if (index < 0) return markdown;
  const first = lines[index]?.trim();
  if (first === `# ${title}`) {
    lines.splice(index, 1);
    return lines.join('\n').trim();
  }
  return markdown.trim();
}

function markdownToToutiaoText(markdown: string, title: string, sourceUrl: string): string {
  let body = stripLeadingTitle(stripFrontmatter(markdown), title);
  body = body
    .replace(/!\[([^\]]*)]\(<[^)]+>\)/g, (_m, alt: string) => (alt ? `\n[图片: ${alt}]\n` : '\n[图片]\n'))
    .replace(/!\[([^\]]*)]\([^)]+\)/g, (_m, alt: string) => (alt ? `\n[图片: ${alt}]\n` : '\n[图片]\n'))
    .replace(/!\[\[([^\]\n|]+)(?:\|[^\]\n]+)?]]/g, (_m, name: string) => `\n[图片: ${name}]\n`)
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const suffix = sourceUrl ? `\n\n原文链接: ${sourceUrl}` : '';
  return `${body}${suffix}`.trim();
}

async function loadPost(item: ToutiaoQueueItem): Promise<{ title: string; body: string }> {
  const mdPath = item.mdPath || (await findMainMarkdown(item.dir, path.basename(item.dir)));
  if (!mdPath) throw new Error(`找不到 Markdown:${item.dir}`);
  const markdown = await fs.readFile(mdPath, 'utf8');
  const parsed = parseMarkdown(markdown, item.title);
  const title = readFrontmatterField(markdown, 'title') || parsed.title || item.title;
  return { title, body: markdownToToutiaoText(markdown, title, item.sourceUrl) };
}

async function waitForLogin(page: Page): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const url = page.url();
    if (!/login|auth\/page/i.test(url)) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('头条号 Chrome profile 仍未登录,请先扫码。');
}

async function setClipboard(text: string): Promise<void> {
  const result = spawnSync('pbcopy', { input: text });
  if (result.status !== 0) throw new Error('写入剪贴板失败');
}

async function visibleSelector(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    const handle = await page.$(selector).catch(() => null);
    const box = await handle?.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) return selector;
  }
  return null;
}

async function fillTitle(page: Page, title: string): Promise<void> {
  const selector = await visibleSelector(page, [
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    'textarea',
    'input[type="text"]',
  ]);
  if (!selector) throw new Error('未找到标题输入框');
  await page.click(selector);
  await page.keyboard.down('Meta');
  await page.keyboard.press('A');
  await page.keyboard.up('Meta');
  await page.keyboard.type(title, { delay: 5 });
}

async function fillBody(page: Page, body: string): Promise<void> {
  const selector = (await page.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll('[contenteditable="true"], textarea'));
    document.querySelectorAll('[data-toutiao-body-candidate]').forEach(el =>
      el.removeAttribute('data-toutiao-body-candidate')
    );
    nodes.forEach((el, index) => el.setAttribute('data-toutiao-body-candidate', String(index)));
    const scored = nodes
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        return { index, score: rect.width * rect.height, visible: rect.width > 0 && rect.height > 0 };
      })
      .filter(row => row.visible)
      .sort((a, b) => b.score - a.score)[0];
    return scored ? '[data-toutiao-body-candidate="' + scored.index + '"]' : null;
  })()`)) as string | null;

  const bodySelector = selector ?? '[contenteditable="true"]';
  await page.click(bodySelector);
  await setClipboard(body);
  await page.keyboard.down('Meta');
  await page.keyboard.press('A');
  await page.keyboard.press('V');
  await page.keyboard.up('Meta');
  await new Promise(resolve => setTimeout(resolve, 1500));
}

async function clickButtonByText(page: Page, texts: readonly string[]): Promise<boolean> {
  const clicked = (await page.evaluate(
    `(labels => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const target = buttons.find(el => labels.some(label => (el.textContent || '').includes(label)));
    if (!target) return false;
    target.click();
    return true;
  })(${JSON.stringify([...texts])})`
  )) as boolean;
  return Boolean(clicked);
}

async function fillOne(item: ToutiaoQueueItem, publish: boolean): Promise<void> {
  const post = await loadPost(item);
  const browser = await puppeteer.launch({
    executablePath: config.channels.chromePath,
    headless: false,
    userDataDir: path.resolve(process.cwd(), `.data/chrome-toutiao-${config.accountExact}`),
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    const page = await browser.newPage();
    await page.goto(TOUTIAO_PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await waitForLogin(page);
    await page.goto(TOUTIAO_PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 4000));
    await fillTitle(page, post.title);
    await fillBody(page, post.body);

    if (publish) {
      const ok = await clickButtonByText(page, ['发布']);
      if (!ok) throw new Error('未找到发布按钮');
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      await clickButtonByText(page, ['保存草稿', '存草稿']);
      console.log('已填入编辑器;未执行发布。');
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function run(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const queue = await readJson<ToutiaoQueueItem[]>(options.queueFile, []);
  const state = await readJson<PublishState>(options.stateFile, { done: {}, failed: {} });
  const pending = queue.filter(item => !state.done[itemKey(item)]).slice(0, options.limit);
  if (pending.length === 0) {
    console.log('头条发布队列为空或已全部处理。');
    return;
  }

  for (const item of pending) {
    try {
      console.log(`处理: ${item.title}`);
      await fillOne(item, options.publish);
      state.done[itemKey(item)] = { at: new Date().toISOString(), title: item.title, url: item.sourceUrl };
      delete state.failed[itemKey(item)];
      await fs.mkdir(path.dirname(options.stateFile), { recursive: true });
      await fs.writeFile(options.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.failed[itemKey(item)] = { at: new Date().toISOString(), title: item.title, reason };
      await fs.mkdir(path.dirname(options.stateFile), { recursive: true });
      await fs.writeFile(options.stateFile, JSON.stringify(state, null, 2));
      throw error;
    }
  }
}

if (isMain(import.meta.url)) runCli(run);
