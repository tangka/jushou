import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { composeEnvironment } from './operator-compose.js';

test('Compose 只导出挂载路径，不将私有配置的凭据放入环境', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-compose-'));
  const file = path.join(root, 'custom-private.json');
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        env: {
          OBSIDIAN_VAULT: 'vault',
          OPENROUTER_API_KEY: 'synthetic-never-export',
          APPLET_CONFIGS: JSON.stringify([{ id: 'demo', name: '演示', dbPath: path.join(root, '.data', 'demo.db') }]),
        },
        accounts: [
          { id: 'demo', envAccount: '', name: '演示', env: { WECHAT_ACCOUNT_ROOT: path.join(root, 'vault', '账号') } },
        ],
        resources: { materialRoots: [path.join(root, 'vault', '素材')] },
      })
    );
    const env = composeEnvironment(root, { WECHAT_OPERATOR_PROFILE: file, PATH: '/usr/bin:/bin' });
    assert.equal(env.OBSIDIAN_VAULT_HOST, path.join(root, 'vault'));
    const mappedFile = path.join(root, '.data', 'operator-compose', 'operator.local.json');
    assert.equal(env.WECHAT_OPERATOR_PROFILE_HOST, mappedFile);
    const mapped = JSON.parse(fs.readFileSync(mappedFile, 'utf8'));
    assert.equal(mapped.accounts[0].env.WECHAT_ACCOUNT_ROOT, '/vault/账号');
    assert.deepEqual(mapped.resources.materialRoots, ['/vault/素材']);
    assert.equal(mapped.env.OBSIDIAN_VAULT, '/vault');
    assert.equal(JSON.parse(mapped.env.APPLET_CONFIGS)[0].dbPath, '/app/.data/demo.db');
    assert.equal(fs.statSync(mappedFile).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(fs.readFileSync(file, 'utf8')).accounts[0].env.WECHAT_ACCOUNT_ROOT,
      path.join(root, 'vault', '账号')
    );
    assert.equal(env.WECHAT_ENV_DIR_HOST, root);
    assert.equal(env.OPENROUTER_API_KEY, undefined);
    assert.equal(env.PATH, '/usr/bin:/bin');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('挂载边界外的运行路径阻断，错误不泄漏真实路径', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-compose-'));
  const file = path.join(root, 'private.json');
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        env: { OBSIDIAN_VAULT: 'vault', STATS_DB: path.join(root, 'vault-other', 'private.db') },
      })
    );
    assert.throws(() => composeEnvironment(root, { WECHAT_OPERATOR_PROFILE: file }), {
      message: 'Docker 路径未在挂载范围内: STATS_DB',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('缺失私有配置不让 Docker 将同名目录误当配置挂载', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-compose-'));
  try {
    assert.throws(() => composeEnvironment(root, { WECHAT_OPERATOR_PROFILE: path.join(root, 'missing.json') }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
