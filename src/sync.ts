import { spawn } from 'node:child_process';
import { runAllApplets } from './applets/fetch-revenue.js';
import { run as runContentMap } from './build-content-map.js';
import { run as runBusiness } from './business-report.js';
import { getChannelsRuntimeStatus } from './channels/fetch.js';
import { config } from './config/index.js';
import { reopenDb } from './db/index.js';
import { run as runEnrich } from './enrich-wechat-stats.js';
import { RateLimitError } from './errors.js';
import { run as runExport } from './export-to-obsidian.js';
import { run as runChannels } from './fetch-channels-stats.js';
import { run as runFollowers } from './fetch-followers.js';
import { run as runReadTendency } from './fetch-read-tendency.js';
import { run as runRevenue } from './fetch-revenue.js';
import { run as runLintVault } from './lint-vault.js';
import { notifyFailure, resetNotifications } from './notify.js';
import { run as runPruneDrafts } from './prune-drafts.js';
import { getRedditRuntimeStatus, run as runRedditCollect } from './reddit-collect.js';
import { buildRows, readDetailEntries, writeCsv, writeOverview } from './report.js';
import { run as runSuggest } from './suggest.js';
import { run as runTag } from './tag-articles.js';
import { isMain, runCli } from './utils/cli.js';

// 每天一键编排:拉素材 → 增量采集 → 补互动数据 → 抓关注/收益 →(打标)→ 复盘 → 选题建议 → 体检。
// 上游核心阶段(采集/补数据)失败 → 通知并中止(下游无意义);其余独立来源失败 → 通知但继续。失败分类见 notify(ADR 0004)。

interface Stage {
  name: string;
  fn: () => Promise<void>;
  /** true 表示失败不中止后续(如打标失败仍可分析旧数据)。 */
  continueOnError?: boolean;
  /** 仅限流时继续；登录失效、账号错配、结构变化仍中止。 */
  continueOnRateLimit?: boolean;
}

type SyncMode = 'all' | 'materials-only' | 'data-only';

export function shouldContinueAfterStageError(
  error: unknown,
  options: Pick<Stage, 'continueOnError' | 'continueOnRateLimit'>
): boolean {
  return Boolean(options.continueOnError || (options.continueOnRateLimit && error instanceof RateLimitError));
}

function parseMode(argv = process.argv.slice(2)): SyncMode {
  if (argv.includes('--materials-only')) return 'materials-only';
  if (argv.includes('--data-only')) return 'data-only';
  return 'all';
}

// 拉 X watchlist 素材:复用 pnpm collect(去调 x-collect monitor)。需本地 skill + 代理;
// 容器/无 skill 或代理不通的环境会失败,故调用处 continueOnError(不挡数据同步)。
function runCollect(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['collect'], { stdio: 'inherit' });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`collect 退出码 ${code}`))));
    child.on('error', reject);
  });
}

async function runChannelsIfAvailable(): Promise<void> {
  const status = getChannelsRuntimeStatus();
  if (!status.ok) {
    console.log(`[sync] 跳过视频号:${status.reason ?? '本地 Chrome 不可用'}`);
    return;
  }
  await runChannels();
}

async function runRedditIfAvailable(): Promise<void> {
  const status = getRedditRuntimeStatus();
  if (!status.ok) {
    console.log(`[sync] 跳过 Reddit:${status.reason ?? '本地 Chrome 不可用'}`);
    return;
  }
  await runRedditCollect();
}

export function shouldSyncApplets(accountId: string | undefined = process.env.WECHAT_ACCOUNT): boolean {
  return !accountId?.trim();
}

interface AppletSyncDeps {
  runAll: () => Promise<void>;
  restorePrimaryDb: (dbPath?: string) => void;
  primaryDbPath: string;
}

export async function runAppletsOnce(
  accountId: string | undefined = process.env.WECHAT_ACCOUNT,
  deps: AppletSyncDeps = {
    runAll: () => runAllApplets([]),
    restorePrimaryDb: reopenDb,
    primaryDbPath: config.dbPath,
  }
): Promise<void> {
  if (!shouldSyncApplets(accountId)) {
    console.log('[sync] 跳过小程序:独立模块已由默认 .env 同步,避免多公众号重复抓取');
    return;
  }
  try {
    await deps.runAll();
  } finally {
    // openAppletDb 会把 DB 单例切到小程序库；后续公众号阶段前必须切回当前账号主库。
    deps.restorePrimaryDb(deps.primaryDbPath);
  }
}

export async function run(): Promise<void> {
  resetNotifications();
  const mode = parseMode();

  const materialStages: Stage[] = [
    // 先拉素材(X watchlist),供下游选题建议参考;需本地 skill+代理,失败不挡数据
    { name: '拉素材(X watchlist)', fn: runCollect, continueOnError: true },
    // Reddit 依赖本机 Chrome + 代理访问 old.reddit;Docker/无 Chrome 环境跳过,失败不挡数据同步
    { name: '拉 Reddit 热帖', fn: runRedditIfAvailable, continueOnError: true },
  ];
  const dataStages: Stage[] = [
    { name: '采集(增量)', fn: () => runExport({ incremental: true }), continueOnRateLimit: true },
    { name: '补互动数据', fn: runEnrich },
    // 粉丝数据独立来源,失败不该挡住分析
    { name: '抓关注/粉丝', fn: runFollowers, continueOnError: true },
    // 阅读趋势(后台权威逐日阅读人数,接口直抓),独立来源失败不挡分析
    { name: '抓阅读趋势', fn: runReadTendency, continueOnError: true },
    // 视频号依赖本机 Chrome;Docker/无 Chrome 环境跳过,可用但抓取失败时不挡主链路
    { name: '抓视频号数据', fn: runChannelsIfAvailable, continueOnError: true },
    // 小程序独立于公众号;多账号编排时只在默认 .env 跑一次,并抓全部已配置小程序
    { name: '抓小程序数据(累计用户 + 收益)', fn: runAppletsOnce, continueOnError: true },
    // 流量主收益独立来源(且 T-1 数据约次日中午才产出),失败不该挡住分析
    { name: '抓流量主收益', fn: runRevenue, continueOnError: true },
  ];
  // 默认 Codex SDK 不依赖 OpenRouter key;显式切到 OpenRouter 时有 key 才打标
  if (config.tag.provider === 'codex' || config.openrouter.apiKey) {
    dataStages.push({ name: '选题打标', fn: runTag, continueOnError: true });
  }
  // enrich 写的总览早于收益抓取,收益列会滞后/为空;收益+打标就绪后重建一次,并入最新收益与标签
  dataStages.push({
    name: '刷新总览(并入收益)',
    fn: async () => {
      const rows = buildRows(await readDetailEntries());
      await writeOverview(rows, true);
      await writeCsv(rows, true);
    },
    continueOnError: true,
  });
  dataStages.push({ name: '经营分析', fn: runBusiness });
  // 回收已发布草稿(标题已进 articles = 已发);独立清理,失败不该挡住别的
  dataStages.push({ name: '回收已发草稿', fn: () => runPruneDrafts(), continueOnError: true });
  // 回收后再重写内容地图「待发布」区(已发的自动从列表消失)
  dataStages.push({ name: '刷新内容地图', fn: runContentMap, continueOnError: true });
  // 数据 + 素材都齐了,生成下一篇选题建议(含收益维度)
  dataStages.push({ name: '选题建议', fn: runSuggest, continueOnError: true });
  // 全库链接体检(只报告断链,不中止)——放最后,产物都更新完再扫
  dataStages.push({ name: '链接体检', fn: runLintVault, continueOnError: true });

  const stages =
    mode === 'materials-only' ? materialStages : mode === 'data-only' ? dataStages : [...materialStages, ...dataStages];

  for (const stage of stages) {
    console.log(`\n=== ${stage.name} ===`);
    try {
      await stage.fn();
    } catch (error) {
      await notifyFailure(stage.name, error);
      const canContinue = shouldContinueAfterStageError(error, stage);
      if (!canContinue) throw new Error(`同步在「${stage.name}」中止`);
      console.error(`[sync] ${stage.name} 失败但继续:`, error);
    }
  }
  console.log(`\n同步完成。模式:${mode}`);
}

if (isMain(import.meta.url)) runCli(run);
