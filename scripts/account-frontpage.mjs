#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { rendererRuntime, requiredText, visualConfig } from './operator-config.mjs';

const visual = visualConfig();
const { puppeteer, chrome: chromePath } = rendererRuntime('x');
const visualBrand = requiredText(visual.brand, 'branding.visual.brand');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function imageData(rawPath) {
  const imagePath = path.resolve(rawPath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png';
  return `data:image/${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;
}

function titleHtml(title) {
  const lines = Array.isArray(title) ? title : [title];
  return lines.map((line, index) => `<span class="title-line line-${index}">${escapeHtml(line)}</span>`).join('');
}

function chipsHtml(chips = []) {
  return chips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('');
}

function renderHtml(item, backgroundData) {
  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8">
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{width:1080px;height:1440px;overflow:hidden}
        body{font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif}
        #canvas{position:relative;width:1080px;height:1440px;overflow:hidden;background:#e9e5dc;color:#090909}
        .photo{position:absolute;inset:0;width:1080px;height:1440px;object-fit:cover}
        .paper-noise{position:absolute;inset:0;opacity:.18;mix-blend-mode:multiply;background-image:
          radial-gradient(circle at 15% 25%,rgba(0,0,0,.22) 0 1px,transparent 1.5px);
          background-size:17px 17px}
        .yellow{position:absolute;left:0;top:0;width:940px;height:470px;background:#eaff00;
          clip-path:polygon(0 0,100% 0,91% 100%,0 100%);box-shadow:0 14px 0 rgba(0,0,0,.92)}
        .eyebrow{position:absolute;left:58px;top:48px;display:inline-flex;align-items:center;gap:13px;
          min-height:44px;padding:0 18px;background:#0a0a0a;color:#fff;font-size:21px;font-weight:850;letter-spacing:.03em}
        .eyebrow:before{content:"";width:12px;height:12px;background:#f12620}
        .stat{position:absolute;left:54px;top:108px;font:950 205px/.88 Arial,sans-serif;letter-spacing:-.085em}
        .stat-note{position:absolute;left:62px;top:315px;font-size:31px;line-height:1.25;font-weight:900;letter-spacing:-.02em}
        .sample{position:absolute;left:62px;top:385px;font-size:21px;line-height:1.2;font-weight:700;color:#323232}
        .headline{position:absolute;left:0;right:0;top:482px;height:236px;padding:33px 58px 30px;
          background:#090909;color:#fff;border-top:9px solid #f12620;border-bottom:8px solid #eaff00}
        .headline-copy{display:flex;flex-direction:column;font-size:82px;line-height:.98;font-weight:950;
          letter-spacing:-.055em}
        .headline-copy .line-1{margin-top:9px;color:#f12620}
        .chips{position:absolute;left:54px;right:54px;top:1040px;display:flex;gap:12px;align-items:center}
        .chips span{padding:12px 20px;background:rgba(234,255,0,.95);border:3px solid #090909;
          color:#090909;font-size:24px;line-height:1;font-weight:900;box-shadow:5px 5px 0 #090909}
        .chips:after{content:"${escapeHtml(item.chipsTail ?? '原本需要交接，现在一个人跨过去')}";margin-left:auto;padding:12px 17px;
          background:#f12620;color:#fff;font-size:21px;line-height:1;font-weight:850}
        .bottom{position:absolute;left:0;right:0;bottom:0;height:252px;padding:40px 54px 28px;background:#090909;color:#fff}
        .verdict{max-width:790px;font-size:49px;line-height:1.12;font-weight:930;letter-spacing:-.035em}
        .verdict b{color:#eaff00;font-weight:950}
        .source{position:absolute;left:56px;bottom:29px;color:#a6a6a6;font:650 17px/1.3 Menlo,monospace}
        .brand{position:absolute;right:54px;bottom:28px;padding-left:16px;border-left:8px solid #f12620;
          color:#fff;font-size:24px;line-height:1;font-weight:900}
        .red-tear{position:absolute;right:-80px;top:20px;width:210px;height:950px;background:#f12620;
          opacity:.9;clip-path:polygon(32% 0,100% 6%,72% 29%,100% 44%,59% 62%,88% 79%,45% 100%,0 89%,20% 62%,0 42%,29% 18%)}
      </style>
    </head>
    <body>
      <div id="canvas">
        <img class="photo" src="${backgroundData}">
        <div class="paper-noise"></div>
        <div class="red-tear"></div>
        <div class="yellow"></div>
        <div class="eyebrow">${escapeHtml(item.eyebrow)}</div>
        <div class="stat">${escapeHtml(item.stat)}</div>
        <div class="stat-note">${escapeHtml(item.statNote)}</div>
        <div class="sample">${escapeHtml(item.sample)}</div>
        <div class="headline"><div class="headline-copy">${titleHtml(item.title)}</div></div>
        <div class="chips">${chipsHtml(item.chips)}</div>
        <div class="bottom">
          <div class="verdict">${escapeHtml(item.verdictLead)}<b>${escapeHtml(item.verdictHighlight)}</b></div>
          <div class="source">${escapeHtml(item.source)}</div>
          <div class="brand">${escapeHtml(item.brand ?? visualBrand)}</div>
        </div>
      </div>
    </body>
  </html>`;
}

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('用法:node scripts/account-frontpage.mjs <output.png> < config.json');
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) throw new Error('stdin 需要 JSON 配置');
  const item = JSON.parse(raw);
  if (!item.background) throw new Error('background 不能为空');
  const backgroundData = imageData(item.background);
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1440, deviceScaleFactor: 1 });
    await page.setContent(renderHtml(item, backgroundData), { waitUntil: 'networkidle0' });
    const canvas = await page.$('#canvas');
    if (!canvas) throw new Error('渲染画布不存在');
    await canvas.screenshot({ path: path.resolve(output) });
    await page.close();
  } finally {
    await browser.close();
  }
  console.log(`✅ ${path.resolve(output)}`);
}

main().catch(error => {
  console.error(`❌ account-frontpage failed:${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
