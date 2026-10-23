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
const privatePoster = posterConfig('learning');
const font = '"Times New Roman","Songti SC","STSong","PingFang SC",serif';

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

const qr = imageData(process.argv[2]);
const avatar = imageData(process.argv[3]);
const groupQrPath = process.env.POSTER_GROUP_QR?.trim();
const groupQr = imageData(groupQrPath);
const wechatQrPath = process.env.POSTER_WECHAT_QR?.trim();
const wechatQr = imageData(wechatQrPath);
if (!qr || !avatar) throw new Error('请传入真实收款码和品牌头像');
if (groupQrPath && !groupQr) throw new Error('POSTER_GROUP_QR 指定的群二维码不存在');
if (wechatQrPath && !wechatQr) throw new Error('POSTER_WECHAT_QR 指定的微信收款码不存在');
const out = process.argv[4] ?? process.env.POSTER_OUT ?? '/tmp/learning-group-poster.png';

const benefits = envList('POSTER_BENEFITS', [
  '全网 AI 最新行业资讯实时更新',
  '趣味 AI 梗图与热点案例',
  '海量 AI 文档教程与实操资料',
  '各类 AI 工具一手内测抢先体验',
  '精选好用 AI 工具私藏推荐',
  'Codex / Claude Code 等 AI 工具实战',
  '用 AI 赚钱实录',
]);
const audiences = envList('POSTER_AUDIENCES', ['想拿一手 AI 资料', '想用AI赚钱', '想发掘真正实用的 AI 工具']);
const payment = env('POSTER_PAYMENT');
const owner = env('POSTER_OWNER_WECHAT');
const remark = env('POSTER_REMARK', '学习群');
const qrLabel = env('POSTER_QR_LABEL', '微信收款码');
const payStep = env('POSTER_PAY_STEP', '扫码支付');
if (wechatQr && (!groupQr || qrLabel !== '支付宝收款码')) {
  throw new Error('双支付布局必须同时提供群码，主收款码须标为支付宝收款码');
}
if (!payment || !/^\d+(?:\.\d{1,2})?$/.test(payment))
  throw new Error('请配置本次有效价格 POSTER_PAYMENT 或私有 payment');
if (!env('POSTER_BRAND') || !env('POSTER_TITLE_TOP')) throw new Error('请配置海报 brand 和 titleTop');
if (!groupQr && !owner) throw new Error('无群二维码时必须配置入群联系人');
const benefitStartTop = 604;
const benefitLastTop = 1036;

const benefitRows = benefits
  .map((item, index) => {
    const top =
      benefits.length === 1
        ? benefitStartTop
        : benefitStartTop + ((benefitLastTop - benefitStartTop) * index) / (benefits.length - 1);
    const lastClass = index === benefits.length - 1 ? ' benefit-last' : '';
    return `
      <div class="benefit benefit-${index + 1}${lastClass}" style="top:${top}px">
        <span class="number">${String(index + 1).padStart(2, '0')}</span><span class="benefit-copy">${escapeHtml(item)}</span>
      </div>`;
  })
  .join('');
const audienceRows = audiences
  .map(
    (item, index) => `
      <div class="audience audience-${index + 1}">
        <span class="audience-number">0${index + 1}</span><span>${escapeHtml(item)}</span>
      </div>`
  )
  .join('');

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;background:#0e0d0b}
#poster{position:relative;width:1080px;height:1620px;overflow:hidden;background:linear-gradient(180deg,#0e0d0b 0 500px,#f2eadc 500px 1238px,#0e0d0b 1238px 100%);color:#f2eadc;font-family:${font}}
#poster:before{content:"";position:absolute;inset:0;opacity:.055;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.9'/%3E%3C/svg%3E")}
.brand{position:absolute;left:62px;top:52px;color:#f2eadc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;letter-spacing:.2em}.brand:before{content:"";display:inline-block;width:7px;height:7px;margin-right:14px;border-radius:50%;background:#bc9b6a}.brand-suffix{color:rgba(242,234,220,.36)}
.avatar{position:absolute;right:66px;top:78px;width:258px;height:300px;object-fit:cover;border:1px solid rgba(242,234,220,.18);filter:saturate(.84) contrast(1.04)}.avatar-name{display:flex;position:absolute;right:66px;top:394px;width:258px;height:52px;align-items:center;justify-content:center;border:1px solid #d4b47f;background:#bc9b6a;color:#0e0d0b;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:21px;font-weight:850;letter-spacing:.04em;box-shadow:6px 6px 0 rgba(0,0,0,.38)}
.price-tag{position:absolute;left:62px;top:423px;min-height:51px;padding:0 28px;display:flex;align-items:center;background:#bc9b6a;color:#0e0d0b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;font-weight:700;letter-spacing:.08em}.price-tag strong{margin-left:10px;color:#0e0d0b;font-size:22px}
.title{position:absolute;left:62px;top:132px;width:690px;color:#f2eadc;font-size:84px;line-height:.9;font-weight:400;letter-spacing:-2px}.title em{color:#bc9b6a;font-style:italic;font-weight:400}.title strong{display:block;margin-top:18px;color:#bc9b6a;font-size:94px;font-style:italic;font-weight:400;letter-spacing:-3px}
.hook{position:absolute;left:66px;top:348px;color:rgba(242,234,220,.72);font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:24px;font-weight:400;letter-spacing:.3px}
.section-title{position:absolute;left:62px;color:#1b1611;font-size:39px;font-weight:400}.section-title:before{display:inline-block;margin-right:19px;color:#8b7140;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;letter-spacing:.18em;vertical-align:8px}.section-title:after{margin-left:24px;color:#8b7140;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.18em;vertical-align:8px}.benefit-title{top:532px}.benefit-title:before{content:"REEL 01"}.benefit-title:after{content:"SELECTED ${benefits.length}"}.audience-title{top:1130px;font-size:31px}.audience-title:before{content:"REEL 02"}.audience-title:after{content:"WHO SHOULD JOIN"}
.benefit{position:absolute;left:62px;width:956px;height:72px;display:grid;grid-template-columns:72px 1fr 168px;align-items:center;border-top:1px solid rgba(27,22,17,.18)}.benefit:after{content:"DETAILS  →";color:#8b7140;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.16em;text-align:right}.benefit-last{left:48px;width:984px;padding:0 14px;background:#1b1611;border:0}.benefit-last:after{content:"CASE NOTES  →";color:#bc9b6a}.benefit-last .number{color:#bc9b6a}.benefit-last .benefit-copy{color:#f2eadc;font-size:31px;font-style:italic}
.number{color:#8b7140;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;letter-spacing:.15em}.benefit-copy{color:#1b1611;font-size:28px;line-height:1;font-weight:400}
.audience{position:absolute;top:1178px;width:304px;height:54px;padding:14px 0 0 40px;border-top:1px solid rgba(27,22,17,.18);color:#1b1611;font-size:22px;line-height:1.25;font-weight:400}.audience-1{left:62px}.audience-2{left:389px}.audience-3{left:716px}.audience-number{position:absolute;left:0;top:18px;color:#8b7140;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.12em}.join-call{display:none}
.checkout{position:absolute;left:0;right:0;top:1238px;height:382px;border-top:1px solid rgba(242,234,220,.12);background:#0e0d0b;color:#f2eadc}
.checkout:before{content:"REEL 03 · JOIN NOW";position:absolute;left:62px;top:34px;color:#bc9b6a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.2em}
.price-box{position:absolute;left:62px;top:63px;width:585px;height:120px;display:flex;align-items:flex-end}.price-label{width:208px;padding-bottom:8px;color:rgba(242,234,220,.48);font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:18px;line-height:1.45}.price-label strong{display:block;color:#f2eadc;font-family:${font};font-size:28px;font-weight:400}.price{display:flex;align-items:baseline;color:#bc9b6a}.price b{font-size:96px;line-height:.82;font-style:italic;font-weight:400;letter-spacing:-4px}.price span{margin-left:12px;color:#f2eadc;font-size:25px}
.steps-title{position:absolute;left:62px;top:214px;color:#f2eadc;font-size:26px;font-weight:400}.steps{position:absolute;left:62px;top:254px;width:620px;display:grid;grid-template-columns:repeat(3,1fr);gap:26px}.step{border-top:1px solid rgba(242,234,220,.12);padding-top:12px;color:rgba(242,234,220,.62);font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:20px;line-height:1.4}.step strong{display:block;margin-bottom:7px;color:#bc9b6a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;letter-spacing:.12em}
.qr-wrap{position:absolute;right:66px;top:53px;width:258px;text-align:right}.qr{width:244px;height:244px;object-fit:contain;border:10px solid #fff;background:#fff}.qr-label{margin-top:12px;color:rgba(242,234,220,.48);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.15em}.slogan{position:absolute;left:62px;bottom:17px;color:rgba(242,234,220,.28);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.14em}
.with-group .price-box{width:420px}.with-group .price-label{width:160px;font-size:16px}.with-group .price-label strong{font-size:25px}
.with-group .steps{width:420px;grid-template-columns:repeat(2,1fr);gap:20px}.with-group .step{font-size:18px}
.with-group .qr-wrap{width:244px;text-align:center}.with-group .qr-wrap.payment{left:532px;right:auto}.with-group .qr-wrap.group{left:800px;right:auto}
.with-group .qr-label{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;letter-spacing:0}
.dual-payment .price-box{top:70px;width:244px;height:auto;flex-direction:column;align-items:flex-start;gap:16px}
.dual-payment .price-label{width:244px;font-size:14px;padding:0}.dual-payment .price-label strong{font-size:25px}
.dual-payment .price b{font-size:90px}.dual-payment .price span{font-size:23px}
.dual-payment .steps-title{top:242px;font-size:23px}.dual-payment .steps{top:281px;width:244px;display:block}
.dual-payment .step{font-size:17px;padding-top:10px}
.dual-payment .qr-wrap{top:90px;width:212px;text-align:center}
.dual-payment .qr-wrap.payment{left:336px}.dual-payment .qr-wrap.wechat{left:570px}.dual-payment .qr-wrap.group{left:804px}
.dual-payment .qr{width:212px;height:212px;border-width:8px}.dual-payment .qr-label{font-size:16px;color:#f2eadc}
.payment-choice,.group-step{position:absolute;top:48px;height:32px;display:flex;align-items:center;justify-content:center;background:#bc9b6a;color:#0e0d0b;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:19px;font-weight:800}
.payment-choice{left:336px;width:446px}.group-step{left:804px;width:212px}
.single-payment .qr-wrap{top:90px;width:224px}.single-payment .qr{width:224px;height:224px}
.single-payment .payment-choice{left:532px;width:224px}.single-payment .group-step{left:800px;width:224px}
.single-payment .qr-label{color:#f2eadc}
</style><main id="poster" class="${groupQr ? 'with-group' : ''} ${wechatQr ? 'dual-payment' : groupQr ? 'single-payment' : ''}">
<div class="brand">${escapeHtml(env('POSTER_BRAND'))}<span class="brand-suffix">${escapeHtml(env('POSTER_BRAND_SUFFIX'))}</span></div>
<div class="price-tag">立即加入<strong>→</strong></div>
<div class="title">${escapeHtml(env('POSTER_TITLE_TOP'))} <em>${escapeHtml(env('POSTER_TITLE_EMPHASIS', 'AI'))}</em><strong>${escapeHtml(env('POSTER_TITLE_ACCENT', '学习交流群'))}</strong></div>
<div class="hook">${escapeHtml(env('POSTER_HOOK', '一手 AI 圈内资讯｜干货教程与工具实测'))}</div>
<img class="avatar" src="${avatar}"><div class="avatar-name">${escapeHtml(env('POSTER_AVATAR_NAME', '你的专属AI陪跑员'))}</div>
<div class="section-title benefit-title">群内核心福利</div><div class="section-title audience-title">入群适合人群</div>
${benefitRows}${audienceRows}<div class="join-call">都可以加入！</div>
<section class="checkout">
  <section class="price-box"><div class="price-label"><strong>现价一次性</strong>资料持续更新 · 群内交流</div><div class="price"><b>${escapeHtml(payment)}</b><span>元</span></div></section>
  ${
    wechatQr
      ? '<div class="steps-title">先支付，再申请入群</div><div class="steps"><div class="step">支付宝 / 微信任选一种</div></div><div class="payment-choice">01 先支付</div><div class="group-step">02 再申请入群</div>'
      : `<div class="steps-title">${groupQr ? '先支付，再申请入群' : '三步进群'}</div><div class="steps"><div class="step"><strong>01</strong>${escapeHtml(payStep)}</div>${
          groupQr
            ? '<div class="step"><strong>02</strong>用微信扫群码<br>申请入群</div>'
            : `<div class="step"><strong>02</strong>加微信<br>${escapeHtml(owner)}</div><div class="step"><strong>03</strong>备注<br>「${escapeHtml(remark)}」</div>`
        }</div>`
  }
  ${groupQr && !wechatQr ? '<div class="payment-choice">01 先支付</div><div class="group-step">02 再申请入群</div>' : ''}
  <div class="qr-wrap payment"><img class="qr" src="${qr}" alt="${escapeHtml(qrLabel)}"><div class="qr-label">${escapeHtml(qrLabel)}</div></div>
  ${wechatQr ? `<div class="qr-wrap wechat"><img class="qr" src="${wechatQr}" alt="微信收款码"><div class="qr-label">微信收款码</div></div>` : ''}
  ${groupQr ? `<div class="qr-wrap group"><img class="qr" src="${groupQr}" alt="微信群二维码"><div class="qr-label">微信扫码申请入群</div></div>` : ''}
</section>
<div class="slogan">${escapeHtml(env('POSTER_SLOGAN', '一手资讯 · 实操资料 · 好用工具，及时跟上每一波 AI 变化'))}</div>
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
