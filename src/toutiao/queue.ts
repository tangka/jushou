import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { discoverOperatorEnvironments, getOperatorAccount, loadOperatorProfile } from '../config/operator-profile.js';
import { isMain, runCli } from '../utils/cli.js';
import { readFrontmatterField } from '../utils/frontmatter.js';

export interface ToutiaoQueueItem {
  account: string;
  title: string;
  published: string;
  sourceUrl: string;
  mdPath: string;
  dir: string;
}

function parseCli(argv: readonly string[]): { outFile: string; accounts: string[] } {
  let outFile = path.resolve(process.cwd(), '.data/toutiao/publish-queue.json');
  const accounts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--out') {
      const value = argv[i + 1];
      if (!value) throw new Error('--out 需要传输出 JSON 路径');
      outFile = path.resolve(value);
      i++;
    } else if (arg === '--account') {
      const value = argv[i + 1];
      if (!value) throw new Error('--account 需要传账号名');
      accounts.push(value);
      i++;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`用法:
  pnpm toutiao:queue
  pnpm toutiao:queue -- --account <账号名> --out .data/toutiao/publish-queue.json

说明:
  - 未传 --account 时,自动读取私有配置及兼容 env 中的账号。
  - 扫描 <OBSIDIAN_VAULT>/微信公众号/<账号>/已发布 下的主 Markdown。
  - 自动排除 comment.md 和 frontmatter post_type=视频号 的内容。`);
      process.exit(0);
    } else {
      throw new Error(`未知参数:${arg}`);
    }
  }
  return { outFile, accounts: accounts.length ? accounts : discoverConfiguredAccounts() };
}

export function discoverConfiguredAccounts(root = process.cwd()): string[] {
  return [
    ...new Set(
      discoverOperatorEnvironments({ root })
        .map(({ env, envAccount }) => env.WECHAT_ACCOUNT_EXACT || env.WECHAT_ACCOUNT_KEYWORD || envAccount)
        .filter(Boolean)
    ),
  ];
}

async function findMainMarkdown(dir: string): Promise<string | null> {
  const base = path.basename(dir);
  const sameName = path.join(dir, `${base}.md`);
  if (await exists(sameName)) return sameName;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const fallback = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => name.endsWith('.md') && name !== 'comment.md' && !name.startsWith('.'))
    .sort()[0];
  return fallback ? path.join(dir, fallback) : null;
}

async function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

function accountPublishedRoot(account: string): string {
  const configured = getOperatorAccount(account, loadOperatorProfile());
  const resolved = discoverOperatorEnvironments().find(
    item =>
      (configured && item.account?.id === configured.id) ||
      item.env.WECHAT_ACCOUNT_EXACT === account ||
      item.env.WECHAT_ACCOUNT_KEYWORD === account
  );
  const env = resolved?.env ?? {};
  const name = env.WECHAT_ACCOUNT_EXACT || env.WECHAT_ACCOUNT_KEYWORD || account;
  const root = env.WECHAT_ACCOUNT_ROOT ?? path.join(env.OBSIDIAN_VAULT ?? config.vaultPath, '微信公众号', name);
  return path.resolve(root, '已发布');
}

async function itemFromDir(account: string, dir: string): Promise<ToutiaoQueueItem | null> {
  const mdPath = await findMainMarkdown(dir);
  if (!mdPath) return null;
  const markdown = await fs.readFile(mdPath, 'utf8');
  if (readFrontmatterField(markdown, 'post_type')?.includes('视频号')) return null;
  return {
    account: readFrontmatterField(markdown, 'account') || account,
    title: readFrontmatterField(markdown, 'title') || path.basename(mdPath, '.md'),
    published: readFrontmatterField(markdown, 'published') || '',
    sourceUrl: readFrontmatterField(markdown, 'source_url') || '',
    mdPath,
    dir,
  };
}

export async function buildToutiaoQueue(accounts: readonly string[]): Promise<ToutiaoQueueItem[]> {
  const items: ToutiaoQueueItem[] = [];
  for (const account of accounts) {
    const root = accountPublishedRoot(account);
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const item = await itemFromDir(account, path.join(root, entry.name));
      if (item) items.push(item);
    }
  }
  return items.sort((a, b) => b.published.localeCompare(a.published));
}

export async function run(): Promise<void> {
  const { outFile, accounts } = parseCli(process.argv.slice(2));
  const items = await buildToutiaoQueue(accounts);
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(items, null, 2));
  console.log(`头条发布队列:${items.length}`);
  console.log(`FILE ${outFile}`);
  for (const [index, item] of items.slice(0, 10).entries()) {
    console.log(`${index + 1}. [${item.account}] ${item.published} ${item.title}`);
  }
}

if (isMain(import.meta.url)) runCli(run);
