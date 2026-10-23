import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadOperatorProfile,
  type OperatorProfile,
  operatorProfilePath,
  resolveOperatorEnvironment,
} from './config/operator-profile.js';
import { isMain, runCli } from './utils/cli.js';

function containerProfile(profile: OperatorProfile, hostVault: string, root: string): OperatorProfile {
  const copy = structuredClone(profile);
  const mappings = [
    [hostVault, '/vault'],
    [path.join(root, '.data'), '/app/.data'],
  ];
  const mapPath = (value: string, field: string): string => {
    if (!path.isAbsolute(value)) return value;
    for (const [host, container] of mappings) {
      if (!host || !container) continue;
      const relative = path.relative(host, value);
      if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
        return path.posix.join(container, relative.split(path.sep).join('/'));
      }
    }
    throw new Error(`Docker 路径未在挂载范围内: ${field}`);
  };
  const pathFields = [
    'OBSIDIAN_VAULT',
    'WECHAT_ACCOUNT_ROOT',
    'STATS_DB',
    'COMPANY_DB',
    'WECHAT_LOGIN_STATE',
    'NITRO_KV_BASE',
    'APPLET_LOGIN_STATE',
    'APPLET_KV_BASE',
    'APPLET_STATS_DB',
  ];
  for (const env of [copy.env, ...copy.accounts.map(account => account.env)]) {
    for (const key of pathFields) {
      if (env[key]) env[key] = mapPath(env[key], key);
    }
    if (env.APPLET_CONFIGS) {
      let configs: unknown;
      try {
        configs = JSON.parse(env.APPLET_CONFIGS);
      } catch {
        throw new Error('Docker APPLET_CONFIGS 必须是合法 JSON');
      }
      if (!Array.isArray(configs)) throw new Error('Docker APPLET_CONFIGS 必须是数组');
      for (const item of configs) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Docker APPLET_CONFIGS 项无效');
        for (const key of ['loginStatePath', 'kvBase', 'dbPath']) {
          if (typeof item[key] === 'string') item[key] = mapPath(item[key], `APPLET_CONFIGS.${key}`);
        }
      }
      env.APPLET_CONFIGS = JSON.stringify(configs);
    }
  }
  copy.env.OBSIDIAN_VAULT = '/vault';
  copy.resources.materialRoots = copy.resources.materialRoots.map(value => mapPath(value, 'resources.materialRoots'));
  return copy;
}

/** 仅将挂载路径交给 Compose，凭据由容器内只读的私有配置提供。 */
export function composeEnvironment(root = process.cwd(), explicit: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const profileFile = operatorProfilePath(root, explicit.WECHAT_OPERATOR_PROFILE ?? explicit.WOA_OPERATOR_PROFILE);
  if (!fs.statSync(profileFile, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Docker 启动前请将 operator.example.json 复制为 operator.local.json 并填写自己的配置');
  }
  const profile = loadOperatorProfile(root, profileFile);
  const resolved = resolveOperatorEnvironment({ root, processEnv: explicit, profile });
  const vault = explicit.OBSIDIAN_VAULT_HOST || resolved.env.OBSIDIAN_VAULT;
  if (!vault) throw new Error('请在私有配置 env.OBSIDIAN_VAULT 中设置自己的数据目录');
  const hostVault = path.resolve(root, vault);
  // 派生文件仅供容器读取；用户仍只编辑原配置，宿主 Vault 子路径映射为 /vault。
  const directory = path.join(root, '.data', 'operator-compose');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const containerFile = path.join(directory, 'operator.local.json');
  if (fs.lstatSync(containerFile, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('Docker 私有配置派生文件不能是软链接');
  }
  const mappedProfile = containerProfile(profile, hostVault, root);
  fs.writeFileSync(containerFile, `${JSON.stringify(mappedProfile, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(containerFile, 0o600);
  return {
    ...explicit,
    OBSIDIAN_VAULT_HOST: hostVault,
    WECHAT_ENV_DIR_HOST: resolved.envDir,
    WECHAT_OPERATOR_PROFILE_HOST: containerFile,
  };
}

export async function run(): Promise<void> {
  const args = process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== '--');
  if (args.length === 0) {
    console.log('用法: pnpm docker -- <compose参数>；例如 pnpm docker -- config 或 pnpm docker -- up -d');
    return;
  }
  const result = spawnSync('docker', ['compose', ...args], {
    env: composeEnvironment(),
    stdio: 'inherit',
  });
  if (result.error) throw new Error('无法启动 Docker Compose，请检查 Docker 安装与运行状态');
  process.exitCode = result.status ?? 1;
}

if (isMain(import.meta.url)) runCli(run);
