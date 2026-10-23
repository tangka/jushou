import { z } from 'zod';

// 视频号后台响应字段同样松散:外部 JSON 先用 zod 收窄,保留未知字段前向兼容。
// 不下载/保存视频本体;media 内的远程 URL 只作为原始元数据留存。

const numOrStr = z.union([z.number(), z.string()]);
const numeric = z.coerce.number().default(0);
const unknownRecord = z.record(z.string(), z.unknown());

export const channelVideoDescSchema = z
  .object({
    description: z.string().default(''),
    mediaType: numeric,
    shortTitle: z.array(z.unknown()).optional().default([]),
    media: z.array(unknownRecord).optional().default([]),
    location: unknownRecord.optional().default({}),
    extReading: unknownRecord.optional().default({}),
    topic: unknownRecord.optional().default({}),
    feedLocation: unknownRecord.optional().default({}),
    event: unknownRecord.optional().default({}),
    audio: unknownRecord.optional().default({}),
    member: unknownRecord.optional().default({}),
    finderNewlifeDesc: unknownRecord.optional().default({}),
    modFeedInfo: unknownRecord.optional().default({}),
  })
  .passthrough();
export type ChannelVideoDesc = z.infer<typeof channelVideoDescSchema>;

export const channelVideoSchema = z
  .object({
    objectId: z.string().min(1),
    exportId: z.string().optional().default(''),
    createTime: z.coerce.number(),
    likeCount: numeric,
    commentCount: numeric,
    readCount: numeric,
    forwardCount: numeric,
    favCount: numeric,
    commentClose: numeric,
    visibleType: numeric,
    status: numeric,
    desc: channelVideoDescSchema,
    objectType: numeric,
    flag: numeric,
    objectNonce: z.string().optional().default(''),
    permissionFlag: numeric,
    canSetOriginalsoundTitle: z.boolean().optional().default(false),
    fullPlayRate: numeric,
    avgPlayTimeSec: numeric,
    disableInfo: unknownRecord.optional().default({}),
    showOriginal: z.boolean().optional().default(false),
    ringsetCount: numeric,
    snscoverCount: numeric,
    statusrefCount: numeric,
    forwardAggregationCount: numeric,
    originalInfo: unknownRecord.optional().default({}),
    followCount: numeric,
    fastFlipRate: numeric,
    forwardSnsCount: numeric,
    forwardAllChatCount: numeric,
    argsInfo: unknownRecord.optional().default({}),
    yesterdayReadCount: numeric,
    stickyOpStatus: numeric,
  })
  .passthrough();
export type ChannelVideo = z.infer<typeof channelVideoSchema>;

export const channelPostListResponseSchema = z
  .object({
    errCode: z.coerce.number().optional().default(0),
    errMsg: z.string().optional().default(''),
    data: z
      .object({
        list: z.array(channelVideoSchema).optional().default([]),
        // bindInfo 实测是数组([{type,bizInfo}]),且我们不消费它 → 宽松收为 unknown,别用 object 把整页 parse 搞挂
        bindInfo: z.unknown().optional(),
        totalCount: numeric,
        lastBuff: z.string().optional().default(''),
        continueFlag: numeric,
      })
      .passthrough()
      .optional()
      .default({ list: [], totalCount: 0, lastBuff: '', continueFlag: 0 }),
  })
  .passthrough();
export type ChannelPostListResponse = z.infer<typeof channelPostListResponseSchema>;

const numberSeries = z.array(z.coerce.number()).optional().default([]);

export const channelFansTabTrendSchema = z
  .object({
    add: numberSeries,
    reduce: numberSeries,
    netAdd: numberSeries,
    total: numberSeries,
    tabType: numeric,
    tabTypeName: z.string().optional().default(''),
  })
  .passthrough();
export type ChannelFansTabTrend = z.infer<typeof channelFansTabTrendSchema>;

export const channelFansTrendResponseSchema = z
  .object({
    errCode: z.coerce.number().optional().default(0),
    errMsg: z.string().optional().default(''),
    data: z
      .object({
        add: numberSeries,
        reduce: numberSeries,
        netAdd: numberSeries,
        total: numberSeries,
        fansDataByTabtype: z.array(channelFansTabTrendSchema).optional().default([]),
      })
      .passthrough()
      .optional()
      .default({ add: [], reduce: [], netAdd: [], total: [], fansDataByTabtype: [] }),
  })
  .passthrough();
export type ChannelFansTrendResponse = z.infer<typeof channelFansTrendResponseSchema>;

export const channelAuthDataResponseSchema = z
  .object({
    errCode: z.coerce.number().optional().default(0),
    errMsg: z.string().optional().default(''),
    data: z
      .object({
        finderUser: z
          .object({
            finderUsername: z.string().optional().default(''),
            nickname: z.string().optional().default(''),
            uniqId: z.string().optional().default(''),
            feedsCount: numeric,
            fansCount: numeric,
          })
          .passthrough(),
      })
      .passthrough()
      .optional()
      .default({ finderUser: { finderUsername: '', nickname: '', uniqId: '', feedsCount: 0, fansCount: 0 } }),
  })
  .passthrough();
export type ChannelAuthDataResponse = z.infer<typeof channelAuthDataResponseSchema>;

export const channelPostTotalDataResponseSchema = z
  .object({
    errCode: z.coerce.number().optional().default(0),
    errMsg: z.string().optional().default(''),
    data: z
      .object({
        totalData: z.record(z.string(), z.array(numOrStr)).optional().default({}),
      })
      .passthrough()
      .optional()
      .default({ totalData: {} }),
  })
  .passthrough();
export type ChannelPostTotalDataResponse = z.infer<typeof channelPostTotalDataResponseSchema>;

export const channelRequestBodySchema = z
  .object({
    startTs: numOrStr.optional(),
    endTs: numOrStr.optional(),
    beginTs: numOrStr.optional(),
    currentPage: numOrStr.optional(),
    pageSize: numOrStr.optional(),
    interval: numOrStr.optional(),
  })
  .passthrough();
export type ChannelRequestBody = z.infer<typeof channelRequestBodySchema>;

export interface ChannelFansTabDaily {
  tabType: number;
  tabTypeName: string;
  add: number;
  reduce: number;
  netAdd: number;
  total: number;
}

export interface ChannelDailyFans {
  date: string;
  add: number;
  reduce: number;
  netAdd: number;
  total: number;
  fansDataByTabtype: ChannelFansTabDaily[];
}

export interface ChannelRawCapture {
  matchedUrl: string;
  requestBody: ChannelRequestBody | null;
  json: unknown;
  capturedAt: number;
}

export interface ChannelAccountSnapshot {
  capturedDay: string;
  capturedAt: number;
  finderUsername: string;
  nickname: string;
  uniqId: string;
  fansCount: number;
  feedsCount: number;
  yesterdayBrowse: number;
  yesterdayLike: number;
  yesterdayComment: number;
  yesterdayForward: number;
  yesterdayFav: number;
  yesterdayFollow: number;
  raw: unknown;
}
