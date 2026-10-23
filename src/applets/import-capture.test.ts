import assert from 'node:assert/strict';
import test from 'node:test';
import { appletRevenueOverviewSchema } from '../types/applet.js';
import { resolveCaptureAppletId } from './import-capture.js';

test('capture without an appid uses the selected applet id', () => {
  assert.equal(resolveCaptureAppletId('football'), 'football');
});

test('capture appid must match the selected applet', () => {
  assert.equal(resolveCaptureAppletId('football', 'football'), 'football');
  assert.throws(() => resolveCaptureAppletId('football', 'reset-radar'), /appid 与当前小程序不匹配/);
});

test('capture schema rejects a blank explicit appid', () => {
  assert.equal(appletRevenueOverviewSchema.safeParse({ appid: '   ' }).success, false);
});
