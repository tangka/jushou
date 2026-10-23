import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { load } from 'cheerio';
import { findMainMarkdown, parseMarkdown, renderArticle } from './build-publish-html.js';
import { accountPolicy } from './config/account-policy.js';
import { config } from './config/index.js';
import { isMain, runCli } from './utils/cli.js';
import { readFrontmatterField } from './utils/frontmatter.js';
import { createWechatDraft, type DraftImageRef, updateWechatDraft } from './wechat/draft-api.js';
import { parseUploadDraftCli } from './wechat/draft-cli.js';
import { ensureWechatDraft } from './wechat/draft-ensure.js';
import {
  assertDraftPostTypeUnchanged,
  assertDraftTitleReplacement,
  assertNoDraftMetaUnlessForced,
  DRAFT_META_FILE,
  hasDraftMeta,
  readExistingDraftMeta,
  writeWechatDraftMeta,
} from './wechat/draft-meta.js';
import { logDraftUploadPlan } from './wechat/draft-upload-log.js';
import { validateAccountPostTypePolicy, validateAutomatedDraftQuality } from './wechat/editorial-quality.js';
import { validateWechatDraftHumanWriting } from './wechat/human-writing-guard.js';
import { hasPaidPartnershipMiniProgramExemption, validateDraftLinkPolicy } from './wechat/mini-program-entry-policy.js';
import { validateDraftXAssets } from './wechat/x-draft-asset-guard.js';

type DraftCandidate = {
  dir: string;
  name: string;
  mdPath: string;
  title: string;
  postType: string | undefined;
  mtimeMs: number;
};
type DraftSelectionResult = {
  candidates: DraftCandidate[];
  skipped: string[];
};
type DraftSource = {
  dir: string;
  name: string;
  mdPath: string;
  markdown: string;
  postType: string | undefined;
  title: string;
  author: string;
  digest: string;
  contentSourceUrl: string | undefined;
  coverPath: string;
  stickerContent: string;
  stickerImages: LocalImageRef[];
  articleHtml: string;
  miniProgramEntryRequired: boolean;
};
type LocalImageRef = DraftImageRef;
const BODY_IMAGE_MAX_BYTES = 1024 * 1024;
const PERMANENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const THUMB_IMAGE_MAX_BYTES = 64 * 1024;
const STICKER_TITLE_MAX_CHARS = 20;
const STICKER_IMAGE_MAX_COUNT = 20;
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const ROUTING_BYPASS_KEYS = ['routing_confirmed', 'account_routing_confirmed'];
type RoutingDraftSource = Pick<DraftSource, 'markdown' | 'title'>;

function cropText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxChars ? compact.slice(0, maxChars) : compact;
}

function markdownExcerpt(body: string): string {
  const paragraph = body
    .split(/\n{2,}/)
    .map(part => part.trim())
    .find(part => part && !part.startsWith('#') && !part.startsWith('!['));
  if (!paragraph) return '';
  return cropText(
    paragraph
      .replace(/!\[[^\]]*]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/[*_`>#-]/g, ''),
    120
  );
}

function markdownPlainText(body: string): string {
  return body
    .replace(/!\[\[[^\]\n]+\]\]/gu, '')
    .replace(/!\[[^\]\n]*\]\([^)]+\)/gu, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeAssetTarget(raw: string): string {
  return raw.split('|')[0]?.trim() ?? raw.trim();
}

function resolveAssetPath(draftDir: string, rawTarget: string): string {
  const target = normalizeAssetTarget(rawTarget);
  if (/^https?:\/\//u.test(target)) throw new Error(`当前只支持本地图片,不支持远程图片:${target}`);
  return path.isAbsolute(target) ? target : path.resolve(draftDir, target);
}

async function assertFile(pathname: string, label: string): Promise<void> {
  const stat = await fs.stat(pathname).catch(() => undefined);
  if (!stat?.isFile()) throw new Error(`${label}不存在:${pathname}`);
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

export async function listUploadableDraftCandidates(
  draftsDir: string,
  today = shanghaiToday(),
  force = false
): Promise<DraftSelectionResult> {
  const entries = await fs.readdir(draftsDir, { withFileTypes: true }).catch(() => []);
  const candidates: DraftCandidate[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    if (!entry.name.startsWith(`${today}-`)) continue;

    const dir = path.join(draftsDir, entry.name);
    const mdPath = await findMainMarkdown(dir, entry.name);
    if (!mdPath) {
      skipped.push(`${entry.name}:无主 Markdown`);
      continue;
    }

    const markdown = await fs.readFile(mdPath, 'utf8').catch(() => '');
    if (!markdown) {
      skipped.push(`${entry.name}:Markdown 读取失败`);
      continue;
    }

    const parsed = parseMarkdown(markdown, entry.name);
    if (parsed.postType === '视频号') {
      skipped.push(`${entry.name}:视频号草稿`);
      continue;
    }

    if (!force && (await hasDraftMeta(dir))) {
      skipped.push(`${entry.name}:已存在 ${DRAFT_META_FILE}`);
      continue;
    }

    const stat = await fs.stat(dir);
    candidates.push({
      dir,
      name: entry.name,
      mdPath,
      title: parsed.title,
      postType: parsed.postType,
      mtimeMs: stat.mtimeMs,
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name, 'zh-Hans-CN'));
  return { candidates, skipped };
}

async function resolveDraftDir(draftArg: string | undefined, force: boolean): Promise<string> {
  if (!draftArg) {
    const today = shanghaiToday();
    const result = await listUploadableDraftCandidates(config.paths.draftsDir, today, force);
    const selected = result.candidates[0];
    if (selected) {
      console.log(`自动选择今天可上传草稿:${selected.name}`);
      console.log(`选择依据:${today} 非视频公众号草稿,按目录修改时间最新`);
      return selected.dir;
    }

    const skipped = result.skipped.length > 0 ? `\n跳过项:\n- ${result.skipped.join('\n- ')}` : '';
    throw new Error(`未找到今天可上传的公众号草稿:${config.paths.draftsDir}${skipped}`);
  }

  const candidates = path.isAbsolute(draftArg)
    ? [draftArg]
    : [path.resolve(process.cwd(), draftArg), path.join(config.paths.draftsDir, draftArg)];
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => undefined);
    if (stat?.isDirectory()) return candidate;
  }
  throw new Error(`找不到草稿目录:${draftArg}`);
}

function readFirstFrontmatter(markdown: string, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readFrontmatterField(markdown, key)?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizedAccount(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function frontmatterFlag(markdown: string, keys: readonly string[]): boolean {
  return keys.some(key => /^(1|true|yes|确认|已确认)$/iu.test(readFrontmatterField(markdown, key)?.trim() ?? ''));
}

function routingGuardDisabled(): boolean {
  return /^(0|false|off|no)$/iu.test(process.env.WECHAT_UPLOAD_ROUTING_GUARD ?? '');
}

export function validateDraftAccountRouting(source: RoutingDraftSource, accountExact: string): void {
  if (routingGuardDisabled() || frontmatterFlag(source.markdown, ROUTING_BYPASS_KEYS)) return;

  const declaredAccount = readFirstFrontmatter(source.markdown, ['account']);
  if (declaredAccount && normalizedAccount(declaredAccount) !== normalizedAccount(accountExact)) {
    throw new Error(
      `草稿账号不匹配:frontmatter account=${declaredAccount},当前上传账号=${accountExact}。请先移到正确账号目录或修正 account。`
    );
  }

  const text = `${source.title}\n${source.markdown}`;
  const matches = accountPolicy(accountExact).routingGuards.map(rule => ({
    ...rule,
    match: new RegExp(rule.pattern, 'u').exec(text),
  }));
  const rule = matches.find(item => item.match);
  if (!rule?.match) return;
  const match = rule.match;

  throw new Error(
    `疑似跨账号选题:${source.title}。当前账号=${accountExact},命中「${match[0]}」,更像 ${rule.owner}。` +
      `请先核对当前账号定位;若这是刻意跨账号内容,在草稿 frontmatter 加 routing_confirmed: true 后重试。`
  );
}

async function loadDraftSource(draftDir: string): Promise<DraftSource> {
  const draftName = path.basename(draftDir);
  const mdPath = await findMainMarkdown(draftDir, draftName);
  if (!mdPath) throw new Error(`草稿无主 Markdown:${draftDir}`);

  const markdown = await fs.readFile(mdPath, 'utf8');
  const parsed = parseMarkdown(markdown, draftName);
  if (parsed.postType === '视频号') {
    throw new Error(`当前命令只支持公众号文章草稿,不支持 post_type=${parsed.postType}`);
  }

  const coverRaw = readFirstFrontmatter(markdown, ['cover', 'cover_image', 'image']);
  const fallbackCover = path.join(draftDir, 'media', 'cover.png');
  const coverPath = coverRaw ? resolveAssetPath(draftDir, coverRaw) : fallbackCover;
  await assertFile(coverPath, '封面');

  if (parsed.postType === '贴图') {
    const stickerImages = collectMarkdownImages(parsed.body, draftDir);
    if (stickerImages.length === 0) {
      stickerImages.push({ src: coverRaw ?? 'media/cover.png', filePath: coverPath });
    }
    const plainBody = markdownPlainText(parsed.body);
    const stickerContent = cropText(
      (readFirstFrontmatter(markdown, ['digest', 'summary']) ?? plainBody) || parsed.title,
      20_000
    );

    return {
      dir: draftDir,
      name: draftName,
      mdPath,
      markdown,
      postType: parsed.postType,
      title: parsed.title,
      author: readFirstFrontmatter(markdown, ['author']) ?? config.wechatApi.draftAuthor,
      digest: '',
      contentSourceUrl: readFirstFrontmatter(markdown, ['content_source_url', 'source_url']),
      coverPath,
      stickerContent,
      stickerImages,
      articleHtml: '',
      miniProgramEntryRequired: false,
    };
  }

  if (!parsed.body) throw new Error(`草稿正文为空:${mdPath}`);

  const digest = cropText(readFirstFrontmatter(markdown, ['digest', 'summary']) ?? markdownExcerpt(parsed.body), 128);
  const author = readFirstFrontmatter(markdown, ['author']) ?? config.wechatApi.draftAuthor;
  const contentSourceUrl = readFirstFrontmatter(markdown, ['content_source_url', 'source_url']);
  const articleHtml = renderArticle(parsed.title, parsed.body, parsed.publishStyle);
  const miniProgramEntryRequired = !hasPaidPartnershipMiniProgramExemption(markdown);

  return {
    dir: draftDir,
    name: draftName,
    mdPath,
    markdown,
    postType: parsed.postType,
    title: parsed.title,
    author,
    digest,
    contentSourceUrl,
    coverPath,
    stickerContent: '',
    stickerImages: [],
    articleHtml,
    miniProgramEntryRequired,
  };
}

function isWechatImageUrl(src: string): boolean {
  return /^https?:\/\/mmbiz\.qpic\.cn\//u.test(src) || /^https?:\/\/mmbiz\.qlogo\.cn\//u.test(src);
}

function collectLocalImages(articleHtml: string, draftDir: string): LocalImageRef[] {
  const $ = load(articleHtml, {}, false);
  const refs = new Map<string, LocalImageRef>();
  $('img').each((_index, element) => {
    const src = $(element).attr('src')?.trim();
    if (!src || isWechatImageUrl(src)) return;
    if (/^https?:\/\//u.test(src)) throw new Error(`正文图片必须先上传到微信,不支持保留外链:${src}`);
    refs.set(src, { src, filePath: resolveAssetPath(draftDir, src) });
  });
  return [...refs.values()];
}

function collectMarkdownImages(markdownBody: string, draftDir: string): LocalImageRef[] {
  const refs = new Map<string, LocalImageRef>();
  const add = (raw: string) => {
    const src = normalizeAssetTarget(raw);
    refs.set(src, { src, filePath: resolveAssetPath(draftDir, src) });
  };

  for (const match of markdownBody.matchAll(/!\[\[([^\]\n]+)\]\]/gu)) {
    const raw = match[1];
    if (raw) add(raw);
  }
  for (const match of markdownBody.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/gu)) {
    const raw = match[1];
    if (raw) add(raw);
  }
  return [...refs.values()];
}

async function validateImage(pathname: string, label: string, maxBytes: number): Promise<void> {
  const ext = path.extname(pathname).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`${label}格式不支持:${pathname}。微信上传接口建议使用 jpg/png。`);
  }
  const stat = await fs.stat(pathname).catch(() => undefined);
  if (!stat?.isFile()) throw new Error(`${label}不存在:${pathname}`);
  if (stat.size > maxBytes) throw new Error(`${label}过大:${pathname} (${stat.size} bytes, 上限 ${maxBytes})`);
}

async function validateDraft(source: DraftSource): Promise<LocalImageRef[]> {
  if (source.postType === '贴图') {
    if (Array.from(source.title).length > STICKER_TITLE_MAX_CHARS) {
      throw new Error(
        `贴图标题过长:${source.title} (${Array.from(source.title).length} 字,上限 ${STICKER_TITLE_MAX_CHARS})`
      );
    }
    if (source.stickerImages.length === 0) throw new Error('贴图草稿至少需要 1 张图片');
    if (source.stickerImages.length > STICKER_IMAGE_MAX_COUNT) {
      throw new Error(`贴图图片过多:${source.stickerImages.length} 张,上限 ${STICKER_IMAGE_MAX_COUNT}`);
    }
    for (const image of source.stickerImages) {
      await validateImage(image.filePath, `贴图图片 ${image.src}`, PERMANENT_IMAGE_MAX_BYTES);
    }
    return [];
  }

  const coverLimit = config.wechatApi.coverMaterialType === 'thumb' ? THUMB_IMAGE_MAX_BYTES : PERMANENT_IMAGE_MAX_BYTES;
  await validateImage(source.coverPath, '封面', coverLimit);
  const bodyImages = collectLocalImages(source.articleHtml, source.dir);
  for (const image of bodyImages) {
    await validateImage(image.filePath, `正文图片 ${image.src}`, BODY_IMAGE_MAX_BYTES);
  }
  return bodyImages;
}

export async function run(): Promise<void> {
  const options = parseUploadDraftCli(process.argv.slice(2));
  const draftDir = await resolveDraftDir(options.draft, options.force);
  const source = await loadDraftSource(draftDir);
  await validateWechatDraftHumanWriting(source.mdPath, source.markdown, source.postType);
  const editorialBrief = await validateAutomatedDraftQuality(
    source.dir,
    source.markdown,
    source.title,
    source.postType,
    config.accountExact
  );
  validateAccountPostTypePolicy({
    accountExact: config.accountExact,
    postType: source.postType,
    brief: editorialBrief,
  });
  validateDraftLinkPolicy(source, config.accountExact);
  validateDraftAccountRouting(source, config.accountExact);
  const bodyImages = await validateDraft(source);
  await validateDraftXAssets(
    source.dir,
    source.postType === '贴图' ? 'newspic' : 'news',
    (source.postType === '贴图' ? source.stickerImages : bodyImages).map(image => image.filePath)
  );
  const existing =
    options.updateMediaId || options.ensureDraft
      ? await readExistingDraftMeta(source.dir, config.accountExact)
      : undefined;
  if (options.updateMediaId && !existing) {
    throw new Error(`更新草稿需要现有 ${DRAFT_META_FILE}:${path.join(source.dir, DRAFT_META_FILE)}`);
  }
  if (options.updateMediaId && existing && existing.mediaId !== options.updateMediaId) {
    throw new Error(`--update-media-id 与 ${DRAFT_META_FILE} 不一致。拒绝更新。`);
  }
  if (!options.ensureDraft) {
    assertDraftPostTypeUnchanged(existing, source.postType);
    assertDraftTitleReplacement(existing, options.replaceTitleFrom, source.title);
  }

  logDraftUploadPlan({
    account: config.accountExact,
    draftDir: source.dir,
    postType: source.postType,
    title: source.title,
    ensureDraft: options.ensureDraft,
    update: Boolean(options.updateMediaId),
    coverPath: source.coverPath,
    stickerImageCount: source.stickerImages.length,
    bodyImageCount: bodyImages.length,
    stickerTextLength: source.stickerContent.length,
    articleHtmlLength: source.articleHtml.length,
    credentialsConfigured: Boolean(config.wechatApi.appid && config.wechatApi.appsecret),
  });

  if (options.dryRun) {
    console.log('dry-run 完成:本地草稿可进入上传流程。');
    return;
  }

  if (options.ensureDraft) {
    const ensured = await ensureWechatDraft({
      account: config.accountExact,
      draftDir: source.dir,
      source,
      bodyImages,
      existing,
      publishedProof: options.ensurePublishedProof,
    });
    console.log(
      ensured.state === 'published_externally'
        ? '✓ 已核验为外部公开发布，未创建或修改草稿'
        : `✓ 已核验微信草稿箱，操作=${ensured.operation}`
    );
    return;
  }

  if (options.updateMediaId) {
    const result = await updateWechatDraft(source, bodyImages, options.updateMediaId, options.replaceTitleFrom);
    await writeWechatDraftMeta({
      draftDir: source.dir,
      account: config.accountExact,
      postType: source.postType,
      title: source.title,
      result,
      operation: 'update',
      existing,
    });
    console.log('✓ 已原位更新并写入微信草稿箱');
    return;
  }

  await assertNoDraftMetaUnlessForced(source.dir, options.force);
  const result = await createWechatDraft(source, bodyImages);
  await writeWechatDraftMeta({
    draftDir: source.dir,
    account: config.accountExact,
    postType: source.postType,
    title: source.title,
    result,
    operation: 'create',
  });
  console.log('✓ 已创建并写入微信草稿箱');
}

if (isMain(import.meta.url)) runCli(run);
