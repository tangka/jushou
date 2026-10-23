import path from 'node:path';
import { Hono } from 'hono';
import { config } from '../../config/index.js';
import {
  getAppletRevenueDays,
  getAppletRevenueOverview,
  getAppletUserDays,
  getAppletUserLatest,
  getArticleReadSeries,
  getChannelAccountLatest,
  getChannelDailyFans,
  getChannelRevenueDays,
  getChannelRevenueSummary,
  getChannelVideoSeries,
  getChannelVideosLatest,
  getCumulativeReads,
  getDailyMetrics,
  getDailyReadBySource,
  getDailyReadTendency,
  getExpenseAmortizedTotal,
  getExpenseDays,
  getExpenseSummary,
  getFollowerDays,
  getGroupRevenueDays,
  getGroupRevenueSummary,
  getLatestStats,
  getRevenueDays,
  getRevenueOverview,
  getSlotDailyIncome,
  getTopicEconomics,
  openAppletDb,
  reopenDb,
  reopenExpenseDb,
} from '../../db/index.js';
import { discoverAccounts, resolveAccount } from '../account-registry.js';
import { type DailyIncomeInput, mergeDailyIncome } from '../dashboard-income.js';
import { cachedAppletLogin, cachedMpLogin, refreshDashboardLoginStatuses } from '../dashboard-login-status.js';
import { accountRoutes } from './accounts.js';

// 本地 dashboard 数据接口(SPEC N3 放宽):按 account 参数切换配置,读对应 SQLite 的时间序列 + 选题聚合。
export const dashboardRoutes = new Hono();

dashboardRoutes.route('/accounts', accountRoutes);

function channelAccountIsFresh(
  channelAccount: ReturnType<typeof getChannelAccountLatest>,
  latestFansDate: string | null | undefined
): boolean {
  if (!channelAccount) return false;
  return !latestFansDate || channelAccount.captured_day >= latestFansDate;
}

function loadAppletData(applet: (typeof config.appletRegistry)[number], historyLimit = 90) {
  openAppletDb(applet.dbPath);
  const overview = getAppletRevenueOverview();
  const userOverview = getAppletUserLatest();
  const userDays = getAppletUserDays(30);
  return {
    summary: {
      id: applet.id,
      name: overview?.name ?? applet.name,
      dashboardUrl: `/dashboard/applets/?applet=${encodeURIComponent(applet.id)}`,
      totalCents: overview?.total_cents ?? 0,
      yesterdayCents: overview?.yesterday_cents ?? 0,
      weekCents: overview?.week_cents ?? 0,
      updatedDate: overview?.captured_day ?? null,
      dateRangeStart: overview?.date_range_start ?? null,
      dateRangeEnd: overview?.date_range_end ?? null,
      cumulativeUsers: userOverview?.cumulative_users ?? null,
      usersDate: userOverview?.data_date ?? null,
      userDays: userDays.map(day => ({
        date: day.data_date,
        cumulativeUsers: day.cumulative_users,
      })),
    },
    days: getAppletRevenueDays(historyLimit),
    userOverview,
  };
}

dashboardRoutes.get('/login-status', async c => {
  c.header('Cache-Control', 'no-store');
  return c.json(await refreshDashboardLoginStatuses(discoverAccounts(), c.req.query('refresh') === '1'));
});

dashboardRoutes.get('/overview', c => {
  c.header('Cache-Control', 'no-store');
  // history=all 用 SQLite LIMIT -1 导出完整历史，普通看板仍沿用 90 天窗口。
  const historyLimit = c.req.query('history') === 'all' ? -1 : 90;
  const accounts = discoverAccounts();
  const rows = [];
  const dailyIncomeRows: DailyIncomeInput[] = [];
  const appletData = config.appletRegistry.map(applet => loadAppletData(applet, historyLimit));
  const applets = appletData.map((item, index) => ({
    ...item.summary,
    login: config.appletRegistry[index] ? cachedAppletLogin(config.appletRegistry[index]) : 'unknown',
  }));
  for (const item of appletData) {
    for (const day of item.days) dailyIncomeRows.push({ date: day.date, appletCents: day.income_cents });
  }
  reopenExpenseDb(config.companyDbPath);
  const expenseSummary = getExpenseSummary();
  const expenseDays = getExpenseDays(historyLimit === -1 ? null : historyLimit);
  for (const day of expenseDays) {
    dailyIncomeRows.push({ date: day.date, expenseCents: day.amount_cents });
  }
  const amortizedExpenseCents = getExpenseAmortizedTotal();
  const appletRevenueCents = applets.reduce((sum, applet) => sum + applet.totalCents, 0);
  for (const account of accounts) {
    const mp = cachedMpLogin(account);
    reopenDb(account.dbPath);
    const groupRevenue = getGroupRevenueSummary();
    const revenueOverview = getRevenueOverview();
    const mpFans = getFollowerDays(8);
    const channelFans = getChannelDailyFans(8);
    const channelVideos = getChannelVideosLatest();
    const channelAccount = getChannelAccountLatest();
    const mpRevenueCents = revenueOverview?.programmatic_cents ?? 0;
    const channelRevenue = getChannelRevenueSummary();
    const channelIncomeCents = channelRevenue.totalCents;
    const mpLatestFans = mpFans[0] ?? null;
    const channelLatestFans = channelFans[0] ?? null;
    const freshChannelAccount = channelAccountIsFresh(channelAccount, channelLatestFans?.date) ? channelAccount : null;
    const channelReadCount = channelVideos.reduce((sum, item) => sum + (item.read_count ?? 0), 0);
    const channelYesterdayReadCount = channelVideos.reduce((sum, item) => sum + (item.yesterday_read_count ?? 0), 0);
    const channelFollowCount = channelVideos.reduce((sum, item) => sum + (item.follow_count ?? 0), 0);
    const channelInteractionCount = channelVideos.reduce(
      (sum, item) =>
        sum + (item.like_count ?? 0) + (item.fav_count ?? 0) + (item.comment_count ?? 0) + (item.forward_count ?? 0),
      0
    );
    for (const day of getRevenueDays(historyLimit)) {
      dailyIncomeRows.push({ date: day.date, mpCents: day.income_cents });
    }
    for (const day of getGroupRevenueDays(historyLimit)) {
      dailyIncomeRows.push({
        date: day.date,
        groupCents: day.groupCents,
        appletMembershipCents: day.appletMembershipCents,
      });
    }
    for (const day of getChannelRevenueDays(historyLimit)) {
      dailyIncomeRows.push({ date: day.date, channelCents: day.amount_cents });
    }

    rows.push({
      id: account.id,
      account: account.account,
      file: account.file,
      dashboardUrl: account.dashboardUrl,
      mp,
      revenue: {
        totalCents: groupRevenue.totalCents + mpRevenueCents,
        groupCents: groupRevenue.groupCents,
        groupCount: groupRevenue.groupCount,
        appletMembershipCents: groupRevenue.appletMembershipCents,
        appletMembershipCount: groupRevenue.appletMembershipCount,
        mpCents: mpRevenueCents,
        mpDate: revenueOverview?.date ?? null,
        mpFans: mpLatestFans?.cumulate_user ?? 0,
        mpFansDate: mpLatestFans?.date ?? null,
        mpNet7: mpFans.slice(0, 7).reduce((sum, item) => sum + item.netgain_user, 0),
      },
      channels: {
        fans: freshChannelAccount ? freshChannelAccount.fans_count : (channelLatestFans?.total_count ?? 0),
        fansDate: freshChannelAccount ? freshChannelAccount.captured_day : (channelLatestFans?.date ?? null),
        net7: channelFans.slice(0, 7).reduce((sum, item) => sum + item.net_add_count, 0),
        videos: freshChannelAccount ? freshChannelAccount.feeds_count : channelVideos.length,
        reads: channelReadCount,
        yesterdayReads: freshChannelAccount ? freshChannelAccount.yesterday_browse : channelYesterdayReadCount,
        follows: freshChannelAccount ? freshChannelAccount.yesterday_follow : channelFollowCount,
        interactions: freshChannelAccount
          ? freshChannelAccount.yesterday_like +
            freshChannelAccount.yesterday_comment +
            freshChannelAccount.yesterday_forward +
            freshChannelAccount.yesterday_fav
          : channelInteractionCount,
        incomeCents: channelIncomeCents,
      },
    });
  }

  const totalRevenueCents =
    rows.reduce((sum, item) => sum + item.revenue.totalCents + item.channels.incomeCents, 0) + appletRevenueCents;

  return c.json({
    accounts: rows,
    applets,
    dailyIncome: mergeDailyIncome(dailyIncomeRows),
    totals: {
      accounts: rows.length,
      applets: applets.length,
      totalCents: totalRevenueCents,
      expenseCents: amortizedExpenseCents,
      expenseCount: expenseSummary.totalCount,
      annualExpenseCents: expenseSummary.annualCents,
      netCents: totalRevenueCents - amortizedExpenseCents,
      groupRevenueCents: rows.reduce((sum, item) => sum + item.revenue.groupCents, 0),
      groupOrderCount: rows.reduce((sum, item) => sum + item.revenue.groupCount, 0),
      appletMembershipCents: rows.reduce((sum, item) => sum + item.revenue.appletMembershipCents, 0),
      appletMembershipCount: rows.reduce((sum, item) => sum + item.revenue.appletMembershipCount, 0),
      mpRevenueCents: rows.reduce((sum, item) => sum + item.revenue.mpCents, 0),
      appletRevenueCents,
      mpFans: rows.reduce((sum, item) => sum + item.revenue.mpFans, 0),
      channelIncomeCents: rows.reduce((sum, item) => sum + item.channels.incomeCents, 0),
      channelFans: rows.reduce((sum, item) => sum + item.channels.fans, 0),
    },
  });
});

dashboardRoutes.get('/applets', c => {
  const requestedApplet = c.req.query('applet');
  const applet = config.appletRegistry.find(item => item.id === requestedApplet) ?? config.appletRegistry[0];
  if (!applet || (requestedApplet && requestedApplet !== applet.id)) {
    return c.json({ error: '小程序不存在' }, 404);
  }

  openAppletDb(applet.dbPath);
  const overview = getAppletRevenueOverview();
  const userOverview = getAppletUserLatest();
  const userDays = getAppletUserDays(90);
  const days = getAppletRevenueDays(90);
  const row = {
    id: applet.id,
    name: overview?.name || applet.name,
    file: path.basename(applet.dbPath),
    overview,
    userOverview,
    userDays,
    days,
  };

  return c.json({
    applets: [row],
    totals: {
      applets: 1,
      totalCents: overview?.total_cents ?? 0,
      yesterdayCents: overview?.yesterday_cents ?? 0,
      weekCents: overview?.week_cents ?? 0,
    },
  });
});

dashboardRoutes.get('/channels', c => {
  const account = resolveAccount(c.req.query('account'));
  if (!account) return c.json({ error: '账号不存在' }, 404);

  reopenDb(account.dbPath);
  const fansTrend = getChannelDailyFans(90).reverse();
  const latestFans = fansTrend[fansTrend.length - 1] ?? null;
  const videos = getChannelVideosLatest();
  const videoSeries = getChannelVideoSeries(videos.map(video => video.object_id));
  const channelAccount = getChannelAccountLatest();
  const freshChannelAccount = channelAccountIsFresh(channelAccount, latestFans?.date) ? channelAccount : null;
  const channelRevenue = getChannelRevenueSummary();
  const incomeCents = channelRevenue.totalCents;
  const row = {
    id: account.id,
    account: account.account,
    file: account.file,
    dashboardUrl: account.dashboardUrl,
    revenue: { incomeCents, latestPeriodEnd: channelRevenue.latestPeriodEnd },
    stats: {
      fans: freshChannelAccount ? freshChannelAccount.fans_count : (latestFans?.total_count ?? 0),
      fansDate: freshChannelAccount ? freshChannelAccount.captured_day : (latestFans?.date ?? null),
      net7: fansTrend.slice(-7).reduce((sum, item) => sum + item.net_add_count, 0),
      videos: freshChannelAccount ? freshChannelAccount.feeds_count : videos.length,
      reads: videos.reduce((sum, item) => sum + (item.read_count ?? 0), 0),
      yesterdayReads: freshChannelAccount
        ? freshChannelAccount.yesterday_browse
        : videos.reduce((sum, item) => sum + (item.yesterday_read_count ?? 0), 0),
      follows: freshChannelAccount
        ? freshChannelAccount.yesterday_follow
        : videos.reduce((sum, item) => sum + (item.follow_count ?? 0), 0),
      interactions: freshChannelAccount
        ? freshChannelAccount.yesterday_like +
          freshChannelAccount.yesterday_comment +
          freshChannelAccount.yesterday_forward +
          freshChannelAccount.yesterday_fav
        : videos.reduce(
            (sum, item) =>
              sum +
              (item.like_count ?? 0) +
              (item.fav_count ?? 0) +
              (item.comment_count ?? 0) +
              (item.forward_count ?? 0),
            0
          ),
    },
    fansTrend,
    latestVideos: videos.map(video => ({ ...video, series: videoSeries[video.object_id] ?? [] })),
  };

  return c.json({
    accounts: [row],
    totals: {
      accounts: 1,
      incomeCents: row.revenue.incomeCents,
      fans: row.stats.fans,
      net7: row.stats.net7,
      videos: row.stats.videos,
      reads: row.stats.reads,
      yesterdayReads: row.stats.yesterdayReads,
      follows: row.stats.follows,
      interactions: row.stats.interactions,
    },
  });
});

dashboardRoutes.get('/summary', c => {
  const historyLimit = c.req.query('history') === 'all' ? -1 : 90;
  const account = resolveAccount(c.req.query('account'));
  if (!account) return c.json({ error: '账号不存在' }, 404);
  // 重开 DB 连接:常驻 server 在 Docker bind-mount 下读不到别的进程的新写入,每次请求 reopen 保证读最新
  reopenDb(account.dbPath);
  // 倒序(最新在前)→ 翻成正序(时间从早到晚),给折线图用
  const followers = getFollowerDays(historyLimit).reverse();
  const revenue = getRevenueDays(historyLimit).reverse();
  const metrics = getDailyMetrics(90).reverse();
  const articles = getLatestStats(); // 已按 read 降序
  const topics = {
    media: getTopicEconomics(), // 前端按 media_type/content_type/subject 再分组
  };

  const latestFollower = followers[followers.length - 1];
  const avgPerFollower = metrics.length ? metrics.reduce((s, m) => s + m.per_follower_cents, 0) / metrics.length : 0;

  return c.json({
    account: account.account,
    accountId: account.id,
    goals: account.goals,
    now: { fans: latestFollower?.cumulate_user ?? 0, avgPerFollowerCents: Number(avgPerFollower.toFixed(2)) },
    groupRevenue: getGroupRevenueSummary(), // 付费群收款汇总(入群门槛 + 付费服务)
    followers,
    revenue,
    slotIncome: getSlotDailyIncome(30),
    slotNames: { ...account.adSlotNames },
    revenueComposition: getRevenueOverview(),
    metrics,
    articles,
    topics,
    readSeries: getArticleReadSeries(3), // 逐日阅读序列(≥3 天快照),看二次爆发
    readTendency: getDailyReadTendency(), // 每日阅读量(后台权威:全部 + 推荐/看一看,接口直抓)
    readBySource: getDailyReadBySource(), // 每日阅读量按渠道(scene)明细,前端透视成来源占比
    cumulativeReads: getCumulativeReads(), // 累计阅读量(各文截至当日最新 read 之和,单调不减)
    channels: {
      // 视频号:每条视频最新快照 + 每日粉丝趋势(正序给折线图)
      videos: getChannelVideosLatest(),
      fans: getChannelDailyFans(historyLimit).reverse(),
    },
  });
});
