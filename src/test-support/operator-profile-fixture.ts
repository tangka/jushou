import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 测试必须先于运行配置导入本模块；仅使用临时目录与合成账号，不读取作者配置。
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'woa-operator-test-'));
export const testOperatorProfilePath = path.join(root, 'operator.json');
export const testOperatorProfile = {
  version: 1,
  env: { OBSIDIAN_VAULT: root, STATS_DB: ':memory:', COMPANY_DB: ':memory:' },
  accounts: [
    {
      id: 'example-news',
      envAccount: '',
      name: 'Example News',
      aliases: ['示例新闻'],
      env: {
        WECHAT_ACCOUNT_EXACT: 'Example News',
        WECHAT_ACCOUNT_KEYWORD: 'Example News',
        WECHAT_APPID: 'wx1111111111111111',
      },
      policy: {
        dailyPublication: 'draft',
        newsOnly: true,
        routingGuards: [{ owner: 'Example Lab', pattern: '\\b(?:Claude|Anthropic|Fable|Opus|Sonnet|Haiku)\\b|克劳德' }],
        miniProgram: {
          required: true,
          textOnly: true,
          appid: 'wx1111111111111111',
          path: 'pages/index/index',
          nickname: '示例助手',
        },
      },
    },
    {
      id: 'example-lab',
      envAccount: 'example-lab',
      name: 'Example Lab',
      aliases: [],
      env: {},
      policy: {
        dailyPublication: 'publish',
        routingGuards: [{ owner: 'Example News', pattern: '\\b(?:Codex|OpenAI|ChatGPT)\\b|GPT[- ]?\\d' }],
        miniProgram: {
          required: true,
          textOnly: true,
          appid: 'wx1111111111111111',
          path: 'pages/index/index?platform=lab',
          nickname: '示例助手',
        },
      },
    },
    {
      id: 'example-notes',
      envAccount: 'example-notes',
      name: 'Example Notes',
      aliases: ['示例随笔'],
      env: {},
      policy: { dailyPublication: 'publish' },
    },
  ],
  resources: { materialRoots: [] },
  business: {
    appletMembershipImports: [
      { service: '示例工具会员', marker: 'SAMPLEVIP:' },
      { service: '示例资料会员', marker: 'DEMOIMPORT:' },
    ],
  },
};

export function writeTestOperatorProfile(value: unknown = testOperatorProfile): void {
  fs.writeFileSync(testOperatorProfilePath, JSON.stringify(value));
}

writeTestOperatorProfile();
process.env.WECHAT_OPERATOR_PROFILE = testOperatorProfilePath;
process.env.WECHAT_ENV_DIR = root;
process.env.WECHAT_ACCOUNT = '';
process.env.WECHAT_ACCOUNT_EXACT = 'Example News';
process.env.WECHAT_ACCOUNT_KEYWORD = 'Example News';
process.env.WECHAT_APPID = 'wx1111111111111111';
process.env.WECHAT_APPSECRET = 'test-only-secret';
process.env.OBSIDIAN_VAULT = root;
process.env.STATS_DB = ':memory:';
process.env.COMPANY_DB = ':memory:';
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
