import { load } from 'cheerio';

/** 微信客户端可能重置 pre 的空白规则；用普通容器和显式换行保留代码/提示词。 */
export function wrapArticleCodeBlocks(articleHtml: string): string {
  const $ = load(articleHtml, {}, false);
  $('pre').each((_index, element) => {
    const pre = $(element);
    const code = pre.children('code').first();
    const source = code.length ? code : pre;
    const text = source.text().replace(/\r\n?/gu, '\n').replace(/\n$/u, '');
    const block = $('<section class="wechat-code-block"></section>')
      .attr('style', pre.attr('style') ?? '')
      .css({
        'box-sizing': 'border-box',
        'max-width': '100%',
        'min-width': '0',
        overflow: 'visible',
        'overflow-x': 'visible',
        'white-space': 'normal',
        'text-align': 'left',
      });
    const content = $('<span class="wechat-code-text"></span>')
      .addClass(code.attr('class') ?? '')
      .attr('style', code.attr('style') ?? '')
      .css({
        display: 'block',
        'white-space': 'pre-wrap',
        'overflow-wrap': 'anywhere',
        'word-wrap': 'break-word',
        'word-break': 'break-all',
        'text-align': 'left',
        'letter-spacing': 'normal',
      });
    for (const [index, line] of text.split('\n').entries()) {
      if (index > 0) content.append('<br>');
      // 通过 text() 编码，示例中的 HTML 不得变成可执行标签。
      content.append($('<span></span>').text(line).html() ?? '');
    }
    block.append(content);
    pre.replaceWith(block);
  });
  return $.html();
}
