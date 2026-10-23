import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { config } from '../config/index.js';
import {
  addExpense,
  addGroupOrder,
  reopenDb,
  reopenExpenseDb,
  upsertChannelDailyFans,
  upsertFollowerDay,
  upsertRevenueIncomeDay,
} from '../db/index.js';
import { dashboardRoutes } from './routes/dashboard.js';

const overviewSchema = z.object({
  totals: z.object({ totalCents: z.number() }),
  accounts: z.array(z.object({ mp: z.string() })),
  applets: z.array(z.object({ login: z.string() })),
  dailyIncome: z.array(z.object({ date: z.string(), mpCents: z.number(), expenseCents: z.number() })),
});

test('总览离线可读且新入账立即可见，不以财务缓存换速度', async t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-offline-'));
  const original = {
    envDir: config.envDir,
    companyDbPath: config.companyDbPath,
    appletRegistry: config.appletRegistry,
    fetch: globalThis.fetch,
    operatorProfile: process.env.WECHAT_OPERATOR_PROFILE,
  };
  t.after(() => {
    Object.assign(config, {
      envDir: original.envDir,
      companyDbPath: original.companyDbPath,
      appletRegistry: original.appletRegistry,
    });
    globalThis.fetch = original.fetch;
    if (original.operatorProfile === undefined) delete process.env.WECHAT_OPERATOR_PROFILE;
    else process.env.WECHAT_OPERATOR_PROFILE = original.operatorProfile;
    reopenDb(':memory:');
    reopenExpenseDb(':memory:');
    fs.rmSync(fixture, { recursive: true, force: true });
  });
  const accountDb = path.join(fixture, 'account.db');
  const profilePath = path.join(fixture, 'operator.local.json');
  fs.writeFileSync(profilePath, JSON.stringify({ version: 1 }));
  process.env.WECHAT_OPERATOR_PROFILE = profilePath;
  fs.writeFileSync(path.join(fixture, '.env'), `WECHAT_ACCOUNT_EXACT=Offline\nSTATS_DB=${accountDb}\n`);
  Object.assign(config, {
    envDir: fixture,
    companyDbPath: path.join(fixture, 'company.db'),
    appletRegistry: [
      {
        id: 'offline-applet',
        name: '测试小程序',
        dbPath: path.join(fixture, 'applet.db'),
        loginStatePath: path.join(fixture, 'login.json'),
        kvBase: path.join(fixture, 'kv'),
      },
    ],
  });
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error('外网故意不可用');
  };
  reopenDb(accountDb);
  addGroupOrder({ date: '2026-10-01', account: 'Offline', kind: 'entry', amountCents: 990 });
  const first = await dashboardRoutes.request('http://localhost/overview');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  const firstBody = overviewSchema.parse(await first.json());
  assert.equal(firstBody.totals.totalCents, 990);
  assert.equal(firstBody.accounts[0]?.mp, 'unknown');
  assert.equal(firstBody.applets[0]?.login, 'unknown');

  reopenDb(accountDb);
  addGroupOrder({ date: '2026-10-01', account: 'Offline', kind: 'entry', amountCents: 100 });
  const second = await dashboardRoutes.request('http://localhost/overview');
  const secondBody = overviewSchema.parse(await second.json());
  assert.equal(secondBody.totals.totalCents, 1090);
  // 全量入口必须保留第 91 条及更早的真实记录，不能受默认 90 条窗口影响。
  reopenExpenseDb(config.companyDbPath);
  addExpense({ date: '2025-01-01', amountCents: 25, category: '测试', item: '历史费用', period: 'one-off' });
  reopenDb(accountDb);
  for (let i = 0; i < 91; i += 1) {
    const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    upsertRevenueIncomeDay(date, 100, 0);
    upsertFollowerDay({ date, new_user: 1, cancel_user: 0, netgain_user: 1, cumulate_user: 100 + i }, 0);
    upsertChannelDailyFans([{ date, add: 1, reduce: 0, netAdd: 1, total: 200 + i, fansDataByTabtype: [] }], 0);
  }
  const history = overviewSchema.parse(
    await (await dashboardRoutes.request('http://localhost/overview?history=all')).json()
  );
  assert.deepEqual(history.dailyIncome[0], { date: '2025-01-01', mpCents: 100, expenseCents: 25 });
  const summarySchema = z.object({
    followers: z.array(z.object({ date: z.string() })),
    channels: z.object({ fans: z.array(z.object({ date: z.string() })) }),
  });
  const series = summarySchema.parse(
    await (await dashboardRoutes.request('http://localhost/summary?history=all')).json()
  );
  assert.equal(series.followers.length, 91);
  assert.equal(series.followers[0]?.date, '2025-01-01');
  assert.equal(series.channels.fans.length, 91);
  const recent = summarySchema.parse(await (await dashboardRoutes.request('http://localhost/summary')).json());
  assert.equal(recent.followers.length, 90);
  assert.equal(recent.channels.fans.length, 90);
  assert.equal(externalCalls, 0);
});
