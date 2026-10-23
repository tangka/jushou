import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  discoverOperatorEnvironments,
  getOperatorAccount,
  loadOperatorProfile,
  operatorProcessEnvForAccount,
  operatorProfileSchema,
  resolveOperatorEnvironment,
} from './operator-profile.js';

function temporaryDirectory(t: test.TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-profile-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('默认配置不含个人账号、业务或发表授权，扩展配置不被剥离', () => {
  const empty = operatorProfileSchema.parse({ version: 1 });
  assert.deepEqual(empty.accounts, []);
  assert.deepEqual(empty.business, {});
  assert.deepEqual(empty.remoteUpload, {});
  const profile = operatorProfileSchema.parse({
    version: 1,
    customResource: { enabled: true },
    operations: { timezone: 'UTC' },
  });
  assert.deepEqual(profile.customResource, { enabled: true });
  assert.equal(profile.operations.timezone, 'UTC');
});

test('进程 > 账号 > 共享 > 旧 env，默认账号和别名均可解析', t => {
  const root = temporaryDirectory(t);
  fs.writeFileSync(
    path.join(root, '.env'),
    'CHOICE=legacy\nLEGACY_ONLY="keep # literal"\nACCOUNT_CHOICE=legacy\nSHARED_CHOICE=legacy\n'
  );
  const profile = operatorProfileSchema.parse({
    version: 1,
    env: { CHOICE: 'shared', SHARED_CHOICE: 'shared', ACCOUNT_CHOICE: 'shared' },
    accounts: [
      {
        id: 'sample',
        envAccount: '',
        name: 'Example News',
        aliases: ['news-alias'],
        env: { CHOICE: 'account', ACCOUNT_CHOICE: 'account' },
      },
    ],
  });
  const resolved = resolveOperatorEnvironment({
    root,
    account: 'news-alias',
    profile,
    processEnv: { CHOICE: 'explicit' },
  });
  assert.equal(resolved.env.CHOICE, 'explicit');
  assert.equal(resolved.env.ACCOUNT_CHOICE, 'account');
  assert.equal(resolved.env.SHARED_CHOICE, 'shared');
  assert.equal(resolved.env.LEGACY_ONLY, 'keep # literal');
  assert.equal(resolved.env.WECHAT_ACCOUNT, '');
  assert.equal(resolved.env.WECHAT_ACCOUNT_EXACT, 'Example News');
  assert.equal(getOperatorAccount(undefined, profile)?.id, 'sample');
  assert.equal(getOperatorAccount('EXAMPLE NEWS', profile)?.id, 'sample');
  assert.throws(
    () => resolveOperatorEnvironment({ root, account: 'unknown', profile, processEnv: {} }),
    /未在私有配置/
  );
});

test('跨账号不继承显式身份、凭据或数据库位置，共享 Vault 和运行变量仍保留', () => {
  const profile = operatorProfileSchema.parse({
    version: 1,
    accounts: [
      { id: 'first', envAccount: '', name: 'Example First', env: { PRIVATE_MODEL_KEY: 'first-key' } },
      { id: 'second', envAccount: 'second', name: 'Example Second', env: { WECHAT_ACCOUNT_EXACT: 'Second Official' } },
    ],
  });
  const explicit = {
    WECHAT_ACCOUNT: '',
    WECHAT_ACCOUNT_EXACT: 'Example First',
    WECHAT_APPSECRET: 'first-secret',
    STATS_DB: 'first.db',
    PRIVATE_MODEL_KEY: 'private',
    OBSIDIAN_VAULT: '/vault',
    PATH: '/bin',
  };
  const selected = operatorProcessEnvForAccount('second', profile, explicit);
  assert.equal(selected.WECHAT_APPSECRET, undefined);
  assert.equal(selected.WECHAT_ACCOUNT_EXACT, undefined);
  assert.equal(selected.STATS_DB, undefined);
  assert.equal(selected.PRIVATE_MODEL_KEY, undefined);
  assert.equal(selected.OBSIDIAN_VAULT, '/vault');
  assert.equal(selected.PATH, '/bin');
  assert.equal(operatorProcessEnvForAccount('', profile, explicit).WECHAT_APPSECRET, 'first-secret');
  assert.equal(getOperatorAccount('Second Official', profile)?.id, 'second');
});

test('仅有 profile 的账号可发现，与旧 env 按选择器去重且凭据互不串号', t => {
  const root = temporaryDirectory(t);
  fs.writeFileSync(path.join(root, '.env.legacy'), 'WECHAT_ACCOUNT_EXACT=Legacy News\nWECHAT_APPSECRET=legacy-test\n');
  const profile = operatorProfileSchema.parse({
    version: 1,
    accounts: [
      { id: 'main', envAccount: '', name: 'Example News', env: { WECHAT_APPSECRET: 'main-test' } },
      { id: 'legacy', envAccount: 'legacy', name: 'Example Lab', env: { WECHAT_APPSECRET: 'lab-test' } },
    ],
  });
  const rows = discoverOperatorEnvironments({ root, profile, processEnv: {} });
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.envAccount === '')?.env.WECHAT_APPSECRET, 'main-test');
  assert.equal(rows.find(row => row.envAccount === 'legacy')?.env.WECHAT_APPSECRET, 'lab-test');
});

test('损坏、错误版本和账号身份冲突阻断，错误不回显配置值', t => {
  const root = temporaryDirectory(t);
  const file = path.join(root, 'operator.local.json');
  const marker = 'private-test-marker';
  fs.writeFileSync(file, JSON.stringify({ version: 2, env: { SECRET: marker } }));
  assert.throws(
    () => loadOperatorProfile(root, file),
    error => error instanceof Error && !error.message.includes(marker)
  );
  fs.writeFileSync(file, '{"SECRET":"private-test-marker",');
  assert.throws(
    () => loadOperatorProfile(root, file),
    error => error instanceof Error && !error.message.includes(marker)
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      accounts: [
        { id: 'first', envAccount: '', name: 'Example One', aliases: ['shared'] },
        { id: 'second', envAccount: 'second', name: 'Example Two', aliases: ['shared'] },
      ],
    })
  );
  assert.throws(() => loadOperatorProfile(root, file), /账号身份重复/);
  assert.throws(() => loadOperatorProfile(root, path.join(root, 'missing.json')), /不存在/);
});

test('已载入账号的子进程切回空选择器时，使用新账号配置而非继承旧账号凭据', t => {
  const root = temporaryDirectory(t);
  const profilePath = path.join(root, 'operator.local.json');
  fs.writeFileSync(
    profilePath,
    JSON.stringify({
      version: 1,
      accounts: [
        {
          id: 'alpha',
          envAccount: 'alpha',
          name: 'Example Alpha',
          env: { WECHAT_APPID: 'alpha-test-id', WECHAT_APPSECRET: 'alpha-test-secret' },
        },
        {
          id: 'beta',
          envAccount: '',
          name: 'Example Beta',
          aliases: ['default-news'],
          env: { WECHAT_APPID: 'beta-test-id', WECHAT_APPSECRET: 'beta-test-secret' },
        },
      ],
    })
  );
  const configUrl = new URL('./index.js', import.meta.url).href;
  const registryUrl = new URL('../server/account-registry.js', import.meta.url).href;
  const queueUrl = new URL('../toutiao/queue.js', import.meta.url).href;
  const childCode = `import {config} from ${JSON.stringify(configUrl)}; console.log(JSON.stringify({name:config.accountExact, secret:config.wechatApi.appsecret, selector:process.env.WECHAT_ACCOUNT}));`;
  const code = `
    import {spawnSync} from 'node:child_process';
    import {config} from ${JSON.stringify(configUrl)};
    import {discoverAccounts,resolveAccount,accountEnvForSpawn} from ${JSON.stringify(registryUrl)};
    import {discoverConfiguredAccounts} from ${JSON.stringify(queueUrl)};
    const accounts=discoverAccounts();
    const selected=resolveAccount('default-news');
    if(!selected) throw new Error('missing account');
    const result=spawnSync(process.execPath,['--input-type=module','-e',${JSON.stringify(childCode)}],{env:accountEnvForSpawn(selected),encoding:'utf8'});
    if(result.status!==0) throw new Error(result.stderr);
    console.log(JSON.stringify({parent:config.accountExact,parentSecret:config.wechatApi.appsecret,count:accounts.length,queue:discoverConfiguredAccounts(),child:JSON.parse(result.stdout)}));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      WECHAT_OPERATOR_PROFILE: profilePath,
      WECHAT_ACCOUNT: 'alpha',
      WECHAT_ACCOUNT_EXACT: 'Example Alpha',
      WECHAT_APPSECRET: 'explicit-alpha',
      STATS_DB: 'alpha-test.db',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    parent: 'Example Alpha',
    parentSecret: 'explicit-alpha',
    count: 2,
    queue: ['Example Alpha', 'Example Beta'],
    child: { name: 'Example Beta', secret: 'beta-test-secret', selector: '' },
  });
});
