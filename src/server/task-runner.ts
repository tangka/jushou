import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export type TaskState = 'running' | 'success' | 'failed';

export interface DashboardTask {
  id: string;
  title: string;
  state: TaskState;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  output: string;
}

const tasks = new Map<string, DashboardTask>();
const MAX_OUTPUT_CHARS = 12_000;

function appendOutput(task: DashboardTask, chunk: string): void {
  task.output = `${task.output}${chunk}`.slice(-MAX_OUTPUT_CHARS);
}

export function startNodeTask(
  title: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = process.cwd()
): DashboardTask {
  const task: DashboardTask = {
    id: randomUUID(),
    title,
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    output: '',
  };
  tasks.set(task.id, task);

  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => appendOutput(task, String(chunk)));
  child.stderr.on('data', chunk => appendOutput(task, String(chunk)));
  child.on('error', error => {
    task.state = 'failed';
    task.finishedAt = new Date().toISOString();
    appendOutput(task, `\n${error.message}\n`);
  });
  child.on('close', code => {
    task.state = code === 0 ? 'success' : 'failed';
    task.exitCode = code;
    task.finishedAt = new Date().toISOString();
  });

  return task;
}

export function getTask(id: string): DashboardTask | null {
  return tasks.get(id) ?? null;
}
