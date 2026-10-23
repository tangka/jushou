import '../test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWechatDraftSnapshot, validateWechatDraftReadback } from './draft-readback.js';

const MINI_PROGRAM_LINK =
  '<a class="weapp_text_link" data-miniprogram-appid="wx1111111111111111" ' +
  'data-miniprogram-path="pages/index/index">打开示例助手</a>';

function newsReadback(overrides: Record<string, unknown> = {}): unknown {
  return {
    news_item: [
      {
        article_type: 'news',
        title: '上传后回读',
        author: 'Example News',
        content: `<p>正文</p>${MINI_PROGRAM_LINK}`,
        content_source_url: 'https://mp.weixin.qq.com/s/source',
        thumb_media_id: 'private-thumb-id',
        ...overrides,
      },
    ],
  };
}

function newspicReadback(imageCount = 2, overrides: Record<string, unknown> = {}): unknown {
  return {
    news_item: [
      {
        article_type: 'newspic',
        title: '两张贴图',
        content: '短导读',
        image_info: {
          image_list: Array.from({ length: imageCount }, (_, index) => ({ image_media_id: `private-image-${index}` })),
        },
        ...overrides,
      },
    ],
  };
}

test('news snapshot is redacted and accepts draft/get or batch item content', () => {
  const direct = parseWechatDraftSnapshot(newsReadback());
  assert.deepEqual(direct, {
    title: '上传后回读',
    author: 'Example News',
    articleType: 'news',
    content: `<p>正文</p>${MINI_PROGRAM_LINK}`,
    contentSourceUrl: 'https://mp.weixin.qq.com/s/source',
    hasCover: true,
    imageCount: 0,
  });
  assert.doesNotMatch(JSON.stringify(direct), /private-thumb-id/u);

  const nested = parseWechatDraftSnapshot({ content: newsReadback() });
  assert.deepEqual(nested, direct);
});

test('news readback verifies title, author, type, cover, source URL and final body links', () => {
  const expected = {
    articleType: 'news' as const,
    title: '上传后回读',
    author: 'Example News',
    thumbMediaId: 'private-thumb-id',
    accountExact: 'Example News',
    imageCount: 0,
    contentSourceUrl: 'https://mp.weixin.qq.com/s/source',
  };
  assert.doesNotThrow(() => validateWechatDraftReadback(newsReadback(), expected));
  assert.throws(() => validateWechatDraftReadback(newsReadback({ title: '错误标题' }), expected), /标题不一致/u);
  assert.throws(() => validateWechatDraftReadback(newsReadback({ author: '旧名称' }), expected), /作者不一致/u);
  assert.throws(
    () => validateWechatDraftReadback(newsReadback({ article_type: 'newspic' }), expected),
    /缺少 image_info|类型不一致/u
  );

  const coverError = assert.throws(() =>
    validateWechatDraftReadback(newsReadback({ thumb_media_id: 'another-private-thumb' }), expected)
  );
  assert.doesNotMatch(String(coverError), /private-thumb|another-private/u);
  assert.throws(
    () =>
      validateWechatDraftReadback(newsReadback({ content_source_url: 'https://mp.weixin.qq.com/s/other' }), expected),
    /阅读原文链接与本地稿件不一致/u
  );
  assert.throws(
    () => validateWechatDraftReadback(newsReadback({ content: '<a href="https://example.com">外链</a>' }), expected),
    /公众号链接白名单/u
  );
  assert.throws(
    () => validateWechatDraftReadback(newsReadback({ content: '<p>小程序入口被微信过滤</p>' }), expected),
    /必须带至少一个可点击的小程序入口/u
  );
  assert.doesNotThrow(() =>
    validateWechatDraftReadback(newsReadback({ content: '<p>商业合作正文</p>' }), {
      ...expected,
      miniProgramEntryRequired: false,
    })
  );
});

test('news readback verifies exact body image count', () => {
  const content = `<p>正文</p><img src="https://mmbiz.qpic.cn/one"><IMG src="https://mmbiz.qpic.cn/two">${MINI_PROGRAM_LINK}`;
  const expected = {
    articleType: 'news' as const,
    title: '上传后回读',
    author: 'Example News',
    thumbMediaId: 'private-thumb-id',
    accountExact: 'Example News',
    imageCount: 2,
    contentSourceUrl: 'https://mp.weixin.qq.com/s/source',
  };
  const snapshot = validateWechatDraftReadback(newsReadback({ content }), expected);
  assert.equal(snapshot.imageCount, 2);
  assert.throws(
    () => validateWechatDraftReadback(newsReadback({ content }), { ...expected, imageCount: 1 }),
    /正文图片数不一致/u
  );
});

test('newspic readback verifies exact image count and valid official image entries', () => {
  const expected = { articleType: 'newspic' as const, title: '两张贴图', imageCount: 2 };
  const snapshot = validateWechatDraftReadback(newspicReadback(), expected);
  assert.deepEqual(snapshot, {
    title: '两张贴图',
    articleType: 'newspic',
    content: '短导读',
    hasCover: false,
    imageCount: 2,
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /private-image/u);
  assert.throws(() => validateWechatDraftReadback(newspicReadback(1), expected), /图片数不一致/u);
  assert.throws(
    () =>
      validateWechatDraftReadback(
        newspicReadback(2, { image_info: { image_list: [{ image_media_id: '' }, {}] } }),
        expected
      ),
    /包含无效图片项/u
  );
});

test('readback fails closed on missing fields and ambiguous multi-article responses', () => {
  assert.throws(() => parseWechatDraftSnapshot({}), /缺少 news_item/u);
  assert.throws(() => parseWechatDraftSnapshot({ news_item: [] }), /恰好包含 1 篇/u);
  assert.throws(
    () => parseWechatDraftSnapshot({ news_item: [{ article_type: 'news', title: '缺正文' }] }),
    /缺少有效正文/u
  );
  assert.throws(
    () => parseWechatDraftSnapshot({ news_item: [{ article_type: 'news', title: '缺封面', content: '' }] }),
    /缺少有效封面/u
  );
  assert.throws(
    () => parseWechatDraftSnapshot({ news_item: [{ article_type: 'video', title: '未知类型', content: '' }] }),
    /article_type 不受支持/u
  );
});
