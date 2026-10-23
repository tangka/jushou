import assert from 'node:assert/strict';
import test from 'node:test';
import { draftRemoteApiInternals } from './draft-remote-api.js';

test('remote draft parser preserves news and newspic identity', () => {
  const parsed = draftRemoteApiInternals.parseBatch(
    {
      item: [
        {
          media_id: 'news-private-ref',
          content: { news_item: [{ title: '文章', article_type: 'news', content: '<p>正文</p>' }] },
        },
        {
          media_id: 'newspic-private-ref',
          content: {
            news_item: [
              {
                title: '贴图',
                article_type: 'newspic',
                content: '说明',
                image_info: { image_list: [{ image_media_id: 'image-private-ref' }] },
              },
            ],
          },
        },
      ],
    },
    'media_id'
  );
  assert.equal(parsed[0]?.postType, 'news');
  assert.equal(parsed[1]?.postType, 'newspic');
  assert.deepEqual(parsed[1]?.imageMediaIds, ['image-private-ref']);
});

test('remote parser rejects malformed items instead of inventing identity', () => {
  assert.deepEqual(draftRemoteApiInternals.parseBatch({ item: [{ media_id: 'ref', content: {} }] }, 'media_id'), []);
});
