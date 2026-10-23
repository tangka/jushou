// 登录体检:先读取私有配置及兼容 env 账号，探各号的公众号 + 视频号登录态。
// 公众号(零成本、不起 Chrome):GET 代理根 `/`,已登录→302 跳 /dashboard;过期→200 返回扫码页。
// 视频号(对有 .data/chrome-channels-<号> 的号起 headless Chrome,默认开启):跳 login/auth 页 = 过期(同
//   channels/fetch.ts)。headless 已验可靠:已登录判已登录、过期判过期,与真实抓取一致,且不弹窗。
//   ⚠️ 视频号登录态基本「一天一失效」(微信侧 session 短命),所以每天拉数据前先 login-check、按需 channels:probe 重扫。
//   profile 被占用(正在跑 channels)/Chrome 缺失 → 优雅降级,不报错。加 --no-channels 跳过视频号(只查公众号)。
// 跑:pnpm login-check [--no-channels]   任一号公众号/视频号过期或服务未起 → 退出码 1(可当 sync 前置闸)。
import { spawn, spawnSync } from 'node:child_process';
import { type AccountEnv, accountEnvForSpawn, discoverAccounts, probeChannels } from './server/account-registry.js';

interface LoginAccount extends AccountEnv {
  loginUrl: string;
}

type MpState = 'ok' | 'expired' | 'down';
type ChState = 'ok' | 'expired' | 'none' | 'locked' | 'nochrome' | 'unknown';

/** 弹公众号扫码页(浏览器开代理根,未登录时即扫码页)。 */
function openMpScan(loginUrl: string): void {
  spawnSync('open', [loginUrl]);
}

/** 弹视频号扫码:跑 channels:probe(headful,弹 Chrome 扫码,扫完即抓一轮验证)。阻塞到扫完。 */
function openChannelsScan(account: AccountEnv): Promise<void> {
  return new Promise(resolve => {
    const child = spawn('node', ['dist/channels/probe.js'], {
      stdio: 'inherit',
      env: accountEnvForSpawn(account),
    });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

/** 公众号:302/301/307=已登录;200=过期(扫码页);连不上=服务未起。 */
async function probeMp(loginUrl: string): Promise<MpState> {
  try {
    const resp = await fetch(loginUrl, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
    return resp.status >= 300 && resp.status < 400 ? 'ok' : 'expired';
  } catch {
    return 'down';
  }
}

const MP_LABEL: Record<MpState, string> = {
  ok: '✓ 已登录',
  expired: '✗ 已过期(需扫码)',
  down: '· 服务未启动',
};
const CH_LABEL: Record<ChState, string> = {
  ok: '✓ 已登录',
  expired: '✗ 已过期(pnpm channels:probe 重扫)',
  none: '— 该号无视频号',
  locked: '· profile 占用中(channels 正在跑,稍后再验)',
  nochrome: '· 未找到 Chrome',
  unknown: '? 未判定(页面异常)',
};

async function main(): Promise<void> {
  const root = process.cwd();
  const withChannels = !process.argv.includes('--no-channels');
  const fix = process.argv.includes('--fix');
  const accounts = discoverAccounts(root).map(account =>
    Object.assign(account, { loginUrl: account.dashboardUrl.replace('/dashboard/', '/') })
  );
  if (accounts.length === 0) {
    console.log('未发现私有配置或兼容 env 中的账号。');
    process.exitCode = 1;
    return;
  }

  const mpExpired: LoginAccount[] = [];
  const chExpired: LoginAccount[] = [];
  let bad = 0;
  console.log('=== 登录体检(公众号 + 视频号)===');
  for (const a of accounts) {
    const mp = await probeMp(a.loginUrl);
    if (mp !== 'ok') bad++;
    if (mp === 'expired') mpExpired.push(a);
    const tail = mp === 'expired' ? '  → 需扫码' : mp === 'down' ? '  → 服务未起(先起 pnpm dev / Docker)' : '';
    console.log(`  [公众号] ${MP_LABEL[mp].padEnd(16)} ${a.account.padEnd(12)} ${a.loginUrl}${tail}`);
    if (withChannels) {
      const ch = await probeChannels(a, root);
      if (ch === 'expired') {
        bad++;
        chExpired.push(a);
      }
      console.log(`  [视频号] ${CH_LABEL[ch].padEnd(16)} ${a.account}`);
    }
  }

  if (bad === 0) {
    console.log('\n登录正常,可以拉数据。');
    return;
  }

  if (!fix) {
    console.log(`\n有 ${bad} 处登录异常。加 --fix 自动弹出对应扫码页(扫完即可放手拉数据)。`);
    process.exitCode = 1;
    return;
  }

  // --fix:先弹所有公众号扫码页(浏览器,秒开),再逐个弹视频号扫码(headful Chrome,阻塞到扫完)。
  console.log('\n=== 弹出扫码(--fix)===');
  for (const a of mpExpired) {
    console.log(`  公众号 ${a.account}:已开浏览器扫码页 ${a.loginUrl}(微信扫一扫)`);
    openMpScan(a.loginUrl);
  }
  for (const a of chExpired) {
    console.log(`  视频号 ${a.account}:弹 Chrome 扫码(扫完它会自动抓一轮验证)…`);
    await openChannelsScan(a);
  }
  console.log('\n扫完后再跑一次 `pnpm login-check` 确认全绿,即可放手拉数据。');
}

void main();
