import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readContentGrowthData } from './content-growth.js';

test('独立只读内容查询：只取精确D+3/D+7、保留null、不依赖收益表', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-growth-test-'));
  const dbPath = path.join(temp, 'content.db');
  try {
    const db = new DatabaseSync(dbPath);
    // 有意只建两个内容表；意外读取其他域会直接失败。
    db.exec(`
      CREATE TABLE articles (id INTEGER PRIMARY KEY, title TEXT, url TEXT, publish_time INTEGER,
        media_type TEXT, content_type TEXT, subject TEXT);
      CREATE TABLE stat_snapshots (id INTEGER PRIMARY KEY, article_id INTEGER, captured_day TEXT,
        captured_at INTEGER, read_uv INTEGER, follow_uv INTEGER, share_uv INTEGER, collection_uv INTEGER);
    `);
    const article = db.prepare('INSERT INTO articles VALUES (?, ?, ?, ?, ?, ?, ?)');
    // UTC 9/30 16:30已是北京时间10/1，D+3应为10/4而非10/3。
    article.run(
      1,
      '教程',
      'https://mp.weixin.qq.com/s/test',
      Date.parse('2026-09-30T16:30:00Z') / 1000,
      '文章',
      '教程',
      'Codex'
    );
    article.run(2, '旧文', null, Date.parse('2026-07-01T00:00:00Z') / 1000, '文章', null, null);
    article.run(3, '新文', null, Date.parse('2026-10-09T00:00:00Z') / 1000, '文章', null, null);
    article.run(4, '日期未知', null, null, null, null, null);
    const snapshot = db.prepare('INSERT INTO stat_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    snapshot.run(1, 1, '2026-10-03', 1, 999, 50, 20, 10);
    snapshot.run(2, 1, '2026-10-04', 2, 100, 1, 3, 4);
    snapshot.run(3, 1, '2026-10-04', 3, 120, null, 0, 5);
    snapshot.run(4, 1, '2026-10-08', 4, 200, 8, 10, 7);
    snapshot.run(5, 1, '2026-10-10', 5, 9000, 90, 80, 70);
    snapshot.run(6, 1, '2026-10-11', 6, 9900, 100, 100, 100);
    snapshot.run(7, 2, '2026-07-04', 7, 10000, 500, 90, 90);
    db.close();
    const before = createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
    const data = readContentGrowthData(dbPath, '2026-08-12', '2026-10-10');
    assert.equal(data.articles.length, 4);
    assert.equal(data.articles.find(a => a.id === 1)?.publishDay, '2026-10-01');
    assert.equal(data.articles.find(a => a.id === 4)?.publishDay, null);
    assert.equal(data.latestSnapshotDay, '2026-10-10');
    assert.deepEqual(
      data.snapshots.map(s => s.capturedDay),
      ['2026-10-04', '2026-10-08']
    );
    assert.equal(data.snapshots[0]?.read, 120);
    assert.equal(data.snapshots[0]?.follow, null);
    assert.equal(data.snapshots[0]?.share, 0);
    assert.equal(createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex'), before);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('不存在的数据库不得被只读报告自动创建', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-growth-missing-'));
  const missing = path.join(temp, 'missing.db');
  try {
    assert.throws(() => readContentGrowthData(missing, '2026-09-01', '2026-10-10'));
    assert.equal(fs.existsSync(missing), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
