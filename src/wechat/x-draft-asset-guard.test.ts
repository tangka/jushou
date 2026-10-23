import '../test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config/index.js';
import { testOperatorProfile, writeTestOperatorProfile } from '../test-support/operator-profile-fixture.js';
import { trustedXMaterialDirs } from './x-draft-asset-guard.js';

test('shared material roots are configured parent pools, never an implicit personal source tree', async () => {
  const pool = path.join(config.vaultPath, '示例共享池');
  const unrelated = path.join(config.vaultPath, '未配置池', '项目', '素材库');
  const accountMaterials = path.join(config.vaultPath, '微信公众号', 'Example Lab', '素材库');
  const sharedMaterials = path.join(pool, '项目', '素材库');
  await Promise.all([sharedMaterials, accountMaterials, unrelated].map(dir => fs.mkdir(dir, { recursive: true })));
  await fs.symlink(unrelated, path.join(pool, '外链'), 'dir');
  writeTestOperatorProfile({ ...testOperatorProfile, resources: { materialRoots: ['示例共享池'] } });
  try {
    const result = await trustedXMaterialDirs();
    assert.ok(result.includes(sharedMaterials));
    assert.ok(result.includes(accountMaterials));
    assert.ok(!result.includes(pool));
    assert.ok(!result.includes(unrelated));
    assert.equal(result.length, new Set(result).size);
    writeTestOperatorProfile();
    assert.ok(!(await trustedXMaterialDirs()).includes(sharedMaterials));
  } finally {
    writeTestOperatorProfile();
  }
});
