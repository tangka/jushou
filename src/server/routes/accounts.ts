import { Hono } from 'hono';
import { accountEnvForSpawn, findAccount, getAccountStatuses } from '../account-registry.js';
import { getTask, startNodeTask } from '../task-runner.js';

export const accountRoutes = new Hono();

accountRoutes.get('/', async c => {
  const requested = c.req.query('account') || null;
  const accounts = await getAccountStatuses(requested);
  const selected = accounts.find(account => account.isSelected)?.id ?? null;
  return c.json({ selected, accounts });
});

accountRoutes.post('/:id/channels-login', c => {
  const account = findAccount(c.req.param('id'));
  if (!account) return c.json({ error: '账号不存在' }, 404);

  const task = startNodeTask(`视频号扫码:${account.account}`, ['dist/channels/probe.js'], accountEnvForSpawn(account));
  return c.json(task);
});

accountRoutes.post('/:id/platforms/:platform/login', c => {
  const account = findAccount(c.req.param('id'));
  if (!account) return c.json({ error: '账号不存在' }, 404);

  const platform = c.req.param('platform');
  if (platform !== 'channels') return c.json({ error: '该平台不支持后台扫码任务' }, 400);

  const task = startNodeTask(`视频号扫码:${account.account}`, ['dist/channels/probe.js'], accountEnvForSpawn(account));
  return c.json(task);
});

accountRoutes.get('/tasks/:id', c => {
  const task = getTask(c.req.param('id'));
  if (!task) return c.json({ error: '任务不存在' }, 404);
  return c.json(task);
});
