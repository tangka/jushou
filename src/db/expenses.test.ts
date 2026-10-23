import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addExpense,
  closeExpenseDb,
  getExpenseAmortizedTotal,
  getExpenseDailyCents,
  getExpenseDays,
  getExpensePaymentDays,
  getExpenseSummary,
  getExpenses,
  reopenExpenseDb,
} from './expenses.js';

test('company expenses stay in one ledger and expose amortized daily cost', () => {
  const dbPath = path.join(os.tmpdir(), `woa-company-expenses-${process.pid}-${Date.now()}.db`);
  reopenExpenseDb(dbPath);
  try {
    assert.equal(
      addExpense({
        date: '2026-07-20',
        amountCents: 3000,
        category: '小程序',
        item: '向云端实时海拔表',
        period: 'annual',
        note: '年费',
      }),
      true
    );
    assert.equal(
      addExpense({
        date: '2026-07-20',
        amountCents: 3000,
        category: '小程序',
        item: '向云端实时海拔表',
        period: 'annual',
        note: '年费',
      }),
      false
    );
    addExpense({
      date: '2026-07-20',
      endDate: '2026-07-20',
      amountCents: 500,
      category: '云服务',
      item: '对象存储',
      period: 'monthly',
    });
    addExpense({
      date: '2026-07-19',
      amountCents: 1200,
      category: '素材',
      item: '字体',
      period: 'one-off',
    });

    assert.deepEqual(getExpenseSummary(), {
      totalCount: 3,
      totalCents: 4700,
      annualCount: 1,
      annualCents: 3000,
    });
    assert.equal(getExpenseDailyCents('2026-07-20'), 25);
    assert.equal(getExpenseDailyCents('2026-07-21'), 8);
    assert.equal(getExpenseAmortizedTotal('2026-07-21'), 1233);
    assert.deepEqual(getExpenseDays(3, '2026-07-21'), [
      { date: '2026-07-21', amount_cents: 8 },
      { date: '2026-07-20', amount_cents: 25 },
      { date: '2026-07-19', amount_cents: 1200 },
    ]);
    assert.deepEqual(getExpensePaymentDays(), [
      { date: '2026-07-20', amount_cents: 3500 },
      { date: '2026-07-19', amount_cents: 1200 },
    ]);
    assert.equal(
      getExpenses(3).some(item => item.item === '对象存储' && item.end_date === '2026-07-20'),
      true
    );
    assert.throws(
      () =>
        addExpense({
          date: '2026-07-20',
          amountCents: 0,
          category: '小程序',
          item: '非法支出',
          period: 'one-off',
        }),
      /正整数分/
    );
    assert.throws(
      () =>
        addExpense({
          date: '2026-07-20',
          endDate: '2026-07-19',
          amountCents: 100,
          category: 'AI服务',
          item: '非法区间',
          period: 'monthly',
        }),
      /不能早于/
    );
  } finally {
    closeExpenseDb();
  }
});
