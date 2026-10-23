import '../test-support/operator-profile-fixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config/index.js';
import { createWechatDraft, updateWechatDraft } from './draft-api.js';
import type { DraftUploadSource } from './draft-types.js';

for (const operation of ['create', 'update'] as const) {
  for (const omitRepeatedImage of [false, true]) {
    test(`${operation} uploads a reused file once and ${omitRepeatedImage ? 'rejects a missing placement' : 'verifies both placements'}`, async t => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-repeated-image-'));
      const originalApi = { ...config.wechatApi };
      Object.assign(config.wechatApi, {
        appid: 'test-app',
        appsecret: 'test-secret',
        baseUrl: 'https://wechat.test',
        tokenCachePath: path.join(root, 'token.json'),
      });
      t.after(async () => {
        Object.assign(config.wechatApi, originalApi);
        await fs.rm(root, { recursive: true, force: true });
      });
      const image = { src: 'media/reused.png', filePath: path.join(root, 'reused.png') };
      await fs.writeFile(image.filePath, 'test image bytes');
      const source: DraftUploadSource = {
        postType: '图文',
        title: '同一原图用于两个步骤',
        author: '测试账号',
        digest: '两个步骤使用同一输入图。',
        contentSourceUrl: undefined,
        coverPath: image.filePath,
        stickerContent: '',
        stickerImages: [],
        articleHtml: `<p>第一步</p><img src="${image.src}"><p>第二步</p><img src="${image.src}">`,
        miniProgramEntryRequired: false,
      };
      const calls: string[] = [];
      let submitted: Record<string, unknown> | undefined;
      t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const endpoint = new URL(input instanceof Request ? input.url : input).pathname;
        calls.push(endpoint);
        let data: unknown;
        if (endpoint === '/cgi-bin/stable_token') data = { access_token: 'test-token', expires_in: 7200 };
        else if (endpoint === '/cgi-bin/media/uploadimg') data = { url: 'https://mmbiz.qpic.cn/reused' };
        else if (endpoint === '/cgi-bin/material/add_material') data = { media_id: 'test-cover' };
        else if (endpoint === '/cgi-bin/draft/add' || endpoint === '/cgi-bin/draft/update') {
          const payload = JSON.parse(String(init?.body)) as {
            articles: Record<string, unknown> | Record<string, unknown>[];
          };
          submitted = Array.isArray(payload.articles) ? payload.articles[0] : payload.articles;
          data = endpoint.endsWith('/add') ? { media_id: 'test-draft' } : { errcode: 0 };
        } else if (endpoint === '/cgi-bin/draft/get') {
          // update 的第一次 get 只解析现有草稿标题；写入后再按实际返回内容核验。
          const article: Record<string, unknown> = { ...submitted, title: source.title };
          if (omitRepeatedImage && typeof article.content === 'string') {
            article.content = article.content.replace(/<img\b[^>]*>/u, '');
          }
          data = { news_item: [article] };
        } else throw new Error(`unexpected request: ${endpoint}`);
        return Response.json(data);
      });
      const upload = () =>
        operation === 'create' ? createWechatDraft(source, [image]) : updateWechatDraft(source, [image], 'test-draft');
      if (omitRepeatedImage) await assert.rejects(upload, /正文图片数不一致:预期 2，实际 1/u);
      else {
        const result = await upload();
        assert.equal(result.mediaId, 'test-draft');
        assert.deepEqual(result.uploadedBodyImages, { [image.src]: 'https://mmbiz.qpic.cn/reused' });
      }
      assert.equal(calls.filter(endpoint => endpoint === '/cgi-bin/media/uploadimg').length, 1);
      assert.equal(
        calls.filter(endpoint => endpoint === `/cgi-bin/draft/${operation === 'create' ? 'add' : 'update'}`).length,
        1
      );
    });
  }
}
