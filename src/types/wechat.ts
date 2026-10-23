import { z } from 'zod';

// 微信返回字段松散且常变:多数字段 optional + passthrough(保留未知键,前向兼容)。
// 数值字段用 coerce(后台可能给字符串)。所有外部数据必须经此校验,禁止当 any 直接用(ADR 0006)。

/** 数字或字符串(日期、id 等),交给 date/text 工具处理。 */
const numOrStr = z.union([z.number(), z.string()]);

/** 登录态文件 artifacts/login-state.json。 */
export const loginStateSchema = z
  .object({
    authKey: z.string().min(1),
  })
  .passthrough();
export type LoginState = z.infer<typeof loginStateSchema>;

/** KV 里存的一条 cookie 记录(同 session 的 cookie + token)。 */
export const kvCookieSchema = z.object({
  token: numOrStr.transform(String),
  cookies: z.array(
    z
      .object({
        name: z.string(),
        value: z.string().optional(),
      })
      .passthrough()
  ),
});
export type KvCookie = z.infer<typeof kvCookieSchema>;

const baseRespSchema = z
  .object({
    ret: z.number().optional(),
    err_msg: z.string().optional(),
  })
  .passthrough();

/** 公众号搜索结果里的一个账号。 */
export const accountSchema = z
  .object({
    nickname: z.string().optional(),
    fakeid: z.string().optional(),
  })
  .passthrough();
export type Account = z.infer<typeof accountSchema>;

/** /api/public/v1/account 响应。 */
export const accountSearchRespSchema = z
  .object({
    base_resp: baseRespSchema.optional(),
    list: z.array(accountSchema).optional(),
  })
  .passthrough();
export type AccountSearchResp = z.infer<typeof accountSearchRespSchema>;

/** 文章列表项(/api/public/v1/article 的 articles[])。 */
export const articleListItemSchema = z
  .object({
    aid: numOrStr.optional(),
    appmsgid: numOrStr.optional(),
    itemidx: numOrStr.optional(),
    idx: numOrStr.optional(),
    link: z.string(),
    title: z.string().optional(),
    author: z.string().optional(),
    author_name: z.string().optional(),
    digest: z.string().optional(),
    cover: z.string().optional(),
    create_time: numOrStr.optional(),
    item_show_type: numOrStr.optional(), // 0=文章 5=视频 8=贴图(推载体用)
    is_deleted: z.unknown().optional(),
    is_pay_subscribe: z.unknown().optional(),
  })
  .passthrough();
export type ArticleListItem = z.infer<typeof articleListItemSchema>;

/** /api/public/v1/article 响应。 */
export const articleListRespSchema = z
  .object({
    base_resp: baseRespSchema.optional(),
    articles: z.array(articleListItemSchema).optional(),
  })
  .passthrough();
export type ArticleListResp = z.infer<typeof articleListRespSchema>;

/** 文章正文详情(/api/public/v1/download?format=json)。 */
export const articleDetailSchema = z
  .object({
    title: z.string().optional(),
    author: z.string().optional(),
    nick_name: z.string().optional(),
    content_noencode: z.string().optional(),
    content: z.string().optional(),
    desc: z.string().optional(),
    ori_create_time: numOrStr.optional(),
    ori_send_time: numOrStr.optional(),
    cdn_url: z.string().optional(),
    cover: z.string().optional(),
    mid: numOrStr.optional(),
    idx: numOrStr.optional(),
    comment_id: numOrStr.optional(),
    link: z.string().optional(),
    is_pay_subscribe: z.unknown().optional(),
    // 图集/图片消息:多张图在此(各带 cdn_url),正文 HTML 无 <img>
    picture_page_info_list: z.array(z.object({ cdn_url: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();
export type ArticleDetail = z.infer<typeof articleDetailSchema>;

/** 后台内容分析页 article_data_new(互动数据)。缺失即限流/未出数据。 */
export const articleDataNewSchema = z
  .object({
    read_uv: z.coerce.number().optional(),
    like_cnt: z.coerce.number().optional(),
    zaikan_cnt: z.coerce.number().optional(),
    comment_cnt: z.coerce.number().optional(),
    share_uv: z.coerce.number().optional(),
    collection_uv: z.coerce.number().optional(),
    avg_article_read_time: z.coerce.number().optional(),
    finished_read_pv_ratio: z.coerce.number().optional(),
    follow_after_read_uv: z.coerce.number().optional(),
  })
  .passthrough();
export type ArticleDataNew = z.infer<typeof articleDataNewSchema>;

/** 后台「用户分析」(/misc/useranalysis?f=json)响应,只取我们用到的部分。 */
export const userAnalysisSchema = z
  .object({
    base_resp: baseRespSchema.optional(),
    user_info: z.object({ nick_name: z.string().optional() }).passthrough().optional(),
    category_list: z
      .array(
        z
          .object({
            list: z
              .array(
                z
                  .object({
                    date: z.string(),
                    new_user: z.coerce.number().default(0),
                    cancel_user: z.coerce.number().default(0),
                    netgain_user: z.coerce.number().default(0),
                    cumulate_user: z.coerce.number().default(0),
                  })
                  .passthrough()
              )
              .optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();
export type UserAnalysisResp = z.infer<typeof userAnalysisSchema>;

/**
 * 后台「图文分析」阅读趋势(/misc/appmsganalysis?action=get_article_stat_tendency_and_source&f=json)。
 * all_article_stat_tendency.list:逐日 × 渠道(scene)的阅读人数。date 为 unix 秒(按北京时区归日)。
 * scene:9999=全部、6=推荐(看一看/算法)、0=公众号消息、1=聊天会话、2=朋友圈、4=公众号主页、7=搜一搜、5=其他。
 * T-1 口径:当天行 read_uv=0(未结算)。
 */
export const readTendencySchema = z
  .object({
    base_resp: baseRespSchema.optional(),
    all_article_stat_tendency: z
      .object({
        list: z
          .array(
            z
              .object({
                date: z.coerce.number(),
                scene: z.coerce.number(),
                read_uv: z.coerce.number().default(0),
                share_uv: z.coerce.number().default(0),
              })
              .passthrough()
          )
          .optional()
          .default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ReadTendencyResp = z.infer<typeof readTendencySchema>;

/** 流量主总览:顶层收入构成单位分;环比为后台浮点值。yesterday_overview.ads_stat 列出账号全部广告位(取 slot_id)。 */
export const adOverviewSchema = z
  .object({
    base_resp: baseRespSchema.optional(),
    total_income: z.coerce.number().optional().default(0),
    total_programmatic_ad_income: z.coerce.number().optional().default(0),
    total_freetrade_income: z.coerce.number().optional().default(0),
    total_cps_income: z.coerce.number().optional().default(0),
    yesterday_income: z.coerce.number().optional().default(0),
    last_week_income: z.coerce.number().optional().default(0),
    last_month_income: z.coerce.number().optional().default(0),
    day_cycle_ratio: z.coerce.number().optional().default(0),
    week_cycle_ratio: z.coerce.number().optional().default(0),
    yesterday_overview: z
      .object({ ads_stat: z.array(z.object({ slot_id: numOrStr }).passthrough()).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type AdOverviewResp = z.infer<typeof adOverviewSchema>;

/** 流量主按广告位的每日数据(biz_ads_stat);income 单位分。 */
export const adStatSchema = z
  .object({
    base_resp: baseRespSchema.optional(),
    list: z
      .array(
        z
          .object({
            date: z.string(),
            income: z.coerce.number().default(0),
            exposure_count: z.coerce.number().default(0),
            click_count: z.coerce.number().default(0),
            req_succ_count: z.coerce.number().default(0),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();
export type AdStatResp = z.infer<typeof adStatSchema>;

/** 流量主 income 接口:逐日总收入 + 每日按广告位拆分;income 单位分。 */
export const adIncomeSchema = z
  .object({
    base_resp: baseRespSchema.optional(),
    income_list: z
      .array(
        z
          .object({
            date: z.string(),
            income: z.coerce.number().default(0),
            income_slotid: z
              .array(
                z
                  .object({
                    slotid: numOrStr.transform(String),
                    income: z.coerce.number().default(0),
                  })
                  .passthrough()
              )
              .optional()
              .default([]),
          })
          .passthrough()
      )
      .optional()
      .default([]),
    income_all: z.coerce.number().optional().default(0),
    total_num: z.coerce.number().optional().default(0),
    income_yesterday: z.coerce.number().optional().default(0),
    revenue_last_week: z.coerce.number().optional().default(0),
    slot: z.array(numOrStr.transform(String)).optional().default([]),
  })
  .passthrough();
export type AdIncomeResp = z.infer<typeof adIncomeSchema>;

/** 流量主按文章的收益明细(article_list);total_income 单位分,分页 total_num。 */
export const articleRevenueSchema = z
  .object({
    base_resp: baseRespSchema.optional(),
    article_stat: z
      .array(
        z
          .object({
            title: z.string().default(''),
            send_date: z.string().default(''),
            orig_status: z.coerce.number().default(0),
            total_income: z.coerce.number().default(0),
          })
          .passthrough()
      )
      .optional(),
    total_num: z.coerce.number().optional(),
  })
  .passthrough();
export type ArticleRevenueResp = z.infer<typeof articleRevenueSchema>;

/** window.wx.cgiData 结构(只取我们用到的 articleData)。 */
export const cgiDataSchema = z
  .object({
    articleData: z
      .object({
        title: z.string().optional(),
        article_data_new: articleDataNewSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type CgiData = z.infer<typeof cgiDataSchema>;
