function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderAppletLoginPage(appletId: string, appletName: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>登录小程序后台</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #f5f7fb; margin: 0; }
  .card { max-width: 380px; margin: 8vh auto; background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 2px 16px rgba(15,23,42,.1); text-align: center; }
  h1 { font-size: 18px; margin: 0 0 8px; color: #0f172a; }
  .hint { margin: 0 0 20px; color: #64748b; font-size: 13px; line-height: 1.6; }
  .qr { width: 240px; height: 240px; margin: 0 auto; display: flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
  .qr img { width: 100%; height: 100%; }
  .msg { margin-top: 16px; min-height: 20px; color: #c0392b; font-size: 14px; }
  .ok { color: #059669; }
  button { margin-top: 16px; padding: 8px 18px; border: 0; border-radius: 6px; background: #0284c7; color: #fff; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
<div class="card">
  <h1>${escapeHtml(appletName)} · 扫码登录</h1>
  <p class="hint">手机确认时选择“${escapeHtml(appletName)}”，不要选择公众号或其他小程序。</p>
  <div class="qr"><img id="qr" alt="二维码" /></div>
  <div class="msg" id="msg">正在获取二维码…</div>
  <button id="refresh" style="display:none">刷新二维码</button>
</div>
<script>
${renderLoginPageScript('applet', appletId)}
</script>
</body>
</html>`;
}

import { renderLoginPageScript } from './login-page-script.js';
