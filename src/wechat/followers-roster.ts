import { z } from 'zod';
import { fetchMpHtml, type MpSession } from './session.js';

// 全量拉取「当前粉丝名单」(带 openid 主键)→ 供两次快照按 openid 取差集、精确算谁取关。
//
// 翻页机制(关键):`get_all_data&offset` 在 offset≈520 处**硬截断**(拉不到最老的粉丝);
// 后台用户管理真正的翻页是**游标式** `action=get_user_list`:带上一页最后一条的
// `begin_openid` + `begin_create_time`、`backfoward=1`、`f=json` 往更老翻,不截断、能拉满。
// 故:第一页用 get_all_data(顺带拿「未分组」真实总数 expectedTotal),其余用 get_user_list 游标翻到拉满。

export interface FollowerRosterEntry {
  openid: string;
  nick: string;
  avatar: string;
  followTime: number; // unix 秒,关注时间
}

export interface FollowerRoster {
  entries: FollowerRosterEntry[];
  expectedTotal: number | null; // 后台「未分组」真实粉丝数;null=没解析到
}

// 第一页 get_all_data 是 HTML,内联 user_list:id / nick_name / create_time / user_head_img
const USER_RE =
  /id\s*:\s*"(o[A-Za-z0-9_-]{20,})"\s*,\s*nick_name\s*:\s*"([^"]*)"\s*,\s*remark_name\s*:\s*"[^"]*"\s*,\s*create_time\s*:\s*"(\d+)"\s*,\s*user_head_img\s*:\s*"([^"]+)"/g;

function parseFirstPage(html: string): FollowerRosterEntry[] {
  const out: FollowerRosterEntry[] = [];
  for (const m of html.matchAll(USER_RE)) {
    const [, openid, nick, ct, avatar] = m;
    if (openid) out.push({ openid, nick: nick ?? '', avatar: avatar ?? '', followTime: Number(ct) || 0 });
  }
  return out;
}

// 「未分组」分组的 cnt = 账号真实总粉丝数(取关判定的完整性基准)
function parseExpectedTotal(html: string): number | null {
  const m = html.match(/name\s*:\s*"未分组"\s*,\s*cnt\s*:\s*"(\d+)"/u);
  return m?.[1] ? Number(m[1]) : null;
}

// get_user_list 返回 JSON:user_list.user_info_list[]
const userListSchema = z.object({
  user_list: z
    .object({
      user_info_list: z
        .array(
          z.object({
            user_openid: z.string(),
            user_name: z.string().optional(),
            user_create_time: z.number().optional(),
            user_head_img: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

function parseJsonPage(raw: string): FollowerRosterEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return []; // 非 JSON(多半登录态失效返回 HTML)→ 空,调用方据完整性判断会跳过取关
  }
  const parsed = userListSchema.safeParse(json);
  if (!parsed.success) return [];
  return (parsed.data.user_list?.user_info_list ?? []).map(u => ({
    openid: u.user_openid,
    nick: u.user_name ?? '',
    avatar: u.user_head_img ?? '',
    followTime: u.user_create_time ?? 0,
  }));
}

/**
 * 游标翻页拉全部当前粉丝(按 openid 去重)+ 后台真实总数。
 * 第一页 get_all_data 拿总数 + 首批;之后 get_user_list 用「上一页最后一条」的 openid+create_time 当游标往老翻,
 * 直到拿满 expectedTotal 或空页。pageLimit 兜底防死循环。
 */
export async function fetchFollowerRoster(session: MpSession, pageLimit = 200): Promise<FollowerRoster> {
  const byId = new Map<string, FollowerRosterEntry>();
  const first = await fetchMpHtml(session, '/cgi-bin/user_tag', { action: 'get_all_data', offset: 0 });
  const expectedTotal = parseExpectedTotal(first);
  let cursor: { openid: string; ct: number } | null = null;
  for (const e of parseFirstPage(first)) {
    if (!byId.has(e.openid)) byId.set(e.openid, e);
    cursor = { openid: e.openid, ct: e.followTime };
  }
  for (let page = 0; page < pageLimit && cursor; page++) {
    if (expectedTotal != null && byId.size >= expectedTotal) break;
    const raw = await fetchMpHtml(session, '/cgi-bin/user_tag', {
      action: 'get_user_list',
      groupid: -2,
      begin_openid: cursor.openid,
      begin_create_time: cursor.ct,
      limit: 20,
      offset: 0,
      backfoward: 1,
      f: 'json',
      ajax: 1,
    });
    const rows = parseJsonPage(raw);
    if (rows.length === 0) break;
    let last: { openid: string; ct: number } | null = null;
    for (const e of rows) {
      if (!byId.has(e.openid)) byId.set(e.openid, e);
      last = { openid: e.openid, ct: e.followTime };
    }
    cursor = last;
  }
  return { entries: [...byId.values()], expectedTotal };
}
