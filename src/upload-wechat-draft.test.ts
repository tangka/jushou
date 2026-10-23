import './test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listUploadableDraftCandidates, validateDraftAccountRouting } from './upload-wechat-draft.js';
import {
  buildWechatNewsArticle,
  buildWechatStickerArticle,
  parseWechatDraftBatchItems,
  selectWechatDraftMediaId,
} from './wechat/draft-api.js';
import { parseUploadDraftCli } from './wechat/draft-cli.js';
import {
  assertDraftPostTypeUnchanged,
  assertDraftTitleReplacement,
  readExistingDraftMeta,
} from './wechat/draft-meta.js';
import { validateWechatArticleMiniProgram, validateWechatContentLinks } from './wechat/link-policy.js';
import { hasPaidPartnershipMiniProgramExemption, validateDraftLinkPolicy } from './wechat/mini-program-entry-policy.js';

const NEWS_MINI_PROGRAM_LINK =
  '<a class="weapp_text_link" data-miniprogram-appid="wx1111111111111111" ' +
  'data-miniprogram-path="pages/index/index">打开示例助手</a>';
const LAB_MINI_PROGRAM_LINK =
  '<a class="weapp_text_link" data-miniprogram-appid="wx1111111111111111" ' +
  'data-miniprogram-path="pages/index/index?platform=lab">打开 Claude 示例助手</a>';

async function writeDraft(root: string, name: string, frontmatter: string): Promise<string> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.md`), `---\ntitle: ${name}\n${frontmatter}---\n\n正文\n`, 'utf8');
  return dir;
}

test('listUploadableDraftCandidates chooses today non-video drafts and skips uploaded drafts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-upload-drafts-'));
  const today = '2026-07-03';

  const older = await writeDraft(root, `${today}-公众号旧稿__codex`, '');
  const newer = await writeDraft(root, `${today}-公众号新稿__claude`, '');
  await writeDraft(root, `${today}-视频号动态__codex`, 'post_type: 视频号\n');
  const uploaded = await writeDraft(root, `${today}-已上传__codex`, '');
  await fs.writeFile(path.join(uploaded, '.wechat-draft.json'), '{}\n', 'utf8');
  await writeDraft(root, '2026-07-02-昨天稿__codex', '');

  const oldTime = new Date('2026-07-03T01:00:00Z');
  const newTime = new Date('2026-07-03T02:00:00Z');
  await fs.utimes(older, oldTime, oldTime);
  await fs.utimes(newer, newTime, newTime);

  const result = await listUploadableDraftCandidates(root, today, false);

  assert.equal(
    result.candidates.map(candidate => candidate.name).join(','),
    `${today}-公众号新稿__claude,${today}-公众号旧稿__codex`
  );
  assert.ok(result.skipped.includes(`${today}-视频号动态__codex:视频号草稿`));
  assert.ok(result.skipped.includes(`${today}-已上传__codex:已存在 .wechat-draft.json`));
});

test('parseUploadDraftCli requires an explicit draft and forbids force for in-place update', () => {
  assert.throws(() => parseUploadDraftCli(['--update-media-id', 'media-1']), /必须同时显式传 --draft/);
  assert.throws(
    () => parseUploadDraftCli(['--draft', '/tmp/draft', '--force', '--update-media-id', 'media-1']),
    /互斥/
  );
  assert.deepEqual(parseUploadDraftCli(['--draft', '/tmp/draft', '--update-media-id', 'media-1']), {
    draft: '/tmp/draft',
    dryRun: false,
    force: false,
    ensureDraft: false,
    ensurePublishedProof: undefined,
    updateMediaId: 'media-1',
    replaceTitleFrom: undefined,
  });
  assert.throws(() => parseUploadDraftCli(['--replace-title-from', '旧标题']), /必须配合 --update-media-id/);
  assert.deepEqual(
    parseUploadDraftCli(['--draft', '/tmp/draft', '--update-media-id', 'media-1', '--replace-title-from', '旧标题']),
    {
      draft: '/tmp/draft',
      dryRun: false,
      force: false,
      ensureDraft: false,
      ensurePublishedProof: undefined,
      updateMediaId: 'media-1',
      replaceTitleFrom: '旧标题',
    }
  );
  assert.throws(() => parseUploadDraftCli(['--ensure-draft']), /必须同时显式传 --draft/);
  assert.throws(() => parseUploadDraftCli(['--draft', '/tmp/draft', '--ensure-draft', '--force']), /互斥/);
  assert.deepEqual(
    parseUploadDraftCli(['--draft', '/tmp/draft', '--ensure-draft', '--ensure-published-proof', 'exact']),
    {
      draft: '/tmp/draft',
      dryRun: false,
      force: false,
      ensureDraft: true,
      ensurePublishedProof: 'exact',
      updateMediaId: undefined,
      replaceTitleFrom: undefined,
    }
  );
});

test('readExistingDraftMeta validates update media id ownership metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-draft-meta-'));
  assert.equal(await readExistingDraftMeta(root, 'Example News'), undefined);

  await fs.writeFile(
    path.join(root, '.wechat-draft.json'),
    `${JSON.stringify({ account: 'Example News', post_type: '图文', title: '旧标题', media_id: 'media-1', created_at: '2026-07-19T00:00:00.000Z' })}\n`,
    'utf8'
  );
  assert.deepEqual(await readExistingDraftMeta(root, 'example news'), {
    mediaId: 'media-1',
    account: 'Example News',
    postType: '图文',
    title: '旧标题',
    createdAt: '2026-07-19T00:00:00.000Z',
  });
  await assert.rejects(() => readExistingDraftMeta(root, 'Example Lab'), /元数据账号不匹配/);
});

test('draft updates fail closed before upload when the local post type changes', async () => {
  const news = {
    mediaId: 'media-news',
    account: 'Example News',
    postType: '图文' as const,
    title: '文章',
    createdAt: undefined,
  };
  const newspic = { ...news, mediaId: 'media-newspic', postType: '贴图' as const, title: '贴图' };

  assert.doesNotThrow(() => assertDraftPostTypeUnchanged(news, undefined));
  assert.doesNotThrow(() => assertDraftPostTypeUnchanged(newspic, '贴图'));
  assert.throws(() => assertDraftPostTypeUnchanged(newspic, undefined), /errcode=53403.*newspic.*news.*上传图片前/);
  assert.throws(() => assertDraftPostTypeUnchanged(news, '贴图'), /errcode=53403.*news.*newspic.*上传图片前/);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-draft-meta-type-'));
  await fs.writeFile(
    path.join(root, '.wechat-draft.json'),
    `${JSON.stringify({ account: 'Example News', title: '旧稿', media_id: 'media-legacy' })}\n`,
    'utf8'
  );
  await assert.rejects(() => readExistingDraftMeta(root, 'Example News'), /缺少或不支持 post_type.*孤儿素材/);
});

test('title replacement requires local metadata to match the explicit old title', () => {
  const existing = {
    mediaId: 'media-1',
    account: 'Example News',
    postType: '图文' as const,
    title: '旧标题',
    createdAt: undefined,
  };
  assert.doesNotThrow(() => assertDraftTitleReplacement(existing, '旧标题', '新标题'));
  assert.throws(() => assertDraftTitleReplacement(existing, '别的旧标题', '新标题'), /本地原标题=旧标题/);
  assert.throws(() => assertDraftTitleReplacement(existing, '旧标题', '旧标题'), /无需使用换题参数/);
});

test('stale draft media id can only recover through one exact-title match', () => {
  const batch = {
    item: [
      { media_id: 'media-current', content: { news_item: [{ title: '今天的文章' }] } },
      { media_id: 'media-other', content: { news_item: [{ title: '另一篇' }] } },
      { media_id: 123, content: { news_item: [{ title: '坏数据' }] } },
    ],
  };
  const parsed = parseWechatDraftBatchItems(batch);
  assert.deepEqual(parsed, [
    { mediaId: 'media-current', title: '今天的文章' },
    { mediaId: 'media-other', title: '另一篇' },
  ]);
  const match = { mediaId: 'media-current', title: '今天的文章' };
  assert.equal(selectWechatDraftMediaId('media-stale', '今天的文章', undefined, [match]), 'media-current');
  assert.equal(selectWechatDraftMediaId('media-current', '今天的文章', '今天的文章', []), 'media-current');
  assert.throws(() => selectWechatDraftMediaId('media-stale', '今天的文章', undefined, []), /没有完整标题匹配项/);
  assert.throws(
    () => selectWechatDraftMediaId('media-stale', '今天的文章', undefined, [match, match]),
    /存在 2 个同标题草稿/
  );
  assert.throws(() => selectWechatDraftMediaId('media-wrong', '今天的文章', '别的文章', []), /标题不匹配/);
  assert.equal(selectWechatDraftMediaId('media-current', '新标题', '旧标题', [], '旧标题'), 'media-current');
  assert.throws(() => selectWechatDraftMediaId('media-current', '新标题', '不是旧标题', [], '旧标题'), /标题不匹配/);
});

test('newspic updates use the official image message article payload', () => {
  const article = buildWechatStickerArticle(
    { title: 'Astra按关键级管控', stickerContent: '不是正式定级，而是按最坏情况加强控制。' },
    ['image-1', 'image-2']
  );
  assert.equal(article.article_type, 'newspic');
  assert.equal(article.title, 'Astra按关键级管控');
  assert.equal(article.content, '不是正式定级，而是按最坏情况加强控制。');
  assert.deepEqual(article.image_info, {
    image_list: [{ image_media_id: 'image-1' }, { image_media_id: 'image-2' }],
  });
});

test('same-type news updates explicitly send the news article type', () => {
  const article = buildWechatNewsArticle(
    {
      title: 'GPT-5.6 Sol最高快14倍',
      author: 'Example News',
      digest: '把贴图原位更新为完整文章。',
      contentSourceUrl: undefined,
    },
    '<p>完整文章正文</p>',
    'thumb-1'
  );

  assert.equal(article.article_type, 'news');
  assert.equal(article.title, 'GPT-5.6 Sol最高快14倍');
  assert.equal(article.content, '<p>完整文章正文</p>');
  assert.equal(article.thumb_media_id, 'thumb-1');
  assert.equal('image_info' in article, false);
});

test('validateDraftAccountRouting blocks obvious cross-account uploads', () => {
  assert.throws(
    () =>
      validateDraftAccountRouting(
        {
          title: 'Fable贵得离谱？',
          markdown: '---\naccount: "Example News"\ntitle: "Fable贵得离谱？"\n---\n\nFable 成本争议\n',
        },
        'Example News'
      ),
    /疑似跨账号选题/
  );

  assert.throws(
    () =>
      validateDraftAccountRouting(
        {
          title: 'Codex被悄悄降智？',
          markdown: '---\naccount: "Example Lab"\ntitle: "Codex被悄悄降智？"\n---\n\nCodex 模型路由争议\n',
        },
        'Example Lab'
      ),
    /疑似跨账号选题/
  );
});

test('validateDraftAccountRouting allows explicit account routing confirmation', () => {
  assert.doesNotThrow(() =>
    validateDraftAccountRouting(
      {
        title: 'Fable贵得离谱？',
        markdown:
          '---\naccount: "Example News"\ntitle: "Fable贵得离谱？"\nrouting_confirmed: true\n---\n\nFable 成本争议\n',
      },
      'Example News'
    )
  );
});

test('validateDraftLinkPolicy allows only WeChat ecosystem links', () => {
  const validBase = {
    markdown:
      '---\ntitle: 链接白名单稿\n---\n\n来源：Anthropic 视觉能力文档\n\n' +
      `![原图](media/source.png)\n${NEWS_MINI_PROGRAM_LINK}\n`,
    articleHtml:
      `<article><p>来源：Anthropic 视觉能力文档</p><img src="media/source.png">` +
      `${NEWS_MINI_PROGRAM_LINK}</article>`,
    contentSourceUrl: undefined,
  };

  assert.doesNotThrow(() => validateDraftLinkPolicy(validBase, 'Example News'));
  assert.doesNotThrow(() =>
    validateDraftLinkPolicy(
      {
        markdown: `[往期文章](https://mp.weixin.qq.com/s/abc123)\n${NEWS_MINI_PROGRAM_LINK}`,
        articleHtml: `<p><a href="https://mp.weixin.qq.com/s/abc123">往期文章</a></p>${NEWS_MINI_PROGRAM_LINK}`,
        contentSourceUrl: 'https://mp.weixin.qq.com/s/source123',
      },
      'Example News'
    )
  );
  assert.doesNotThrow(() =>
    validateDraftLinkPolicy(
      {
        markdown: NEWS_MINI_PROGRAM_LINK,
        articleHtml: NEWS_MINI_PROGRAM_LINK,
        contentSourceUrl: undefined,
      },
      'Example News'
    )
  );

  assert.throws(
    () =>
      validateDraftLinkPolicy(
        {
          markdown: '---\ntitle: 没有小程序\n---\n\n只有正文',
          articleHtml: '<article><p>只有正文</p></article>',
          contentSourceUrl: undefined,
        },
        'Example News'
      ),
    /必须带至少一个可点击的小程序入口/
  );
  assert.throws(
    () => validateDraftLinkPolicy({ ...validBase, contentSourceUrl: 'https://example.com/source' }, 'Example News'),
    /公众号链接白名单/
  );
  assert.throws(
    () =>
      validateDraftLinkPolicy(
        {
          ...validBase,
          markdown: '[Anthropic](https://docs.anthropic.com/vision)',
          articleHtml: '<p><a href="https://docs.anthropic.com/vision">Anthropic</a></p>',
        },
        'Example News'
      ),
    /公众号链接白名单/
  );
  assert.throws(
    () =>
      validateDraftLinkPolicy(
        {
          ...validBase,
          markdown: '<a class="weapp_text_link" data-miniprogram-appid="wx123">伪造小程序</a>',
          articleHtml: '<a class="weapp_text_link" data-miniprogram-appid="wx123">伪造小程序</a>',
        },
        'Example News'
      ),
    /公众号链接白名单/
  );
  assert.throws(
    () => validateDraftLinkPolicy({ ...validBase, markdown: '资料在 docs.example.com/guide' }, 'Example News'),
    /公众号链接白名单/
  );

  assert.doesNotThrow(() =>
    validateDraftLinkPolicy(
      {
        markdown: '---\nad_campaign_id: "900000000001"\nmini_program_entry_exempt: true\n---\n\n普通正文',
        articleHtml: '<article><p>普通正文</p></article>',
        contentSourceUrl: undefined,
        miniProgramEntryRequired: false,
      },
      'Example News'
    )
  );
});

test('paid partnership mini-program exemption requires only an explicit campaign id', () => {
  assert.equal(
    hasPaidPartnershipMiniProgramExemption(
      '---\nad_campaign_id: "900000000001"\nmini_program_entry_exempt: true\n---\n\n普通正文'
    ),
    true
  );
  assert.equal(hasPaidPartnershipMiniProgramExemption('---\ntitle: 普通稿\n---\n\n正文'), false);
  assert.throws(
    () =>
      hasPaidPartnershipMiniProgramExemption('---\nmini_program_entry_exempt: true\n---\n\n本文为示例商业合作正文。'),
    /ad_campaign_id/u
  );
});

test('validateWechatArticleMiniProgram enforces account-specific targets and exempts Example Notes aliases', () => {
  assert.doesNotThrow(() => validateWechatArticleMiniProgram(NEWS_MINI_PROGRAM_LINK, 'Example News'));
  assert.doesNotThrow(() => validateWechatArticleMiniProgram(LAB_MINI_PROGRAM_LINK, 'Example Lab'));
  assert.doesNotThrow(() => validateWechatArticleMiniProgram('<p>Example Notes原创观点</p>', 'Example Notes'));
  assert.doesNotThrow(() => validateWechatArticleMiniProgram('<p>Example Notes原创观点</p>', 'Example Notes'));
  assert.doesNotThrow(() => validateWechatArticleMiniProgram('<p>商业合作正文</p>', 'Example News', false));
  assert.throws(
    () =>
      validateWechatArticleMiniProgram(
        `<a class="weapp_image_link" data-miniprogram-appid="wx1111111111111111" ` +
          `data-miniprogram-path="pages/index/index"><img src="media/example-mini-program.png"></a>`,
        'Example News'
      ),
    /只允许文字入口/
  );
  assert.throws(
    () => validateWechatArticleMiniProgram(LAB_MINI_PROGRAM_LINK, 'Example News'),
    /Example News 公众号图文必须带「示例助手」/
  );
  assert.throws(
    () =>
      validateWechatArticleMiniProgram(
        '<a data-miniprogram-appid="wx2222222222222222" data-miniprogram-path="pages/index/index">别的小程序</a>',
        'Example News'
      ),
    /Example News 公众号图文必须带「示例助手」/
  );
  assert.throws(
    () =>
      validateWechatArticleMiniProgram('<a data-miniprogram-appid="wx1111111111111111">缺少路径</a>', 'Example News'),
    /合法 appid \+ path/
  );
});

test('validateWechatContentLinks enforces the same allowlist at the final API payload layer', () => {
  assert.doesNotThrow(() => validateWechatContentLinks('<article><p>来源：OpenAI 官方活动页</p></article>'));
  assert.doesNotThrow(() =>
    validateWechatContentLinks('<article><a href="https://mp.weixin.qq.com/s/abc123">往期文章</a></article>')
  );
  assert.doesNotThrow(() =>
    validateWechatContentLinks(
      '<article><a class="weapp_text_link" data-miniprogram-appid="wx1111111111111111" data-miniprogram-path="pages/index/index">打开小程序</a></article>'
    )
  );
  assert.throws(
    () => validateWechatContentLinks('<article><a href="/task">任务链接</a></article>'),
    /公众号链接白名单/
  );
  assert.throws(
    () => validateWechatContentLinks('<article><p>资料：docs.example.com/guide</p></article>'),
    /公众号链接白名单/
  );
  assert.throws(
    () => validateWechatContentLinks('<article><p>资料依据：OpenAI 官方说明</p></article>'),
    /禁止出处段落/
  );
});
