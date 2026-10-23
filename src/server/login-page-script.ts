export const LOGIN_PAGE_SESSION_TTL_MS = 10 * 60 * 1000;
export const LOGIN_PAGE_REQUEST_TIMEOUT_MS = 15_000;
export const LOGIN_PAGE_POLL_MS = 2000;

/** 两种独立扫码页共用会话生命周期；公众号也走 account + sid 隔离接口。 */
export function renderLoginPageScript(kind: 'mp' | 'applet', appletId = ''): string {
  const settings = JSON.stringify({ kind, appletId }).replaceAll('<', '\\u003c');
  return `
const settings = ${settings};
const qr = document.getElementById('qr');
const msg = document.getElementById('msg');
const refresh = document.getElementById('refresh');
const isApplet = settings.kind === 'applet';
const target = isApplet ? settings.appletId : new URLSearchParams(window.location.search).get('account') || '';
const query = target ? (isApplet ? 'applet=' : 'account=') + encodeURIComponent(target) : '';
const api = isApplet ? '/api/web/applet-login/' : '/api/web/login/inline/';
const dashboardUrl = (isApplet ? '/dashboard/applets/' : '/dashboard/') + (query ? '?' + query : '');
let current = null;
let sequence = 0;

function active(run) { return current === run && !run.controller.signal.aborted; }
function setMsg(text, ok) { msg.textContent = text; msg.className = ok ? 'msg ok' : 'msg'; }
function stop(run) {
  if (!run) return;
  run.controller.abort();
  clearTimeout(run.timer);
  clearTimeout(run.expiry);
  clearTimeout(run.requestTimer);
  if (current === run) current = null;
}
function fail(run, text) {
  if (!active(run)) return;
  setMsg(text);
  refresh.style.display = 'inline-block';
  stop(run);
}
function endpoint(action, run) {
  return api + action + '/' + encodeURIComponent(run.sid) + (query ? '?' + query : '');
}
function showQr(run) {
  if (!active(run)) return;
  const url = endpoint('getqrcode', run);
  qr.src = url + (url.includes('?') ? '&' : '?') + 'rnd=' + Math.random();
}
function later(run, callback, delay) {
  if (!active(run)) return;
  clearTimeout(run.timer);
  run.timer = setTimeout(() => {
    run.timer = null;
    if (active(run)) callback();
  }, delay);
}
async function request(run, action, method) {
  if (!active(run)) return null;
  run.requestTimer = setTimeout(() => fail(run, '请求超时，请刷新二维码重试'), ${LOGIN_PAGE_REQUEST_TIMEOUT_MS});
  try {
    const response = await fetch(endpoint(action, run), { method: method || 'GET', signal: run.controller.signal });
    if (!active(run)) return null;
    if (response.status === 410) throw new Error('登录会话已过期，请刷新二维码');
    if (!response.ok) throw new Error('登录请求失败（' + response.status + '），请刷新二维码');
    const body = await response.json();
    if (!active(run)) return null;
    if (body && body.err) throw new Error(body.err);
    return body;
  } finally {
    clearTimeout(run.requestTimer);
    run.requestTimer = null;
  }
}
function requireSuccess(body) {
  if (!body || !body.base_resp || body.base_resp.ret !== 0) {
    throw new Error(body && body.base_resp && body.base_resp.err_msg || '登录请求失败，请刷新二维码');
  }
}
function poll(run) { later(run, () => { void check(run); }, ${LOGIN_PAGE_POLL_MS}); }
async function check(run) {
  try {
    const body = await request(run, 'scan');
    if (!active(run)) return;
    requireSuccess(body);
    switch (body.status) {
      case 0: return poll(run);
      case 1:
        setMsg(isApplet ? '已确认，正在校验小程序后台…' : '已确认，正在登录…');
        return void bizLogin(run);
      case 2: case 3: return fail(run, '二维码已过期或取消，请刷新二维码');
      case 4: case 6:
        if (!(body.acct_size >= 1)) return fail(run, '没有可登录账号，请刷新二维码');
        setMsg(isApplet ? '扫码成功，请在手机上选择小程序账号并确认' : '扫码成功，请在手机上确认');
        return poll(run);
      case 5: return fail(run, '该账号尚未绑定邮箱，请绑定后刷新二维码');
      default: return fail(run, '登录状态异常，请刷新二维码');
    }
  } catch (error) { fail(run, error instanceof Error ? error.message : String(error)); }
}
async function bizLogin(run) {
  if (!active(run)) return;
  try {
    const body = await request(run, 'bizlogin', 'POST');
    if (!active(run)) return;
    if (!body || !body.nickname) throw new Error('登录确认失败，请刷新二维码');
    qr.style.display = 'none';
    setMsg(isApplet ? '小程序登录成功，正在进入看板...' : '登录成功:' + body.nickname + '(正在进入看板...)', true);
    clearTimeout(run.expiry);
    later(run, () => { window.location.href = dashboardUrl; stop(run); }, 600);
  } catch (error) { fail(run, error instanceof Error ? error.message : String(error)); }
}
async function start() {
  stop(current);
  const run = {
    sid: settings.kind + '-page-' + Date.now() + '-' + (++sequence) + '-' + Math.floor(Math.random() * 10000),
    controller: new AbortController(), timer: null, expiry: null, requestTimer: null,
  };
  current = run;
  run.expiry = setTimeout(() => fail(run, '登录会话已过期，请刷新二维码'), ${LOGIN_PAGE_SESSION_TTL_MS});
  setMsg('正在获取二维码…');
  refresh.style.display = 'none';
  qr.style.display = '';
  qr.removeAttribute('src');
  try {
    const body = await request(run, 'session', 'POST');
    if (!active(run)) return;
    requireSuccess(body);
    showQr(run);
    setMsg(isApplet ? '请用微信扫码，并在手机上选择小程序账号' : '请用微信扫码');
    poll(run);
  } catch (error) { fail(run, error instanceof Error ? error.message : String(error)); }
}
refresh.addEventListener('click', () => { void start(); });
window.addEventListener('pagehide', () => {
  stop(current);
  refresh.style.display = 'inline-block';
});
void start();
`;
}
