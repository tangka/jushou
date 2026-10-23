import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const extension = z.record(z.string(), z.unknown());
const environment = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string());
const selector = z.string().regex(/^[\p{Letter}\p{Number}_-]*$/u);
const accountSchema = z
  .object({
    id: selector.refine(value => value.length > 0),
    envAccount: selector,
    name: z.string().trim().min(1),
    aliases: z.array(z.string().trim().min(1)).default([]),
    env: environment.default({}),
    policy: extension.default({}),
    editorial: extension.default({}),
  })
  .passthrough();

export const operatorProfileSchema = z
  .object({
    version: z.literal(1),
    env: environment.default({}),
    accounts: z.array(accountSchema).default([]),
    runtime: extension.default({}),
    operations: extension.default({}),
    remoteUpload: extension.default({}),
    branding: extension.default({}),
    resources: z
      .object({ materialRoots: z.array(z.string().min(1)).default([]) })
      .passthrough()
      .default({ materialRoots: [] }),
    business: extension.default({}),
  })
  .passthrough();

export type OperatorProfile = z.infer<typeof operatorProfileSchema>;
export type OperatorAccount = z.infer<typeof accountSchema>;

// 只保留启动时真正传入的环境，不能把当前账号后来载入的配置转交给另一账号。
const startupEnvironment = { ...process.env };

export function getExplicitOperatorEnv(): NodeJS.ProcessEnv {
  return { ...startupEnvironment };
}

const sharedEnvironmentKeys = new Set([
  'OBSIDIAN_VAULT',
  'COMPANY_DB',
  'PORT',
  'TZ',
  'PATH',
  'CHROME',
  'CHROME_PATH',
  'WECHAT_ENV_DIR',
  'WECHAT_EXPORTER_BASE_URL',
  'WECHAT_OPERATOR_PROFILE',
  'WOA_OPERATOR_PROFILE',
  'WECHAT_CHANNELS_SKIP',
  'WECHAT_CHANNELS_CAPTURE_TIMEOUT_MS',
  'WECHAT_CHANNELS_JOIN_WINDOW_MINUTES',
  'WECHAT_CHANNELS_FANS_DAYS',
]);
const accountEnvironmentKey =
  /^(?:WECHAT_(?:ACCOUNT(?:_|$)|APPID$|APPSECRET$|LOGIN_STATE$|DRAFT_|CHANNEL|COVER_|GOALS$|AD_SLOT_NAMES$|PUBLISH_)|WX_APP(?:ID|SECRET)$|STATS_DB$|NITRO_KV_BASE$)/;

/** 显式账号覆盖只属于启动时选中的账号，切号后保留共享运行环境。 */
export function operatorProcessEnvForAccount(
  nameOrId: string,
  profile = loadOperatorProfile(),
  explicit = getExplicitOperatorEnv()
): NodeJS.ProcessEnv {
  const current = getOperatorAccount(explicit.WECHAT_ACCOUNT, profile)?.envAccount ?? explicit.WECHAT_ACCOUNT ?? '';
  const selected = getOperatorAccount(nameOrId, profile)?.envAccount ?? nameOrId;
  const result: NodeJS.ProcessEnv = { ...explicit, WECHAT_ACCOUNT: selected };
  if (current === selected) return result;
  const configuredKeys = new Set(profile.accounts.flatMap(account => Object.keys(account.env)));
  for (const key of Object.keys(result)) {
    if (
      !sharedEnvironmentKeys.has(key) &&
      !key.startsWith('APPLET_') &&
      (accountEnvironmentKey.test(key) || configuredKeys.has(key))
    )
      delete result[key];
  }
  result.WECHAT_ACCOUNT = selected;
  return result;
}

export function operatorProfilePath(root = process.cwd(), explicitPath?: string): string {
  return path.resolve(
    root,
    explicitPath ?? process.env.WECHAT_OPERATOR_PROFILE ?? process.env.WOA_OPERATOR_PROFILE ?? 'operator.local.json'
  );
}

function normalizeIdentity(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}

function accountIdentities(account: OperatorAccount): string[] {
  return [
    account.id,
    account.envAccount,
    account.name,
    ...account.aliases,
    ...[account.env.WECHAT_ACCOUNT_EXACT, account.env.WECHAT_ACCOUNT_KEYWORD].filter((value): value is string =>
      Boolean(value)
    ),
  ];
}

export function loadOperatorProfile(root = process.cwd(), explicitPath?: string): OperatorProfile {
  const file = operatorProfilePath(root, explicitPath);
  if (!fs.existsSync(file)) {
    if (explicitPath || process.env.WECHAT_OPERATOR_PROFILE || process.env.WOA_OPERATOR_PROFILE) {
      throw new Error('指定的私有配置文件不存在');
    }
    return operatorProfileSchema.parse({ version: 1 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    throw new Error('私有配置无法读取或不是合法 JSON');
  }
  const parsed = operatorProfileSchema.safeParse(raw);
  if (!parsed.success) {
    // 不输出输入值或 JSON 片段，避免校验错误泄漏凭据。
    const fields = parsed.error.issues.map(issue => issue.path.join('.') || '(root)');
    throw new Error(`私有配置字段无效: ${fields.join(', ')}`);
  }
  const identities = new Map<string, number>();
  parsed.data.accounts.forEach((account, index) => {
    for (const value of accountIdentities(account)) {
      const key = normalizeIdentity(value);
      if (identities.has(key) && identities.get(key) !== index) {
        throw new Error(`私有配置账号身份重复: accounts.${index}`);
      }
      identities.set(key, index);
    }
  });
  return parsed.data;
}

export function getOperatorAccount(
  nameOrId: string | undefined,
  profile = loadOperatorProfile()
): OperatorAccount | undefined {
  const key = normalizeIdentity(nameOrId ?? '');
  return profile.accounts.find(account => accountIdentities(account).some(value => normalizeIdentity(value) === key));
}

export function readLegacyAccountEnv(envDir: string, envAccount = ''): Record<string, string> {
  if (!selector.safeParse(envAccount).success) throw new Error('账号配置选择器无效');
  const file = path.join(envDir, envAccount ? `.env.${envAccount}` : '.env');
  if (!fs.existsSync(file)) return {};
  try {
    return Object.fromEntries(
      Object.entries(parseEnv(fs.readFileSync(file, 'utf8'))).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    );
  } catch {
    throw new Error('账号环境配置无法读取');
  }
}

export interface OperatorEnvironmentOptions {
  root?: string;
  envDir?: string;
  account?: string;
  profile?: OperatorProfile;
  processEnv?: NodeJS.ProcessEnv;
}

export function resolveOperatorEnvironment(options: OperatorEnvironmentOptions = {}) {
  const root = options.root ?? process.cwd();
  const explicit = options.processEnv ?? getExplicitOperatorEnv();
  const envDir = path.resolve(root, options.envDir ?? explicit.WECHAT_ENV_DIR ?? root);
  const profile = options.profile ?? loadOperatorProfile(root);
  const account = getOperatorAccount(options.account ?? explicit.WECHAT_ACCOUNT ?? '', profile);
  const envAccount = account?.envAccount ?? options.account ?? explicit.WECHAT_ACCOUNT ?? '';
  const legacy = readLegacyAccountEnv(envDir, envAccount);
  if (!account && profile.accounts.length > 0 && Object.keys(legacy).length === 0) {
    throw new Error('所选账号未在私有配置或兼容 env 中登记');
  }
  const explicitValues = Object.fromEntries(
    Object.entries(explicit).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  const identity: Record<string, string> = account
    ? { WECHAT_ACCOUNT_EXACT: account.name, WECHAT_ACCOUNT_KEYWORD: account.name }
    : {};
  const env: Record<string, string> = {
    ...legacy,
    ...profile.env,
    ...identity,
    ...account?.env,
    ...explicitValues,
    WECHAT_ACCOUNT: envAccount,
    WECHAT_ENV_DIR: envDir,
  };
  return { env, envDir, envAccount, account, profile };
}

export function initializeOperatorEnvironment(options: OperatorEnvironmentOptions = {}) {
  const resolved = resolveOperatorEnvironment(options);
  Object.assign(process.env, resolved.env);
  return resolved;
}

export function discoverOperatorEnvironments(options: Omit<OperatorEnvironmentOptions, 'account'> = {}) {
  const root = options.root ?? process.cwd();
  const explicit = options.processEnv ?? getExplicitOperatorEnv();
  const envDir = path.resolve(root, options.envDir ?? explicit.WECHAT_ENV_DIR ?? root);
  const profile = options.profile ?? loadOperatorProfile(root);
  const files = fs.existsSync(envDir)
    ? fs
        .readdirSync(envDir, { withFileTypes: true })
        .filter(
          entry =>
            entry.isFile() && (entry.name === '.env' || entry.name.startsWith('.env.')) && entry.name !== '.env.example'
        )
        .map(entry => entry.name)
        .sort()
    : [];
  const selectors = new Set([
    ...files.map(file => (file === '.env' ? '' : file.slice('.env.'.length))),
    ...profile.accounts.map(account => account.envAccount),
  ]);
  return [...selectors].map(account =>
    resolveOperatorEnvironment({
      ...options,
      root,
      envDir,
      account,
      profile,
      processEnv: operatorProcessEnvForAccount(account, profile, explicit),
    })
  );
}
