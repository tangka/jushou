import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { findMainMarkdown, parseMarkdown } from '../build-publish-html.js';
import { config } from '../config/index.js';
import { isMain, runCli } from '../utils/cli.js';
import { buildEgoBrowserPublishScript, type EgoPublishPayload } from './ego-publish-script.js';
import { resolvePublishArtifacts } from './publish-artifacts.js';
import type {
  ChannelDraftCandidate,
  ChannelDraftSelectionResult,
  CliOptions,
  PublishArtifacts,
} from './publish-today-types.js';

export { buildEgoBrowserPublishScript } from './ego-publish-script.js';

const CHANNELS_PUBLISH_META = '.channels-publish.json';

type PublishMeta = {
  status?: string;
  title?: string;
  short_title?: string;
  published_at?: string;
};

function parseCli(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    draft: undefined,
    date: shanghaiToday(),
    build: false,
    skipBuild: false,
    publish: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--draft') {
      const value = argv[i + 1];
      if (!value) throw new Error('--draft 需要传视频号草稿目录名或绝对路径');
      options.draft = value;
      i++;
    } else if (arg === '--date') {
      const value = argv[i + 1];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('--date 需要 YYYY-MM-DD');
      options.date = value;
      i++;
    } else if (arg === '--build') {
      options.build = true;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '--publish') {
      options.publish = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数:${arg}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`用法:
  pnpm channels:publish-today [-- --draft <视频号草稿目录>] [--date YYYY-MM-DD] [--build] [--publish] [--force]

说明:
  - 默认选择当前账号待发布目录里今天最新的 post_type=视频号 草稿。
  - --build 会在草稿 video/ 目录运行 npm run build,生成/刷新 MP4、cover 和 QA。
  - 不加 --publish 时只做本地发布前校验,并写 .channels-publish.json status=ready。
  - --publish 会调用 ego-browser-wechat:上传视频、填描述/短标题、原创、不显示位置、直接发表并回列表核验。`);
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function stripShortTitleLine(body: string): { description: string; shortTitle: string } {
  let shortTitle = '';
  const descriptionLines: string[] = [];
  for (const line of body.split('\n')) {
    const match = line.trim().match(/^短标题[:：]\s*(.+)$/u);
    if (match?.[1]) {
      shortTitle = match[1].trim();
      continue;
    }
    descriptionLines.push(line);
  }
  return {
    description: descriptionLines.join('\n').trim(),
    shortTitle,
  };
}

async function readPublishMeta(draftDir: string): Promise<PublishMeta | undefined> {
  const metaPath = path.join(draftDir, CHANNELS_PUBLISH_META);
  const raw = await fs.readFile(metaPath, 'utf8').catch(() => '');
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as PublishMeta;
  } catch {
    return { status: 'unknown' };
  }
}

async function hasPublishedMeta(draftDir: string): Promise<boolean> {
  const meta = await readPublishMeta(draftDir);
  return meta?.status === 'published';
}

export async function listChannelDraftCandidates(
  draftsDir: string,
  today = shanghaiToday(),
  force = false
): Promise<ChannelDraftSelectionResult> {
  const entries = await fs.readdir(draftsDir, { withFileTypes: true }).catch(() => []);
  const candidates: ChannelDraftCandidate[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    if (!entry.name.startsWith(`${today}-`)) continue;

    const dir = path.join(draftsDir, entry.name);
    const mdPath = await findMainMarkdown(dir, entry.name);
    if (!mdPath) {
      skipped.push(`${entry.name}:无主 Markdown`);
      continue;
    }

    const markdown = await fs.readFile(mdPath, 'utf8').catch(() => '');
    if (!markdown) {
      skipped.push(`${entry.name}:Markdown 读取失败`);
      continue;
    }

    const parsed = parseMarkdown(markdown, entry.name);
    if (parsed.postType !== '视频号') {
      skipped.push(`${entry.name}:非视频号草稿`);
      continue;
    }
    if (!force && (await hasPublishedMeta(dir))) {
      skipped.push(`${entry.name}:已存在已发布 ${CHANNELS_PUBLISH_META}`);
      continue;
    }

    const { description, shortTitle } = stripShortTitleLine(parsed.body);
    const stat = await fs.stat(dir);
    candidates.push({
      dir,
      name: entry.name,
      mdPath,
      title: parsed.title,
      description,
      shortTitle: shortTitle || parsed.title,
      mtimeMs: stat.mtimeMs,
    });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name, 'zh-Hans-CN'));
  return { candidates, skipped };
}

async function resolveDraftDir(
  draftArg: string | undefined,
  date: string,
  force: boolean
): Promise<ChannelDraftCandidate> {
  if (!draftArg) {
    const result = await listChannelDraftCandidates(config.paths.draftsDir, date, force);
    const selected = result.candidates[0];
    if (selected) {
      console.log(`自动选择今天视频号草稿:${selected.name}`);
      console.log(`选择依据:${date} post_type=视频号,按目录修改时间最新`);
      return selected;
    }
    const skipped = result.skipped.length > 0 ? `\n跳过项:\n- ${result.skipped.join('\n- ')}` : '';
    throw new Error(`未找到今天可发布的视频号草稿:${config.paths.draftsDir}${skipped}`);
  }

  const candidates = path.isAbsolute(draftArg)
    ? [draftArg]
    : [path.resolve(process.cwd(), draftArg), path.join(config.paths.draftsDir, draftArg)];
  for (const dir of candidates) {
    const stat = await fs.stat(dir).catch(() => undefined);
    if (!stat?.isDirectory()) continue;
    const name = path.basename(dir);
    const mdPath = await findMainMarkdown(dir, name);
    if (!mdPath) throw new Error(`视频号草稿无主 Markdown:${dir}`);
    const markdown = await fs.readFile(mdPath, 'utf8');
    const parsed = parseMarkdown(markdown, name);
    if (parsed.postType !== '视频号') throw new Error(`不是视频号草稿:${dir}`);
    const { description, shortTitle } = stripShortTitleLine(parsed.body);
    return {
      dir,
      name,
      mdPath,
      title: parsed.title,
      description,
      shortTitle: shortTitle || parsed.title,
      mtimeMs: stat.mtimeMs,
    };
  }
  throw new Error(`找不到视频号草稿目录:${draftArg}`);
}

function runWithInput(command: string, args: string[], cwd: string, input: string): void {
  const result = spawnSync(command, args, {
    cwd,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (
    /user has taken control|ended the task|not assigned to an agent|user is controlling|ego's nodejs process exited with code [1-9]|^Error:/im.test(
      output
    )
  ) {
    throw new Error(`${command} ${args.join(' ')} 被用户接管或任务空间中断,未完成发布`);
  }
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败(exit ${result.status})`);
}

async function writePublishMeta(
  artifacts: PublishArtifacts,
  status: 'ready' | 'published',
  extra: Record<string, unknown> = {}
): Promise<void> {
  const body = {
    account: config.accountExact,
    status,
    title: artifacts.title,
    short_title: artifacts.shortTitle,
    description: artifacts.description,
    video: artifacts.videoPath,
    cover: artifacts.coverPath,
    qa_dir: artifacts.qaDir,
    prepared_at: new Date().toISOString(),
    ...extra,
  };
  await fs.writeFile(path.join(artifacts.draftDir, CHANNELS_PUBLISH_META), `${JSON.stringify(body, null, 2)}\n`);
}

async function runEgoBrowserPublish(artifacts: PublishArtifacts): Promise<void> {
  const screenshotDir = path.join(artifacts.draftDir, 'video', 'output', 'publish-screenshots');
  await fs.mkdir(screenshotDir, { recursive: true });
  const payload: EgoPublishPayload = {
    taskSpace: config.channels.egoTaskSpace,
    verifyText: config.channels.egoVerifyText,
    account: config.accountExact,
    channelLabel: config.channelLabel,
    collectionName: artifacts.collectionName,
    draftDir: artifacts.draftDir,
    videoPath: artifacts.videoPath,
    coverPath: artifacts.coverPath,
    qaDir: artifacts.qaDir,
    title: artifacts.title,
    shortTitle: artifacts.shortTitle,
    description: artifacts.description,
    screenshotDir,
  };
  runWithInput('ego-browser', ['nodejs'], process.cwd(), buildEgoBrowserPublishScript(payload));
}

export async function run(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const candidate = await resolveDraftDir(options.draft, options.date, options.force);
  const artifacts = await resolvePublishArtifacts(candidate, options);

  console.log(`账号:${config.accountExact}`);
  console.log(`草稿:${artifacts.draftDir}`);
  console.log(`标题:${artifacts.title}`);
  console.log(`短标题:${artifacts.shortTitle}`);
  console.log(`视频:${artifacts.videoPath}`);
  console.log(`封面:${artifacts.coverPath}`);
  console.log(`尺寸:${artifacts.width}x${artifacts.height}`);
  console.log(`音频:${artifacts.hasAudio ? '正常' : '缺失'}`);

  await writePublishMeta(artifacts, 'ready');
  console.log(`✓ 已写入发布准备清单:${path.join(artifacts.draftDir, CHANNELS_PUBLISH_META)}`);

  if (options.publish) {
    console.log(`ego-browser 任务空间:${config.channels.egoTaskSpace}`);
    console.log(`页面账号校验文本:${config.channels.egoVerifyText}`);
    await runEgoBrowserPublish(artifacts);
    await writePublishMeta(artifacts, 'published', { published_at: new Date().toISOString() });
    console.log(`✓ 视频号已发表并回列表核验:${artifacts.shortTitle}`);
    return;
  }

  console.log('dry-run 完成:视频号草稿已通过本地发布前校验,尚未点击视频号发表。');
}

if (isMain(import.meta.url)) runCli(run);
