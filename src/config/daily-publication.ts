import { configuredDailyAccounts } from './account-policy.js';

/** 发表授权由本机私有账号配置提供；未配置不隐含任何作者账号。 */
export const DAILY_PUBLICATION_POLICY = {
  timezone: 'Asia/Shanghai',
  publicOrigin: 'https://mp.weixin.qq.com',
  get accounts() {
    return configuredDailyAccounts();
  },
};
