import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildXAssetHashIndex,
  generateAndWriteXAssetManifest,
  generateXAssetManifest,
  readXAssetManifest,
  sha256File,
  verifyXAssetManifest,
  writeXAssetManifest,
  X_ASSET_MANIFEST_FILE,
  type XAssetPostType,
} from './x-asset-guard.js';

type Fixture = {
  root: string;
  materialsDir: string;
  otherMaterialsDir: string;
  draftDir: string;
  coverPath: string;
  contentPath: string;
  originalPath: string;
};

async function makeFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-x-assets-'));
  const materialsDir = path.join(root, 'account-a', '素材库');
  const otherMaterialsDir = path.join(root, 'account-b', '素材库');
  const materialDir = path.join(materialsDir, '2026-08-14', 'post-1');
  const otherMaterialDir = path.join(otherMaterialsDir, '2026-08-14', 'post-2');
  const draftDir = path.join(root, 'account-a', '待发布', 'draft');
  await Promise.all([
    fs.mkdir(path.join(materialDir, 'media'), { recursive: true }),
    fs.mkdir(path.join(otherMaterialDir, 'media'), { recursive: true }),
    fs.mkdir(path.join(draftDir, 'media'), { recursive: true }),
  ]);

  const coverPath = path.join(materialDir, 'cover.png');
  const contentPath = path.join(materialDir, 'content.png');
  const originalPath = path.join(materialDir, 'media', 'photo1.jpg');
  await Promise.all([
    fs.writeFile(coverPath, 'x-cover-with-top-and-bottom'),
    fs.writeFile(contentPath, 'x-content-tightly-cropped'),
    fs.writeFile(originalPath, 'x-original-photo'),
    fs.writeFile(path.join(otherMaterialDir, 'content.png'), 'other-account-content'),
    fs.writeFile(
      path.join(materialDir, 'post.json'),
      JSON.stringify({
        tweet_id: '1111111111111111111',
        url: 'https://x.com/account_a/status/1111111111111111111',
      })
    ),
    fs.writeFile(
      path.join(otherMaterialDir, 'post.json'),
      JSON.stringify({ url: 'https://x.com/account_b/status/2222222222222222222' })
    ),
  ]);
  return { root, materialsDir, otherMaterialsDir, draftDir, coverPath, contentPath, originalPath };
}

async function copyIntoDraft(fixture: Fixture, source: string, filename: string): Promise<string> {
  const target = path.join(fixture.draftDir, 'media', filename);
  await fs.copyFile(source, target);
  return target;
}

async function generateFor(
  fixture: Fixture,
  postType: XAssetPostType,
  imagePaths: readonly string[]
): ReturnType<typeof generateXAssetManifest> {
  return generateXAssetManifest({
    draftDir: fixture.draftDir,
    materialsDir: fixture.materialsDir,
    postType,
    imagePaths,
  });
}

test('builds a recursive SHA-256 index for cover, content and media/photo variants', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const index = await buildXAssetHashIndex(fixture.materialsDir);

  assert.equal(index.get(await sha256File(fixture.coverPath))?.variant, 'cover');
  assert.equal(index.get(await sha256File(fixture.contentPath))?.variant, 'content');
  assert.equal(index.get(await sha256File(fixture.originalPath))?.variant, 'original');
  assert.deepEqual(index.get(await sha256File(fixture.contentPath))?.sourceIds, ['x:1111111111111111111']);
});

test('X Article originals retain provenance after copying and reject changed bytes or card conflicts', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const originals = ['article1.jpg', 'article7.png', 'article-cover.jpg'];
  const images: string[] = [];
  for (const filename of originals) {
    const source = path.join(path.dirname(fixture.originalPath), filename);
    await fs.writeFile(source, `original-${filename}`);
    images.push(await copyIntoDraft(fixture, source, `copied-${filename}`));
  }
  const manifest = await generateAndWriteXAssetManifest({
    draftDir: fixture.draftDir,
    materialsDir: fixture.materialsDir,
    postType: 'news',
    imagePaths: images,
  });
  assert.ok(manifest.files.every(entry => entry.variant === 'original'));
  assert.ok(manifest.files.every(entry => entry.source_ids.join() === 'x:1111111111111111111'));
  const options = { draftDir: fixture.draftDir, postType: 'news' as const, imagePaths: images };
  await assert.doesNotReject(() => verifyXAssetManifest(options));
  const firstImage = images[0];
  assert.ok(firstImage);
  await fs.writeFile(firstImage, 'changed-after-copy');
  await assert.rejects(() => verifyXAssetManifest(options), /哈希复核失败/u);
  await fs.copyFile(fixture.coverPath, path.join(path.dirname(fixture.originalPath), 'article2.jpg'));
  await assert.rejects(() => buildXAssetHashIndex(fixture.materialsDir), /分类冲突/u);
});

test('news rejects a copied and renamed X cover but allows content and original photos', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const renamedCover = await copyIntoDraft(fixture, fixture.coverPath, 'evidence.png');
  const renamedContent = await copyIntoDraft(fixture, fixture.contentPath, 'tweet.png');
  const renamedOriginal = await copyIntoDraft(fixture, fixture.originalPath, 'source.jpg');

  await assert.rejects(() => generateFor(fixture, 'news', [renamedCover]), /图文正文禁止使用 X cover/u);
  const manifest = await generateFor(fixture, 'news', [renamedContent, renamedOriginal]);
  assert.deepEqual(manifest.files.map(entry => entry.variant).sort(), ['content', 'original']);
});

test('newspic preserves X top and bottom by rejecting content while allowing cover and original photos', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const renamedCover = await copyIntoDraft(fixture, fixture.coverPath, 'full-card.png');
  const renamedContent = await copyIntoDraft(fixture, fixture.contentPath, 'cropped-card.png');
  const renamedOriginal = await copyIntoDraft(fixture, fixture.originalPath, 'source.jpg');

  await assert.rejects(() => generateFor(fixture, 'newspic', [renamedContent]), /贴图禁止使用紧裁 X content/u);
  const manifest = await generateFor(fixture, 'newspic', [renamedCover, renamedOriginal]);
  assert.deepEqual(manifest.files.map(entry => entry.variant).sort(), ['cover', 'original']);
});

test('hash classification conflicts fail closed', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await fs.copyFile(fixture.coverPath, fixture.contentPath);

  await assert.rejects(() => buildXAssetHashIndex(fixture.materialsDir), /分类冲突/u);
});

test('damaged or conflicting post.json provenance fails closed', async t => {
  const damaged = await makeFixture();
  const conflicting = await makeFixture();
  t.after(() => fs.rm(damaged.root, { recursive: true, force: true }));
  t.after(() => fs.rm(conflicting.root, { recursive: true, force: true }));
  await fs.writeFile(path.join(damaged.materialsDir, '2026-08-14', 'post-1', 'post.json'), '{not-valid-json');
  await fs.writeFile(
    path.join(conflicting.materialsDir, '2026-08-14', 'post-1', 'post.json'),
    JSON.stringify({
      tweet_id: '1111111111111111111',
      id_str: '9999999999999999999',
      url: 'https://x.com/account_a/status/1111111111111111111',
    })
  );

  await assert.rejects(() => buildXAssetHashIndex(damaged.materialsDir), /来源文件损坏/u);
  await assert.rejects(() => buildXAssetHashIndex(conflicting.materialsDir), /来源 ID 互相冲突/u);
});

test('explicit roots control classification and shared roots retain the original X post ID', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const foreignContent = path.join(fixture.otherMaterialsDir, '2026-08-14', 'post-2', 'content.png');
  const renamedForeignContent = await copyIntoDraft(fixture, foreignContent, 'foreign-renamed.png');

  const localManifest = await generateFor(fixture, 'newspic', [renamedForeignContent]);
  assert.equal(localManifest.files[0]?.variant, 'unclassified');
  assert.deepEqual(localManifest.files[0]?.source_ids, []);
  const sharedManifest = await generateXAssetManifest({
    draftDir: fixture.draftDir,
    materialsDir: [fixture.materialsDir, fixture.otherMaterialsDir],
    postType: 'news',
    imagePaths: [renamedForeignContent],
  });
  assert.equal(sharedManifest.files[0]?.variant, 'content');
  assert.deepEqual(sharedManifest.files[0]?.source_ids, ['x:2222222222222222222']);
  await assert.rejects(
    () =>
      generateXAssetManifest({
        draftDir: fixture.draftDir,
        materialsDir: fixture.otherMaterialsDir,
        postType: 'newspic',
        imagePaths: [renamedForeignContent],
      }),
    /贴图禁止使用紧裁 X content/u
  );
});

test('manifest round-trip verifies exact image set, hashes and current account classification', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const content = await copyIntoDraft(fixture, fixture.contentPath, 'tweet-renamed.png');
  const generated = await generateAndWriteXAssetManifest({
    draftDir: fixture.draftDir,
    materialsDir: fixture.materialsDir,
    postType: 'news',
    imagePaths: [content],
  });

  assert.deepEqual(await readXAssetManifest(fixture.draftDir), generated);
  await assert.doesNotReject(() =>
    verifyXAssetManifest({
      draftDir: fixture.draftDir,
      materialsDir: fixture.materialsDir,
      postType: 'news',
      imagePaths: [content],
    })
  );

  const extra = path.join(fixture.draftDir, 'media', 'extra.png');
  await fs.writeFile(extra, 'not-from-x');
  await assert.rejects(
    () => verifyXAssetManifest({ draftDir: fixture.draftDir, postType: 'news', imagePaths: [content, extra] }),
    /未完整覆盖/u
  );

  await fs.writeFile(content, 'changed-after-manifest');
  await assert.rejects(
    () => verifyXAssetManifest({ draftDir: fixture.draftDir, postType: 'news', imagePaths: [content] }),
    /哈希复核失败/u
  );
});

test('manifest verification rejects post type changes and a forged forbidden variant', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const cover = await copyIntoDraft(fixture, fixture.coverPath, 'card.png');
  const coverHash = await sha256File(cover);
  await writeXAssetManifest(fixture.draftDir, {
    schema_version: 2,
    post_type: 'newspic',
    files: [
      {
        file: 'media/card.png',
        sha256: coverHash,
        variant: 'cover',
        source_ids: ['x:1111111111111111111'],
      },
    ],
  });

  await assert.rejects(
    () => verifyXAssetManifest({ draftDir: fixture.draftDir, postType: 'news', imagePaths: [cover] }),
    /草稿类型与本次上传不一致/u
  );

  await fs.writeFile(
    path.join(fixture.draftDir, X_ASSET_MANIFEST_FILE),
    `${JSON.stringify({
      schema_version: 2,
      post_type: 'news',
      files: [
        {
          file: 'media/card.png',
          sha256: coverHash,
          variant: 'cover',
          source_ids: ['x:1111111111111111111'],
        },
      ],
    })}\n`
  );
  await assert.rejects(
    () => verifyXAssetManifest({ draftDir: fixture.draftDir, postType: 'news', imagePaths: [cover] }),
    /图文正文禁止使用 X cover/u
  );
});

test('manifest reader rejects traversal and duplicate paths', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const hash = 'a'.repeat(64);
  const manifestPath = path.join(fixture.draftDir, X_ASSET_MANIFEST_FILE);

  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 2,
      post_type: 'news',
      files: [{ file: '../outside.png', sha256: hash, variant: 'unclassified', source_ids: [] }],
    })
  );
  await assert.rejects(() => readXAssetManifest(fixture.draftDir), /越界草稿路径/u);

  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 2,
      post_type: 'news',
      files: [
        { file: 'media/a.png', sha256: hash, variant: 'unclassified', source_ids: [] },
        { file: 'media/a.png', sha256: hash, variant: 'unclassified', source_ids: [] },
      ],
    })
  );
  await assert.rejects(() => readXAssetManifest(fixture.draftDir), /重复文件条目/u);
});

test('classified X assets require a source ID in schema v2', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.draftDir, X_ASSET_MANIFEST_FILE);
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 2,
      post_type: 'news',
      files: [{ file: 'media/card.png', sha256: 'a'.repeat(64), variant: 'content', source_ids: [] }],
    })
  );
  await assert.rejects(() => readXAssetManifest(fixture.draftDir), /缺少来源 ID/u);
});

test('draft files cannot escape through absolute paths or symlinks', async t => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const outside = path.join(fixture.root, 'outside.png');
  await fs.writeFile(outside, 'outside');
  await assert.rejects(() => generateFor(fixture, 'news', [outside]), /草稿目录内/u);

  const linked = path.join(fixture.draftDir, 'media', 'linked.png');
  await fs.symlink(outside, linked);
  await assert.rejects(() => generateFor(fixture, 'news', [linked]), /普通文件/u);
});
