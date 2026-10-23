import assert from 'node:assert/strict';
import test from 'node:test';
import { renderArticle } from '../build-publish-html.js';
import { validateGrokArticleReadability } from './article-readability.js';

test('rejects the original pale background with inherited foreground', () => {
  assert.throws(
    () => validateGrokArticleReadability('<article style="background:#fbfdff;color:inherit"><p>正文</p></article>'),
    /Grok深色阅读校验失败.*对比度/u
  );
});

test('rendering rejects unreadable backgrounds added in raw Markdown HTML', () => {
  for (const body of [
    '<p style="background-color:#fbfdff">新增段落</p>',
    '<section style="background:#fbfdff"><div><span>嵌套正文</span></div></section>',
    '<div style="color:#fff;background:#fff">白底白字</div>',
    '<p style="background-image:linear-gradient(white, #edf5ff)">渐变正文</p>',
  ]) {
    assert.throws(() => renderArticle('测试标题', body, 'grok-editorial'), /Grok.*阅读校验失败/u);
  }
});

test('checks every paragraph instead of only the first occurrence', () => {
  assert.throws(
    () => renderArticle('测试标题', '正常正文\n\n<p style="background:#fff">后面的浅色底块</p>', 'grok-editorial'),
    /Grok深色阅读校验失败（后面的浅色底块）/u
  );
});

test('allows transparent theme text and paired high contrast blocks with images', () => {
  assert.doesNotThrow(() =>
    renderArticle(
      '测试标题',
      '正文里的 `code`。\n\n> 引用\n\n```text\ncommand\n```\n\n![图片](media/photo.png)\n\n<div style="color:rgb(255, 255, 255);background:#111">深底浅字</div>',
      'grok-editorial'
    )
  );
});

test('does not silently pass colors the guard cannot verify', () => {
  assert.throws(
    () => renderArticle('测试标题', '<div style="color:var(--text)">正文</div>', 'grok-editorial'),
    /无法校验颜色/u
  );
});
