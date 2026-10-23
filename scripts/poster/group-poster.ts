import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { posterConfig, rendererRuntime } from '../operator-config.mjs';

// 高转化入群海报:图形底板 + 精确 HTML 排版 + 真实收款二维码 → PNG。
// 兼容旧参数:node group-poster.ts <收款码> <第二张码(忽略)> <输出>
// 新参数:node group-poster.ts <收款码> <输出>

interface ElementHandle {
  screenshot(o: { path: string }): Promise<unknown>;
}
interface Page {
  setViewport(o: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  setContent(html: string, o: { waitUntil: string }): Promise<void>;
  $(selector: string): Promise<ElementHandle | null>;
}
interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Puppeteer {
  launch(o: { executablePath: string; headless: boolean; args: string[] }): Promise<Browser>;
}

interface PosterConfig {
  brand: string;
  titleTop: string;
  titleAccent: string;
  hook: string;
  proof: string;
  leftTitle: string;
  leftBenefits: readonly string[];
  rightTitle: string;
  rightBenefits: readonly string[];
  payment: string;
  priceNote: string;
  payStep: string;
  ownerWechat: string;
  remark: string;
  audience: string;
  slogan: string;
  qrLabel: string;
  background: string | null;
}

const runtime = rendererRuntime('web');
const puppeteer = runtime.puppeteer as Puppeteer;
const CHROME = runtime.chrome;
const privatePoster = posterConfig('group');
const FONT = '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';

function env(key: string, fallback = ''): string {
  return privatePoster.text(key, fallback);
}

function envList(key: string, fallback: readonly string[]): readonly string[] {
  return privatePoster.list(key, fallback);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function imageData(file: string | undefined): string | null {
  if (!file || !existsSync(file)) return null;
  const extension = path.extname(file).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

const payment = process.env.POSTER_PAYMENT?.trim();
if (!payment) throw new Error('请用 POSTER_PAYMENT 显式传入用户确认的当前价格，不沿用历史档位');

const poster: PosterConfig = {
  brand: env('POSTER_BRAND'),
  titleTop: env('POSTER_TITLE_TOP', 'Codex'),
  titleAccent: env('POSTER_TITLE_ACCENT', '进阶实战群'),
  hook: env('POSTER_HOOK', '不是教你点按钮｜只聊额度、Agent 与真实项目'),
  proof: env('POSTER_PROOF', '持续更新：额度规则 · 模型变化 · 真实失败复盘'),
  leftTitle: env('POSTER_LEFT_TITLE', '额度别再烧糊涂'),
  leftBenefits: envList('POSTER_LEFT_BENEFITS', [
    'Sol / Ultra / Max / Fast 选择',
    '上下文、压缩与长任务真实消耗',
    '工具调用怎么少烧 Token',
    '重置时间与额度曲线判断',
    '消耗突然变快如何定位',
  ]),
  rightTitle: env('POSTER_RIGHT_TITLE', 'Agent 别只停在 Demo'),
  rightBenefits: envList('POSTER_RIGHT_BENEFITS', [
    'Skills / Plugins / MCP 实战',
    '多代理协作与自动化工作流',
    'CLI / App / 环境 / 网络排障',
    'AGENTS / 上下文 / 规则沉淀',
    '公众号、小程序、视频真实项目',
  ]),
  payment,
  priceNote: env('POSTER_PRICE_NOTE', '一次付费 · 无续费'),
  payStep: env('POSTER_PAY_STEP', '扫码支付'),
  ownerWechat: env('POSTER_OWNER_WECHAT'),
  remark: env('POSTER_REMARK', 'Codex群'),
  audience: env('POSTER_AUDIENCE', '适合：已经在用 Codex，想把额度和 Agent 做明白的人'),
  slogan: env('POSTER_SLOGAN', '少烧 Token · 少踩坑 · 把 Agent 真正跑起来'),
  qrLabel: env('POSTER_QR_LABEL', '微信收款码'),
  background: imageData(process.env.POSTER_BACKGROUND),
};

const paymentQr = imageData(process.argv[2]);
if (!paymentQr) throw new Error('请传入真实收款二维码');
const groupQrPath = process.env.POSTER_GROUP_QR?.trim();
const groupQr = imageData(groupQrPath);
if (groupQrPath && !groupQr) throw new Error('POSTER_GROUP_QR 指定的群二维码不存在');
if (!poster.brand) throw new Error('请配置 branding.posters.group.brand 或 POSTER_BRAND');
if (!groupQr && !poster.ownerWechat) throw new Error('无群二维码时必须配置入群联系人');
const out = process.argv[4] ?? process.argv[3] ?? process.env.POSTER_OUT ?? '/tmp/group-poster.png';

function benefitRows(items: readonly string[]): string {
  return items
    .map(
      (item, index) => `
        <div class="benefit-row">
          <span class="benefit-index">0${index + 1}</span>
          <span>${escapeHtml(item)}</span>
        </div>`
    )
    .join('');
}

const backgroundStyle = poster.background
  ? `background-image:linear-gradient(rgba(2,8,24,.08),rgba(2,8,24,.08)),url("${poster.background}");`
  : 'background-image:radial-gradient(circle at 82% 8%,#0d3e84 0,transparent 22%),linear-gradient(155deg,#020713,#06142d 58%,#020713);';

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #020713; }
  #poster {
    width: 1080px;
    height: 1620px;
    position: relative;
    overflow: hidden;
    color: #f7fbff;
    font-family: ${FONT};
    ${backgroundStyle}
    background-size: cover;
    background-position: center;
  }
  .brand {
    position: absolute; left: 66px; top: 62px;
    display: inline-flex; align-items: center; gap: 12px;
    font-size: 24px; font-weight: 800; letter-spacing: 3px; color: #6ddcff;
  }
  .brand::before { content: ""; width: 38px; height: 5px; background: #18c6ff; box-shadow: 0 0 18px #18c6ff; }
  .hero { position: absolute; left: 64px; top: 112px; width: 810px; }
  .title-top { font-size: 88px; line-height: 1; font-weight: 950; letter-spacing: -3px; }
  .title-accent {
    margin-top: 8px; font-size: 102px; line-height: 1; font-weight: 950; letter-spacing: -5px;
    color: #67d9ff; text-shadow: 0 0 28px rgba(41,182,255,.42);
  }
  .hook { margin-top: 28px; font-size: 31px; line-height: 1.45; font-weight: 850; color: #fff; }
  .proof {
    display: inline-flex; margin-top: 18px; padding: 10px 18px;
    border: 1px solid rgba(92,202,255,.52); background: rgba(5,25,57,.72);
    font-size: 22px; line-height: 1.35; color: #b7d8f8; letter-spacing: .5px;
  }
  .panel-copy { position: absolute; top: 575px; width: 405px; }
  .panel-copy.left { left: 79px; }
  .panel-copy.right { left: 553px; }
  .panel-title { font-size: 31px; font-weight: 950; color: #fff; margin-bottom: 26px; }
  .panel-title em { color: #53d8ff; font-style: normal; }
  .benefit-row {
    min-height: 75px; display: grid; grid-template-columns: 52px 1fr; gap: 13px;
    align-items: start; padding: 11px 0 10px; border-bottom: 1px solid rgba(76,142,213,.28);
    font-size: 20px; line-height: 1.5; font-weight: 720; color: #e8f2ff;
  }
  .benefit-row:last-child { border-bottom: 0; }
  .benefit-index {
    display: inline-flex; align-items: center; justify-content: center;
    width: 46px; height: 30px; margin-top: 2px; border-radius: 4px;
    background: linear-gradient(90deg,#1148d8,#16bfff); color: #fff;
    font-size: 17px; font-weight: 900; letter-spacing: 1px;
    box-shadow: 0 0 18px rgba(30,157,255,.35);
  }
  .price-card { position: absolute; left: 73px; top: 1162px; width: 555px; height: 116px; display: flex; align-items: center; }
  .price-label { width: 198px; font-size: 22px; line-height: 1.55; color: #b9d5f4; font-weight: 760; }
  .price-label strong { display: block; font-size: 27px; color: #fff; }
  .price { display: flex; align-items: baseline; color: #fff; }
  .price b { font-size: 78px; line-height: 1; letter-spacing: -4px; color: #69dcff; text-shadow: 0 0 22px rgba(55,193,255,.45); }
  .price span { margin-left: 9px; font-size: 25px; font-weight: 850; }
  .flow { position: absolute; left: 78px; top: 1340px; width: 530px; }
  .flow-title { font-size: 25px; font-weight: 900; color: #fff; margin-bottom: 15px; }
  .steps { display: grid; grid-template-columns: repeat(3,1fr); column-gap: 15px; }
  .step { font-size: 18px; line-height: 1.42; color: #c5d8ee; }
  .step strong { display: block; margin-bottom: 7px; font-size: 24px; color: #63dcff; }
  .qr-wrap {
    position: absolute; left: 680px; top: 1150px; width: 310px;
    display: flex; flex-direction: column; align-items: center;
  }
  .qr {
    display: block; width: 310px; height: 310px; object-fit: contain;
    background: #fff; border: 10px solid #fff; box-shadow: 0 0 28px rgba(28,179,255,.42);
  }
  .qr-label { margin-top: 11px; font-size: 20px; font-weight: 850; color: #d9efff; letter-spacing: 1px; }
  .with-group .price-card, .with-group .flow { width: 420px; }
  .with-group .steps { grid-template-columns: repeat(2,1fr); }
  .with-group .qr-wrap { width: 232px; }
  .with-group .qr-wrap.payment { left: 526px; }
  .with-group .qr-wrap.group { left: 784px; }
  .with-group .qr { width: 232px; height: 232px; }
  .with-group .qr-label { font-size: 17px; }
  .audience {
    position: absolute; left: 72px; right: 72px; top: 1518px;
    text-align: center; font-size: 19px; line-height: 1.4; color: #93abc4;
  }
  .slogan {
    position: absolute; left: 72px; right: 72px; bottom: 30px;
    text-align: center; font-size: 23px; line-height: 1.3; font-weight: 900; color: #64d8ff; letter-spacing: 1px;
  }
</style>
<main id="poster" class="${groupQr ? 'with-group' : ''}">
  <div class="brand">${escapeHtml(poster.brand)}</div>
  <section class="hero">
    <div class="title-top">${escapeHtml(poster.titleTop)}</div>
    <div class="title-accent">${escapeHtml(poster.titleAccent)}</div>
    <div class="hook">${escapeHtml(poster.hook)}</div>
    <div class="proof">${escapeHtml(poster.proof)}</div>
  </section>

  <section class="panel-copy left">
    <div class="panel-title">${escapeHtml(poster.leftTitle)}</div>
    ${benefitRows(poster.leftBenefits)}
  </section>
  <section class="panel-copy right">
    <div class="panel-title">${escapeHtml(poster.rightTitle)}</div>
    ${benefitRows(poster.rightBenefits)}
  </section>

  <section class="price-card">
    <div class="price-label"><strong>一次性门槛费</strong>${escapeHtml(poster.priceNote)}</div>
    <div class="price"><b>${escapeHtml(poster.payment)}</b><span>元</span></div>
  </section>

  <section class="flow">
    <div class="flow-title">${groupQr ? '两步进群' : '三步进群'}</div>
    <div class="steps">
      <div class="step"><strong>01</strong>${escapeHtml(poster.payStep)}<br>¥${escapeHtml(poster.payment)}</div>
      ${
        groupQr
          ? '<div class="step"><strong>02</strong>微信扫码入群</div>'
          : `<div class="step"><strong>02</strong>加微信<br>${escapeHtml(poster.ownerWechat)}</div>
      <div class="step"><strong>03</strong>备注<br>「${escapeHtml(poster.remark)}」</div>`
      }
    </div>
  </section>

  <div class="qr-wrap payment">
    <img class="qr" src="${paymentQr}" alt="${escapeHtml(poster.qrLabel)}">
    <div class="qr-label">${groupQr ? '1 ' : ''}${escapeHtml(poster.qrLabel)}</div>
  </div>
  ${
    groupQr
      ? `<div class="qr-wrap group">
    <img class="qr" src="${groupQr}" alt="微信群二维码">
    <div class="qr-label">2 微信扫码入群</div>
  </div>`
      : ''
  }
  <div class="audience">${escapeHtml(poster.audience)}</div>
  <div class="slogan">${escapeHtml(poster.slogan)}</div>
</main>`;

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1620, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'load' });
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    const element = await page.$('#poster');
    if (!element) throw new Error('未找到海报渲染节点');
    await element.screenshot({ path: out });
  } finally {
    await browser.close();
  }
  console.log('DONE', out);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
