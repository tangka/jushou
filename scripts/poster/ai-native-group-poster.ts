import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { posterConfig, rendererRuntime } from '../operator-config.mjs';

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

const runtime = rendererRuntime('web');
const puppeteer = runtime.puppeteer as Puppeteer;
const chrome = runtime.chrome;
const privatePoster = posterConfig('aiNative');

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function imageData(file: string | undefined): string | null {
  if (!file || !existsSync(file)) return null;
  const extension = path.extname(file).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

const background = imageData(process.argv[2]);
const qr = imageData(process.argv[3]);
const out = process.argv[4] ?? '/tmp/ai-native-group-poster.png';
const payment = privatePoster.text('POSTER_PAYMENT');
const groupSize = privatePoster.text('POSTER_GROUP_SIZE');
const benefitGroupSize = privatePoster.text('POSTER_BENEFIT_GROUP_SIZE', groupSize);
const qrLabel = privatePoster.text('POSTER_QR_LABEL', '微信收款码');
const payStep = privatePoster.text('POSTER_PAY_STEP', '扫码支付');
const groupQrPath = process.env.POSTER_GROUP_QR?.trim();
const groupQr = imageData(groupQrPath);
const wechatQrPath = process.env.POSTER_WECHAT_QR?.trim();
const wechatQr = imageData(wechatQrPath);
const groupQrNote = process.env.POSTER_GROUP_QR_NOTE?.trim() || '';
if (!background || !qr) {
  throw new Error('用法: node ai-native-group-poster.ts <无字底板.png> <收款码.jpg> <输出.png>');
}
if (!/^\d+(?:\.\d{1,2})?$/.test(payment)) {
  throw new Error('POSTER_PAYMENT 必须是最多两位小数的非负数');
}
if (!groupSize || groupSize.length > 12 || /[<>&]/.test(groupSize)) {
  throw new Error('POSTER_GROUP_SIZE 必须是 1–12 个字符且不得包含 HTML 特殊字符');
}
if (!benefitGroupSize || benefitGroupSize.length > 12 || /[<>&]/.test(benefitGroupSize)) {
  throw new Error('POSTER_BENEFIT_GROUP_SIZE 必须是 1–12 个字符且不得包含 HTML 特殊字符');
}
if (!qrLabel || qrLabel.length > 12 || /[<>&]/.test(qrLabel)) {
  throw new Error('POSTER_QR_LABEL 必须是 1–12 个字符且不得包含 HTML 特殊字符');
}
if (!payStep || payStep.length > 20 || /[<>&]/.test(payStep)) {
  throw new Error('POSTER_PAY_STEP 必须是 1–20 个字符且不得包含 HTML 特殊字符');
}
if (groupQrPath && !groupQr) {
  throw new Error('POSTER_GROUP_QR 指定的群二维码不存在');
}
if (wechatQrPath && !wechatQr) throw new Error('POSTER_WECHAT_QR 指定的微信收款码不存在');
if (wechatQr && (!groupQr || qrLabel !== '支付宝收款码')) {
  throw new Error('双支付布局必须同时提供群码，主收款码须标为支付宝收款码');
}
if (groupQrNote.length > 20 || /[<>&]/.test(groupQrNote)) {
  throw new Error('POSTER_GROUP_QR_NOTE 不得超过 20 个字符或包含 HTML 特殊字符');
}
if (groupQrNote && !groupQr) {
  throw new Error('群码有效期提示必须配合 POSTER_GROUP_QR 使用');
}

const brand = privatePoster.text('POSTER_BRAND');
const owner = privatePoster.text('POSTER_OWNER_WECHAT');
const remark = privatePoster.text('POSTER_REMARK', 'AI Native');
if (!brand) throw new Error('请配置 branding.posters.aiNative.brand 或 POSTER_BRAND');
if (!groupQr && !owner) throw new Error('无群二维码时必须配置入群联系人');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #0b42ed; }
  #poster {
    position: relative;
    width: 1080px;
    height: 1620px;
    overflow: hidden;
    background: url("${background}") center / cover no-repeat;
    color: #080808;
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .eyebrow {
    position: absolute;
    left: 78px;
    top: 78px;
    padding: 11px 18px 10px;
    border: 4px solid #080808;
    background: #ff654d;
    box-shadow: 7px 7px 0 #080808;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 2px;
  }
  .hero {
    position: absolute;
    left: 78px;
    top: 152px;
    width: 520px;
  }
  .hero h1 {
    margin: 0;
    font-size: 88px;
    line-height: .98;
    font-weight: 1000;
    letter-spacing: -5px;
  }
  .hero h1 em {
    display: block;
    margin: 7px 0;
    color: #0649ee;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 82px;
    font-style: normal;
    letter-spacing: -4px;
  }
  .hero .hook {
    width: 470px;
    margin-top: 30px;
    padding-top: 22px;
    border-top: 6px solid #080808;
    font-size: 29px;
    line-height: 1.45;
    font-weight: 850;
  }
  .hero .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 24px;
  }
  .hero .tag {
    padding: 9px 14px;
    border: 3px solid #080808;
    background: #ffe31b;
    font-size: 19px;
    font-weight: 900;
  }
  .hero .codex-row { display: flex; align-items: flex-start; gap: 14px; margin-top: 18px; }
  .hero .tag.codex {
    display: inline-block;
    padding: 12px 28px;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 42px;
    line-height: 1.05;
    letter-spacing: -1px;
  }
  .benefit {
    position: absolute;
    left: 218px;
    width: 735px;
    height: 104px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .benefit.one { top: 895px; }
  .benefit.two { top: 1015px; }
  .benefit.three { top: 1134px; }
  .benefit strong {
    font-size: 31px;
    line-height: 1.08;
    font-weight: 1000;
    letter-spacing: -1px;
  }
  .benefit span {
    margin-top: 8px;
    font-size: 20px;
    line-height: 1.2;
    font-weight: 700;
    color: #333;
  }
  .checkout {
    position: absolute;
    left: 72px;
    top: 1325px;
    width: 650px;
    color: #fff;
  }
  .checkout .label {
    display: inline-block;
    padding: 7px 13px;
    border: 3px solid #080808;
    background: #ff654d;
    box-shadow: 5px 5px 0 #080808;
    color: #080808;
    font-size: 18px;
    font-weight: 950;
    letter-spacing: 1px;
  }
  .price {
    display: flex;
    align-items: baseline;
    margin-top: 12px;
  }
  .price b {
    color: #ffe31b;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 98px;
    line-height: .95;
    font-weight: 1000;
    letter-spacing: -6px;
    -webkit-text-stroke: 3px #080808;
    text-shadow: 6px 6px 0 #080808;
  }
  .price span {
    margin-left: 13px;
    color: #fff;
    font-size: 27px;
    font-weight: 900;
  }
  .steps {
    margin-top: 19px;
    color: #fff;
    font-size: 21px;
    line-height: 1.55;
    font-weight: 750;
  }
  .steps strong { color: #ffe31b; }
  .qr {
    position: absolute;
    left: 784px;
    top: 1347px;
    width: 208px;
    height: 208px;
    object-fit: contain;
    border: 8px solid #fff;
    background: #fff;
  }
  .qr-label {
    position: absolute;
    left: 780px;
    top: 1570px;
    width: 218px;
    color: #fff;
    text-align: center;
    font-size: 17px;
    font-weight: 900;
    letter-spacing: 1px;
  }
  .with-group .checkout { width: 420px; }
  .payment-frame {
    position: absolute;
    left: 474px;
    top: 1310px;
    width: 270px;
    height: 270px;
    background: url("${background}") -756px -1310px / 1080px 1620px no-repeat;
  }
  .with-group .qr.payment { left: 502px; }
  .with-group .qr-label.payment { left: 497px; }
  .group-qr-note {
    position: absolute;
    left: 766px;
    top: 1597px;
    width: 244px;
    color: #fff;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
  }
  .triple-qr-backdrop { position: absolute; left: 352px; top: 1303px; width: 684px; height: 300px; background: #073fd5; }
  .dual-payment .checkout { width: 282px; }
  .dual-payment .steps { font-size: 18px; }
  .dual-payment .payment-frame { display: none; }
  .dual-payment .qr { top: 1347px; width: 204px; height: 204px; }
  .dual-payment .qr.payment, .dual-payment .qr-label.payment { left: 366px; }
  .dual-payment .qr.wechat, .dual-payment .qr-label.wechat { left: 588px; }
  .dual-payment .qr.group, .dual-payment .qr-label.group { left: 810px; }
  .dual-payment .qr-label { top: 1566px; width: 204px; font-size: 16px; letter-spacing: 0; }
  .payment-choice, .group-step { position: absolute; top: 1308px; height: 32px; display: flex; align-items: center; justify-content: center; color: #080808; border: 2px solid #080808; font-size: 19px; font-weight: 900; }
  .payment-choice { left: 366px; width: 426px; background: #ffe31b; }
  .group-step { left: 810px; width: 204px; background: #ff654d; }
  .dual-payment .group-qr-note { left: 810px; width: 204px; }
  .single-payment .triple-qr-backdrop { left: 474px; width: 562px; }
  .single-payment .payment-frame { display: none; }
  .single-payment .payment-choice { left: 502px; width: 208px; }
  .single-payment .group-step { left: 784px; width: 208px; }
</style>
<main id="poster" class="${groupQr ? 'with-group' : ''} ${wechatQr ? 'dual-payment' : groupQr ? 'single-payment' : ''}">
  <div class="eyebrow">${escapeHtml(brand)}</div>
  <section class="hero">
    <h1>${groupSize}<em>AI Native</em>交流大群</h1>
    <div class="hook">和一群真正使用 AI 的人<br>交流工具、方法与真实经验</div>
    <div class="tags"><span class="tag">AI 工具</span><span class="tag">Agent</span><span class="tag">工作流</span></div>
    <div class="codex-row"><span class="tag codex">Codex</span><span class="tag codex">Claude</span></div>
  </section>

  <section class="benefit one"><strong>一手 AI 资讯</strong><span>模型、工具与行业变化持续分享</span></section>
  <section class="benefit two"><strong>AI Native 实操</strong><span>Agent、自动化与真实工作流交流</span></section>
  <section class="benefit three"><strong>${benefitGroupSize}同行交流</strong><span>问题互助、案例拆解、资源共享</span></section>

  ${groupQr ? '<div class="triple-qr-backdrop" aria-hidden="true"></div>' : ''}
  <section class="checkout">
    <div class="label">一次性入群门槛费</div>
    <div class="price"><b>${payment}</b><span>元</span></div>
    <div class="steps">${
      wechatQr
        ? '<strong>先支付，再申请入群</strong><br>支付宝 / 微信任选一种'
        : groupQr
          ? `<strong>先支付，再申请入群</strong><br>${escapeHtml(payStep)}`
          : `<strong>${payStep}</strong> → 加微信 ${escapeHtml(owner)}<br>备注「${escapeHtml(remark)}」进入交流群`
    }</div>
  </section>
  ${groupQr ? '<div class="payment-frame" aria-hidden="true"></div>' : ''}
  ${groupQr ? '<div class="payment-choice">01 先支付</div><div class="group-step">02 再申请入群</div>' : ''}
  <img class="qr payment" src="${qr}" alt="${qrLabel}">
  <div class="qr-label payment">${qrLabel}</div>
  ${wechatQr ? `<img class="qr wechat" src="${wechatQr}" alt="微信收款码"><div class="qr-label wechat">微信收款码</div>` : ''}
  ${
    groupQr
      ? `<img class="qr group" src="${groupQr}" alt="微信群二维码">
  <div class="qr-label group">微信扫码申请入群</div>
  ${groupQrNote ? `<div class="group-qr-note">${groupQrNote}</div>` : ''}`
      : ''
  }
</main>`;

async function main(): Promise<void> {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
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
