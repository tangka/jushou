import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { load } from 'cheerio';
import type { DraftImageRef, DraftUploadSource, WechatDraftResult } from './draft-api.js';
import { createWechatDraft, updateWechatDraft } from './draft-api.js';
import { type EnsureDraftOperation, ensureRemoteDraft } from './draft-ensure-core.js';
import type {
  ArticleIdentity,
  RemoteDraftArticle,
  RemotePublishedArticle,
  ReplacementJournal,
} from './draft-lifecycle.js';
import { type ExistingDraftMeta, writeWechatDraftMeta, writeWechatDraftTerminalState } from './draft-meta.js';
import { createAtomicDraftJournalStore } from './draft-operation-journal.js';
import {
  deleteWechatDraftArticle,
  listWechatDraftArticlesByTitle,
  listWechatPublishedArticlesByTitle,
  readWechatDraftArticle,
  type WechatRemoteArticle,
} from './draft-remote-api.js';

export type EnsureWechatDraftInput = {
  account: string;
  draftDir: string;
  source: DraftUploadSource;
  bodyImages: readonly DraftImageRef[];
  existing?: ExistingDraftMeta;
  publishedProof?: 'absent' | 'exact';
};

export type EnsureWechatDraftOutput = {
  state: 'draft_exact' | 'published_externally';
  operation: EnsureDraftOperation;
};

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function imageFingerprint(image: DraftImageRef): Promise<string> {
  return hash(await fs.readFile(image.filePath));
}

async function localIdentity(input: EnsureWechatDraftInput): Promise<ArticleIdentity> {
  const postType = input.source.postType === '贴图' ? 'newspic' : 'news';
  const images = input.source.postType === '贴图' ? input.source.stickerImages : input.bodyImages;
  const imageHashes = await Promise.all(images.map(imageFingerprint));
  const coverHash = postType === 'news' ? hash(await fs.readFile(input.source.coverPath)) : '';
  return {
    title: input.source.title,
    postType,
    fingerprint: `local:${hash(
      JSON.stringify({
        account: input.account,
        postType,
        title: input.source.title,
        author: input.source.author,
        digest: input.source.digest,
        contentSourceUrl: input.source.contentSourceUrl ?? '',
        content: postType === 'newspic' ? input.source.stickerContent : input.source.articleHtml,
        coverHash,
        imageHashes,
      })
    )}`,
  };
}

function normalizedRemoteHtml(value: string): string {
  if (!value.trim()) return '';
  const $ = load(value, {}, false);
  $('img').each((_index, element) => {
    $(element).attr('src', '__WECHAT_IMAGE__');
    if ($(element).attr('data-src')) $(element).attr('data-src', '__WECHAT_IMAGE__');
  });
  return $.html().replace(/\s+/gu, ' ').trim();
}

function remoteFingerprint(record: WechatRemoteArticle): string {
  return `remote:${hash(
    JSON.stringify({
      title: record.title,
      postType: record.postType,
      content: record.postType === 'news' ? normalizedRemoteHtml(record.content) : record.content,
      author: record.author,
      digest: record.digest,
      contentSourceUrl: record.contentSourceUrl,
      thumbMediaId: record.thumbMediaId,
      imageMediaIds: record.imageMediaIds,
    })
  )}`;
}

function operationId(account: string, target: ArticleIdentity): string {
  return `ensure-${hash(JSON.stringify({ account, ...target })).slice(0, 24)}`;
}

function sanitizedFailure(state: string, code: string | undefined): Error {
  return new Error(`确保微信草稿失败:state=${state},code=${code ?? 'unknown'}。未报告草稿箱完成。`);
}

function publishedProofFallback(
  proof: EnsureWechatDraftInput['publishedProof'],
  target: ArticleIdentity,
  error: unknown
): RemotePublishedArticle[] {
  if (proof === 'exact') return [target];
  if (proof === 'absent') return [];
  throw error;
}

export async function ensureWechatDraft(input: EnsureWechatDraftInput): Promise<EnsureWechatDraftOutput> {
  const target = await localIdentity(input);
  const journalStore = createAtomicDraftJournalStore(input.draftDir);
  let currentJournal: ReplacementJournal | undefined;
  const resultByRef = new Map<string, WechatDraftResult>();
  const identityOverride = new Set<string>();

  const toDraft = (record: WechatRemoteArticle): RemoteDraftArticle => {
    const observedFingerprint = remoteFingerprint(record);
    const trustedByMeta =
      input.existing?.mediaId === record.ref &&
      input.existing.contentFingerprint === target.fingerprint &&
      input.existing.remoteFingerprint === observedFingerprint;
    const trustedByJournal = currentJournal?.newDraftRef === record.ref;
    return {
      ref: record.ref,
      title: record.title,
      postType: record.postType,
      fingerprint:
        identityOverride.has(record.ref) || trustedByMeta || trustedByJournal
          ? target.fingerprint
          : observedFingerprint,
    };
  };
  const drafts = {
    listByTitle: async (title: string) => (await listWechatDraftArticlesByTitle(title)).map(toDraft),
    read: async (ref: string) => {
      const record = await readWechatDraftArticle(ref);
      return record ? toDraft(record) : undefined;
    },
    create: async () => {
      const result = await createWechatDraft(input.source, input.bodyImages);
      resultByRef.set(result.mediaId, result);
      identityOverride.add(result.mediaId);
      return result.mediaId;
    },
    remove: deleteWechatDraftArticle,
  };
  const published = {
    listByTitle: async (title: string): Promise<RemotePublishedArticle[]> => {
      let records: WechatRemoteArticle[];
      try {
        records = await listWechatPublishedArticlesByTitle(title);
      } catch (error) {
        return publishedProofFallback(input.publishedProof, target, error);
      }
      return records.map(record => {
        const observed = remoteFingerprint(record);
        const trustedByMeta =
          input.existing?.contentFingerprint === target.fingerprint && input.existing.remoteFingerprint === observed;
        return {
          title: record.title,
          postType: record.postType,
          fingerprint: trustedByMeta ? target.fingerprint : observed,
        };
      });
    },
  };
  const journal = {
    load: async (id: string) => {
      currentJournal = await journalStore.load(id);
      return currentJournal;
    },
    save: async (value: ReplacementJournal) => {
      await journalStore.save(value);
      currentJournal = value;
    },
  };
  const update = async (ref: string) => {
    const result = await updateWechatDraft(input.source, input.bodyImages, ref, input.existing?.title);
    resultByRef.set(result.mediaId, result);
    identityOverride.add(result.mediaId);
  };

  const ensured = await ensureRemoteDraft(operationId(input.account, target), target, {
    drafts,
    published,
    journal,
    update,
    readPinnedDraft: async () => {
      if (!input.existing) return undefined;
      const record = await readWechatDraftArticle(input.existing.mediaId);
      if (!record) return undefined;
      if (!input.existing.title || record.title !== input.existing.title) {
        throw new Error('本地草稿元数据原标题与远端草稿不一致，拒绝确保草稿');
      }
      return toDraft(record);
    },
  });
  if (ensured.outcome !== 'complete' || !ensured.operation) throw sanitizedFailure(ensured.state, ensured.code);
  if (ensured.state === 'published_externally') {
    await writeWechatDraftTerminalState({
      draftDir: input.draftDir,
      account: input.account,
      title: input.source.title,
      state: ensured.state,
      operation: ensured.operation,
    });
    return { state: ensured.state, operation: ensured.operation };
  }
  if (ensured.state !== 'draft_exact' || !ensured.ref) throw sanitizedFailure(ensured.state, ensured.code);

  const remote = await readWechatDraftArticle(ensured.ref);
  if (!remote) throw sanitizedFailure('unknown', 'final_readback_failed');
  const uploadResult = resultByRef.get(ensured.ref) ?? {
    mediaId: ensured.ref,
    uploadedBodyImages: {},
    ...(remote.thumbMediaId ? { thumbMediaId: remote.thumbMediaId } : {}),
    ...(remote.imageMediaIds.length > 0 ? { uploadedStickerImages: remote.imageMediaIds } : {}),
  };
  await writeWechatDraftMeta({
    draftDir: input.draftDir,
    account: input.account,
    postType: input.source.postType,
    title: input.source.title,
    result: uploadResult,
    operation: ensured.operation === 'noop_published' ? 'noop_draft' : ensured.operation,
    existing: input.existing,
    contentFingerprint: target.fingerprint,
    remoteFingerprint: remoteFingerprint(remote),
  });
  await writeWechatDraftTerminalState({
    draftDir: input.draftDir,
    account: input.account,
    title: input.source.title,
    state: ensured.state,
    operation: ensured.operation,
  });
  return { state: ensured.state, operation: ensured.operation };
}

export const draftEnsureInternals = { normalizedRemoteHtml, publishedProofFallback, remoteFingerprint };
