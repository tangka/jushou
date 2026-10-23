import { renderLoginPageScript } from './login-page-script.js';

// 极简扫码登录页(替代原 Nuxt SPA 的 Login.vue):同源浏览器打开 → 扫码 → 服务端写 login-state.json。
export const LOGIN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>登录微信公众号</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #f5f5f5; margin: 0; }
  .card { max-width: 360px; margin: 8vh auto; background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 2px 16px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 18px; margin: 0 0 20px; }
  .qr { width: 240px; height: 240px; margin: 0 auto; display: flex; align-items: center; justify-content: center; border: 1px solid #eee; border-radius: 8px; }
  .qr img { width: 100%; height: 100%; }
  .msg { margin-top: 16px; min-height: 20px; color: #c0392b; font-size: 14px; }
  .ok { color: #27ae60; }
  button { margin-top: 16px; padding: 8px 18px; border: 0; border-radius: 6px; background: #07c160; color: #fff; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
<div class="card">
  <h1>微信公众号扫码登录</h1>
  <div class="qr"><img id="qr" alt="二维码" /></div>
  <div class="msg" id="msg">正在获取二维码…</div>
  <button id="refresh" style="display:none">刷新二维码</button>
</div>
<script>
${renderLoginPageScript('mp')}
</script>
</body>
</html>`;
