import fs from 'node:fs';
import path from 'node:path';
import { discoverOperatorEnvironments, loadOperatorProfile, operatorProfilePath } from './config/operator-profile.js';
import { isMain, runCli } from './utils/cli.js';

export function checkOperatorProfile(root = process.cwd()) {
  const profile = loadOperatorProfile(root);
  const accounts = discoverOperatorEnvironments({ root, profile });
  return {
    version: profile.version,
    profilePresent: fs.existsSync(operatorProfilePath(root)),
    valid: true,
    profileAccounts: profile.accounts.length,
    discoveredAccounts: accounts.length,
    accounts: accounts.map(({ account, env, envAccount, envDir }, index) => ({
      index: index + 1,
      id: account?.id ?? envAccount,
      name: env.WECHAT_ACCOUNT_EXACT || env.WECHAT_ACCOUNT_KEYWORD || envAccount,
      profileConfigured: Boolean(account),
      defaultAccount: envAccount === '',
      legacyEnvPresent: fs.existsSync(path.join(envDir, envAccount ? `.env.${envAccount}` : '.env')),
      identityConfigured: Boolean(env.WECHAT_ACCOUNT_EXACT || env.WECHAT_ACCOUNT_KEYWORD),
      apiCredentialsConfigured: Boolean(
        (env.WECHAT_APPID || env.WX_APPID) && (env.WECHAT_APPSECRET || env.WX_APPSECRET)
      ),
      publication: account?.policy.dailyPublication === 'publish' ? 'publish' : 'draft',
    })),
    remoteUploadConfigured: Boolean(profile.remoteUpload.host && profile.remoteUpload.directory),
    materialRootCount: profile.resources.materialRoots.length,
  };
}

export async function run(): Promise<void> {
  const result = checkOperatorProfile();
  console.log(JSON.stringify(result, null, 2));
  if (result.discoveredAccounts === 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) runCli(run);
