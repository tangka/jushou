import fs from 'node:fs/promises';
import path from 'node:path';
import type { WechatDraftResult } from './draft-api.js';

export const DRAFT_META_FILE = '.wechat-draft.json';
export const DRAFT_STATE_FILE = '.wechat-draft-state.json';

type DraftPostType = '图文' | '贴图';

export type ExistingDraftMeta = {
  mediaId: string;
  account: string;
  postType: DraftPostType;
  title: string | undefined;
  createdAt: string | undefined;
  contentFingerprint?: string;
  remoteFingerprint?: string;
};

function normalizedDraftPostType(postType: string | undefined): DraftPostType {
  return postType === '贴图' ? '贴图' : '图文';
}

function wechatArticleType(postType: DraftPostType): 'news' | 'newspic' {
  return postType === '贴图' ? 'newspic' : 'news';
}

export function assertDraftPostTypeUnchanged(
  existing: ExistingDraftMeta | undefined,
  sourcePostType: string | undefined
): void {
  if (!existing) return;
  const nextPostType = normalizedDraftPostType(sourcePostType);
  if (existing.postType === nextPostType) return;
  throw new Error(
    `微信不支持原位修改草稿类型(errcode=53403):${DRAFT_META_FILE} post_type=${existing.postType}(${wechatArticleType(existing.postType)}),当前稿源=${nextPostType}(${wechatArticleType(nextPostType)})。已在上传图片前拒绝更新;请保持原类型或另行新建草稿。`
  );
}

export function assertDraftTitleReplacement(
  existing: ExistingDraftMeta | undefined,
  replaceTitleFrom: string | undefined,
  sourceTitle: string
): void {
  if (!replaceTitleFrom) return;
  if (!existing?.title) throw new Error(`换题更新需要 ${DRAFT_META_FILE} 中保留原 title`);
  if (existing.title !== replaceTitleFrom) {
    throw new Error(
      `--replace-title-from 与 ${DRAFT_META_FILE} 不一致:参数=${replaceTitleFrom},本地原标题=${existing.title}。拒绝换题。`
    );
  }
  if (sourceTitle === replaceTitleFrom) {
    throw new Error('--replace-title-from 与本地新标题相同,无需使用换题参数');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getNonEmptyString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' && field.trim() ? field.trim() : undefined;
}

function normalizedAccount(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

export async function hasDraftMeta(draftDir: string): Promise<boolean> {
  const metaPath = path.join(draftDir, DRAFT_META_FILE);
  return fs.stat(metaPath).then(
    stat => stat.isFile(),
    () => false
  );
}

export async function assertNoDraftMetaUnlessForced(draftDir: string, force: boolean): Promise<void> {
  if (!force && (await hasDraftMeta(draftDir))) {
    throw new Error(`已存在 ${DRAFT_META_FILE},为避免重复创建草稿,请确认后加 --force`);
  }
}

export async function readExistingDraftMeta(
  draftDir: string,
  expectedAccount: string
): Promise<ExistingDraftMeta | undefined> {
  const metaPath = path.join(draftDir, DRAFT_META_FILE);
  const raw = await fs.readFile(metaPath, 'utf8').catch(() => undefined);
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${DRAFT_META_FILE} 不是合法 JSON:${metaPath}`);
  }
  if (!isRecord(parsed)) throw new Error(`${DRAFT_META_FILE} 结构异常:${metaPath}`);

  const mediaId = getNonEmptyString(parsed, 'media_id');
  if (!mediaId) throw new Error(`${DRAFT_META_FILE} 缺少 media_id:${metaPath}`);

  const account = getNonEmptyString(parsed, 'account');
  if (!account) throw new Error(`${DRAFT_META_FILE} 缺少 account:${metaPath}`);
  if (normalizedAccount(account) !== normalizedAccount(expectedAccount)) {
    throw new Error(
      `草稿元数据账号不匹配:${DRAFT_META_FILE} account=${account},当前上传账号=${expectedAccount}。拒绝更新。`
    );
  }

  const postType = getNonEmptyString(parsed, 'post_type');
  if (postType !== '图文' && postType !== '贴图') {
    throw new Error(
      `${DRAFT_META_FILE} 缺少或不支持 post_type:${metaPath}。无法确认现有微信草稿类型,为避免跨类型更新产生孤儿素材,拒绝更新。`
    );
  }

  return {
    mediaId,
    account,
    postType,
    title: getNonEmptyString(parsed, 'title'),
    createdAt: getNonEmptyString(parsed, 'created_at'),
    ...(getNonEmptyString(parsed, 'content_fingerprint')
      ? { contentFingerprint: getNonEmptyString(parsed, 'content_fingerprint') }
      : {}),
    ...(getNonEmptyString(parsed, 'remote_fingerprint')
      ? { remoteFingerprint: getNonEmptyString(parsed, 'remote_fingerprint') }
      : {}),
  };
}

export async function writeWechatDraftMeta(input: {
  draftDir: string;
  account: string;
  postType: string | undefined;
  title: string;
  result: WechatDraftResult;
  operation: 'create' | 'update' | 'replace' | 'noop_draft';
  existing?: ExistingDraftMeta;
  contentFingerprint?: string;
  remoteFingerprint?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const body = {
    account: input.account,
    post_type: normalizedDraftPostType(input.postType),
    title: input.title,
    media_id: input.result.mediaId,
    uploaded_body_images: input.result.uploadedBodyImages,
    ...(input.result.thumbMediaId ? { thumb_media_id: input.result.thumbMediaId } : {}),
    ...(input.result.uploadedStickerImages ? { uploaded_sticker_images: input.result.uploadedStickerImages } : {}),
    ...(input.contentFingerprint ? { content_fingerprint: input.contentFingerprint } : {}),
    ...(input.remoteFingerprint ? { remote_fingerprint: input.remoteFingerprint } : {}),
    draft_status: 'verified',
    verified_at: now,
    operation: input.operation,
    automation_published: false,
    created_at: input.existing?.createdAt ?? now,
    ...(input.operation !== 'create' ? { updated_at: now } : {}),
  };
  await fs.writeFile(path.join(input.draftDir, DRAFT_META_FILE), `${JSON.stringify(body, null, 2)}\n`);
}

async function atomicWriteJson(filePath: string, value: Record<string, unknown>): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

export async function writeWechatDraftTerminalState(input: {
  draftDir: string;
  account: string;
  title: string;
  state: 'draft_exact' | 'published_externally';
  operation: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const terminal = {
    account: input.account,
    title: input.title,
    draft_status: input.state,
    verified_at: now,
    operation: input.operation,
    automation_published: false,
  };
  await atomicWriteJson(path.join(input.draftDir, DRAFT_STATE_FILE), terminal);

  const metaPath = path.join(input.draftDir, DRAFT_META_FILE);
  const raw = await fs.readFile(metaPath, 'utf8').catch(() => undefined);
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${DRAFT_META_FILE} 不是合法 JSON:${metaPath}`);
  }
  if (!isRecord(parsed)) throw new Error(`${DRAFT_META_FILE} 结构异常:${metaPath}`);
  await atomicWriteJson(metaPath, { ...parsed, ...terminal });
}
