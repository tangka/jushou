import fs from 'node:fs/promises';
import process from 'node:process';
import { z } from 'zod';
import { isMain, runCli } from './utils/cli.js';
import {
  assertDailyDraftsVerified,
  type DailyDraftVerificationInput,
  dailyDraftOperations,
  stringifyDailyDraftVerification,
  verifyDailyDrafts,
} from './wechat/daily-draft-verifier.js';

const observationSchema = z
  .object({
    expectedAccountId: z.string().trim().min(1),
    observedAccountId: z.string().trim().min(1).nullable(),
    draftCount: z.number().int().nonnegative().nullable(),
    publishedCount: z.number().int().nonnegative().nullable(),
    operation: z.enum(dailyDraftOperations),
    certainty: z.enum(['verified', 'unknown', 'ambiguous']),
  })
  .strip();

const inputSchema = z
  .object({
    expectedAccountIds: z.array(z.string().trim().min(1)).min(1),
    observations: z.array(observationSchema),
    verifiedAt: z.string().trim().min(1),
  })
  .strip();

export function parseDailyDraftVerificationInput(value: unknown): DailyDraftVerificationInput {
  return inputSchema.parse(value);
}

export function parseDailyDraftVerifierCli(argv: readonly string[]): { input: string } {
  let input: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--input') {
      input = argv[index + 1]?.trim();
      if (!input) throw new Error('--input 需要终态观测 JSON 文件路径');
      index++;
      continue;
    }
    throw new Error(`未知参数:${arg}`);
  }
  if (!input) throw new Error('必须传 --input <终态观测 JSON>');
  return { input };
}

export async function run(): Promise<void> {
  const options = parseDailyDraftVerifierCli(process.argv.slice(2));
  const raw = await fs.readFile(options.input, 'utf8');
  const input = parseDailyDraftVerificationInput(JSON.parse(raw) as unknown);
  const report = verifyDailyDrafts(input);
  console.log(stringifyDailyDraftVerification(report));
  assertDailyDraftsVerified(report);
}

if (isMain(import.meta.url)) runCli(run);
