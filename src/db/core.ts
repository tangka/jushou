import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config/index.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  appmsgid TEXT NOT NULL,
  itemidx INTEGER NOT NULL,
  title TEXT,
  url TEXT,
  account TEXT,
  publish_time INTEGER,
  media_type TEXT,            -- 载体:文章/贴图/视频(由 item_show_type 推,采集即填)
  content_type TEXT,          -- 体裁(ADR 0005),打标后填
  subject TEXT,               -- 对象(ADR 0005),打标后填
  UNIQUE(appmsgid, itemidx)
);

CREATE TABLE IF NOT EXISTS stat_snapshots (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  captured_at INTEGER NOT NULL,   -- 采集时刻(unix 秒)
  captured_day TEXT NOT NULL,     -- YYYY-MM-DD,同日重跑覆盖(幂等),跨日追加
  read_uv INTEGER, like_cnt INTEGER, zaikan_cnt INTEGER,
  comment_cnt INTEGER, share_uv INTEGER, collection_uv INTEGER,
  follow_uv INTEGER,              -- 读后关注人数(follow_after_read_uv)
  UNIQUE(article_id, captured_day)
);

CREATE INDEX IF NOT EXISTS idx_snap_article ON stat_snapshots(article_id, captured_at);

CREATE TABLE IF NOT EXISTS article_comments (
  id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  content_id TEXT NOT NULL,       -- 微信留言唯一 id
  nick_name TEXT,
  content TEXT,
  like_num INTEGER,
  is_elected INTEGER,
  ip_wording TEXT,
  post_time INTEGER,
  reply_json TEXT,
  captured_at INTEGER NOT NULL,
  UNIQUE(article_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_article_comments_article ON article_comments(article_id, like_num DESC);

-- 账号「用户分析」每日快照(总粉丝 + 新增/取消/净增),按 date 幂等
CREATE TABLE IF NOT EXISTS follower_snapshots (
  date TEXT PRIMARY KEY,          -- YYYY-MM-DD(T-1 口径)
  new_user INTEGER, cancel_user INTEGER, netgain_user INTEGER, cumulate_user INTEGER,
  captured_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revenue_snapshots (
  date TEXT PRIMARY KEY,          -- YYYY-MM-DD(T-1 口径,流量主全部广告位合计)
  income_cents INTEGER, exposure INTEGER, click INTEGER, req_succ INTEGER,
  captured_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revenue_slot_daily (
  date TEXT NOT NULL,             -- YYYY-MM-DD,流量主 income 接口逐日口径
  slotid TEXT NOT NULL,           -- 广告位 id;中文名不入库,按账号配置展示
  income_cents INTEGER,           -- 该广告位当天收入(分)
  captured_at INTEGER NOT NULL,
  PRIMARY KEY(date, slotid)
);

CREATE INDEX IF NOT EXISTS idx_revenue_slot_daily_date ON revenue_slot_daily(date);

CREATE TABLE IF NOT EXISTS revenue_overview (
  date TEXT PRIMARY KEY,          -- YYYY-MM-DD(抓取日,同日重跑覆盖)
  total_cents INTEGER,
  programmatic_cents INTEGER,
  freetrade_cents INTEGER,
  cps_cents INTEGER,
  yesterday_cents INTEGER,
  week_cents INTEGER,
  month_cents INTEGER,
  day_ratio REAL,
  week_ratio REAL,
  captured_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS article_revenue (
  send_date TEXT, title TEXT,     -- 文章发布日 + 标题(接口无稳定 id,以此为主键)
  orig_status INTEGER, income_cents INTEGER,  -- orig_status 1=原创;income 区间累计,单位分
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (send_date, title)
);

-- 每日人均收益(当天收益 ÷ 当天累计粉丝);由收益+粉丝快照 join 算出,每次 sync 全量刷新
CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT PRIMARY KEY,           -- YYYY-MM-DD
  cumulate_user INTEGER,           -- 当天累计粉丝
  income_cents INTEGER,            -- 当天收益(分)
  per_follower_cents REAL,         -- 每粉收益(分) = income_cents / cumulate_user
  captured_at INTEGER NOT NULL
);

-- 后台「图文分析」阅读趋势:逐日 × 渠道(scene)阅读人数(权威口径,接口直抓)。
-- scene 9999=全部、6=推荐(看一看)。按 (date, scene) 幂等,T-1 当天可隔日重抓覆盖。
CREATE TABLE IF NOT EXISTS read_tendency (
  date TEXT NOT NULL,             -- YYYY-MM-DD(北京时区归日,T-1 口径)
  scene INTEGER NOT NULL,         -- 渠道:9999=全部,6=推荐,0/1/2/4/5/7=各来源
  read_uv INTEGER, share_uv INTEGER,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (date, scene)
);

-- 视频号视频元数据:不下载/存储视频本体,仅保存后台列表返回的对象与字段。
CREATE TABLE IF NOT EXISTS channel_videos (
  object_id TEXT PRIMARY KEY,
  export_id TEXT,
  description TEXT,
  short_title_json TEXT,
  create_time INTEGER,
  media_type INTEGER,
  status INTEGER,
  visible_type INTEGER,
  object_type INTEGER,
  flag INTEGER,
  object_nonce TEXT,
  permission_flag INTEGER,
  comment_close INTEGER,
  can_set_original_sound_title INTEGER,
  show_original INTEGER,
  ringset_count INTEGER,
  snscover_count INTEGER,
  statusref_count INTEGER,
  sticky_op_status INTEGER,
  disable_info_json TEXT,
  original_info_json TEXT,
  args_info_json TEXT,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);

-- 视频号列表指标快照:与 stat_snapshots 一样按自然日幂等,跨日形成时序。
CREATE TABLE IF NOT EXISTS channel_video_snapshots (
  id INTEGER PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES channel_videos(object_id),
  captured_at INTEGER NOT NULL,
  captured_day TEXT NOT NULL,
  read_count INTEGER,
  yesterday_read_count INTEGER,
  full_play_rate REAL,
  avg_play_time_sec REAL,
  fast_flip_rate REAL,
  like_count INTEGER,
  fav_count INTEGER,
  comment_count INTEGER,
  forward_count INTEGER,
  forward_sns_count INTEGER,
  forward_all_chat_count INTEGER,
  forward_aggregation_count INTEGER,
  follow_count INTEGER,
  raw_json TEXT,
  UNIQUE(object_id, captured_day)
);

CREATE INDEX IF NOT EXISTS idx_channel_snap_object ON channel_video_snapshots(object_id, captured_at);

-- 视频号粉丝趋势:日序列;来源细分 fansDataByTabtype 保留为 JSON 列。
CREATE TABLE IF NOT EXISTS channel_daily_fans (
  date TEXT PRIMARY KEY,
  add_count INTEGER,
  reduce_count INTEGER,
  net_add_count INTEGER,
  total_count INTEGER,
  fans_data_by_tabtype_json TEXT,
  captured_at INTEGER NOT NULL
);

-- 视频号账号首页概览:来自 auth_data / new_post_total_data,用于展示当前粉丝与昨日核心指标。
CREATE TABLE IF NOT EXISTS channel_account_snapshots (
  captured_day TEXT PRIMARY KEY,
  captured_at INTEGER NOT NULL,
  finder_username TEXT,
  nickname TEXT,
  uniq_id TEXT,
  fans_count INTEGER,
  feeds_count INTEGER,
  yesterday_browse INTEGER,
  yesterday_like INTEGER,
  yesterday_comment INTEGER,
  yesterday_forward INTEGER,
  yesterday_fav INTEGER,
  yesterday_follow INTEGER,
  raw_json TEXT
);

-- 视频号收益区间快照:后台常只给所选区间累计值。相同 period_start 的后续快照按增量计入曲线。
CREATE TABLE IF NOT EXISTS channel_revenue_snapshots (
  period_start TEXT NOT NULL,                -- YYYY-MM-DD(后台所选区间开始)
  period_end TEXT NOT NULL,                  -- YYYY-MM-DD(后台所选区间结束)
  total_cents INTEGER NOT NULL,              -- 该区间截至 period_end 的累计收益(分)
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY(period_start, period_end),
  CHECK(total_cents >= 0),
  CHECK(period_start GLOB '????-??-??'),
  CHECK(period_end GLOB '????-??-??')
);

CREATE INDEX IF NOT EXISTS idx_channel_revenue_period_end ON channel_revenue_snapshots(period_end);

-- 头条号后台 Codex 浏览器采集:原始响应完整留存,结构化表只做运营指标索引。
CREATE TABLE IF NOT EXISTS toutiao_raw_captures (
  id INTEGER PRIMARY KEY,
  target TEXT NOT NULL,
  matched_url TEXT,
  captured_at INTEGER NOT NULL,
  request_body_json TEXT,
  response_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_toutiao_raw_target ON toutiao_raw_captures(target, captured_at);

CREATE TABLE IF NOT EXISTS toutiao_items (
  item_id TEXT PRIMARY KEY,
  title TEXT,
  url TEXT,
  item_type TEXT,
  publish_time INTEGER,
  status TEXT,
  abstract TEXT,
  raw_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS toutiao_item_snapshots (
  id INTEGER PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES toutiao_items(item_id),
  captured_at INTEGER NOT NULL,
  captured_day TEXT NOT NULL,
  read_count INTEGER,
  comment_count INTEGER,
  like_count INTEGER,
  share_count INTEGER,
  favorite_count INTEGER,
  follow_count INTEGER,
  income_cents INTEGER,
  raw_json TEXT,
  UNIQUE(item_id, captured_day)
);

CREATE INDEX IF NOT EXISTS idx_toutiao_snap_item ON toutiao_item_snapshots(item_id, captured_at);

CREATE TABLE IF NOT EXISTS toutiao_comments (
  comment_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  nick_name TEXT,
  content TEXT,
  like_count INTEGER,
  reply_count INTEGER,
  create_time INTEGER,
  status TEXT,
  raw_json TEXT,
  captured_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_toutiao_comments_item ON toutiao_comments(item_id, captured_at);

-- 小程序流量主收益:独立于公众号流量主收益,只进入收入汇总/小程序看板。
CREATE TABLE IF NOT EXISTS applet_revenue_daily (
  date TEXT NOT NULL,                       -- YYYY-MM-DD
  appid TEXT NOT NULL CHECK (length(trim(appid, char(9) || char(10) || char(11) || char(12) || char(13) || ' ')) > 0),
  income_cents INTEGER NOT NULL,
  pull_count INTEGER,
  exposure_count INTEGER,
  click_count INTEGER,
  ecpm_yuan REAL,
  raw_json TEXT,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY(date, appid)
);

CREATE INDEX IF NOT EXISTS idx_applet_revenue_daily_date ON applet_revenue_daily(date);

CREATE TABLE IF NOT EXISTS applet_revenue_overview (
  captured_day TEXT NOT NULL,
  appid TEXT NOT NULL CHECK (length(trim(appid, char(9) || char(10) || char(11) || char(12) || char(13) || ' ')) > 0),
  name TEXT,
  yesterday_cents INTEGER NOT NULL,
  week_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  date_range_start TEXT,
  date_range_end TEXT,
  raw_json TEXT,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY(captured_day, appid)
);

-- 小程序累计用户:来自后台首页「昨日核心数据」指标 10100。
-- 数据日期按微信返回的 data_time 归日,与流量主收益独立,未开通流量主的小程序也能持续记录。
CREATE TABLE IF NOT EXISTS applet_user_snapshots (
  data_date TEXT NOT NULL,
  appid TEXT NOT NULL CHECK (length(trim(appid, char(9) || char(10) || char(11) || char(12) || char(13) || ' ')) > 0),
  name TEXT,
  cumulative_users INTEGER NOT NULL,
  raw_json TEXT,
  captured_at INTEGER NOT NULL,
  PRIMARY KEY(data_date, appid)
);

CREATE INDEX IF NOT EXISTS idx_applet_user_snapshots_date ON applet_user_snapshots(data_date);

-- 运营目标达标里程碑:记某个目标数字首次达成,用于「达标即提醒刷新目标」只报一次。
-- goal_key 含目标值(如「短期·粉丝·1000」),目标上调后是新 key,会重新提醒。
CREATE TABLE IF NOT EXISTS goal_milestones (
  goal_key TEXT PRIMARY KEY,
  hit_at INTEGER NOT NULL
);

-- 付费群收款流水:手工录入(非抓取),一单一行。按号存进各自库(多账号隔离)。
-- kind:entry=入群门槛(9.9/10) | service=付费服务(远程安装/陪跑/工作流等高客单)。
CREATE TABLE IF NOT EXISTS group_revenue (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                       -- YYYY-MM-DD(收款日)
  account TEXT,                             -- 账号(冗余留痕,便于导出/跨号汇总)
  kind TEXT NOT NULL DEFAULT 'entry',       -- entry | service
  amount_cents INTEGER NOT NULL,            -- 实收金额(分)
  channel TEXT,                             -- wx | ali | ''(收款渠道)
  service TEXT,                             -- 付费服务名(kind=service 时)
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_group_revenue_date ON group_revenue(date);

-- 粉丝名单(按 openid 主键的全量快照状态):每次拉取 upsert 当前在关注的人,
-- 上次在、这次没拉到的判为取关。靠 openid 精确算「谁取关」,不受昵称花字符/OCR 影响。
CREATE TABLE IF NOT EXISTS follower_roster (
  openid TEXT PRIMARY KEY,
  nick TEXT NOT NULL,
  avatar TEXT,
  follow_time INTEGER,
  first_seen_day TEXT NOT NULL,   -- 首次出现在名单的日期
  last_seen_day TEXT NOT NULL,    -- 最近一次仍在名单的日期
  status TEXT NOT NULL DEFAULT 'following',  -- following | unfollowed
  unfollowed_day TEXT             -- 判定取关的日期(status=unfollowed 时)
);
`;

// 旧库平滑加列(已存在则忽略报错)
const MIGRATIONS = [
  'ALTER TABLE stat_snapshots ADD COLUMN follow_uv INTEGER',
  'ALTER TABLE articles ADD COLUMN media_type TEXT',
  // 选题↔收益打通:文章收益接上 articles.id(加列前已落的行靠 backfillArticleRevenueLinks 回填)
  'ALTER TABLE article_revenue ADD COLUMN article_id INTEGER',
];

let instance: DatabaseSync | null = null;
let activeDbPath = config.dbPath;

export function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function boolInt(value: boolean): number {
  return value ? 1 : 0;
}

/** 打开(并按需建表)SQLite;单例。 */
export function getDb(): DatabaseSync {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(activeDbPath), { recursive: true });
  instance = new DatabaseSync(activeDbPath);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec(SCHEMA);
  for (const m of MIGRATIONS) {
    try {
      instance.exec(m);
    } catch {
      // 列已存在等,忽略
    }
  }
  return instance;
}

/**
 * 关掉并重置单例,下次 getDb() 重开新连接。
 * 用途:常驻进程(看板 server)在 macOS Docker bind-mount 下,长连接读不到「别的进程(本地 sync / 容器定时 sync)」对同一 DB 文件的新写入;
 * 每次请求前 reopen 一下,保证读到最新已提交数据。
 */
export function reopenDb(dbPath = activeDbPath): void {
  if (instance) {
    try {
      instance.close();
    } catch {
      // 已关闭等,忽略
    }
    instance = null;
  }
  activeDbPath = dbPath;
}
