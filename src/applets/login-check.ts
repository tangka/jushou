import { config } from '../config/index.js';
import { isMain, runCli } from '../utils/cli.js';
import { appletFrameUrl, loadAppletSession, probeAppletLogin } from './session.js';

export async function run(): Promise<void> {
  const probe = await probeAppletLogin();
  if (!probe.loggedIn) {
    throw new Error(
      `小程序登录态无效:${probe.reason}\n请打开 ${config.baseUrl}/applet-login?applet=${encodeURIComponent(config.applets.id)} 重新扫码。`
    );
  }
  const session = await loadAppletSession();
  console.log('小程序登录态有效');
  console.log(`页面标题:${probe.title || '-'}`);
  console.log(`入口:${appletFrameUrl(session.token)}`);
}

if (isMain(import.meta.url)) runCli(run);
