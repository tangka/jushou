import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { renderArticle } from '../build-publish-html.js';
import { wrapArticleCodeBlocks } from './article-code-layout.js';

test('prompt line breaks survive collapsing HTML whitespace without pre styling', () => {
  const prompt = '检查当前连接的REA服务。\n列出这轮对话实际可调用的REA工具，\n\n先不要安装新软件。';
  const html = renderArticle('换行回归', `\`\`\`text\n${prompt}\n\`\`\``);
  const $ = load(html.replace(/\s+/gu, ' '));
  const block = $('.wechat-code-block');
  assert.equal($('pre').length, 0);
  assert.equal(block.find('br').length, 3);
  block.find('br').replaceWith('\n');
  assert.equal(block.text(), prompt);
});

test('code stays escaped and retains indentation, blank lines and literal characters', () => {
  const code = 'const tag = "<script>alert(1)</script>";\n\tif (a < b && b > 0) {\n    run();\n\n}\n';
  const $ = load(renderArticle('代码保真', `\`\`\`js\n${code}\`\`\``));
  assert.equal($('.wechat-code-block script').length, 0);
  $('.wechat-code-block br').replaceWith('\n');
  assert.equal($('.wechat-code-block').text(), code.slice(0, -1));
});

test('empty, indented and raw code blocks normalize without changing ordinary text', () => {
  const $ = load(renderArticle('多种代码', '普通正文。\n\n```\n```\n\n    a\n    b\n\n<pre><code>x\r\ny</code></pre>'));
  assert.equal($('.wechat-code-block').length, 3);
  assert.equal($('p').first().text(), '普通正文。');
  assert.equal($('.wechat-code-block').eq(1).find('br').length, 1);
  assert.equal($('.wechat-code-block').eq(2).find('br').length, 1);
});

test('normalizing twice keeps all code and line breaks unchanged', () => {
  const html = renderArticle('幂等', '```text\na\nb\n```');
  assert.equal(wrapArticleCodeBlocks(html), html);
});
