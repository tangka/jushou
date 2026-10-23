import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { z } from 'zod';
import { config } from '../config/index.js';
import { loadOperatorProfile } from '../config/operator-profile.js';
import { generateAndWriteXAssetManifest, verifyXAssetManifest, type XAssetPostType } from './x-asset-guard.js';

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(candidate);
    return !stat.isSymbolicLink() && stat.isDirectory();
  } catch {
    return false;
  }
}

async function collectNamedMaterialDirs(parentDir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(parentDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate =
      entry.name === '素材库' ? path.join(parentDir, entry.name) : path.join(parentDir, entry.name, '素材库');
    if (await isDirectory(candidate)) directories.push(candidate);
  }
  return directories;
}

export async function trustedXMaterialDirs(): Promise<string[]> {
  const officialAccounts = path.join(config.vaultPath, '微信公众号');
  const extraRoots = z.array(z.string().trim().min(1)).parse(loadOperatorProfile().resources.materialRoots ?? []);
  const extraPools = await Promise.all(
    extraRoots.map(root => collectNamedMaterialDirs(path.resolve(config.vaultPath, root)))
  );
  const directories = new Set<string>([
    path.resolve(config.paths.materialsDir),
    ...(await collectNamedMaterialDirs(officialAccounts)).map(dir => path.resolve(dir)),
    ...extraPools.flat().map(dir => path.resolve(dir)),
  ]);
  return [...directories].sort();
}

export async function validateDraftXAssets(
  draftDir: string,
  postType: XAssetPostType,
  imagePaths: readonly string[]
): Promise<void> {
  const options = { draftDir, postType, imagePaths };
  if (process.env.WOA_REMOTE_UPLOAD === '1') {
    await verifyXAssetManifest(options);
    return;
  }
  await generateAndWriteXAssetManifest({ ...options, materialsDir: await trustedXMaterialDirs() });
}
