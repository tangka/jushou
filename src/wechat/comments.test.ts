import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArticleCommentsResponse } from './comments.js';

test('parseArticleCommentsResponse accepts array comment_list', () => {
  const comments = parseArticleCommentsResponse({
    base_resp: { ret: 0 },
    comment_list: [
      {
        content_id: 'c1',
        nick_name: '读者',
        content: '很有用',
        like_num: '12',
        is_elected: 1,
        ip_wording: '上海',
        post_time: '1710000000',
        reply: { reply_list: [{ content: '谢谢' }] },
      },
    ],
  });

  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.content_id, 'c1');
  assert.equal(comments[0]?.like_num, 12);
  assert.equal(comments[0]?.is_elected, true);
  assert.equal(comments[0]?.reply?.reply_list.length, 1);
});

test('parseArticleCommentsResponse accepts string comment_list', () => {
  const comments = parseArticleCommentsResponse({
    base_resp: { ret: 0 },
    comment_list: JSON.stringify([
      {
        content_id: 123,
        nick_name: 'A',
        content: '字符串形态',
        like_num: 3,
        is_elected: '0',
      },
    ]),
  });

  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.content_id, '123');
  assert.equal(comments[0]?.is_elected, false);
});
