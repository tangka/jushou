/**
 * 视频号(WeChat Channels)采集探针。
 *
 * 真实逻辑在 fetch.ts:本文件只负责跑一次浏览器拦截,并把原始响应样本落盘。
 * 跑:WECHAT_ACCOUNT=<账号> pnpm channels:probe   (首次会弹 Chrome 扫码)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { isMain, runCli } from '../utils/cli.js';
import { fetchChannelsData } from './fetch.js';

interface ProbeCapture {
  matchedUrl: string;
  requestBody: unknown;
  json: unknown;
}

async function run(): Promise<void> {
  const result = await fetchChannelsData();
  const outPath = path.resolve(process.cwd(), `.data/channels-probe-${config.accountExact}.json`);
  const output: Record<string, ProbeCapture> = {};
  for (const [name, captures] of Object.entries(result.captures)) {
    const last = captures[captures.length - 1];
    if (!last) continue;
    output[name] = { matchedUrl: last.matchedUrl, requestBody: last.requestBody, json: last.json };
  }
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log('\n[channels-probe] ===== 结果 =====');
  console.log(
    `  post_list: ${result.videos.length ? `✓ ${result.videos.length}/${result.postListTotalCount || result.videos.length}` : '✗ 未截获'}`
  );
  console.log(`  fans_trend: ${result.dailyFans.length ? `✓ ${result.dailyFans.length} 天` : '✗ 未截获'}`);
  console.log(`[channels-probe] 原始响应已存:${outPath}`);
}

if (isMain(import.meta.url)) runCli(run);
