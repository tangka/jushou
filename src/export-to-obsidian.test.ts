import assert from 'node:assert/strict';
import test from 'node:test';
import {
  articleIdentityKey,
  latestArticleGate,
  MAX_EXPORT_ARTICLES,
  resolveArticleBase,
} from './export-to-obsidian.js';

test('articleIdentityKey ignores changing WeChat URLs when appmsgid is stable', () => {
  const stable = { appmsgid: '2247484976', itemidx: 1 };
  assert.equal(
    articleIdentityKey({ ...stable, link: 'https://mp.weixin.qq.com/s/stable' }),
    articleIdentityKey({ ...stable, link: 'https://mp.weixin.qq.com/s?tempkey=changed' })
  );
});

test('articleIdentityKey falls back to link when article id is unavailable', () => {
  assert.equal(
    articleIdentityKey({ link: 'https://mp.weixin.qq.com/s/example' }),
    'link:https://mp.weixin.qq.com/s/example'
  );
});

test('resolveArticleBase adds a stable suffix for same-day same-title collisions', () => {
  const owners = new Map([['2026-06-19-同名文章', 'id:100:1']]);
  assert.equal(
    resolveArticleBase(
      '2026-06-19-同名文章',
      { appmsgid: '101', itemidx: 1, link: 'https://mp.weixin.qq.com/s/other' },
      owners
    ),
    '2026-06-19-同名文章-101_1'
  );
  assert.equal(
    resolveArticleBase(
      '2026-06-19-同名文章',
      { appmsgid: '100', itemidx: 1, link: 'https://mp.weixin.qq.com/s/same' },
      owners
    ),
    '2026-06-19-同名文章'
  );
});

test('latestArticleGate keeps only the newest 100 articles by default', () => {
  const articles = Array.from({ length: 105 }, (_, index) => ({ id: index + 1 }));
  const limited = latestArticleGate(articles);
  assert.equal(limited.length, MAX_EXPORT_ARTICLES);
  assert.deepEqual(
    limited.map(article => article.id),
    articles.slice(0, MAX_EXPORT_ARTICLES).map(article => article.id)
  );
});

test('latestArticleGate also supports a narrower caller gate', () => {
  assert.deepEqual(latestArticleGate([1, 2, 3, 4], 2), [1, 2]);
});
