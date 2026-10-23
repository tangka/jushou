import fs from 'node:fs/promises';
import process from 'node:process';
import { isMain, runCli } from './utils/cli.js';
import { parseDailyDraftVerifierCli } from './verify-daily-drafts.js';
import { verifyDailyPublications } from './wechat/daily-publication-verifier.js';

export async function run(): Promise<void> {
  const { input } = parseDailyDraftVerifierCli(process.argv.slice(2));
  const raw: unknown = JSON.parse(await fs.readFile(input, 'utf8'));
  const report = verifyDailyPublications(raw);
  console.log(JSON.stringify(report));
  if (!report.ok) {
    throw new Error(`每日发表终态未通过:${[...new Set(report.issues.map(issue => issue.code))].join(',')}`);
  }
}

if (isMain(import.meta.url)) runCli(run);
