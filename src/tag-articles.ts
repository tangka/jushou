import fs from 'node:fs/promises';
import { Codex } from '@openai/codex-sdk';
import { type Dispatcher, getGlobalDispatcher, ProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';
import { z } from 'zod';
import { articlePaths, config } from './config/index.js';
import { type ArticleTopic, getAllArticles, getDb, setTopic } from './db/index.js';
import { articleBase, readDetailEntries } from './report.js';
import {
  applyValidatedClassificationBatch,
  buildTagSystemPrompt,
  buildTagUserPrompt,
  type Classification,
  classificationSchema,
  TAG_RESPONSE_FORMAT,
  type TagAccountContext,
  type TagArticleInput,
} from './tag-article-prompts.js';
import { isMain, runCli } from './utils/cli.js';
import { upsertFrontmatter } from './utils/frontmatter.js';
import { withRetry } from './utils/retry.js';

const TRANSIENT_CODES = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
];

/** 代理/网络抖动(TLS reset 等)→ 值得重试;真实 HTTP 错误不在此列。 */
function isTransientNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause;
  const code = cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code: unknown }).code) : '';
  return error.message.includes('fetch failed') || TRANSIENT_CODES.includes(code);
}

// 选题打标(ADR 0005):按固定词表把未打标文章分 content_type + subject,
// 写回 SQLite + Obsidian frontmatter。只处理未打标的(增量)。
// provider 可配:OpenRouter(OpenAI 兼容)或本机 Codex SDK(TAG_PROVIDER=codex)。

const BATCH_SIZE = 40;

const chatRespSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

interface PendingArticle extends TagArticleInput {
  appmsgid: string;
  itemidx: number;
}

const keyOf = (appmsgid: string, itemidx: number): string => `${appmsgid}:${itemidx}`;

/** 从各篇 raw.json 建 appmsgid:itemidx → {digest, mdPath} 映射(补 digest / 定位 frontmatter)。 */
async function loadArticleMeta(): Promise<{ digest: Map<string, string>; mdPath: Map<string, string> }> {
  const digest = new Map<string, string>();
  const mdPath = new Map<string, string>();
  try {
    const entries = await readDetailEntries();
    entries.forEach((entry, i) => {
      const { listItem: item, detail } = entry;
      const key = keyOf(String(item.appmsgid || detail.mid || ''), Number(item.itemidx || detail.idx || 1) || 1);
      digest.set(key, detail.desc || item.digest || '');
      mdPath.set(key, articlePaths(articleBase(entry, i)).md);
    });
  } catch {
    // 没有文章文件夹时:只能用标题分类,且无法写 frontmatter
  }
  return { digest, mdPath };
}

/** 把一篇的 content_type/subject 写进它 markdown 的 frontmatter(库 → 人读副本)。 */
async function syncFrontmatter(mdPath: string | undefined, contentType: string, subject: string): Promise<void> {
  if (!mdPath) return;
  try {
    const md = await fs.readFile(mdPath, 'utf8');
    await fs.writeFile(mdPath, upsertFrontmatter(md, { content_type: contentType, subject }));
  } catch {
    // markdown 不存在则只留库里的标签
  }
}

function applyClassifications(batch: PendingArticle[], classifications: Classification[]): void {
  applyValidatedClassificationBatch(batch, { classifications }, prepared => {
    const db = getDb();
    db.exec('BEGIN');
    try {
      for (const { article, classification } of prepared) {
        setTopic(article.appmsgid, article.itemidx, classification.content_type, classification.subject);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    for (const { article, classification } of prepared) {
      console.log(`  [${classification.content_type} / ${classification.subject}] ${article.title}`);
    }
  });
}

async function classifyBatchOpenRouter(
  payload: TagArticleInput[],
  accountContext: TagAccountContext
): Promise<Classification[]> {
  const body = JSON.stringify({
    model: config.openrouter.model,
    messages: [
      { role: 'system', content: buildTagSystemPrompt() },
      { role: 'user', content: buildTagUserPrompt(accountContext, payload) },
    ],
    response_format: TAG_RESPONSE_FORMAT,
    provider: { require_parameters: true }, // 只路由到支持 structured outputs 的提供方
  });

  // 用 undici 的 fetch(与 setGlobalDispatcher 同一实例);代理 TLS 抖动时退避重试
  const resp = await withRetry(
    () =>
      undiciFetch(`${config.openrouter.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openrouter.apiKey}`, 'Content-Type': 'application/json' },
        body,
      }),
    {
      attempts: 5,
      baseDelayMs: 1000,
      shouldRetry: isTransientNetworkError,
      onRetry: (_e, attempt, delayMs) => console.warn(`  代理连接抖动,${delayMs}ms 后重试(第 ${attempt} 次)`),
    }
  );
  const text = await resp.text();
  if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 300)}`);

  const chat = chatRespSchema.parse(JSON.parse(text));
  const content = chat.choices[0]?.message.content ?? '';
  const parsed = classificationSchema.parse(JSON.parse(content));
  return parsed.classifications;
}

async function classifyBatchCodex(
  payload: TagArticleInput[],
  accountContext: TagAccountContext
): Promise<Classification[]> {
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: process.cwd(),
    approvalPolicy: 'never',
  });
  const turn = await thread.run([buildTagSystemPrompt(), buildTagUserPrompt(accountContext, payload)].join('\n\n'), {
    outputSchema: TAG_RESPONSE_FORMAT.json_schema.schema,
  });
  const parsed = classificationSchema.parse(JSON.parse(turn.finalResponse));
  return parsed.classifications;
}

async function classifyBatch(batch: PendingArticle[], accountContext: TagAccountContext): Promise<void> {
  const payload = batch.map(a => ({ index: a.index, title: a.title, digest: a.digest }));
  const classifications =
    config.tag.provider === 'codex'
      ? await classifyBatchCodex(payload, accountContext)
      : await classifyBatchOpenRouter(payload, accountContext);
  applyClassifications(batch, classifications);
}

export async function run(): Promise<void> {
  const all: ArticleTopic[] = getAllArticles();
  if (all.length === 0) {
    console.log('库里还没有文章,先跑 enrich / build-index 入库。');
    return;
  }
  const { digest, mdPath } = await loadArticleMeta();

  // 未打标的 → 调 LLM 分类(需 key);已打标的不动
  const pending: PendingArticle[] = all
    .filter(a => !a.content_type || !a.subject)
    .map((a, index) => ({
      index,
      appmsgid: a.appmsgid,
      itemidx: a.itemidx,
      title: a.title,
      digest: digest.get(keyOf(a.appmsgid, a.itemidx)) ?? '',
    }));

  if (pending.length > 0) {
    let positioning = '';
    try {
      positioning = await fs.readFile(config.paths.positioningDoc, 'utf8');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      console.warn(`本号定位文件缺失,仅使用当前账号名与文章分类:${config.paths.positioningDoc}`);
    }
    const accountContext = { accountExact: config.accountExact, positioning };
    if (config.tag.provider === 'openrouter' && !config.openrouter.apiKey) {
      throw new Error(`有 ${pending.length} 篇未打标,需 OPENROUTER_API_KEY 调 OpenRouter 分类;请在环境变量里提供。`);
    }
    const providerInfo =
      config.tag.provider === 'codex'
        ? 'Codex SDK'
        : `OpenRouter ${config.openrouter.model}${config.openrouter.proxy ? '(经代理)' : ''}`;
    console.log(
      `待打标 ${pending.length} 篇,provider ${providerInfo},分 ${Math.ceil(pending.length / BATCH_SIZE)} 批:`
    );
    // 仅打标期间把全局 dispatcher 切到代理(WeChat 请求都在 tag 之前已完成),跑完恢复
    const useOpenRouterProxy = config.tag.provider === 'openrouter' && config.openrouter.proxy;
    const prevDispatcher: Dispatcher | undefined = useOpenRouterProxy ? getGlobalDispatcher() : undefined;
    if (useOpenRouterProxy) setGlobalDispatcher(new ProxyAgent(config.openrouter.proxy));
    try {
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        await classifyBatch(pending.slice(i, i + BATCH_SIZE), accountContext);
      }
    } finally {
      if (prevDispatcher) setGlobalDispatcher(prevDispatcher);
    }
  } else {
    console.log('没有未打标文章。');
  }

  // 把库里所有标签同步进各篇 frontmatter(重新导出后用这步补回标签,无需再分类)
  let synced = 0;
  for (const a of getAllArticles()) {
    if (!a.content_type || !a.subject) continue;
    await syncFrontmatter(mdPath.get(keyOf(a.appmsgid, a.itemidx)), a.content_type, a.subject);
    synced += 1;
  }
  console.log(`完成:库标签 → ${synced} 篇 frontmatter 同步(可手动改);DB ${config.dbPath}`);
}

if (isMain(import.meta.url)) runCli(run);
