import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const X_ASSET_MANIFEST_FILE = '.x-asset-manifest.json';
const X_ASSET_MANIFEST_VERSION = 2;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_ID_PATTERN = /^(?:x:\d{10,}|material:[^\s]+)$/u;

export type XAssetVariant = 'cover' | 'content' | 'original';
export type XAssetManifestVariant = XAssetVariant | 'unclassified';
export type XAssetPostType = 'news' | 'newspic';

export type XAssetHashRecord = {
  variant: XAssetVariant;
  sourcePaths: readonly string[];
  sourceIds: readonly string[];
};

export type XAssetHashIndex = ReadonlyMap<string, XAssetHashRecord>;

export type XAssetManifestEntry = {
  file: string;
  sha256: string;
  variant: XAssetManifestVariant;
  source_ids: string[];
};

export type XAssetManifest = {
  schema_version: 2;
  post_type: XAssetPostType;
  files: XAssetManifestEntry[];
};

export type GenerateXAssetManifestOptions = {
  draftDir: string;
  materialsDir: string | readonly string[];
  postType: XAssetPostType;
  imagePaths: readonly string[];
};

export type VerifyXAssetManifestOptions = {
  draftDir: string;
  postType: XAssetPostType;
  imagePaths: readonly string[];
  materialsDir?: string | readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPortableRelativePath(value: string): string {
  return value.split(path.sep).join('/');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function classifyMaterialPath(relativePath: string): XAssetVariant | undefined {
  const portable = toPortableRelativePath(relativePath).toLowerCase();
  const segments = portable.split('/');
  const filename = segments.at(-1);
  if (filename === 'cover.png') return 'cover';
  if (filename === 'content.png') return 'content';
  const parent = segments.at(-2);
  if (
    parent === 'media' &&
    filename &&
    /^(?:photo(?:[_-]?\d+)?|article(?:\d+|-cover))\.(?:jpe?g|png|webp)$/u.test(filename)
  ) {
    return 'original';
  }
  return undefined;
}

async function listMaterialAssets(
  rootDir: string,
  currentDir = rootDir
): Promise<Array<{ path: string; variant: XAssetVariant }>> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const assets: Array<{ path: string; variant: XAssetVariant }> = [];
  for (const entry of entries) {
    const candidate = path.join(currentDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      assets.push(...(await listMaterialAssets(rootDir, candidate)));
      continue;
    }
    if (!entry.isFile()) continue;
    const variant = classifyMaterialPath(path.relative(rootDir, candidate));
    if (variant) assets.push({ path: candidate, variant });
  }
  return assets;
}

export async function sha256File(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function materialSourceDir(assetPath: string, variant: XAssetVariant): string {
  return variant === 'original' ? path.dirname(path.dirname(assetPath)) : path.dirname(assetPath);
}

function xPostIdFromPostJson(value: unknown): string | undefined {
  if (!isRecord(value)) throw new Error('X 素材 post.json 结构异常。');
  const directIds = new Set<string>();
  for (const field of ['tweet_id', 'id', 'id_str']) {
    const candidate = value[field];
    if (typeof candidate === 'string' && /^\d{10,}$/u.test(candidate)) directIds.add(candidate);
  }
  if (directIds.size > 1) throw new Error('X 素材 post.json 的来源 ID 互相冲突。');
  const directId = [...directIds][0];
  if (directId) return directId;

  const urlIds = new Set<string>();
  for (const field of ['url', 'source_url']) {
    const candidate = value[field];
    if (typeof candidate !== 'string') continue;
    const id = /^(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[^/\s]+\/status\/(\d{10,})(?:[/?#].*)?$/u.exec(
      candidate
    )?.[1];
    if (id) urlIds.add(id);
  }
  if (urlIds.size > 1) throw new Error('X 素材 post.json 的来源 URL 互相冲突。');
  return [...urlIds][0];
}

async function materialSourceId(rootDir: string, assetPath: string, variant: XAssetVariant): Promise<string> {
  const sourceDir = materialSourceDir(assetPath, variant);
  const postJsonPath = path.join(sourceDir, 'post.json');
  let postId: string | undefined;
  let postJsonText: string | undefined;
  try {
    postJsonText = await fs.readFile(postJsonPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`X 素材来源文件不可读:${postJsonPath}`, { cause: error });
    }
  }
  if (postJsonText !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(postJsonText) as unknown;
    } catch (error) {
      throw new Error(`X 素材来源文件损坏:${postJsonPath}`, { cause: error });
    }
    postId = xPostIdFromPostJson(parsed);
  }
  const directoryPostId = /(?:^|[_-])(\d{10,})(?:$|[_-])/u.exec(path.basename(sourceDir))?.[1];
  if (postId && directoryPostId && postId !== directoryPostId) {
    throw new Error(`X 素材 post.json 与来源目录 ID 不一致:${sourceDir}`);
  }
  if (postId ?? directoryPostId) return `x:${postId ?? directoryPostId}`;
  return `material:${encodeURIComponent(toPortableRelativePath(path.relative(rootDir, sourceDir)))}`;
}

/** 扫描调用方明确传入的可信素材库集合，并用原始 X post ID 记录来源。 */
export async function buildXAssetHashIndex(materialsDir: string | readonly string[]): Promise<XAssetHashIndex> {
  const roots = [
    ...new Set((typeof materialsDir === 'string' ? [materialsDir] : materialsDir).map(dir => path.resolve(dir))),
  ];
  if (roots.length === 0) throw new Error('X 素材索引路径为空，拒绝继续。');

  const mutable = new Map<string, { variant: XAssetVariant; sourcePaths: string[]; sourceIds: string[] }>();
  for (const rootDir of roots) {
    const stat = await fs.stat(rootDir);
    if (!stat.isDirectory()) throw new Error('X 素材索引路径不是目录，拒绝继续。');
    for (const asset of await listMaterialAssets(rootDir)) {
      const hash = await sha256File(asset.path);
      const sourcePath = toPortableRelativePath(path.relative(rootDir, asset.path));
      const sourceId = await materialSourceId(rootDir, asset.path, asset.variant);
      const existing = mutable.get(hash);
      if (existing && existing.variant !== asset.variant) {
        throw new Error(`X 素材哈希同时属于 ${existing.variant} 与 ${asset.variant}，分类冲突，已拒绝继续。`);
      }
      if (existing) {
        if (!existing.sourcePaths.includes(sourcePath)) existing.sourcePaths.push(sourcePath);
        if (!existing.sourceIds.includes(sourceId)) existing.sourceIds.push(sourceId);
      } else {
        mutable.set(hash, { variant: asset.variant, sourcePaths: [sourcePath], sourceIds: [sourceId] });
      }
    }
  }

  return new Map(
    [...mutable].map(([hash, record]) => [
      hash,
      {
        variant: record.variant,
        sourcePaths: [...record.sourcePaths].sort(),
        sourceIds: [...record.sourceIds].sort(),
      } satisfies XAssetHashRecord,
    ])
  );
}

export function assertXAssetVariantAllowed(postType: XAssetPostType, variant: XAssetManifestVariant): void {
  if (variant === 'unclassified' || variant === 'original') return;
  if (postType === 'news' && variant === 'cover') {
    throw new Error('公众号图文正文禁止使用 X cover 变体；请改用紧裁 content.png 或 media/photo 原图。');
  }
  if (postType === 'newspic' && variant === 'content') {
    throw new Error('公众号贴图禁止使用紧裁 X content 变体；请保留上下区域并改用 cover.png 或 media/photo 原图。');
  }
}

async function resolveDraftFile(draftDir: string, filePath: string): Promise<{ absolute: string; relative: string }> {
  const resolvedDraftDir = path.resolve(draftDir);
  const draftStat = await fs.stat(resolvedDraftDir);
  if (!draftStat.isDirectory()) throw new Error('草稿路径不是目录，拒绝生成 X 素材清单。');

  const candidate = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(resolvedDraftDir, filePath);
  if (!isInside(resolvedDraftDir, candidate)) throw new Error('X 素材清单只允许引用草稿目录内文件。');
  const candidateStat = await fs.lstat(candidate);
  if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
    throw new Error('X 素材清单只允许草稿目录内的普通文件。');
  }

  const realDraftDir = await fs.realpath(resolvedDraftDir);
  const realCandidate = await fs.realpath(candidate);
  if (!isInside(realDraftDir, realCandidate)) throw new Error('X 素材文件越过草稿目录边界，已拒绝继续。');
  return {
    absolute: candidate,
    relative: toPortableRelativePath(path.relative(resolvedDraftDir, candidate)),
  };
}

async function normalizeDraftFiles(draftDir: string, imagePaths: readonly string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const imagePath of imagePaths) {
    const resolved = await resolveDraftFile(draftDir, imagePath);
    files.set(resolved.relative, resolved.absolute);
  }
  return files;
}

export async function generateXAssetManifest(options: GenerateXAssetManifestOptions): Promise<XAssetManifest> {
  const index = await buildXAssetHashIndex(options.materialsDir);
  const draftFiles = await normalizeDraftFiles(options.draftDir, options.imagePaths);
  const files: XAssetManifestEntry[] = [];
  for (const [relative, absolute] of [...draftFiles].sort(([left], [right]) => left.localeCompare(right))) {
    const sha256 = await sha256File(absolute);
    const indexed = index.get(sha256);
    const variant = indexed?.variant ?? 'unclassified';
    assertXAssetVariantAllowed(options.postType, variant);
    files.push({ file: relative, sha256, variant, source_ids: [...(indexed?.sourceIds ?? [])] });
  }
  return { schema_version: X_ASSET_MANIFEST_VERSION, post_type: options.postType, files };
}

function parseManifestEntry(value: unknown, seenPaths: Set<string>): XAssetManifestEntry {
  if (!isRecord(value)) throw new Error(`${X_ASSET_MANIFEST_FILE} 文件条目结构异常。`);
  const file = value.file;
  const sha256 = value.sha256;
  const variant = value.variant;
  const sourceIds = value.source_ids;
  if (typeof file !== 'string' || file.length === 0 || path.isAbsolute(file) || file.includes('\\')) {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 含非法草稿相对路径。`);
  }
  const normalized = path.posix.normalize(file);
  if (normalized !== file || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 含越界草稿路径。`);
  }
  if (seenPaths.has(file)) throw new Error(`${X_ASSET_MANIFEST_FILE} 含重复文件条目。`);
  seenPaths.add(file);
  if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 含非法 SHA-256。`);
  }
  if (variant !== 'cover' && variant !== 'content' && variant !== 'original' && variant !== 'unclassified') {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 含未知 X 素材变体。`);
  }
  if (
    !Array.isArray(sourceIds) ||
    sourceIds.some(sourceId => typeof sourceId !== 'string' || !SOURCE_ID_PATTERN.test(sourceId)) ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 含非法或重复的素材来源 ID。`);
  }
  if (variant !== 'unclassified' && sourceIds.length === 0) {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 已分类 X 素材缺少来源 ID。`);
  }
  return { file, sha256, variant, source_ids: [...sourceIds].sort() };
}

function parseXAssetManifest(value: unknown): XAssetManifest {
  if (!isRecord(value) || value.schema_version !== X_ASSET_MANIFEST_VERSION) {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 版本或结构异常。`);
  }
  const postType = value.post_type;
  if (postType !== 'news' && postType !== 'newspic') {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 含未知草稿类型。`);
  }
  if (!Array.isArray(value.files)) throw new Error(`${X_ASSET_MANIFEST_FILE} 缺少文件条目。`);
  const seenPaths = new Set<string>();
  return {
    schema_version: X_ASSET_MANIFEST_VERSION,
    post_type: postType,
    files: value.files.map(entry => parseManifestEntry(entry, seenPaths)),
  };
}

export async function writeXAssetManifest(draftDir: string, manifest: XAssetManifest): Promise<string> {
  const validated = parseXAssetManifest(manifest);
  const manifestPath = path.join(path.resolve(draftDir), X_ASSET_MANIFEST_FILE);
  const temporaryPath = `${manifestPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, manifestPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return manifestPath;
}

export async function generateAndWriteXAssetManifest(options: GenerateXAssetManifestOptions): Promise<XAssetManifest> {
  const manifest = await generateXAssetManifest(options);
  await writeXAssetManifest(options.draftDir, manifest);
  return manifest;
}

export async function readXAssetManifest(draftDir: string): Promise<XAssetManifest> {
  const manifestPath = path.join(path.resolve(draftDir), X_ASSET_MANIFEST_FILE);
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `无法读取 ${X_ASSET_MANIFEST_FILE}：${error instanceof SyntaxError ? 'JSON 格式错误。' : '文件不存在或不可读。'}`
    );
  }
  return parseXAssetManifest(value);
}

export async function verifyXAssetManifest(options: VerifyXAssetManifestOptions): Promise<XAssetManifest> {
  const manifest = await readXAssetManifest(options.draftDir);
  if (manifest.post_type !== options.postType) {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 草稿类型与本次上传不一致。`);
  }

  const draftFiles = await normalizeDraftFiles(options.draftDir, options.imagePaths);
  const manifestPaths = new Set(manifest.files.map(entry => entry.file));
  if (manifestPaths.size !== draftFiles.size || [...draftFiles.keys()].some(file => !manifestPaths.has(file))) {
    throw new Error(`${X_ASSET_MANIFEST_FILE} 未完整覆盖本次上传图片，已拒绝继续。`);
  }

  const currentIndex = options.materialsDir ? await buildXAssetHashIndex(options.materialsDir) : undefined;
  for (const entry of manifest.files) {
    assertXAssetVariantAllowed(options.postType, entry.variant);
    const absolute = draftFiles.get(entry.file);
    if (!absolute) throw new Error(`${X_ASSET_MANIFEST_FILE} 引用了非本次上传图片。`);
    const currentHash = await sha256File(absolute);
    if (currentHash !== entry.sha256) throw new Error(`${X_ASSET_MANIFEST_FILE} 图片哈希复核失败，文件已变化。`);
    if (currentIndex) {
      const currentRecord = currentIndex.get(currentHash);
      const currentVariant = currentRecord?.variant ?? 'unclassified';
      if (currentVariant !== entry.variant) {
        throw new Error(`${X_ASSET_MANIFEST_FILE} 素材分类与当前账号素材库不一致。`);
      }
      const currentSourceIds = [...(currentRecord?.sourceIds ?? [])].sort();
      if (JSON.stringify(currentSourceIds) !== JSON.stringify(entry.source_ids)) {
        throw new Error(`${X_ASSET_MANIFEST_FILE} 素材来源 ID 与可信素材库不一致。`);
      }
    }
  }
  return manifest;
}
