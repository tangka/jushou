import { readFileSync } from 'node:fs';
import process from 'node:process';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { probeAppletLogin } from '../applets/session.js';
import { config } from '../config/index.js';
import { isMain } from '../utils/cli.js';
import { resolveAccount } from './account-registry.js';
import { injectAccountBranding, readStoredAccount } from './account-state.js';
import { renderAppletLoginPage } from './applet-login-page.js';
import { LOGIN_PAGE } from './login-page.js';
import { appletLoginRoutes } from './routes/applet-login.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { checkLogin, loginRoutes } from './routes/login.js';
import { publicRoutes } from './routes/public.js';

// 端口:优先 --port 参数,否则 config.serverPort(PORT env / 默认 3333)
function resolvePort(): number {
  const i = process.argv.indexOf('--port');
  if (i >= 0) {
    const v = Number(process.argv[i + 1]);
    if (Number.isInteger(v) && v > 0) return v;
  }
  return config.serverPort;
}

function accountQuery(accountId: string | undefined): string {
  return accountId ? `?account=${encodeURIComponent(accountId)}` : '';
}

function appletQuery(appletId: string): string {
  return `?applet=${encodeURIComponent(appletId)}`;
}

/** 读看板 index.html 并注入账号 title/logo(品牌化);失败返回 null。 */
function dashboardHtml(accountId: string | undefined): string | null {
  try {
    const account = accountId ? resolveAccount(accountId) : null;
    const stored = account
      ? readStoredAccount({ loginStatePath: account.loginStatePath, fallbackName: account.account })
      : { nickname: '运营首页', avatar: '' };
    return injectAccountBranding(readFileSync('./web/dist/index.html', 'utf8'), stored);
  } catch {
    return null;
  }
}

function htmlNoStore(c: { header: (name: string, value: string) => void }): void {
  c.header('Cache-Control', 'no-store, max-age=0');
  c.header('Pragma', 'no-cache');
}

export function buildApp(): Hono {
  const app = new Hono();
  // 访问根路径:登录态有效则直接进看板,免扫码;否则给扫码登录页(title 用账号名)
  app.get('/', async c => {
    const requestedAccount = c.req.query('account');
    const account = resolveAccount(requestedAccount);
    const query = accountQuery(account?.id);
    const relogin = c.req.query('relogin') === '1';
    if (account?.id && requestedAccount !== account.id) return c.redirect(`/${query}${relogin ? '&relogin=1' : ''}`);
    if (!relogin) {
      const { loggedIn } = await checkLogin(account, c.req.raw.signal);
      if (loggedIn) return c.redirect(`/dashboard/${query}`);
    }
    htmlNoStore(c);
    return c.html(
      injectAccountBranding(LOGIN_PAGE, account ? { nickname: account.account, avatar: '' } : readStoredAccount())
    );
  });
  app.get('/health', c => c.json({ ok: true, product: 'wechat-official-account' }));
  app.get('/applet-login', async c => {
    const requestedApplet = c.req.query('applet');
    const applet = config.appletRegistry.find(item => item.id === requestedApplet) ?? config.appletRegistry[0];
    if (!applet) return c.text('未配置小程序', 404);
    if (requestedApplet && requestedApplet !== applet.id) return c.redirect(`/applet-login${appletQuery(applet.id)}`);
    const probe = await probeAppletLogin(undefined, applet, c.req.raw.signal);
    if (probe.loggedIn) return c.redirect(`/dashboard/applets/${appletQuery(applet.id)}`);
    htmlNoStore(c);
    return c.html(renderAppletLoginPage(applet.id, applet.name));
  });
  app.route('/api/web/login', loginRoutes);
  app.route('/api/web/applet-login', appletLoginRoutes);
  app.route('/api/public/v1', publicRoutes);
  app.route('/api/dashboard', dashboardRoutes);
  // 本地看板:serve web/dist(vite build,base=/dashboard/);/dashboard 跳到带斜杠
  app.get('/dashboard', c => {
    const requestedAccount = c.req.query('account');
    if (!requestedAccount) return c.redirect('/dashboard/');
    const account = resolveAccount(requestedAccount);
    return c.redirect(`/dashboard/${accountQuery(account?.id)}`);
  });
  // 看板首页 HTML 注入账号 title/logo;静态资源(js/css)仍走 serveStatic
  app.get('/dashboard/', c => {
    const requestedAccount = c.req.query('account');
    if (requestedAccount) {
      const account = resolveAccount(requestedAccount);
      const query = accountQuery(account?.id);
      if (account?.id && requestedAccount !== account.id) return c.redirect(`/dashboard/${query}`);
    }
    const html = dashboardHtml(requestedAccount);
    if (!html) return c.notFound();
    htmlNoStore(c);
    return c.html(html);
  });
  app.use('/dashboard/*', serveStatic({ root: './web/dist', rewriteRequestPath: p => p.replace(/^\/dashboard/, '') }));
  // SPA fallback:/dashboard/a/:id 等前端路由,静态没命中就回(已注入品牌的)index.html
  app.get('/dashboard/*', c => {
    const requestedAccount = c.req.query('account');
    if (requestedAccount) {
      const account = resolveAccount(requestedAccount);
      if (account?.id && requestedAccount !== account.id) {
        const url = new URL(c.req.url);
        url.searchParams.set('account', account.id);
        return c.redirect(`${url.pathname}${url.search}`);
      }
    }
    const html = dashboardHtml(c.req.query('account'));
    if (!html) return c.notFound();
    htmlNoStore(c);
    return c.html(html);
  });
  return app;
}

/** 启动微信代理服务(扫码登录页 + 代理接口)。 */
export function startServer(port: number = resolvePort()): void {
  serve({ fetch: buildApp().fetch, port }, info => {
    console.log(`微信代理服务已启动:http://127.0.0.1:${info.port}`);
    console.log('扫码登录:用浏览器打开上面地址,扫码后登录态按 account 写入各自配置。');
  });
}

if (isMain(import.meta.url)) startServer();
