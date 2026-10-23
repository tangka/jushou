import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadOperatorProfile } from '../dist/config/operator-profile.js';
import { posterConfig, projectRoot, remoteProjection } from './operator-config.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-scripts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'operator.json');
  const raw = {
    version: 1,
    env: { OPENROUTER_API_KEY: 'shared-secret-fixture', OBSIDIAN_VAULT: '/private/local/vault' },
    accounts: [
      {
        id: 'alpha',
        envAccount: '',
        name: 'Alpha',
        env: { WECHAT_APPID: 'app-alpha', WECHAT_APPSECRET: 'secret-alpha', OPENROUTER_API_KEY: 'alpha-ai-secret' },
        policy: {
          newsOnly: true,
          miniProgram: { appid: 'mini-alpha', path: 'pages/index/index' },
          routingGuards: { rejectOtherAccount: true },
        },
      },
      {
        id: 'beta',
        envAccount: 'beta',
        name: 'Beta',
        env: { WECHAT_APPID: 'app-beta', WECHAT_APPSECRET: 'secret-beta' },
        policy: {},
      },
    ],
    branding: {
      posters: {
        learning: {
          brand: 'Fixture brand',
          ownerWechat: 'private-contact-fixture',
          payment: '1',
          benefits: ['A', 'B'],
        },
      },
    },
    business: { privateMemo: 'private-business-fixture' },
    runtime: {
      pathEntries: ['/fixture/bin'],
      launchdLabel: 'org.example.draft',
      launchdHours: [9, 15],
      nodeExecutable: process.execPath,
    },
  };
  fs.writeFileSync(file, JSON.stringify(raw), { mode: 0o600 });
  return { dir, file, raw, profile: loadOperatorProfile(dir, file) };
}

test('remote projection contains only selected credentials and the complete current policy', t => {
  const { dir, profile } = fixture(t);
  fs.writeFileSync(path.join(dir, '.env'), 'WECHAT_DRAFT_AUTHOR=Fixture author\nOTHER_SECRET=legacy-private\n');
  const result = remoteProjection({
    profile,
    selector: '',
    envDir: dir,
    remoteDirectory: '/srv/uploader',
    processEnv: {},
  });
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].env.WECHAT_APPSECRET, 'secret-alpha');
  assert.equal(result.accounts[0].env.WECHAT_DRAFT_AUTHOR, 'Fixture author');
  assert.deepEqual(result.accounts[0].policy, profile.accounts[0].policy);
  assert.equal(result.accounts[0].env.WECHAT_ACCOUNT_ROOT, '/srv/uploader/accounts/alpha');
  const serialized = JSON.stringify(result);
  for (const privateValue of [
    'secret-beta',
    'app-beta',
    'shared-secret-fixture',
    'alpha-ai-secret',
    'private-contact-fixture',
    'private-business-fixture',
    'legacy-private',
    '/private/local/vault',
  ]) {
    assert.ok(!serialized.includes(privateValue), `projection excluded ${privateValue}`);
  }
  assert.deepEqual(Object.keys(result), ['version', 'accounts']);
  assert.throws(
    () =>
      remoteProjection({ profile, selector: 'missing', envDir: dir, remoteDirectory: '/srv/uploader', processEnv: {} }),
    /登记目标账号/
  );
});

test('CLI projection is private on disk and does not print configuration values', t => {
  const { dir, file, profile } = fixture(t);
  const output = path.join(dir, 'remote.json');
  const stdout = execFileSync(
    process.execPath,
    ['scripts/operator-config.mjs', 'export-remote', 'beta', dir, '/srv/uploader', output],
    { cwd: projectRoot, env: { PATH: process.env.PATH, WECHAT_OPERATOR_PROFILE: file }, encoding: 'utf8' }
  );
  assert.equal(stdout, '');
  const remote = loadOperatorProfile(dir, output);
  assert.equal(remote.accounts[0].id, 'beta');
  assert.deepEqual(remote.accounts[0].policy, profile.accounts[1].policy);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
});

test('remote projection clears parent-account explicit credentials when selecting another account', t => {
  const { dir, profile } = fixture(t);
  const projection = remoteProjection({
    profile,
    selector: 'beta',
    envDir: dir,
    remoteDirectory: '/srv/uploader',
    processEnv: {
      WECHAT_ACCOUNT: 'alpha',
      WECHAT_APPID: 'explicit-alpha-app',
      WECHAT_APPSECRET: 'explicit-alpha-secret',
      WECHAT_ACCOUNT_EXACT: 'Explicit Alpha',
      WECHAT_DRAFT_AUTHOR: 'Alpha author',
    },
  });
  assert.equal(projection.accounts[0].env.WECHAT_APPID, 'app-beta');
  assert.equal(projection.accounts[0].env.WECHAT_APPSECRET, 'secret-beta');
  assert.equal(projection.accounts[0].env.WECHAT_ACCOUNT_EXACT, 'Beta');
  assert.equal(projection.accounts[0].env.WECHAT_DRAFT_AUTHOR, undefined);
  assert.ok(!JSON.stringify(projection).includes('explicit-alpha'));
  assert.deepEqual(projection.accounts[0].policy, profile.accounts[1].policy);
});

test('remote projection keeps valid explicit overrides for the requested account with no parent selector', t => {
  const { dir, profile } = fixture(t);
  for (const context of [{}, { WECHAT_ACCOUNT: 'Beta' }]) {
    const projection = remoteProjection({
      profile,
      selector: 'beta',
      envDir: dir,
      remoteDirectory: '/srv/uploader',
      processEnv: { ...context, WECHAT_APPSECRET: 'explicit-beta-secret', WECHAT_DRAFT_AUTHOR: 'Beta author' },
    });
    assert.equal(projection.accounts[0].env.WECHAT_APPSECRET, 'explicit-beta-secret');
    assert.equal(projection.accounts[0].env.WECHAT_DRAFT_AUTHOR, 'Beta author');
    assert.equal(projection.accounts[0].env.WECHAT_APPID, 'app-beta');
  }
});

test('account enumeration merges profile selectors with only the requested env directory', t => {
  const { dir, file } = fixture(t);
  const custom = path.join(dir, 'custom-env');
  const explicit = path.join(dir, 'explicit-env');
  fs.mkdirSync(custom);
  fs.mkdirSync(explicit);
  fs.writeFileSync(path.join(custom, '.env.external'), 'WECHAT_ACCOUNT_EXACT=External');
  fs.writeFileSync(path.join(custom, '.env.example'), '');
  fs.writeFileSync(path.join(explicit, '.env.selected'), 'WECHAT_ACCOUNT_EXACT=Selected');
  const env = { PATH: process.env.PATH, WECHAT_OPERATOR_PROFILE: file, WECHAT_ENV_DIR: custom };
  const expected = ['.env', '.env.beta', '.env.external'].map(name => path.join(custom, name));
  const cli = execFileSync(process.execPath, ['scripts/operator-config.mjs', 'account-files'], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
  assert.deepEqual(cli.trim().split('\n').sort(), expected.sort());
  const shell = execFileSync(
    '/bin/zsh',
    ['-c', 'source "$1/scripts/account-envs.sh"; account_env_files "$1"', 'test', projectRoot],
    { env, encoding: 'utf8' }
  );
  assert.deepEqual(shell.trim().split('\n').sort(), expected.sort());
  const selected = execFileSync(process.execPath, ['scripts/operator-config.mjs', 'account-files', explicit], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
  assert.deepEqual(
    selected.trim().split('\n').sort(),
    ['.env', '.env.beta', '.env.selected'].map(name => path.join(explicit, name)).sort()
  );
});

test('poster fields read private defaults with explicit overrides and no embedded identity fallback', t => {
  const { file } = fixture(t);
  const previous = process.env.WECHAT_OPERATOR_PROFILE;
  const previousBrand = process.env.POSTER_BRAND;
  t.after(() => {
    if (previous === undefined) delete process.env.WECHAT_OPERATOR_PROFILE;
    else process.env.WECHAT_OPERATOR_PROFILE = previous;
    if (previousBrand === undefined) delete process.env.POSTER_BRAND;
    else process.env.POSTER_BRAND = previousBrand;
  });
  process.env.WECHAT_OPERATOR_PROFILE = file;
  delete process.env.POSTER_BRAND;
  assert.equal(posterConfig('learning').text('POSTER_BRAND'), 'Fixture brand');
  assert.deepEqual(posterConfig('learning').list('POSTER_BENEFITS'), ['A', 'B']);
  assert.equal(posterConfig('group').text('POSTER_OWNER_WECHAT'), '');
  process.env.POSTER_BRAND = 'Explicit brand';
  assert.equal(posterConfig('learning').text('POSTER_BRAND'), 'Explicit brand');
});

test('shell default-account runner clears a previous account and selects the correct env directory', t => {
  const { dir, file } = fixture(t);
  const script = `source "$1/scripts/account-envs.sh"; run_for_account_env "$2/.env" /bin/zsh -c 'print -r -- "\${WECHAT_ACCOUNT-unset}|$WECHAT_ENV_DIR"'`;
  const result = execFileSync('/bin/zsh', ['-c', script, 'test', projectRoot, dir], {
    env: { PATH: process.env.PATH, WECHAT_ACCOUNT: 'beta', WECHAT_OPERATOR_PROFILE: file },
    encoding: 'utf8',
  });
  assert.equal(result.trim(), `unset|${fs.realpathSync(dir)}`);
});

test('launchd generation uses explicit schedule and local paths without installing a job', t => {
  const { dir, file } = fixture(t);
  const output = path.join(dir, 'job.plist');
  execFileSync(process.execPath, ['scripts/generate-launchd.mjs', output], {
    cwd: projectRoot,
    env: { PATH: process.env.PATH, WECHAT_OPERATOR_PROFILE: file },
  });
  const plist = fs.readFileSync(output, 'utf8');
  assert.ok(plist.includes('<string>org.example.draft</string>'));
  assert.ok(plist.includes('<integer>9</integer>'));
  assert.ok(plist.includes('<integer>15</integer>'));
  assert.ok(plist.includes(file));
  assert.ok(!plist.includes('{{'));
  assert.ok(!plist.includes('<string>-lc</string>'));
  if (process.platform === 'darwin') execFileSync('/usr/bin/plutil', ['-lint', output]);
});
