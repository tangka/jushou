import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExpenseAddArgs, todayBeijing } from './expense.js';

test('parseExpenseAddArgs parses annual applet expense in yuan', () => {
  assert.deepEqual(parseExpenseAddArgs(['30', '小程序', '向云端实时海拔表', 'annual', '年费']), {
    amountCents: 3000,
    category: '小程序',
    item: '向云端实时海拔表',
    period: 'annual',
    note: '年费',
  });
  assert.equal(parseExpenseAddArgs(['30.5', '小程序', '向云端实时海拔表']).amountCents, 3050);
  assert.equal(parseExpenseAddArgs(['30.05', '小程序', '向云端实时海拔表']).amountCents, 3005);
});

test('parseExpenseAddArgs rejects invalid amount and period', () => {
  assert.throws(() => parseExpenseAddArgs(['', '小程序', '向云端实时海拔表', 'annual']), /金额非法/);
  assert.throws(() => parseExpenseAddArgs(['0', '小程序', '向云端实时海拔表', 'annual']), /金额非法/);
  assert.throws(() => parseExpenseAddArgs(['-30', '小程序', '向云端实时海拔表', 'annual']), /金额非法/);
  assert.throws(() => parseExpenseAddArgs(['30.001', '小程序', '向云端实时海拔表', 'annual']), /金额非法/);
  assert.throws(() => parseExpenseAddArgs(['1e2', '小程序', '向云端实时海拔表', 'annual']), /金额非法/);
  assert.throws(() => parseExpenseAddArgs(['9007199254740991', '小程序', '向云端实时海拔表', 'annual']), /金额非法/);
  assert.throws(() => parseExpenseAddArgs(['30', '小程序', '向云端实时海拔表', 'weekly']), /周期非法/);
});

test('todayBeijing uses the Asia/Shanghai calendar day', () => {
  assert.equal(todayBeijing(new Date('2026-07-19T15:59:59Z')), '2026-07-19');
  assert.equal(todayBeijing(new Date('2026-07-19T16:00:00Z')), '2026-07-20');
});
