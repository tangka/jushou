import assert from 'node:assert/strict';
import test from 'node:test';
import {
  avgIncomeYuan,
  ecpmLeaderOf,
  ecpmYuan,
  followPerPiece,
  groupEconomics,
  pickNextStage,
} from './business-report.js';
import type { TopicEcoRow } from './db/index.js';
import { looseTitleKey, normalizeTitle } from './db/index.js';

function row(p: Partial<TopicEcoRow>): TopicEcoRow {
  return {
    id: 0,
    title: 't',
    publish_time: null,
    media_type: null,
    content_type: null,
    subject: null,
    read_uv: 0,
    follow_uv: 0,
    like_cnt: 0,
    income_cents: null,
    ...p,
  };
}

test('normalizeTitle: NFKC + 折叠空白(全角/多空格归一)', () => {
  assert.equal(normalizeTitle('  Codex  额度 '), 'Codex 额度');
  // 全角字母经 NFKC 归一成半角,便于跨来源标题匹配
  assert.equal(normalizeTitle('Ｃｏｄｅｘ'), 'Codex');
  // HTML 实体解码:采集存的 It&#39;s 与流量主返回的 It's 归一后相等
  assert.equal(normalizeTitle('It&#39;s time to fly.'), normalizeTitle("It's time to fly."));
  assert.equal(normalizeTitle('A&amp;B'), 'A&B');
});

test('looseTitleKey: 标点/引号差异归一为同键,字序错位不归一', () => {
  // , vs ; 与结尾标点 → 同键(能救回)
  assert.equal(
    looseTitleKey('Time to Fly:这一周,Codex 把油门踩到底了'),
    looseTitleKey('Time to Fly:这一周;Codex 把油门踩到底了')
  );
  // 直引号 vs 弯引号 + 结尾句号 → 同键
  assert.equal(looseTitleKey("It's time to fly."), looseTitleKey('It’s time to fly'));
  // 字序错位(里直接 vs 直接里)→ 不同键(不该被模糊救回,留人工)
  assert.notEqual(looseTitleKey('代码里直接调用Codex'), looseTitleKey('代码直接里调用Codex'));
});

test('ecpmLeaderOf: 剔除低阅读小样本,选阅读量够的最高 eCPM 组', () => {
  const big = {
    key: '文章',
    count: 3,
    avgRead: 50,
    sumFollow: 1,
    revenuePieces: 3,
    sumIncomeCents: 91,
    sumReadWithIncome: 150,
  };
  const tiny = {
    key: '视频',
    count: 6,
    avgRead: 11,
    sumFollow: 0,
    revenuePieces: 2,
    sumIncomeCents: 40,
    sumReadWithIncome: 31,
  };
  // 视频 eCPM(12.9)虽高于文章(6.07),但阅读仅 31 < 100 → 被剔除,选文章
  assert.equal(ecpmLeaderOf([tiny, big])?.key, '文章');
  // 全是小样本 → null
  assert.equal(ecpmLeaderOf([tiny]), null);
});

test('pickNextStage: 第一个未达标的阶段(双轴:粉丝 × 每粉收益分/天)', () => {
  assert.equal(pickNextStage(568, 1.46).name, '短期'); // 每粉收益过线,粉丝 568<1000
  assert.equal(pickNextStage(1200, 1.35).name, '中期'); // 短期达标,粉丝差中期 2000
  assert.equal(pickNextStage(2500, 1.35).name, '中期'); // 粉丝够中期但每粉收益没到 1.4
  assert.equal(pickNextStage(12000, 1.6).name, '远期'); // 全达成 → 落最后阶段
});

test('groupEconomics: 按载体聚合阅读/涨粉/收益,按收益降序', () => {
  const rows = [
    row({ media_type: '贴图', read_uv: 1000, follow_uv: 20, income_cents: 80 }),
    row({ media_type: '贴图', read_uv: 500, follow_uv: 10, income_cents: 40 }),
    row({ media_type: '文章', read_uv: 200, follow_uv: 2, income_cents: 60 }),
  ];
  const [tietu, wenzhang] = groupEconomics(rows, r => r.media_type ?? '(未知)');
  assert.ok(tietu && wenzhang);
  // 贴图收益 120 > 文章 60 → 贴图在前
  assert.equal(tietu.key, '贴图');
  assert.equal(tietu.count, 2);
  assert.equal(tietu.avgRead, 750);
  assert.equal(tietu.sumFollow, 30);
  assert.equal(tietu.sumIncomeCents, 120);
  // 文章 eCPM = 60分/200阅读*1000/100 = 3.00 元/千阅读;贴图 = 120/1500*1000/100 = 0.80
  assert.equal(ecpmYuan(wenzhang)?.toFixed(2), '3.00');
  assert.equal(ecpmYuan(tietu)?.toFixed(2), '0.80');
  // 验证「文章人效更高」假设可被检出
  assert.ok((ecpmYuan(wenzhang) ?? 0) > (ecpmYuan(tietu) ?? 0));
});

test('groupEconomics: 收益全 null 时收益/eCPM 为 null(优雅降级),阅读/涨粉仍在', () => {
  const rows = [row({ media_type: '贴图', read_uv: 1000, follow_uv: 20 })];
  const [g] = groupEconomics(rows, r => r.media_type ?? '(未知)');
  assert.ok(g);
  assert.equal(g.revenuePieces, 0);
  assert.equal(avgIncomeYuan(g), null);
  assert.equal(ecpmYuan(g), null);
  assert.equal(g.avgRead, 1000);
  assert.equal(followPerPiece(g), 20);
});

test('groupEconomics: 部分篇有收益时 eCPM 只算有收益的篇', () => {
  const rows = [
    row({ media_type: '贴图', read_uv: 1000, income_cents: 100 }),
    row({ media_type: '贴图', read_uv: 9999 }), // 无收益,不该稀释 eCPM
  ];
  const [g] = groupEconomics(rows, r => r.media_type ?? '(未知)');
  assert.ok(g);
  assert.equal(g.revenuePieces, 1);
  assert.equal(g.sumReadWithIncome, 1000);
  assert.equal(ecpmYuan(g)?.toFixed(2), '1.00'); // 100分/1000*1000/100
});
