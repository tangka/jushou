import assert from 'node:assert/strict';
import test from 'node:test';
import { isOutsideRefreshWindow } from './enrich-wechat-stats.js';

test('interaction refresh keeps the 30-day boundary and skips anything older', () => {
  const nowMs = Date.parse('2026-07-23T00:00:00Z');
  const exactly30Days = Math.floor(Date.parse('2026-06-23T00:00:00Z') / 1000);
  const olderThan30Days = exactly30Days - 1;

  assert.equal(isOutsideRefreshWindow(exactly30Days, 30, nowMs), false);
  assert.equal(isOutsideRefreshWindow(olderThan30Days, 30, nowMs), true);
  assert.equal(isOutsideRefreshWindow(olderThan30Days, 0, nowMs), false);
  assert.equal(isOutsideRefreshWindow(null, 30, nowMs), false);
});
