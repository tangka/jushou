#!/usr/bin/env node
// Public script adapter; all operator values are loaded by the shared profile contract.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getOperatorAccount,
  loadOperatorProfile,
  operatorProcessEnvForAccount,
  resolveOperatorEnvironment,
} from '../dist/config/operator-profile.js';

export const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function textValue(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function getProfile() {
  return loadOperatorProfile(projectRoot);
}

export function requiredText(value, field) {
  const result = textValue(value);
  if (!result) throw new Error(`请配置私有字段 ${field}`);
  return result;
}

export function rendererRuntime(kind) {
  const runtime = getProfile().runtime;
  const collector =
    process.env[kind === 'web' ? 'WEB_COLLECT_DIR' : 'X_COLLECT_DIR'] ||
    textValue(runtime[kind === 'web' ? 'webCollectDir' : 'xCollectDir']);
  const require = collector ? createRequire(path.resolve(collector, 'package.json')) : createRequire(import.meta.url);
  return {
    puppeteer: require('puppeteer-core'),
    chrome: requiredText(process.env.CHROME || runtime.chromePath, 'runtime.chromePath'),
  };
}

export function visualConfig() {
  return object(getProfile().branding.visual);
}

export function posterConfig(kind) {
  const config = object(object(getProfile().branding.posters)[kind]);
  const field = key =>
    key
      .replace(/^POSTER_/, '')
      .toLowerCase()
      .replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  return {
    text(key, fallback = '') {
      return textValue(process.env[key]) || textValue(config[field(key)], fallback);
    },
    list(key, fallback = []) {
      const explicit = textValue(process.env[key]);
      if (explicit)
        return explicit
          .split('|')
          .map(item => item.trim())
          .filter(Boolean);
      const configured = config[field(key)];
      return Array.isArray(configured) && configured.every(item => typeof item === 'string') ? configured : fallback;
    },
  };
}

function accountFiles(profile, directory = process.env.WECHAT_ENV_DIR || projectRoot) {
  const root = path.resolve(directory);
  const files = new Set(
    profile.accounts.map(account => path.join(root, account.envAccount ? `.env.${account.envAccount}` : '.env'))
  );
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (
      (name === '.env' || name.startsWith('.env.')) &&
      !name.startsWith('.env.example') &&
      fs.statSync(path.join(root, name)).isFile()
    ) {
      files.add(path.join(root, name));
    }
  }
  return [...files];
}

// Deliberately excludes login cookies, other services, business data, and local paths.
const uploadEnvironmentKeys = [
  'WECHAT_APPID',
  'WECHAT_APPSECRET',
  'WX_APPID',
  'WX_APPSECRET',
  'WECHAT_ACCOUNT_EXACT',
  'WECHAT_ACCOUNT_KEYWORD',
  'WECHAT_DRAFT_AUTHOR',
  'WECHAT_DRAFT_NEED_OPEN_COMMENT',
  'WECHAT_DRAFT_ONLY_FANS_CAN_COMMENT',
  'WECHAT_DRAFT_COVER_MATERIAL_TYPE',
  'WECHAT_PUBLISH_STYLE',
  'WECHAT_PUBLISH_THEME',
];

export function remoteProjection({ profile, selector, envDir, remoteDirectory, processEnv = process.env }) {
  const target = selector ?? processEnv.WECHAT_ACCOUNT ?? '';
  const account = getOperatorAccount(target, profile);
  if (!account) throw new Error('远端上传要求先在私有配置 accounts 中登记目标账号和 policy');
  // An explicit account identifies who owns inherited overrides. Without one, overrides belong to this invocation.
  const scoped = operatorProcessEnvForAccount(target, profile, {
    ...processEnv,
    WECHAT_ACCOUNT: processEnv.WECHAT_ACCOUNT ?? target,
  });
  const explicit = Object.fromEntries(
    uploadEnvironmentKeys.filter(key => typeof scoped[key] === 'string').map(key => [key, scoped[key]])
  );
  const resolved = resolveOperatorEnvironment({
    root: projectRoot,
    envDir,
    account: target,
    profile,
    processEnv: explicit,
  });
  const env = Object.fromEntries(
    uploadEnvironmentKeys.filter(key => typeof resolved.env[key] === 'string').map(key => [key, resolved.env[key]])
  );
  env.WECHAT_ACCOUNT_ROOT = path.posix.join(remoteDirectory, 'accounts', account.id);
  env.OBSIDIAN_VAULT = path.posix.join(remoteDirectory, 'vault');
  return {
    version: 1,
    accounts: [{ id: account.id, envAccount: account.envAccount, name: account.name, env, policy: account.policy }],
  };
}

function emit(value) {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('脚本配置必须是单行字符串');
  process.stdout.write(value);
}

function cli() {
  const [command, ...args] = process.argv.slice(2);
  const profile = getProfile();
  switch (command) {
    case 'runtime-path': {
      const entries = profile.runtime.pathEntries ?? [];
      if (!Array.isArray(entries) || entries.some(value => typeof value !== 'string' || /[\r\n\0:]/.test(value)))
        throw new Error('runtime.pathEntries 必须是路径数组');
      emit([...entries, process.env.PATH || '/usr/bin:/bin'].join(':'));
      break;
    }
    case 'remote-host':
      emit(process.env.WECHAT_REMOTE_UPLOAD_HOST || textValue(profile.remoteUpload.host));
      break;
    case 'remote-directory':
      emit(
        process.env.WECHAT_REMOTE_UPLOAD_DIR ||
          process.env.WECHAT_REMOTE_UPLOAD_REPO ||
          textValue(profile.remoteUpload.directory)
      );
      break;
    case 'remote-draft-root':
      emit(process.env.WECHAT_REMOTE_DRAFT_ROOT || textValue(profile.remoteUpload.draftRoot));
      break;
    case 'remote-mode':
      emit(process.env.WECHAT_UPLOAD_DRAFT_MODE || textValue(profile.remoteUpload.mode, 'local'));
      break;
    case 'sync-catchup-after': {
      const value = textValue(profile.runtime.syncCatchupAfter, '0000');
      if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(value)) throw new Error('runtime.syncCatchupAfter 必须为 HHMM');
      emit(value);
      break;
    }
    case 'remote-ssh-options': {
      const options = profile.remoteUpload.sshOptions ?? [];
      if (!Array.isArray(options) || options.some(value => typeof value !== 'string' || value.includes('\0')))
        throw new Error('remoteUpload.sshOptions 必须是字符串数组');
      for (const option of options) process.stdout.write(`${option}\0`);
      break;
    }
    case 'account-files':
      process.stdout.write(
        accountFiles(profile, args[0])
          .map(file => `${file}\n`)
          .join('')
      );
      break;
    case 'account-label': {
      const resolved = resolveOperatorEnvironment({
        root: projectRoot,
        envDir: args[1],
        account: args[0],
        profile,
        processEnv: {},
      });
      emit(
        resolved.account?.name ||
          resolved.env.WECHAT_ACCOUNT_EXACT ||
          resolved.env.WECHAT_ACCOUNT_KEYWORD ||
          args[0] ||
          'default'
      );
      break;
    }
    case 'account-exists': {
      if (!getOperatorAccount(args[0], profile) && !fs.existsSync(args[1] || '')) throw new Error('目标账号未配置');
      break;
    }
    case 'export-remote': {
      const [selector, envDir, remoteDirectory, output] = args;
      if (!envDir || !output || !remoteDirectory?.startsWith('/'))
        throw new Error('export-remote 参数不完整或远端目录不是绝对路径');
      const projection = remoteProjection({ profile, selector, envDir, remoteDirectory });
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      fs.writeFileSync(output, `${JSON.stringify(projection, null, 2)}\n`, { mode: 0o600 });
      fs.chmodSync(output, 0o600);
      break;
    }
    default:
      throw new Error('未知配置读取命令');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    cli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : '私有配置读取失败');
    process.exitCode = 1;
  }
}
