import { load } from 'cheerio';
import { accountPolicy } from '../config/account-policy.js';

const URL_OR_DOMAIN_PATTERN =
  /(?:https?:\/\/|mailto:|tel:|www\.)[^\s<>"')\]]+|\b(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|ai|dev|app|site|co|me|xyz)(?![a-z0-9_-])(?:\/[^\s<>"')\]]*)?/giu;
const MINI_PROGRAM_APPID_PATTERN = /^wx[a-z0-9]{16}$/iu;
const FORBIDDEN_SOURCE_SECTION_PATTERN = /资料依据|参考资料|来源说明|资料来源|参考来源/u;

export function isAllowedOfficialAccountUrl(raw: string): boolean {
  const candidate = raw.trim().replace(/[，。；！？、]+$/u, '');
  const normalized = candidate.startsWith('www.') ? `https://${candidate}` : candidate;
  try {
    const url = new URL(normalized);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}

function isAllowedMiniProgramElement(
  element: Parameters<ReturnType<typeof load>>[0],
  $: ReturnType<typeof load>
): boolean {
  const appid = ($(element).attr('data-miniprogram-appid') ?? $(element).attr('appid') ?? '').trim();
  if (!MINI_PROGRAM_APPID_PATTERN.test(appid)) return false;
  const miniProgramPath = ($(element).attr('data-miniprogram-path') ?? $(element).attr('path') ?? '').trim();
  if (!miniProgramPath) return false;
  const href = $(element).attr('href')?.trim();
  return !href || href === '#' || isAllowedOfficialAccountUrl(href);
}

/** 仅配置了入口规则的账号要求小程序；已配置目标仍精确校验，普通链接白名单独立执行。 */
export function validateWechatArticleMiniProgram(content: string, accountExact?: string, required = true): void {
  const policy = accountPolicy(accountExact).miniProgram;
  const entryRequired = required && policy?.required === true;

  const $ = load(content, {}, false);
  const elements = $('a, mp-miniprogram')
    .toArray()
    .filter(
      element =>
        element.tagName.toLowerCase() === 'mp-miniprogram' || Boolean($(element).attr('data-miniprogram-appid'))
    );
  const validElements = elements.filter(element => isAllowedMiniProgramElement(element, $));
  if (validElements.length === 0) {
    if (!entryRequired) return;
    throw new Error('公众号图文必须带至少一个可点击的小程序入口（合法 appid + path）；只写名称或放二维码不算。');
  }

  const expected = policy;
  if (!expected) return;

  const imageEntries = validElements.filter(element => {
    const type = ($(element).attr('data-miniprogram-type') ?? '').trim().toLowerCase();
    return type === 'image' || $(element).hasClass('weapp_image_link') || $(element).find('img').length > 0;
  });
  if (expected.textOnly && imageEntries.length > 0) {
    throw new Error(
      `${accountExact} 公众号图文禁止小程序截图、二维码、海报或 weapp_image_link 图片入口；只允许文字入口。`
    );
  }

  if (!expected.appid || !expected.path) return;
  const hasExpectedTarget = validElements.some(element => {
    const appid = ($(element).attr('data-miniprogram-appid') ?? $(element).attr('appid') ?? '').trim();
    const miniProgramPath = ($(element).attr('data-miniprogram-path') ?? $(element).attr('path') ?? '').trim();
    return appid === expected.appid && miniProgramPath === expected.path;
  });
  if (!hasExpectedTarget) {
    throw new Error(
      `${accountExact} 公众号图文必须带「${expected.nickname ?? '已配置目标'}」小程序入口:` +
        `appid=${expected.appid}, path=${expected.path}`
    );
  }
}

/** 对外正文不得附带出处汇总段；出处仅保留在内部素材审计。 */
export function validateWechatEditorialText(text: string): void {
  const match = FORBIDDEN_SOURCE_SECTION_PATTERN.exec(text);
  if (match) {
    throw new Error(`公众号发布正文禁止出处段落，检测到:${match[0]}`);
  }
}

export function validateWechatLinkText(text: string): void {
  for (const match of text.matchAll(URL_OR_DOMAIN_PATTERN)) {
    const target = match[0];
    if (target && !isAllowedOfficialAccountUrl(target)) {
      throw new Error(`公众号链接白名单:只允许微信小程序和 mp.weixin.qq.com 公众号内容，检测到外链:${target}`);
    }
  }
}

export function validateWechatContentLinks(content: string): void {
  const $ = load(content, {}, false);
  $('a, mp-miniprogram').each((_index, element) => {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'mp-miniprogram' || $(element).attr('data-miniprogram-appid')) {
      if (!isAllowedMiniProgramElement(element, $)) {
        throw new Error('公众号链接白名单:小程序跳转缺少合法 appid/path，或混入了外部 href。');
      }
      return;
    }

    const href = $(element).attr('href')?.trim() ?? '';
    if (!isAllowedOfficialAccountUrl(href)) {
      throw new Error(`公众号链接白名单:只允许 mp.weixin.qq.com 公众号内容链接，检测到:${href || '<空 href>'}`);
    }
  });
  const plainText = $.root().text();
  validateWechatLinkText(plainText);
  validateWechatEditorialText(plainText);
}
