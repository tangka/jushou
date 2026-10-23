import { readFrontmatterField } from '../utils/frontmatter.js';
import {
  isAllowedOfficialAccountUrl,
  validateWechatArticleMiniProgram,
  validateWechatContentLinks,
  validateWechatEditorialText,
  validateWechatLinkText,
} from './link-policy.js';

type DraftLinkPolicySource = {
  markdown: string;
  articleHtml: string;
  contentSourceUrl: string | undefined;
  miniProgramEntryRequired?: boolean;
};

function readFirstFrontmatter(markdown: string, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = readFrontmatterField(markdown, key)?.trim();
    if (value) return value;
  }
  return undefined;
}

function frontmatterFlag(markdown: string, key: string): boolean {
  return /^(1|true|yes|确认|已确认)$/iu.test(readFrontmatterField(markdown, key)?.trim() ?? '');
}

/** 商业合作稿可显式免除与正文无关的小程序入口；必须留下任务 ID 供内部审计。 */
export function hasPaidPartnershipMiniProgramExemption(markdown: string): boolean {
  if (!frontmatterFlag(markdown, 'mini_program_entry_exempt')) return false;

  const campaignId = readFirstFrontmatter(markdown, ['ad_campaign_id']);
  if (!campaignId || !/^\d{6,}$/u.test(campaignId)) {
    throw new Error('商业合作稿免除小程序入口时，frontmatter 必须填写有效 ad_campaign_id。');
  }

  return true;
}

/** 公众号链接仅放行微信小程序和 mp.weixin.qq.com 内容。 */
export function validateDraftLinkPolicy(source: DraftLinkPolicySource, accountExact?: string): void {
  if (source.contentSourceUrl && !isAllowedOfficialAccountUrl(source.contentSourceUrl)) {
    throw new Error(
      `公众号链接白名单:source_url/content_source_url 只允许 mp.weixin.qq.com，检测到:${source.contentSourceUrl}`
    );
  }
  validateWechatLinkText(source.markdown);
  validateWechatEditorialText(source.markdown);
  validateWechatContentLinks(source.articleHtml);
  if (source.articleHtml.trim()) {
    validateWechatArticleMiniProgram(source.articleHtml, accountExact, source.miniProgramEntryRequired !== false);
  }
}
