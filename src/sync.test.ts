import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthExpiredError, RateLimitError } from './errors.js';
import { runAppletsOnce, shouldContinueAfterStageError, shouldSyncApplets } from './sync.js';

test('采集阶段只在限流时继续，登录失效和结构错误仍中止', () => {
  const options = { continueOnRateLimit: true };
  assert.equal(shouldContinueAfterStageError(new RateLimitError('freq control'), options), true);
  assert.equal(shouldContinueAfterStageError(new AuthExpiredError('expired'), options), false);
  assert.equal(shouldContinueAfterStageError(new Error('schema changed'), options), false);
  assert.equal(shouldContinueAfterStageError(new Error('optional source failed'), { continueOnError: true }), true);
});

test('小程序只在默认账号同步中抓取一次', () => {
  assert.equal(shouldSyncApplets(undefined), true);
  assert.equal(shouldSyncApplets(''), true);
  assert.equal(shouldSyncApplets('exampledev'), false);
  assert.equal(shouldSyncApplets('exampleai'), false);
});

test('小程序同步完成后恢复公众号主库', async () => {
  const calls: string[] = [];
  await runAppletsOnce(undefined, {
    runAll: async () => {
      calls.push('applets');
    },
    restorePrimaryDb: dbPath => {
      calls.push(`restore:${dbPath}`);
    },
    primaryDbPath: '/tmp/stats-ExampleNews.db',
  });
  assert.deepEqual(calls, ['applets', 'restore:/tmp/stats-ExampleNews.db']);
});

test('小程序同步失败时仍恢复公众号主库', async () => {
  const calls: string[] = [];
  await assert.rejects(
    runAppletsOnce(undefined, {
      runAll: async () => {
        calls.push('applets');
        throw new Error('fetch failed');
      },
      restorePrimaryDb: dbPath => {
        calls.push(`restore:${dbPath}`);
      },
      primaryDbPath: '/tmp/stats-ExampleNews.db',
    }),
    /fetch failed/
  );
  assert.deepEqual(calls, ['applets', 'restore:/tmp/stats-ExampleNews.db']);
});

test('非默认账号跳过小程序时不切换数据库', async () => {
  const calls: string[] = [];
  await runAppletsOnce('exampledev', {
    runAll: async () => {
      calls.push('applets');
    },
    restorePrimaryDb: dbPath => {
      calls.push(`restore:${dbPath}`);
    },
    primaryDbPath: '/tmp/stats-ExampleDev.db',
  });
  assert.deepEqual(calls, []);
});
