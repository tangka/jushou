#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { operatorProfilePath } from '../dist/config/operator-profile.js';
import { getProfile, projectRoot, requiredText } from './operator-config.mjs';

const runtime = getProfile().runtime;
const label = requiredText(runtime.launchdLabel, 'runtime.launchdLabel');
if (!/^[A-Za-z0-9._-]+$/.test(label)) throw new Error('runtime.launchdLabel 只能包含字母、数字、点、下划线和短横线');
const hours = runtime.launchdHours;
if (!Array.isArray(hours) || !hours.length || hours.some(hour => !Number.isInteger(hour) || hour < 0 || hour > 23)) {
  throw new Error('runtime.launchdHours 必须为 0–23 的小时数组');
}
const escapeXml = value =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
const replacements = {
  LABEL: escapeXml(label),
  REPO: escapeXml(projectRoot),
  PROFILE: escapeXml(operatorProfilePath(projectRoot)),
  CALENDAR_INTERVALS: [...new Set(hours)]
    .map(hour => `<dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer></dict>`)
    .join('\n    '),
};
const template = fs.readFileSync(path.join(projectRoot, 'scripts/com.example.woa.draft.plist'), 'utf8');
const output = path.resolve(process.argv[2] || path.join(projectRoot, '.data/launchd-draft.plist'));
const rendered = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => replacements[key]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, rendered, { mode: 0o600 });
fs.chmodSync(output, 0o600);
console.log('launchd 配置已生成；尚未安装或启动。');
