import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import type { ChannelDraftCandidate, CliOptions, PublishArtifacts, VideoConfig } from './publish-today-types.js';

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`video.config.json 缺少 ${label}`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`video.config.json 缺少 ${label}`);
  return value;
}

async function readVideoConfig(configPath: string): Promise<VideoConfig> {
  const raw = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
  const template = raw.template as Record<string, unknown> | undefined;
  const duration = raw.duration as Record<string, unknown> | undefined;
  const outputs = raw.outputs as Record<string, unknown> | undefined;
  if (!template || !duration || !outputs) {
    throw new Error(`video.config.json 缺少 template/duration/outputs:${configPath}`);
  }
  return {
    issueDate: requireString(raw.issueDate, 'issueDate'),
    account: requireString(raw.account, 'account'),
    title: requireString(raw.title, 'title'),
    templateKind: requireString(template.kind, 'template.kind'),
    duration: {
      width: requireNumber(duration.width, 'duration.width'),
      height: requireNumber(duration.height, 'duration.height'),
      fps: requireNumber(duration.fps, 'duration.fps'),
    },
    outputs: {
      video: requireString(outputs.video, 'outputs.video'),
      cover: requireString(outputs.cover, 'outputs.cover'),
    },
  };
}

export function resolveChannelCollectionName(
  templateKind: string,
  dailyCollectionName: string,
  weeklyCollectionName: string
): string {
  const collectionName = templateKind === 'weekly' ? weeklyCollectionName : dailyCollectionName;
  if (!collectionName) {
    throw new Error(`视频号${templateKind === 'weekly' ? '周刊' : '日常'}合集未配置,停止发表`);
  }
  return collectionName;
}

async function assertFile(filePath: string, label: string): Promise<void> {
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat?.isFile()) throw new Error(`${label}不存在:${filePath}`);
}

function runChecked(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败(exit ${result.status})`);
}

type ProbeStream = { codec_type?: string; width?: number; height?: number };
type ProbeJson = { streams?: ProbeStream[] };

function ffprobe(filePath: string): ProbeJson {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
    { encoding: 'utf8' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffprobe 失败:${filePath}\n${result.stderr}`);
  return JSON.parse(result.stdout) as ProbeJson;
}

function videoProbe(filePath: string): { width: number; height: number; hasAudio: boolean } {
  const probe = ffprobe(filePath);
  const video = probe.streams?.find(stream => stream.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error(`视频缺少宽高:${filePath}`);
  return {
    width: video.width,
    height: video.height,
    hasAudio: Boolean(probe.streams?.some(stream => stream.codec_type === 'audio')),
  };
}

function imageProbe(filePath: string): { width: number; height: number } {
  const probe = ffprobe(filePath);
  const image = probe.streams?.find(stream => stream.codec_type === 'video') ?? probe.streams?.[0];
  if (!image?.width || !image.height) throw new Error(`封面缺少宽高:${filePath}`);
  return { width: image.width, height: image.height };
}

function frameSsim(firstFramePath: string, coverPath: string): number {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      firstFramePath,
      '-i',
      coverPath,
      '-lavfi',
      '[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`ffmpeg ssim 失败:first-frame=${firstFramePath}, cover=${coverPath}\n${result.stderr}`);
  }
  const match = `${result.stdout}\n${result.stderr}`.match(/All:([0-9.]+)/);
  if (!match) throw new Error(`无法读取首帧封面 SSIM:first-frame=${firstFramePath}, cover=${coverPath}`);
  return Number(match[1]);
}

export async function resolvePublishArtifacts(
  candidate: ChannelDraftCandidate,
  options: CliOptions
): Promise<PublishArtifacts> {
  const videoDir = path.join(candidate.dir, 'video');
  const configPath = path.join(videoDir, 'video.config.json');
  await assertFile(configPath, 'video.config.json');

  if (options.build || (options.publish && !options.skipBuild)) {
    runChecked('npm', ['run', 'build'], videoDir);
  }

  const videoConfig = await readVideoConfig(configPath);
  if (videoConfig.account !== config.accountExact) {
    throw new Error(`video.config.json 账号不匹配: config=${videoConfig.account}, 当前账号=${config.accountExact}`);
  }

  const videoPath = path.resolve(videoDir, videoConfig.outputs.video);
  const coverPath = path.resolve(videoDir, videoConfig.outputs.cover);
  const qaDir = path.join(videoDir, 'output', 'qa');
  const firstFramePath = path.join(qaDir, 'first-frame.png');
  await assertFile(videoPath, '成片 MP4');
  await assertFile(coverPath, '成片封面');
  await assertFile(firstFramePath, 'QA first-frame');
  await assertFile(path.join(qaDir, 'contact-sheet.jpg'), 'QA contact-sheet');
  await assertFile(path.join(qaDir, 'hero-frame.png'), 'QA hero-frame');

  const video = videoProbe(videoPath);
  const cover = imageProbe(coverPath);
  if (video.width !== 1080 || video.height !== 1440) {
    throw new Error(`视频尺寸不合格:${video.width}x${video.height},要求 1080x1440`);
  }
  if (video.width !== videoConfig.duration.width || video.height !== videoConfig.duration.height) {
    throw new Error(
      `视频尺寸与配置不一致:视频 ${video.width}x${video.height},配置 ${videoConfig.duration.width}x${videoConfig.duration.height}`
    );
  }
  if (cover.width !== video.width || cover.height !== video.height) {
    throw new Error(`封面尺寸不合格:${cover.width}x${cover.height},视频 ${video.width}x${video.height}`);
  }
  const firstFrameSsim = frameSsim(firstFramePath, coverPath);
  if (firstFrameSsim < 0.97) {
    throw new Error(`首帧与封面不匹配:SSIM=${firstFrameSsim}, first-frame=${firstFramePath}, cover=${coverPath}`);
  }
  if (!video.hasAudio) throw new Error(`视频没有音频流:${videoPath}`);
  const collectionName = resolveChannelCollectionName(
    videoConfig.templateKind,
    config.channels.dailyCollectionName,
    config.channels.weeklyCollectionName
  );

  return {
    draftDir: candidate.dir,
    mdPath: candidate.mdPath,
    videoDir,
    configPath,
    videoPath,
    coverPath,
    qaDir,
    title: videoConfig.title || candidate.title,
    shortTitle: candidate.shortTitle,
    description: candidate.description,
    collectionName,
    width: video.width,
    height: video.height,
    hasAudio: video.hasAudio,
  };
}
