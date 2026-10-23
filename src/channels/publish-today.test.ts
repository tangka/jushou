import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveChannelCollectionName } from './publish-artifacts.js';
import { buildEgoBrowserPublishScript, listChannelDraftCandidates } from './publish-today.js';

async function writeDraft(root: string, name: string, postType: string): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.md`),
    `---\ntitle: ${name}\npost_type: ${postType}\n---\n\n正文\n\n短标题：${name.slice(-4)}\n`,
    'utf8'
  );
  return dir;
}

test('listChannelDraftCandidates chooses today video drafts and skips non-video drafts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-channel-publish-'));
  const today = '2026-07-03';

  const older = await writeDraft(root, `${today}-视频号-旧稿__codex`, '视频号');
  const newer = await writeDraft(root, `${today}-视频号-新稿__claude`, '视频号');
  await writeDraft(root, `${today}-公众号稿__codex`, '图文');
  const ready = await writeDraft(root, `${today}-视频号-已准备__codex`, '视频号');
  await fs.writeFile(path.join(ready, '.channels-publish.json'), '{"status":"ready"}\n', 'utf8');
  const published = await writeDraft(root, `${today}-视频号-已发布__codex`, '视频号');
  await fs.writeFile(path.join(published, '.channels-publish.json'), '{"status":"published"}\n', 'utf8');
  await writeDraft(root, '2026-07-02-视频号-昨天__codex', '视频号');

  await fs.utimes(older, new Date('2026-07-03T01:00:00Z'), new Date('2026-07-03T01:00:00Z'));
  await fs.utimes(newer, new Date('2026-07-03T02:00:00Z'), new Date('2026-07-03T02:00:00Z'));

  const result = await listChannelDraftCandidates(root, today, false);

  assert.equal(
    result.candidates.map(candidate => candidate.name).join(','),
    `${today}-视频号-已准备__codex,${today}-视频号-新稿__claude,${today}-视频号-旧稿__codex`
  );
  assert.ok(result.skipped.includes(`${today}-公众号稿__codex:非视频号草稿`));
  assert.ok(result.skipped.includes(`${today}-视频号-已发布__codex:已存在已发布 .channels-publish.json`));
});

test('buildEgoBrowserPublishScript emits syntactically valid async script', () => {
  const script = buildEgoBrowserPublishScript({
    taskSpace: 'wechat-channels:test',
    verifyText: 'test-account',
    account: 'TestAccount',
    channelLabel: 'Test',
    collectionName: '',
    draftDir: '/tmp/draft',
    videoPath: '/tmp/video.mp4',
    coverPath: '/tmp/cover.png',
    qaDir: '/tmp/qa',
    title: '今天 Test 动态:demo',
    shortTitle: '今日Test动态：demo',
    description: '今天 Test 动态:demo\n\n正文',
    screenshotDir: '/tmp/screenshots',
  });

  assert.doesNotThrow(() => new Function(`return (async () => {\n${script}\n})`));
  assert.equal(script.includes('尚未接入'), false);
  assert.ok(script.includes('await publishAndVerify();'));
});

test('weekly videos use the weekly collection and fail closed when it is missing', () => {
  assert.equal(resolveChannelCollectionName('weekly', '示例每日动态', 'Codex周刊'), 'Codex周刊');
  assert.equal(resolveChannelCollectionName('daily', '示例每日动态', 'Codex周刊'), '示例每日动态');
  assert.throws(() => resolveChannelCollectionName('weekly', '示例每日动态', ''), /周刊合集未配置/);
});
