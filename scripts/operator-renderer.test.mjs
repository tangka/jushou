import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { projectRoot } from './operator-config.mjs';

test('all renderer entry points use private brand and contact config without opening a browser', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-renderer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const collector = path.join(dir, 'collector');
  const dependency = path.join(collector, 'node_modules/puppeteer-core');
  fs.mkdirSync(dependency, { recursive: true });
  fs.writeFileSync(path.join(collector, 'package.json'), '{}');
  fs.writeFileSync(path.join(dependency, 'package.json'), '{"main":"index.cjs"}');
  fs.writeFileSync(
    path.join(dependency, 'index.cjs'),
    `
    const fs = require('node:fs');
    exports.launch = async () => ({
      newPage: async () => ({
        setViewport: async () => {},
        setContent: async html => fs.appendFileSync(process.env.TEST_HTML_PATH, html),
        $: async () => ({ screenshot: async () => {} }),
        close: async () => {},
      }),
      close: async () => {},
    });
  `
  );
  const asset = path.join(dir, 'fixture.png');
  fs.writeFileSync(asset, 'fixture image bytes, never decoded by the stub');
  const config = path.join(dir, 'profile.json');
  const poster = {
    brand: 'Fixture & brand',
    ownerWechat: 'fixture-contact',
    payment: '1',
    titleTop: 'Fixture title',
    groupSize: '示例',
    brandSuffix: ' / fixture.example',
  };
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      runtime: { chromePath: '/not-launched', xCollectDir: collector, webCollectDir: collector },
      branding: {
        visual: { brand: 'Fixture & brand', avatarPath: asset },
        posters: { group: poster, learning: poster, aiNative: poster },
      },
    })
  );
  for (const [script, args, input] of [
    ['poster/group-poster.ts', [asset, path.join(dir, 'group.png')], undefined],
    ['poster/learning-group-poster.ts', [asset, asset, path.join(dir, 'learning.png')], undefined],
    ['poster/ai-native-group-poster.ts', [asset, asset, path.join(dir, 'native.png')], undefined],
    [
      'account-frontpage.mjs',
      [path.join(dir, 'frontpage.png')],
      { background: asset, title: 'Fixture title', headline: 'Fixture headline' },
    ],
    [
      'account-visual.mjs',
      [path.join(dir, 'visual')],
      [
        { title: 'Fixture cover' },
        { type: 'card', title: 'Fixture card' },
        { type: 'newspic', title: 'Fixture news', benchmarkImage: asset, signatoriesImage: asset },
      ],
    ],
  ]) {
    const htmlPath = path.join(dir, 'html.txt');
    fs.writeFileSync(htmlPath, '');
    execFileSync(process.execPath, [path.join(projectRoot, 'scripts', script), ...args], {
      cwd: dir,
      env: { PATH: process.env.PATH, WECHAT_OPERATOR_PROFILE: config, POSTER_PAYMENT: '2', TEST_HTML_PATH: htmlPath },
      input: input ? JSON.stringify(input) : undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(html.includes('Fixture &amp; brand'), `${script} renders configured escaped brand`);
    if (script.startsWith('poster/'))
      assert.ok(html.includes('fixture-contact'), `${script} renders configured contact`);
    if (script.includes('learning')) assert.ok(html.includes('fixture.example'));
  }
});
