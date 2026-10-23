import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRows, type DetailEntry, dedupeRows, formatArticleCommentsMd, planArticleJsonWrites } from './report.js';
import { makeEmptyStats } from './wechat/stats.js';

const PUBLISHED_AT = 1_780_404_900;

function makeEntry(appmsgid: string, itemidx: number, title: string, readUv: number): DetailEntry {
  return {
    dirBase: `2026-06-03-${title}`,
    listItem: {
      appmsgid,
      itemidx,
      link: `https://mp.weixin.qq.com/s/${appmsgid}`,
      title,
      create_time: PUBLISHED_AT,
      item_show_type: 0,
    },
    detail: {
      mid: appmsgid,
      idx: itemidx,
      link: `https://mp.weixin.qq.com/s/${appmsgid}`,
      title,
      ori_create_time: PUBLISHED_AT,
      content_noencode: '<p>body</p>',
    },
    stats: {
      ...makeEmptyStats({
        appmsgid,
        itemidx,
        publishDate: '2026-06-03',
        fallbackTitle: title,
      }),
      read_uv: readUv,
    },
  };
}

test('dedupeRows keeps the latest entry index for the same appmsgid and itemidx', () => {
  const rows = buildRows([
    makeEntry('2247484000', 1, 'Same Article', 100),
    makeEntry('2247484000', 1, 'Same Article', 200),
    makeEntry('2247484001', 1, 'Other Article', 300),
  ]);

  const deduped = dedupeRows(rows);
  const sameArticle = deduped.find(row => String(row.appmsgid) === '2247484000');

  assert.equal(deduped.length, 2);
  assert.ok(sameArticle);
  assert.equal(sameArticle.read_uv, 200);
});

test('planArticleJsonWrites writes one raw.json per target path and keeps the last entry', () => {
  const writes = planArticleJsonWrites([
    makeEntry('2247484000', 1, 'Same Article', 100),
    makeEntry('2247484000', 1, 'Same Article', 200),
  ]);
  const write = writes[0];

  assert.equal(writes.length, 1);
  assert.ok(write);
  assert.equal(write.entry.stats?.read_uv, 200);
  assert.match(write.rawJson, /Same Article\/raw\.json$/);
  assert.match(write.comment, /Same Article\/comment\.md$/);
});

test('formatArticleCommentsMd writes readable comments with replies', () => {
  const entry = makeEntry('2247484002', 1, 'Commented Article', 100);
  entry.comments = [
    {
      content_id: 'normal',
      nick_name: '普通读者',
      content: '后来的留言',
      like_num: 0,
      is_elected: false,
      ip_wording: '',
      post_time: 2,
    },
    {
      content_id: 'elected',
      nick_name: '读者|甲',
      content: '很有用|收藏了',
      like_num: 12,
      is_elected: true,
      ip_wording: '上海',
      post_time: 1,
      reply: { reply_list: [{ nick_name: '作者', content: '谢谢|继续更' }] },
    },
  ];

  const markdown = formatArticleCommentsMd(entry);

  assert.match(markdown, /^# 读者留言 · Commented Article/);
  assert.match(markdown, /共 2 条/);
  assert.match(markdown, /- \*\*读者\\\|甲\*\* 〔精选·12赞·上海〕: 很有用\\\|收藏了/);
  assert.match(markdown, / {2}- ↳ \*\*作者\*\*: 谢谢\\\|继续更/);
  assert.ok(markdown.indexOf('读者\\|甲') < markdown.indexOf('普通读者'));
});

test('formatArticleCommentsMd writes a placeholder when no comments were fetched', () => {
  const markdown = formatArticleCommentsMd(makeEntry('2247484003', 1, 'Quiet Article', 100));

  assert.match(markdown, /^# 读者留言 · Quiet Article/);
  assert.match(markdown, /共 0 条/);
  assert.match(markdown, /暂无已抓取留言。/);
});
