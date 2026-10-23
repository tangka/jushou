import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPublishedStats,
  parsePublishedAccountNameFromHtml,
  parsePublishedArticleItemsFromHtml,
  parsePublishedArticleStatsFromHtml,
  publishedStatsKey,
} from './published-stats.js';
import { makeEmptyStats } from './stats.js';

function encodeHtmlEntities(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function publishPageHtml(publishInfo: unknown): string {
  const page = {
    total_count: 1,
    publish_list: [{ publish_info: encodeHtmlEntities(JSON.stringify(publishInfo)) }],
  };
  return `<script>var cgiData = { nick_name: "ExampleNews" }; publish_page = ${JSON.stringify(page)}; isPublishPageNoEncode = 1;</script>`;
}

test('parsePublishedArticleItemsFromHtml reads current DOM list shape', () => {
  const html = publishPageHtml({
    publish_info: JSON.stringify({ create_time: '1785556234' }),
    appmsg_info: [
      {
        appmsgid: '2247484976',
        itemidx: '1',
        title: 'Codex & ChatGPT',
        content_url: 'https://mp.weixin.qq.com/s/example?a=1&b=2',
        cover: 'https://mmbiz.qpic.cn/cover.jpg',
        digest: '摘要',
        item_show_type: '0',
      },
      { appmsgid: '2247484976', itemidx: '2', title: '已删除文章' },
    ],
  });

  assert.equal(parsePublishedAccountNameFromHtml(html), 'ExampleNews');
  assert.deepEqual(parsePublishedArticleItemsFromHtml(html), [
    {
      aid: '2247484976',
      appmsgid: '2247484976',
      itemidx: '1',
      idx: '1',
      link: 'https://mp.weixin.qq.com/s/example?a=1&b=2',
      title: 'Codex & ChatGPT',
      author: undefined,
      digest: '摘要',
      cover: 'https://mmbiz.qpic.cn/cover.jpg',
      create_time: '1785556234',
      item_show_type: '0',
      is_deleted: undefined,
      is_pay_subscribe: undefined,
    },
  ]);
});

test('parsePublishedArticleStatsFromHtml decodes embedded publish_info JSON', () => {
  const stats = parsePublishedArticleStatsFromHtml(
    publishPageHtml({
      appmsg_info: [
        {
          appmsgid: '2247484000',
          itemidx: '1',
          title: 'Codex & ChatGPT',
          read_num: '1016',
          old_like_num: '3',
          like_num: '2',
          comment_num: '1',
          total_comment_count_contains_reply: '4',
          comment_id: '999',
          share_num: '19',
        },
      ],
    })
  );

  const article = stats.get(publishedStatsKey('2247484000', 1));
  assert.ok(article);
  assert.equal(article.title, 'Codex & ChatGPT');
  assert.equal(article.read_num, 1016);
  assert.equal(article.old_like_num, 3);
  assert.equal(article.like_num, 2);
  assert.equal(article.comment_num, 1);
  assert.equal(article.total_comment_count_contains_reply, 4);
  assert.equal(article.comment_id, '999');
  assert.equal(article.share_num, 19);
});

test('applyPublishedStats overrides realtime metrics and preserves detail-only fields', () => {
  const detailStats = {
    ...makeEmptyStats({
      appmsgid: '2247484000',
      itemidx: 1,
      publishDate: '2026-06-03',
      fallbackTitle: 'Codex & ChatGPT',
    }),
    collection_uv: 7,
    follow_after_read_uv: 5,
  };

  const merged = applyPublishedStats(detailStats, {
    appmsgid: '2247484000',
    itemidx: 1,
    title: 'Codex & ChatGPT',
    read_num: 1016,
    old_like_num: 3,
    like_num: 2,
    comment_num: 1,
    total_comment_count_contains_reply: 4,
    comment_id: '999',
    share_num: 19,
  });

  assert.equal(merged.read_uv, 1016);
  assert.equal(merged.like_cnt, 3);
  assert.equal(merged.zaikan_cnt, 2);
  assert.equal(merged.comment_cnt, 4);
  assert.equal(merged.share_uv, 19);
  assert.equal(merged.collection_uv, 7);
  assert.equal(merged.follow_after_read_uv, 5);
});
