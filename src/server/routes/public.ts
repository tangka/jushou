import * as cheerio from 'cheerio';
import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import TurndownService from 'turndown';
import { parseCgiDataNew } from '../../utils/cgidata.js';
import { parsePublishedAccountNameFromHtml, parsePublishedArticleItemsFromHtml } from '../../wechat/published-stats.js';
import { cookieStore } from '../cookie-store.js';
import { proxyMpRequest } from '../proxy-request.js';

const MP = 'https://mp.weixin.qq.com';
const AUTH_ERR = { base_resp: { ret: -1, err_msg: '认证信息无效' } };

function getAuthKey(c: Context): string | undefined {
  return c.req.header('X-Auth-Key') || getCookie(c, 'auth-key');
}

function urlIsValidMpArticle(url: string): boolean {
  try {
    return new URL(url).hostname === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

export const publicRoutes = new Hono();

// 搜索公众号
publicRoutes.get('/account', async c => {
  const authKey = getAuthKey(c);
  const token = authKey ? await cookieStore.getToken(authKey) : null;
  if (!authKey || !token) return jsonResponse(AUTH_ERR);

  const keyword = c.req.query('keyword');
  if (!keyword) return jsonResponse({ base_resp: { ret: -1, err_msg: 'keyword不能为空' } });

  const resp = await proxyMpRequest({
    signal: c.req.raw.signal,
    method: 'GET',
    endpoint: `${MP}/cgi-bin/searchbiz`,
    query: {
      action: 'search_biz',
      begin: Number(c.req.query('begin') ?? 0),
      count: Number(c.req.query('size') ?? 5),
      query: keyword,
      token,
      lang: 'zh_CN',
      f: 'json',
      ajax: '1',
    },
    cookie: await cookieStore.getCookie(authKey),
  });
  return new Response(await resp.text(), { headers: { 'Content-Type': 'application/json' } });
});

// 拉当前登录公众号的已发表文章列表。微信现版返回 HTML DOM，数据嵌在 publish_page 变量中。
publicRoutes.get('/article', async c => {
  const authKey = getAuthKey(c);
  const token = authKey ? await cookieStore.getToken(authKey) : null;
  if (!authKey || !token) return jsonResponse(AUTH_ERR);

  const expectedAccount = c.req.query('account');
  if (!expectedAccount) return jsonResponse({ base_resp: { ret: -1, err_msg: 'account不能为空' } });

  const resp = await proxyMpRequest({
    signal: c.req.raw.signal,
    method: 'GET',
    endpoint: `${MP}/cgi-bin/appmsgpublish`,
    query: {
      sub: 'list',
      begin: Number(c.req.query('begin') ?? 0),
      count: Number(c.req.query('size') ?? 10),
      token,
      lang: 'zh_CN',
    },
    cookie: await cookieStore.getCookie(authKey),
  });
  const html = await resp.text();
  if (/freq control|操作频繁/i.test(html)) {
    return jsonResponse({ base_resp: { ret: 200013, err_msg: 'freq control' } });
  }
  try {
    const actualAccount = parsePublishedAccountNameFromHtml(html);
    if (!actualAccount || actualAccount !== expectedAccount) {
      return jsonResponse({
        base_resp: {
          ret: -1,
          err_msg: `当前登录公众号不匹配:期望「${expectedAccount}」,实际「${actualAccount || '无法识别'}」`,
        },
      });
    }
    return jsonResponse({ base_resp: { ret: 0, err_msg: 'ok' }, articles: parsePublishedArticleItemsFromHtml(html) });
  } catch (error) {
    return jsonResponse({
      base_resp: { ret: -1, err_msg: error instanceof Error ? error.message : '已发表列表 DOM 解析失败' },
    });
  }
});

// 下载文章正文(json=解析 cgiDataNew;html/markdown/text=转换)
publicRoutes.get('/download', async c => {
  const rawUrl = c.req.query('url');
  if (!rawUrl) return jsonResponse({ base_resp: { ret: -1, err_msg: 'url不能为空' } });
  const url = decodeURIComponent(rawUrl.trim());
  if (!urlIsValidMpArticle(url)) return jsonResponse({ base_resp: { ret: -1, err_msg: 'url不合法' } });

  const format = (c.req.query('format') ?? 'html').toLowerCase();
  if (!['html', 'markdown', 'text', 'json'].includes(format)) {
    return jsonResponse({ base_resp: { ret: -1, err_msg: '不支持的format' } });
  }

  const rawHtml = await proxyMpRequest({
    method: 'GET',
    endpoint: url,
    signal: c.req.raw.signal,
  }).then(r => r.text());

  switch (format) {
    case 'json': {
      const data = parseCgiDataNew(rawHtml);
      if (data === null)
        return jsonResponse({ base_resp: { ret: -1, err_msg: '解析文章数据失败(可能已删除或被限流)' } });
      return jsonResponse(data);
    }
    case 'markdown':
      return new Response(new TurndownService().turndown(rawHtml), {
        headers: { 'Content-Type': 'text/markdown; charset=UTF-8' },
      });
    case 'text':
      return new Response(cheerio.load(rawHtml)('body').text().trim(), {
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      });
    default:
      return new Response(rawHtml, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }
});
