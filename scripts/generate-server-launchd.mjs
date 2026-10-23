#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorProfilePath } from '../dist/config/operator-profile.js';
import { getProfile, projectRoot, requiredText } from './operator-config.mjs';

const xml = value =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** 看板是本地交互界面的后端，不应以默认 Standard 模式承受后台 CPU/I/O 限速。 */
export function renderServerLaunchd({ label, root, node, profile, port = 3333, runtimePath }) {
  if (!/^[A-Za-z0-9._-]+$/.test(label)) throw new Error('服务 label 不合法');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('服务端口不合法');
  for (const value of [root, node, profile]) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || /[\r\n\0]/.test(value)) {
      throw new Error('服务路径必须是有效绝对路径');
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(node)}</string><string>${xml(path.join(root, 'dist/server/index.js'))}</string>
    <string>--port</string><string>${port}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>ProcessType</key><string>Interactive</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>WECHAT_OPERATOR_PROFILE</key><string>${xml(profile)}</string>
    <key>PATH</key><string>${xml(runtimePath || `${path.dirname(node)}:/usr/bin:/bin`)}</string>
  </dict>
  <key>StandardOutPath</key><string>${xml(path.join(root, `.data/server-${port}.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(root, `.data/server-${port}.err.log`))}</string>
</dict></plist>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [label, output, port] = process.argv.slice(2);
  if (!label || !output) throw new Error('用法: node scripts/generate-server-launchd.mjs <label> <输出文件> [端口]');
  const runtime = getProfile().runtime;
  const body = renderServerLaunchd({
    label,
    root: projectRoot,
    node: requiredText(runtime.nodeExecutable, 'runtime.nodeExecutable'),
    profile: operatorProfilePath(projectRoot),
    port: port === undefined ? undefined : Number(port),
    runtimePath: Array.isArray(runtime.pathEntries) ? runtime.pathEntries.join(':') : undefined,
  });
  // 只生成，不覆盖、不安装、不重启。安装已有服务前必须备份并核对 label/端口。
  fs.writeFileSync(path.resolve(output), body, { flag: 'wx', mode: 0o600 });
  console.log('交互式看板服务配置已生成；尚未安装或启动。');
}
