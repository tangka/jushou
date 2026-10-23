import { load } from 'cheerio';
import type { ArticleStyleName } from './article-style.js';

const READING_THEMES = [
  { name: '浅色', foreground: '#1a1a1a', background: '#ffffff' },
  { name: '深色', foreground: '#f7f7f7', background: '#191919' },
];
const MIN_TEXT_CONTRAST = 4.5;
const TRANSPARENT_BACKGROUNDS = new Set(['transparent', 'none', 'initial', 'unset', 'inherit', 'rgba(0,0,0,0)']);

export function validateArticleReadability(articleHtml: string, style: ArticleStyleName): string {
  if (style === 'grok-editorial') validateGrokArticleReadability(articleHtml);
  return articleHtml;
}

function luminance(color: string): number {
  const named = { black: '#000000', white: '#ffffff' };
  let hex = color === 'black' || color === 'white' ? named[color] : color;
  if (/^#[0-9a-f]{3}$/u.test(hex)) hex = `#${[...hex.slice(1)].map(value => value + value).join('')}`;
  let channels: number[];
  if (/^#[0-9a-f]{6}$/u.test(hex)) {
    channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
  } else {
    const rgb = color.match(/^rgb\((\d+),(\d+),(\d+)\)$/u);
    if (!rgb) throw new Error(`无法校验颜色 ${color}，请使用明确的十六进制或RGB颜色`);
    channels = rgb.slice(1).map(Number);
    if (channels.some(value => value > 255)) throw new Error(`无效颜色 ${color}`);
  }
  const linear = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
}

/** 检查最终内联HTML；不猜测微信会不会替换稿件的固定背景。 */
export function validateGrokArticleReadability(articleHtml: string): void {
  const $ = load(articleHtml, {}, false);
  if ($('article').length !== 1) throw new Error('Grok明暗阅读校验失败：缺少唯一正文容器');
  $('article, article *').each((_index, element) => {
    const text = $(element)
      .contents()
      .filter((_childIndex, child) => child.type === 'text')
      .text()
      .trim();
    if (!text) return;
    const ancestors = [...$(element).parents().get().reverse(), element];
    for (const theme of READING_THEMES) {
      let foreground = theme.foreground;
      let background = theme.background;
      try {
        for (const ancestor of ancestors) {
          for (const [property, rawValue] of Object.entries($(ancestor).css() ?? {})) {
            const value = rawValue.toLowerCase().replace(/\s|!important/gu, '');
            if (property === 'color' && !['inherit', 'unset', 'currentcolor'].includes(value)) foreground = value;
            if ((property === 'background' || property === 'background-color') && !TRANSPARENT_BACKGROUNDS.has(value)) {
              background = value;
            }
            if (property === 'background-image' && value !== 'none') {
              throw new Error('文字背景不能叠加图片或渐变，请保持透明背景');
            }
          }
        }
        const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
        const contrast = ((values[1] ?? 0) + 0.05) / ((values[0] ?? 0) + 0.05);
        if (contrast < MIN_TEXT_CONTRAST) {
          throw new Error(`文字对比度 ${contrast.toFixed(2)}:1 低于 ${MIN_TEXT_CONTRAST}:1，请调整文字和底色`);
        }
      } catch (error) {
        throw new Error(
          `Grok${theme.name}阅读校验失败（${text.slice(0, 30)}）：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  });
}
