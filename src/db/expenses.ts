import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config/index.js';

export type ExpensePeriod = 'one-off' | 'monthly' | 'annual';

export interface ExpenseInput {
  date: string;
  endDate?: string;
  amountCents: number;
  category: string;
  item: string;
  period: ExpensePeriod;
  note?: string;
}

export interface Expense {
  id: number;
  date: string;
  end_date: string | null;
  amount_cents: number;
  category: string;
  item: string;
  period: ExpensePeriod;
  note: string | null;
  created_at: number;
}

export interface ExpenseSummary {
  totalCount: number;
  totalCents: number;
  annualCount: number;
  annualCents: number;
}

export interface ExpenseDay {
  date: string;
  amount_cents: number;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const EXPENSE_SCHEMA = `
CREATE TABLE IF NOT EXISTS company_expenses (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'one-off',
  note TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  CHECK(amount_cents > 0),
  CHECK(period IN ('one-off', 'monthly', 'annual')),
  CHECK(date GLOB '????-??-??'),
  CHECK(length(trim(category)) > 0),
  CHECK(length(trim(item)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_company_expenses_date ON company_expenses(date);
`;

let instance: DatabaseSync | null = null;
let activeDbPath = config.companyDbPath;

function getExpenseDb(): DatabaseSync {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(activeDbPath), { recursive: true });
  instance = new DatabaseSync(activeDbPath);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec(EXPENSE_SCHEMA);
  const columns = instance.prepare('PRAGMA table_info(company_expenses)').all() as unknown as { name: string }[];
  if (!columns.some(column => column.name === 'end_date')) {
    instance.exec('ALTER TABLE company_expenses ADD COLUMN end_date TEXT');
  }
  return instance;
}

export function reopenExpenseDb(dbPath = config.companyDbPath): void {
  if (instance) {
    try {
      instance.close();
    } catch {
      // 已关闭则忽略。
    }
  }
  instance = null;
  activeDbPath = dbPath;
}

export function closeExpenseDb(): void {
  if (instance) {
    try {
      instance.close();
    } catch {
      // 已关闭则忽略。
    }
  }
  instance = null;
}

function normalizeExpenseInput(input: ExpenseInput): ExpenseInput {
  const date = input.date.trim();
  const endDate = input.endDate?.trim() || undefined;
  const category = input.category.trim();
  const item = input.item.trim();
  const note = input.note?.trim() || undefined;
  if (!ISO_DATE_RE.test(date)) throw new Error(`支出日期非法:${input.date}`);
  if (endDate && !ISO_DATE_RE.test(endDate)) throw new Error(`支出结束日期非法:${input.endDate}`);
  if (endDate && endDate < date) throw new Error(`支出结束日期不能早于开始日期:${endDate}`);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error(`支出金额必须是正整数分:${input.amountCents}`);
  }
  if (!category) throw new Error('支出类别不能为空');
  if (!item) throw new Error('支出项目名不能为空');
  if (!['one-off', 'monthly', 'annual'].includes(input.period)) throw new Error(`支出周期非法:${input.period}`);
  return { ...input, date, endDate, category, item, note };
}

function expenseFingerprint(input: ExpenseInput): string {
  const fields = input.endDate
    ? [input.date, input.endDate, input.amountCents, input.category, input.item, input.period, input.note ?? '']
    : [input.date, input.amountCents, input.category, input.item, input.period, input.note ?? ''];
  return createHash('sha256').update(fields.join('\u001f')).digest('hex');
}

/** 返回 true=新增；false=相同支出已存在，保持幂等。 */
export function addExpense(input: ExpenseInput): boolean {
  const normalized = normalizeExpenseInput(input);
  const result = getExpenseDb()
    .prepare(`
      INSERT INTO company_expenses
        (date, end_date, amount_cents, category, item, period, note, fingerprint, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO NOTHING
    `)
    .run(
      normalized.date,
      normalized.endDate ?? null,
      normalized.amountCents,
      normalized.category,
      normalized.item,
      normalized.period,
      normalized.note ?? null,
      expenseFingerprint(normalized),
      Math.floor(Date.now() / 1000)
    );
  return Number(result.changes) > 0;
}

export function getExpenses(limit = 50): Expense[] {
  const rows = getExpenseDb()
    .prepare(`
      SELECT id, date, end_date, amount_cents, category, item, period, note, created_at
      FROM company_expenses
      ORDER BY date DESC, created_at DESC, id DESC
      LIMIT ?
    `)
    .all(limit) as unknown as Expense[];
  return rows.map(row => ({ ...row }));
}

export function getExpenseSummary(): ExpenseSummary {
  const row = getExpenseDb()
    .prepare(`
      SELECT
        COUNT(*) AS totalCount,
        COALESCE(SUM(amount_cents), 0) AS totalCents,
        COALESCE(SUM(CASE WHEN period = 'annual' THEN 1 ELSE 0 END), 0) AS annualCount,
        COALESCE(SUM(CASE WHEN period = 'annual' THEN amount_cents ELSE 0 END), 0) AS annualCents
      FROM company_expenses
    `)
    .get() as unknown as ExpenseSummary;
  return {
    totalCount: Number(row.totalCount),
    totalCents: Number(row.totalCents),
    annualCount: Number(row.annualCount),
    annualCents: Number(row.annualCents),
  };
}

function todayBeijing(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function utcDay(date: string): Date {
  if (!ISO_DATE_RE.test(date)) throw new Error(`支出日期非法:${date}`);
  return new Date(`${date}T00:00:00Z`);
}

function offsetDate(date: string, days: number): string {
  return new Date(utcDay(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function recurringDailyCents(expense: Expense): number {
  if (expense.period === 'monthly') return Math.round(expense.amount_cents / 30);
  if (expense.period === 'annual') return Math.round(expense.amount_cents / 365);
  return 0;
}

function expenseIsActive(expense: Expense, date: string): boolean {
  return expense.date <= date && (!expense.end_date || expense.end_date >= date);
}

function expenseRowsThrough(endDate: string): Expense[] {
  return (
    getExpenseDb()
      .prepare(`
        SELECT id, date, end_date, amount_cents, category, item, period, note, created_at
        FROM company_expenses
        WHERE date <= ?
        ORDER BY date ASC, created_at ASC, id ASC
      `)
      .all(endDate) as unknown as Expense[]
  ).map(row => ({ ...row, amount_cents: Number(row.amount_cents) }));
}

export function getExpenseDailyCents(date: string): number {
  return expenseRowsThrough(date).reduce((sum, expense) => {
    if (!expenseIsActive(expense, date)) return sum;
    if (expense.period === 'one-off') {
      return sum + (expense.date === date ? expense.amount_cents : 0);
    }
    return sum + recurringDailyCents(expense);
  }, 0);
}

export function getExpenseAmortizedTotal(endDate = todayBeijing()): number {
  const expenses = expenseRowsThrough(endDate);
  if (expenses.length === 0) return 0;
  const firstDate = expenses[0]?.date;
  if (!firstDate) return 0;

  let totalCents = 0;
  for (let date = firstDate; date <= endDate; date = offsetDate(date, 1)) {
    totalCents += expenses.reduce((sum, expense) => {
      if (!expenseIsActive(expense, date)) return sum;
      if (expense.period === 'one-off') return sum + (expense.date === date ? expense.amount_cents : 0);
      return sum + recurringDailyCents(expense);
    }, 0);
  }
  return totalCents;
}

/** null 返回全部历史日摊，供完整曲线同步使用。 */
export function getExpenseDays(limit: number | null = 90, endDate = todayBeijing()): ExpenseDay[] {
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) throw new Error(`支出天数非法:${limit}`);
  const expenses = expenseRowsThrough(endDate);
  if (expenses.length === 0) return [];
  const firstDate = expenses[0]?.date;
  if (!firstDate) return [];
  const startDate = limit === null ? firstDate : [firstDate, offsetDate(endDate, -(limit - 1))].sort().at(-1);
  if (!startDate) return [];

  const days: ExpenseDay[] = [];
  for (let date = startDate; date <= endDate; date = offsetDate(date, 1)) {
    const amountCents = expenses.reduce((sum, expense) => {
      if (!expenseIsActive(expense, date)) return sum;
      if (expense.period === 'one-off') return sum + (expense.date === date ? expense.amount_cents : 0);
      return sum + recurringDailyCents(expense);
    }, 0);
    if (amountCents > 0) days.push({ date, amount_cents: amountCents });
  }
  return days.reverse();
}

export function getExpensePaymentDays(limit = 90): ExpenseDay[] {
  const rows = getExpenseDb()
    .prepare(`
      SELECT date, COALESCE(SUM(amount_cents), 0) AS amount_cents
      FROM company_expenses
      GROUP BY date
      ORDER BY date DESC
      LIMIT ?
    `)
    .all(limit) as unknown as ExpenseDay[];
  return rows.map(row => ({ date: row.date, amount_cents: Number(row.amount_cents) }));
}
