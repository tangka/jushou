#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rendererRuntime, requiredText, visualConfig } from './operator-config.mjs';

const visual = visualConfig();
const { puppeteer, chrome: chromePath } = rendererRuntime('x');
const visualBrand = requiredText(visual.brand, 'branding.visual.brand');
const avatarPath = requiredText(process.env.ACCOUNT_AVATAR || visual.avatarPath, 'branding.visual.avatarPath');

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function titleHtml(title) {
  const lines = Array.isArray(title) ? title : [title];
  return lines.map(line => `<span>${escapeHtml(line)}</span>`).join('');
}

function lineItems(lines = []) {
  return lines
    .map((line, index) => {
      const value = typeof line === 'string' ? line : line.text;
      const label = typeof line === 'string' ? String(index + 1).padStart(2, '0') : line.label;
      return `<div class="line"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`;
    })
    .join('');
}

function tagItems(tags = []) {
  return tags
    .map((tag, index) => {
      const tone = index % 2 === 0 ? 'blue' : 'orange';
      return `<div class="tag ${tone}"><i></i><span>${escapeHtml(tag)}</span></div>`;
    })
    .join('');
}

function commonCss(width, height) {
  return `
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{width:${width}px;height:${height}px;overflow:hidden}
    body{font-family:"PingFang SC","Helvetica Neue","Microsoft YaHei",Arial,sans-serif}
    #canvas{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#08111f;color:#f7f8fb}
    .grid{position:absolute;inset:0;opacity:.23;background-image:
      linear-gradient(rgba(100,147,255,.22) 1px,transparent 1px),
      linear-gradient(90deg,rgba(100,147,255,.18) 1px,transparent 1px);
      background-size:42px 42px}
    .glow-blue{position:absolute;width:520px;height:520px;border-radius:50%;left:-210px;top:-190px;
      background:radial-gradient(circle,rgba(15,103,255,.55),rgba(15,103,255,0) 69%)}
    .glow-orange{position:absolute;width:520px;height:520px;border-radius:50%;right:-190px;bottom:-240px;
      background:radial-gradient(circle,rgba(255,104,24,.46),rgba(255,104,24,0) 70%)}
    .brand-row{position:absolute;display:flex;align-items:center;gap:14px;z-index:4}
    .avatar-token{width:54px;height:54px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.86);
      box-shadow:0 0 0 4px rgba(65,119,255,.28),0 8px 28px rgba(0,0,0,.32)}
    .brand-main{font-size:22px;line-height:1;font-weight:760;letter-spacing:.03em}
    .brand-sub{margin-top:7px;color:#8da0bf;font:600 12px/1 "SFMono-Regular",Menlo,monospace;letter-spacing:.14em}
    .signal-bar{position:absolute;z-index:5;height:4px;left:0;right:0;top:0;
      background:linear-gradient(90deg,#0877ff 0%,#58a8ff 42%,#f1e9dc 50%,#ff9b4a 62%,#ff5b0a 100%)}
  `;
}

function coverHtml(item, avatarData, backgroundData = '') {
  const width = 1080;
  const height = 460;
  const brand = item.brand ?? visualBrand;
  const kicker = item.kicker ?? 'AI越强';
  const title = titleHtml(item.title);

  if (item.layout === 'editorial') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${commonCss(width, height)}
      #canvas{background:#060b12;color:#fff}
      .background{position:absolute;inset:0;width:1080px;height:460px;object-fit:cover}
      .shade{position:absolute;inset:0;background:
        linear-gradient(90deg,rgba(3,8,15,.78) 0%,rgba(3,8,15,.42) 38%,rgba(3,8,15,0) 70%),
        linear-gradient(180deg,rgba(3,8,15,.46) 0%,rgba(3,8,15,0) 48%)}
      .copy{position:absolute;left:70px;top:65px;z-index:3;width:470px;text-shadow:0 5px 25px rgba(0,0,0,.72)}
      .kicker{color:#8bb9ff;font-size:29px;line-height:1;font-weight:820}
      .title{margin-top:17px;display:flex;flex-direction:column;color:#fff;font-size:65px;line-height:1.02;
        font-weight:930;letter-spacing:-.045em}
      .title span:last-child{margin-top:5px;color:#ff8a36;font-size:77px}
      .signature{position:absolute;right:43px;bottom:30px;z-index:4;display:flex;align-items:center;gap:13px;
        text-shadow:0 3px 14px rgba(0,0,0,.86)}
      .signature img{width:58px;height:58px;border:2px solid rgba(255,255,255,.92);border-radius:50%;object-fit:cover}
      .signature span{color:#fff;font-size:23px;font-weight:820}
    </style></head><body><div id="canvas">
      <img class="background" src="${backgroundData}"><div class="shade"></div>
      <div class="copy"><div class="kicker">${escapeHtml(kicker)}</div><div class="title">${title}</div></div>
      <div class="signature"><img src="${avatarData}"><span>${escapeHtml(brand)}</span></div>
    </div></body></html>`;
  }

  if (item.layout === 'minimal') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${commonCss(width, height)}
      #canvas{background:#101114;color:#fff}
      .title{position:absolute;left:96px;top:82px;z-index:2;display:flex;flex-direction:column;
        font-size:88px;line-height:1.02;font-weight:930;letter-spacing:-.055em}
      .title span:last-child{margin-top:8px;color:#ff7625;font-size:96px}
      .signature{position:absolute;right:48px;bottom:34px;z-index:2;display:flex;align-items:center;gap:15px}
      .signature img{width:62px;height:62px;border:2px solid rgba(255,255,255,.9);border-radius:50%;object-fit:cover}
      .signature span{color:#fff;font-size:24px;font-weight:800}
    </style></head><body><div id="canvas">
      <div class="title">${title}</div>
      <div class="signature"><img src="${avatarData}"><span>${escapeHtml(brand)}</span></div>
    </div></body></html>`;
  }

  if (item.layout === 'signature') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${commonCss(width, height)}
      #canvas{background:#f5f0e7;color:#0b1320}
      .blue{position:absolute;z-index:1;left:0;top:0;width:260px;height:460px;background:#116df5}
      .orange-edge{position:absolute;z-index:2;left:260px;top:0;width:15px;height:460px;background:#ff6a19}
      .ai{position:absolute;z-index:3;left:60px;top:86px;color:#fff;font-size:126px;line-height:.9;
        font-weight:950;letter-spacing:-.08em}
      .strong{position:absolute;z-index:3;left:70px;top:220px;color:rgba(255,255,255,.9);font-size:39px;
        line-height:1;font-weight:850;letter-spacing:.13em}
      .copy{position:absolute;z-index:4;left:322px;top:89px;width:520px}
      .kicker{color:#116df5;font-size:31px;line-height:1;font-weight:850}
      .title{margin-top:17px;display:flex;flex-direction:column;color:#0b1320;font-size:80px;line-height:1;
        font-weight:930;letter-spacing:-.055em}
      .title span:last-child{margin-top:4px;color:#f25712}
      .rule{position:absolute;z-index:4;left:322px;top:328px;width:430px;height:7px;background:#0b1320}
      .question{position:absolute;z-index:2;right:64px;top:18px;color:#116df5;font-size:265px;line-height:1;
        font-weight:950;opacity:.065}
      .signature{position:absolute;z-index:5;right:45px;bottom:31px;display:flex;align-items:center;gap:15px}
      .signature img{width:68px;height:68px;border:4px solid #f5f0e7;border-radius:50%;object-fit:cover;
        box-shadow:0 0 0 3px #116df5,0 0 0 6px #ff6a19}
      .signature span{color:#0b1320;font-size:25px;font-weight:880;letter-spacing:.02em}
      .footline{position:absolute;z-index:4;left:322px;right:45px;bottom:22px;height:3px;
        background:linear-gradient(90deg,#116df5 0 45%,#ff6a19 45% 100%)}
    </style></head><body><div id="canvas">
      <div class="blue"></div><div class="orange-edge"></div>
      <div class="ai">AI</div><div class="strong">越强</div>
      <div class="copy"><div class="kicker">${escapeHtml(kicker)}</div><div class="title">${title}</div></div>
      <div class="rule"></div><div class="question">?</div><div class="footline"></div>
      <div class="signature"><img src="${avatarData}"><span>${escapeHtml(brand)}</span></div>
    </div></body></html>`;
  }

  if (item.layout === 'cinema') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${commonCss(width, height)}
      #canvas{background:#07101d}
      .bg{position:absolute;z-index:1;left:-45px;top:-45px;width:1170px;height:550px;object-fit:cover;
        filter:blur(30px) brightness(.54) saturate(.82);transform:scale(1.05)}
      .portrait{position:absolute;z-index:2;left:310px;top:0;width:460px;height:460px;object-fit:cover}
      .edge-left{position:absolute;z-index:3;left:280px;top:0;width:90px;height:460px;
        background:linear-gradient(90deg,rgba(7,16,29,.62),rgba(7,16,29,0))}
      .edge-right{position:absolute;z-index:3;left:710px;top:0;width:90px;height:460px;
        background:linear-gradient(90deg,rgba(7,16,29,0),rgba(7,16,29,.55))}
      .bottom{position:absolute;z-index:3;left:292px;top:212px;width:496px;height:248px;
        background:linear-gradient(180deg,rgba(2,8,18,0),rgba(2,8,18,.9) 82%)}
      .copy{position:absolute;z-index:4;left:336px;bottom:47px;width:408px;text-shadow:0 5px 24px rgba(0,0,0,.72)}
      .kicker{color:#fff;font-size:38px;line-height:1;font-weight:850;letter-spacing:.01em}
      .title{margin-top:11px;display:flex;flex-direction:column;color:#ff9a49;font-size:61px;line-height:1;
        font-weight:930;letter-spacing:-.045em}
      .line{position:absolute;z-index:4;left:336px;bottom:25px;width:408px;height:5px;
        background:linear-gradient(90deg,#1677ff 0 45%,#f4eee3 45% 53%,#ff6a19 53% 100%)}
    </style></head><body><div id="canvas">
      <img class="bg" src="${avatarData}"><img class="portrait" src="${avatarData}">
      <div class="edge-left"></div><div class="edge-right"></div><div class="bottom"></div>
      <div class="copy"><div class="kicker">${escapeHtml(kicker)}</div><div class="title">${title}</div></div>
      <div class="line"></div>
    </div></body></html>`;
  }

  if (item.layout === 'fullbleed') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${commonCss(width, height)}
      #canvas{background:#07101d}
      .portrait{position:absolute;z-index:1;left:450px;top:0;width:630px;height:460px;object-fit:cover;object-position:50% 47%}
      .shade{position:absolute;z-index:2;inset:0;background:
        linear-gradient(90deg,#07101d 0%,#07101d 30%,rgba(7,16,29,.93) 46%,rgba(7,16,29,.15) 73%,rgba(7,16,29,0) 100%)}
      .brand{position:absolute;z-index:4;left:58px;top:42px;color:#f7f1e7;font-size:24px;font-weight:800}
      .brand:before{content:"";display:inline-block;width:28px;height:8px;margin-right:12px;background:#1677ff;border-radius:99px}
      .copy{position:absolute;z-index:4;left:310px;top:108px;width:350px}
      .kicker{color:#75a8ff;font-size:26px;line-height:1;font-weight:780;letter-spacing:.02em}
      .title{margin-top:17px;display:flex;flex-direction:column;color:#fff;font-size:76px;line-height:.98;
        font-weight:900;letter-spacing:-.055em;text-shadow:0 7px 30px rgba(0,0,0,.42)}
      .title span:last-child{color:#ff9a49}
      .rule{position:absolute;z-index:4;left:58px;bottom:40px;width:210px;height:5px;background:linear-gradient(90deg,#1677ff,#ff6a1a)}
      .tagline{position:absolute;z-index:4;left:58px;bottom:58px;color:#9aabc3;font-size:18px;font-weight:600}
    </style></head><body><div id="canvas">
      <div class="signal-bar"></div><img class="portrait" src="${avatarData}"><div class="shade"></div>
      <div class="brand">${escapeHtml(brand)}</div>
      <div class="copy"><div class="kicker">${escapeHtml(kicker)}</div><div class="title">${title}</div></div>
      <div class="tagline">观察 AI，也观察人</div><div class="rule"></div>
    </div></body></html>`;
  }

  if (item.layout === 'split') {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      ${commonCss(width, height)}
      #canvas{background:#f5efe4;color:#0c1320}
      .blue{position:absolute;inset:0 auto 0 0;width:285px;background:#116df5}
      .orange{position:absolute;inset:0 0 0 auto;width:250px;background:#ff6a19}
      .brand{position:absolute;z-index:4;left:54px;top:40px;color:#fff;font-size:25px;font-weight:850}
      .brand-sub{position:absolute;z-index:4;left:54px;bottom:42px;width:170px;color:rgba(255,255,255,.82);
        font-size:17px;line-height:1.45;font-weight:650}
      .copy{position:absolute;z-index:4;left:310px;top:108px;width:320px}
      .kicker{color:#116df5;font-size:27px;line-height:1;font-weight:850}
      .title{margin-top:17px;display:flex;flex-direction:column;font-size:69px;line-height:1;
        font-weight:920;letter-spacing:-.055em}
      .title span:last-child{color:#f25712}
      .ring{position:absolute;z-index:2;left:565px;top:50px;width:360px;height:360px;border-radius:50%;
        background:conic-gradient(#116df5 0 46%,#f5efe4 46% 51%,#ff6a19 51% 100%);
        box-shadow:0 24px 60px rgba(44,43,41,.18)}
      .portrait{position:absolute;z-index:3;left:579px;top:64px;width:332px;height:332px;border:9px solid #f5efe4;
        border-radius:50%;object-fit:cover;object-position:50% 48%}
      .dot{position:absolute;z-index:3;right:52px;top:48px;width:22px;height:22px;border-radius:50%;background:#0c1320}
    </style></head><body><div id="canvas">
      <div class="blue"></div><div class="orange"></div><div class="dot"></div>
      <div class="brand">${escapeHtml(brand)}</div><div class="brand-sub">从 AI 噪声里<br>看见价值迁移</div>
      <div class="copy"><div class="kicker">${escapeHtml(kicker)}</div><div class="title">${title}</div></div>
      <div class="ring"></div><img class="portrait" src="${avatarData}">
    </div></body></html>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${commonCss(width, height)}
    #canvas{background:#f5efe4;color:#0c1320}
    .paper{position:absolute;inset:0;opacity:.28;background-image:
      radial-gradient(circle at 20% 20%,rgba(20,80,180,.16) 0 1px,transparent 1.5px);
      background-size:18px 18px}
    .blue-bar{position:absolute;left:0;top:0;bottom:0;width:82px;background:#116df5}
    .orange-bar{position:absolute;left:82px;top:0;bottom:0;width:10px;background:#ff6a19}
    .brand{position:absolute;z-index:4;left:126px;top:42px;color:#116df5;font-size:26px;font-weight:880;letter-spacing:.02em}
    .tagline{position:absolute;z-index:4;left:126px;bottom:44px;color:#6c675f;font-size:18px;font-weight:650}
    .copy{position:absolute;z-index:5;left:310px;top:112px;width:330px}
    .kicker{color:#116df5;font-size:27px;line-height:1;font-weight:850}
    .title{margin-top:17px;display:flex;flex-direction:column;color:#0c1320;font-size:68px;line-height:.98;
      font-weight:920;letter-spacing:-.055em}
    .title span:last-child{color:#f25712}
    .ring{position:absolute;z-index:2;left:520px;top:45px;width:370px;height:370px;border-radius:50%;
      background:conic-gradient(#116df5 0 47%,#f5efe4 47% 52%,#ff6a19 52% 100%);
      box-shadow:0 24px 70px rgba(42,45,52,.22)}
    .portrait{position:absolute;z-index:3;left:535px;top:60px;width:340px;height:340px;border:10px solid #f5efe4;
      border-radius:50%;object-fit:cover;object-position:50% 48%}
    .mark{position:absolute;right:48px;top:42px;color:#116df5;font-size:102px;line-height:1;font-weight:950;opacity:.16}
    .line{position:absolute;right:48px;bottom:46px;width:155px;height:8px;background:#ff6a19}
  </style></head><body><div id="canvas">
    <div class="paper"></div><div class="blue-bar"></div><div class="orange-bar"></div>
    <div class="brand">${escapeHtml(brand)}</div><div class="tagline">观察 AI，也观察人</div>
    <div class="copy"><div class="kicker">${escapeHtml(kicker)}</div><div class="title">${title}</div></div>
    <div class="ring"></div><img class="portrait" src="${avatarData}">
    <div class="mark">?</div><div class="line"></div>
  </div></body></html>`;
}

function cardHtml(item, avatarData) {
  const width = 1080;
  const height = 760;
  const kicker = item.kicker ?? 'VALUE SIGNAL';
  const number = item.number ?? '01';
  const lines = lineItems(item.lines);
  const tags = tagItems(item.tags);
  const quote = item.quote ? `<div class="quote">${escapeHtml(item.quote)}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${commonCss(width, height)}
    .brand-row{left:58px;top:42px}
    .number{position:absolute;z-index:3;right:58px;top:38px;color:rgba(255,255,255,.12);
      font:800 90px/1 "SFMono-Regular",Menlo,monospace;letter-spacing:-.08em}
    .content{position:absolute;z-index:3;left:58px;right:58px;top:142px}
    .kicker{color:#75a8ff;font:700 15px/1 "SFMono-Regular",Menlo,monospace;letter-spacing:.17em}
    .title{margin-top:18px;font-size:54px;line-height:1.14;font-weight:800;letter-spacing:-.025em}
    .sub{margin-top:16px;color:#9eacc3;font-size:21px;line-height:1.55}
    .lines{display:grid;gap:12px;margin-top:30px}
    .line{display:grid;grid-template-columns:64px 1fr;align-items:center;min-height:64px;padding:12px 20px;
      border:1px solid rgba(116,146,195,.24);border-radius:14px;background:rgba(13,27,48,.78)}
    .line b{color:#ff9b51;font:700 14px/1 "SFMono-Regular",Menlo,monospace;letter-spacing:.08em}
    .line span{font-size:22px;line-height:1.42;font-weight:580}
    .tags{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:30px}
    .tag{display:flex;align-items:center;gap:14px;min-height:78px;padding:16px 20px;border:1px solid rgba(116,146,195,.24);
      border-radius:15px;background:rgba(13,27,48,.82);font-size:24px;font-weight:680}
    .tag i{width:12px;height:12px;border-radius:50%;background:#4c91ff;box-shadow:0 0 20px rgba(76,145,255,.8)}
    .tag.orange i{background:#ff8b35;box-shadow:0 0 20px rgba(255,139,53,.8)}
    .quote{margin-top:26px;padding:18px 22px;border-left:4px solid #ff8b35;background:rgba(255,139,53,.08);
      color:#f8e8d8;font-size:23px;line-height:1.48;font-weight:650}
    .footer{position:absolute;z-index:3;left:58px;right:58px;bottom:30px;display:flex;justify-content:space-between;
      color:#60738f;font:600 12px/1 "SFMono-Regular",Menlo,monospace;letter-spacing:.12em}
    .corner{position:absolute;right:0;bottom:0;width:250px;height:250px;border:1px solid rgba(255,139,53,.16);
      transform:translate(75px,75px) rotate(45deg)}
  </style></head><body><div id="canvas">
    <div class="signal-bar"></div><div class="grid"></div><div class="glow-blue"></div><div class="glow-orange"></div>
    <div class="corner"></div>
    <div class="brand-row">
      <img class="avatar-token" src="${avatarData}">
      <div><div class="brand-main">${escapeHtml(item.brand ?? visualBrand)}</div><div class="brand-sub">SIGNAL NOTES</div></div>
    </div>
    <div class="number">${escapeHtml(number)}</div>
    <div class="content">
      <div class="kicker">${escapeHtml(kicker)}</div>
      <div class="title">${titleHtml(item.title)}</div>
      ${item.sub ? `<div class="sub">${escapeHtml(item.sub)}</div>` : ''}
      ${lines ? `<div class="lines">${lines}</div>` : ''}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${quote}
    </div>
    <div class="footer"><span>BLUE = SYSTEM</span><span>ORANGE = HUMAN</span></div>
  </div></body></html>`;
}

function newspicHtml(item, avatarData, benchmarkData, signatoriesData) {
  const width = 1080;
  const height = 1440;
  const title = titleHtml(item.title);
  const kicker = item.kicker ?? 'KIMI K3 · OPEN WEIGHTS';
  const fact = item.fact ?? '2.8T 参数 · 100 万上下文 · 7 月 27 日开放权重';
  const quote = item.quote ?? '只靠闭源，并不天然更安全';
  const signers = item.signers ?? 'OpenAI · Microsoft · Meta · NVIDIA · Hugging Face';
  const note = item.note ?? '开放权重 ≠ 训练数据与代码全部开源';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${commonCss(width, height)}
    #canvas{background:
      radial-gradient(circle at 86% 8%,rgba(255,91,10,.2),transparent 26%),
      radial-gradient(circle at 8% 24%,rgba(11,118,255,.28),transparent 30%),
      #08111f}
    .copy{position:absolute;z-index:5;left:64px;right:64px;top:62px}
    .kicker{color:#77acff;font:760 20px/1 "SFMono-Regular",Menlo,monospace;letter-spacing:.13em}
    .title{display:flex;flex-direction:column;margin-top:24px;color:#f7f1e7;font-size:91px;line-height:.98;
      font-weight:930;letter-spacing:-.055em}
    .title span:last-child{margin-top:8px;color:#ff8a36}
    .fact{margin-top:24px;color:#b7c5db;font-size:25px;line-height:1.45;font-weight:650}
    .benchmark{position:absolute;z-index:4;left:64px;right:64px;top:392px;height:462px;overflow:hidden;
      border:1px solid rgba(139,181,255,.45);border-radius:22px;background:#f8f8f8;
      box-shadow:0 24px 70px rgba(0,0,0,.34)}
    .benchmark img{width:100%;height:100%;object-fit:cover;object-position:50% 50%}
    .benchmark-label{position:absolute;z-index:6;left:20px;top:18px;padding:9px 16px;border-radius:999px;
      background:rgba(8,17,31,.9);color:#fff;font:720 17px/1 "SFMono-Regular",Menlo,monospace}
    .quote{position:absolute;z-index:5;left:64px;right:64px;top:890px;color:#f7f1e7;font-size:39px;
      line-height:1.28;font-weight:830;letter-spacing:-.02em}
    .quote b{color:#ff8a36;font-weight:900}
    .letter{position:absolute;z-index:4;left:64px;right:64px;top:1008px;height:244px;overflow:hidden;
      border:1px solid rgba(255,255,255,.35);border-radius:22px;background:#fff}
    .letter img{width:100%;height:100%;object-fit:cover;object-position:50% 82%}
    .letter-label{position:absolute;z-index:6;left:18px;top:16px;padding:8px 14px;border-radius:8px;
      background:#08111f;color:#fff;font-size:18px;line-height:1;font-weight:760}
    .signers{position:absolute;z-index:5;left:64px;right:64px;top:1274px;color:#8da0bf;
      font:650 17px/1.35 "SFMono-Regular",Menlo,monospace;letter-spacing:.01em}
    .note{position:absolute;z-index:5;left:64px;bottom:43px;color:#7185a3;font-size:17px;font-weight:650}
    .signature{position:absolute;z-index:6;right:64px;bottom:30px;display:flex;align-items:center;gap:13px}
    .signature img{width:64px;height:64px;border:2px solid rgba(255,255,255,.92);border-radius:50%;object-fit:cover;
      box-shadow:0 0 0 4px rgba(11,118,255,.38)}
    .signature span{color:#f7f1e7;font-size:23px;font-weight:820}
  </style></head><body><div id="canvas">
    <div class="signal-bar"></div><div class="grid"></div>
    <div class="copy"><div class="kicker">${escapeHtml(kicker)}</div><div class="title">${title}</div>
      <div class="fact">${escapeHtml(fact)}</div></div>
    <div class="benchmark"><div class="benchmark-label">KIMI 官方数据</div><img src="${benchmarkData}"></div>
    <div class="quote">“${escapeHtml(quote).replace('闭源', '<b>闭源</b>')}”</div>
    <div class="letter"><div class="letter-label">7 月 24 日 · 开放权重联名信</div><img src="${signatoriesData}"></div>
    <div class="signers">${escapeHtml(signers)}</div>
    <div class="note">${escapeHtml(note)}</div>
    <div class="signature"><img src="${avatarData}"><span>${escapeHtml(item.brand ?? visualBrand)}</span></div>
  </div></body></html>`;
}

function localImageData(rawPath) {
  if (!rawPath) return '';
  const imagePath = path.isAbsolute(rawPath) ? rawPath : path.join(projectRoot, rawPath);
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png';
  return `data:image/${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;
}

async function main() {
  const outDir = process.argv[2] ?? path.join(os.tmpdir(), 'account-visual');
  fs.mkdirSync(outDir, { recursive: true });
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) throw new Error('stdin 需要 JSON 对象或数组');
  const parsed = JSON.parse(raw);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const avatarData = `data:image/jpeg;base64,${fs.readFileSync(avatarPath).toString('base64')}`;
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox'],
  });
  const counts = { cover: 0, card: 0, newspic: 0 };
  try {
    for (const item of items) {
      const type = item.type === 'card' ? 'card' : item.type === 'newspic' ? 'newspic' : 'cover';
      counts[type] += 1;
      const width = 1080;
      const height = type === 'cover' ? 460 : type === 'newspic' ? 1440 : 760;
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const backgroundData = localImageData(item.background);
      if (type === 'cover' && item.layout === 'editorial' && !backgroundData) {
        throw new Error('editorial 封面必须提供 background');
      }
      const benchmarkData = localImageData(item.benchmarkImage);
      const signatoriesData = localImageData(item.signatoriesImage);
      if (type === 'newspic' && (!benchmarkData || !signatoriesData)) {
        throw new Error('newspic 贴图必须提供 benchmarkImage 和 signatoriesImage');
      }
      const html =
        type === 'cover'
          ? coverHtml(item, avatarData, backgroundData)
          : type === 'newspic'
            ? newspicHtml(item, avatarData, benchmarkData, signatoriesData)
            : cardHtml(item, avatarData);
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const output = path.join(outDir, `account-${type}-${String(counts[type]).padStart(2, '0')}.png`);
      const canvas = await page.$('#canvas');
      if (!canvas) throw new Error('渲染画布不存在');
      await canvas.screenshot({ path: output });
      await page.close();
      console.log(`✅ ${path.basename(output)}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`输出:${outDir}`);
}

main().catch(error => {
  console.error(`❌ account-visual failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
