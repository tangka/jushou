import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { renderArticle } from '../build-publish-html.js';

function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/iu);
  const channels = [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

const body = [
  '正文和**重点文字**，包含 `inline-code`。',
  '## 二级标题',
  '### 三级标题',
  '- 列表内容',
  '> 引用段落',
  '```text\ncommand --check\n```',
  '| 项目 | 结果 |\n| --- | --- |\n| 主题切换 | 可读 |',
  '[微信文章](https://mp.weixin.qq.com/s/demo)',
  '<a class="weapp_text_link" data-miniprogram-appid="wx1111111111111111">小程序入口</a>',
].join('\n\n');

// 复现用户截图：宿主切换文字和页面底色，保留稿件已经内联的背景。
for (const host of [
  { name: 'light', foreground: '#1a1a1a', background: '#ffffff' },
  { name: 'dark', foreground: '#f7f7f7', background: '#191919' },
]) {
  test(`Grok exported text stays readable on a ${host.name} WeChat surface`, () => {
    const $ = load(renderArticle('标题', body, 'grok-editorial'));
    for (const selector of [
      'h1',
      'h2',
      'h3',
      'p',
      'strong',
      'li',
      'th',
      'td',
      'a',
      'blockquote p',
      'p code',
      '.wechat-code-block .wechat-code-text',
      'a.weapp_text_link',
    ]) {
      const element = $(selector).first();
      assert.equal(element.length, 1, selector);
      let foreground = host.foreground;
      let background = host.background;
      const ancestors = [...element.parents().get().reverse(), ...element.get()];
      for (const ancestor of ancestors) {
        for (const declaration of ($(ancestor).attr('style') ?? '').split(';')) {
          const separator = declaration.indexOf(':');
          const property = declaration.slice(0, separator).trim();
          const value = declaration.slice(separator + 1).trim();
          if (property === 'color' && value !== 'inherit') foreground = value;
          if ((property === 'background' || property === 'background-color') && value !== 'transparent') {
            background = value;
          }
        }
      }
      const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      const contrast = ((values[1] ?? 0) + 0.05) / ((values[0] ?? 0) + 0.05);
      assert.ok(contrast >= 4.5, `${selector}: ${foreground} on ${background} has contrast ${contrast.toFixed(2)}`);
    }
  });
}
