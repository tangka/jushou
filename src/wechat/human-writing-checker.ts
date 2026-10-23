import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { collectEditorialProcessProseErrors } from './editorial-process-guard.js';
import { formatProseFindings, inspectProsePatterns, type ProseFinding } from './prose-patterns.js';

export type HumanWritingCheckerOptions = {
  checkerPath?: string;
  pythonPath?: string;
  allowNoChinese?: boolean;
};

export type HumanWritingInspection = {
  articleSha256: string;
  checkerSha256: string;
  checkerPath: string;
  warnings: string[];
  stdout: string;
  skippedNoChinese: boolean;
  proseFindings: ProseFinding[];
};

const CHECKER_RELATIVE_PATH = path.join('wechat-human-writing', 'scripts', 'check_prose.py');
export const humanWritingSha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

export async function resolveHumanWritingChecker(explicitPath?: string): Promise<string> {
  const candidates = [
    explicitPath ?? process.env.WECHAT_HUMAN_WRITING_CHECKER?.trim(),
    path.join(os.homedir(), '.agents', 'skills', CHECKER_RELATIVE_PATH),
    path.join(os.homedir(), '.codex', 'skills', CHECKER_RELATIVE_PATH),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if ((await fs.stat(resolved).catch(() => undefined))?.isFile()) return resolved;
  }
  throw new Error(
    '未找到公众号去 AI 味检查器。请安装 wechat-human-writing Skill，' +
      '或设置 WECHAT_HUMAN_WRITING_CHECKER 指向 scripts/check_prose.py。'
  );
}

function runChecker(pythonPath: string, checkerPath: string, markdownPath: string) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(pythonPath, [checkerPath, '--wechat-export', markdownPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', code => {
      resolve({
        exitCode: code ?? 2,
        stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
      });
    });
  });
}

/** 保留完整原始提醒，不以摘要或自拟空集合代替检查器输出。 */
function parseWarnings(stdout: string): string[] {
  const sections = stdout.split(/^需要人工判断$/mu);
  if (sections.length === 1) return [];
  const warnings = sections[1]?.trim().split('\n');
  if (sections.length !== 2 || !warnings?.length || warnings.some(line => !/^- \S/u.test(line))) {
    throw new Error('去 AI 味检查器提醒集合无法完整解析，已阻止上传草稿箱');
  }
  return warnings;
}

/** 同一份检查既服务上传门禁，也服务独立复核；硬错先阻断。 */
export async function inspectHumanWritingDraft(
  markdownPath: string,
  options: HumanWritingCheckerOptions = {}
): Promise<HumanWritingInspection> {
  const articleBytes = await fs.readFile(markdownPath);
  const proseFindings = inspectProsePatterns(articleBytes.toString('utf8'));
  if (proseFindings.some(finding => finding.severity === 'block')) {
    throw new Error(`表达检查存在硬命中，已阻止上传草稿箱：${markdownPath}\n${formatProseFindings(proseFindings)}`);
  }
  const processErrors = collectEditorialProcessProseErrors(articleBytes.toString('utf8'));
  if (processErrors.length) {
    throw new Error(`正文作者过程说明未移除，已阻止上传草稿箱：${markdownPath}\n- ${processErrors.join('\n- ')}`);
  }
  const checkerPath = await resolveHumanWritingChecker(options.checkerPath);
  const checkerBytes = await fs.readFile(checkerPath);
  const pythonPath = options.pythonPath ?? process.env.WECHAT_HUMAN_WRITING_PYTHON?.trim() ?? 'python3';
  const result = await runChecker(pythonPath, checkerPath, markdownPath);
  if (
    !(await fs.readFile(markdownPath)).equals(articleBytes) ||
    !(await fs.readFile(checkerPath)).equals(checkerBytes)
  ) {
    throw new Error('去 AI 味检查期间正文或检查器已变更，需重新检查');
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const skippedNoChinese = result.exitCode === 2 && Boolean(options.allowNoChinese) && /没有检测到汉字/u.test(output);
  if (!skippedNoChinese && (result.exitCode !== 0 || /^需要修改$/mu.test(output))) {
    throw new Error(`去 AI 味检查未通过，已阻止上传草稿箱：${markdownPath}\n${output}`);
  }
  return {
    articleSha256: humanWritingSha256(articleBytes),
    checkerSha256: humanWritingSha256(checkerBytes),
    checkerPath,
    warnings: skippedNoChinese ? [] : parseWarnings(result.stdout),
    stdout: result.stdout,
    skippedNoChinese,
    proseFindings,
  };
}
