import process from 'node:process';
import { config } from './config/index.js';
import { addGroupOrder, getGroupOrders, getGroupRevenueSummary } from './db/index.js';
import { isMain, runCli } from './utils/cli.js';

// 付费群收款台账(手工录入,非抓取)。按号存进各自库(WECHAT_ACCOUNT 选号)。
// 用法:
//   pnpm group-revenue                         查看本号汇总 + 最近流水
//   pnpm group-revenue add <金额元> [wx|ali] [备注]    记一笔入群门槛收款(如 add 10 wx 首单)
//   pnpm group-revenue service <金额元> <服务名> [备注] 记一笔付费服务收款(远程安装/陪跑/工作流)
// 金额按「元」输入,内部存「分」。日期默认今天(北京时区),也可在备注前不传(暂不支持改日期,沿用今天)。

const yuan = (cents: number): string => (cents / 100).toFixed(2);

/** 北京时区今天 YYYY-MM-DD。 */
function todayBeijing(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA 输出即 YYYY-MM-DD
}

/** 把「元」字符串解析成「分」整数;非法则报错退出。 */
function parseAmountCents(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) {
    throw new Error(`金额非法:${raw ?? '(空)'};示例 pnpm group-revenue add 10`);
  }
  return Math.round(n * 100);
}

function printSummary(): void {
  const s = getGroupRevenueSummary();
  console.log(`\n📊 ${config.accountExact} · 付费群收款`);
  console.log(`  入群门槛:${s.entryCount} 单 / ¥${yuan(s.entryCents)}`);
  console.log(`  付费服务:${s.serviceCount} 单 / ¥${yuan(s.serviceCents)}`);
  console.log(`  合计:    ${s.totalCount} 单 / ¥${yuan(s.totalCents)}\n`);

  const orders = getGroupOrders(20);
  if (orders.length === 0) {
    console.log('  (暂无流水,用 `pnpm group-revenue add <金额>` 记一笔)\n');
    return;
  }
  console.log('  最近流水:');
  for (const o of orders) {
    const tag = o.kind === 'service' ? `服务·${o.service ?? ''}` : '入群';
    const extra = [o.channel || null, o.note || null].filter(Boolean).join(' · ');
    console.log(`    ${o.date}  ¥${yuan(o.amount_cents)}  [${tag}]${extra ? `  ${extra}` : ''}`);
  }
  console.log('');
}

export async function run(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === 'list') {
    printSummary();
    return;
  }

  if (cmd === 'add') {
    const amountCents = parseAmountCents(rest[0]);
    const maybeChannel = (rest[1] ?? '').toLowerCase();
    const isChannel = maybeChannel === 'wx' || maybeChannel === 'ali';
    const channel = isChannel ? maybeChannel : '';
    const note = (isChannel ? rest.slice(2) : rest.slice(1)).join(' ') || undefined;
    addGroupOrder({
      date: todayBeijing(),
      account: config.accountExact,
      kind: 'entry',
      amountCents,
      channel,
      note,
    });
    console.log(
      `✅ 已记入群门槛:${config.accountExact} · ${todayBeijing()} · ¥${yuan(amountCents)}${channel ? ` · ${channel}` : ''}`
    );
    printSummary();
    return;
  }

  if (cmd === 'service') {
    const amountCents = parseAmountCents(rest[0]);
    const service = rest[1];
    if (!service) throw new Error('缺服务名;示例 pnpm group-revenue service 200 远程安装');
    const note = rest.slice(2).join(' ') || undefined;
    addGroupOrder({
      date: todayBeijing(),
      account: config.accountExact,
      kind: 'service',
      amountCents,
      service,
      note,
    });
    console.log(`✅ 已记付费服务:${config.accountExact} · ${todayBeijing()} · ${service} · ¥${yuan(amountCents)}`);
    printSummary();
    return;
  }

  throw new Error(`未知命令:${cmd};支持 add / service / list(空)`);
}

if (isMain(import.meta.url)) runCli(run);
