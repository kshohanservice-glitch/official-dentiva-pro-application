/** Accounting: expense categories, expenses, other income, report aggregations. */

import type { ServiceContext } from './context';
import { audit } from './context';
import { ipcError } from '../ipc/dispatcher';
import { presetRange, dhakaDateToEpoch } from '@shared/datetime';
import type {
  CategorySpendRow,
  DailyRevenueRow,
  ExpenseCategoryRecord,
  ExpenseRecord,
  MethodBreakdownRow,
  OtherIncomeRecord,
  Paged,
  PaymentMethod,
  ReportSummary,
} from '@shared/types';

type RangeSpec = {
  preset: 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'custom';
  from?: string;
  to?: string;
};

function resolveRange(p: RangeSpec): { start: number; end: number } {
  if (p.preset === 'custom') {
    if (!p.from || !p.to) ipcError('VALIDATION', 'Custom range requires from and to dates.');
    return { start: dhakaDateToEpoch(p.from), end: dhakaDateToEpoch(p.to) + 86_400_000 };
  }
  const range = presetRange(p.preset);
  if (!range) ipcError('VALIDATION', 'Invalid date range.');
  return range;
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

function mapCategory(r: Record<string, unknown>): ExpenseCategoryRecord {
  return {
    id: r.id as number,
    name: r.name as string,
    isBuiltIn: r.is_builtin === 1,
    isActive: r.is_active === 1,
  };
}

export function listCategories(sc: ServiceContext): ExpenseCategoryRecord[] {
  const rows = sc.db
    .prepare('SELECT * FROM expense_categories ORDER BY name COLLATE NOCASE')
    .all() as Record<string, unknown>[];
  return rows.map(mapCategory);
}

export function saveCategory(
  sc: ServiceContext,
  p: { id: number | null; name: string; isActive: boolean },
): ExpenseCategoryRecord {
  if (!p.name.trim()) ipcError('VALIDATION', 'Category name is required.');
  const id = sc.db.transaction(() => {
    if (p.id) {
      const exists = sc.db.prepare('SELECT id FROM expense_categories WHERE id = ?').get(p.id);
      if (!exists) ipcError('NOT_FOUND', 'Category not found.');
      sc.db
        .prepare('UPDATE expense_categories SET name = ?, is_active = ? WHERE id = ?')
        .run(p.name.trim(), p.isActive ? 1 : 0, p.id);
      return p.id;
    }
    const dup = sc.db
      .prepare('SELECT id FROM expense_categories WHERE name = ? COLLATE NOCASE')
      .get(p.name.trim());
    if (dup) ipcError('CONFLICT', 'That category already exists.');
    const info = sc.db
      .prepare('INSERT INTO expense_categories (name, is_builtin, is_active) VALUES (?, 0, ?)')
      .run(p.name.trim(), p.isActive ? 1 : 0);
    return Number(info.lastInsertRowid);
  })();
  audit(sc, {
    action: p.id ? 'expense_category.update' : 'expense_category.create',
    entityType: 'expense_category',
    entityId: id,
    summary: `Saved expense category ${p.name}`,
  });
  const row = sc.db
    .prepare('SELECT * FROM expense_categories WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return mapCategory(row);
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

function mapExpense(sc: ServiceContext, r: Record<string, unknown>): ExpenseRecord {
  const enteredBy = (r.entered_by as number | null) ?? null;
  const name = enteredBy
    ? ((sc.db.prepare('SELECT username FROM users WHERE id = ?').get(enteredBy) as
        | { username: string }
        | undefined)?.username ?? '')
    : '';
  return {
    id: r.id as number,
    categoryId: r.category_id as number,
    categoryName: (r.category_name as string) ?? '',
    amountPoisha: r.amount_poisha as number,
    spentOn: r.spent_on as string,
    method: r.method as PaymentMethod,
    description: (r.description as string) ?? '',
    enteredBy: name,
    createdAt: r.created_at as number,
  };
}

export function listExpenses(
  sc: ServiceContext,
  p: RangeSpec & { categoryId?: number; page: number; pageSize: number },
): Paged<ExpenseRecord> {
  const range = resolveRange(p);
  const where = ['e.created_at >= ?', 'e.created_at < ?'];
  const args: unknown[] = [range.start, range.end];
  if (p.categoryId) {
    where.push('e.category_id = ?');
    args.push(p.categoryId);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = (
    sc.db.prepare(`SELECT COUNT(*) AS n FROM expenses e ${whereSql}`).get(...args) as { n: number }
  ).n;
  const rows = sc.db
    .prepare(
      `SELECT e.*, c.name AS category_name FROM expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       ${whereSql} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as Record<string, unknown>[];
  return { items: rows.map((r) => mapExpense(sc, r)), total, page: p.page, pageSize: p.pageSize };
}

export type ExpenseSave = {
  id: number | null;
  categoryId: number;
  amountPoisha: number;
  spentOn: string;
  method: PaymentMethod;
  description: string;
};

export function saveExpense(sc: ServiceContext, p: ExpenseSave): ExpenseRecord {
  if (!Number.isSafeInteger(p.amountPoisha) || p.amountPoisha <= 0) {
    ipcError('VALIDATION', 'Amount must be a positive integer.');
  }
  const id = sc.db.transaction(() => {
    if (p.id) {
      const exists = sc.db.prepare('SELECT id FROM expenses WHERE id = ?').get(p.id);
      if (!exists) ipcError('NOT_FOUND', 'Expense not found.');
      sc.db
        .prepare(
          'UPDATE expenses SET category_id=?, amount_poisha=?, spent_on=?, method=?, description=? WHERE id=?',
        )
        .run(p.categoryId, p.amountPoisha, p.spentOn, p.method, p.description, p.id);
      return p.id;
    }
    const cat = sc.db.prepare('SELECT id FROM expense_categories WHERE id = ?').get(p.categoryId);
    if (!cat) ipcError('NOT_FOUND', 'Expense category not found.');
    const info = sc.db
      .prepare(
        `INSERT INTO expenses (category_id, amount_poisha, spent_on, method, description, entered_by, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(p.categoryId, p.amountPoisha, p.spentOn, p.method, p.description, sc.ctx.userId, sc.now());
    return Number(info.lastInsertRowid);
  })();
  audit(sc, {
    action: p.id ? 'expense.update' : 'expense.create',
    entityType: 'expense',
    entityId: id,
    summary: `Recorded expense (${(p.amountPoisha / 100).toFixed(2)} BDT)`,
  });
  const row = sc.db
    .prepare(
      `SELECT e.*, c.name AS category_name FROM expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id WHERE e.id = ?`,
    )
    .get(id) as Record<string, unknown>;
  return mapExpense(sc, row);
}

/* ------------------------------------------------------------------ */
/* Other income                                                        */
/* ------------------------------------------------------------------ */

function mapOtherIncome(sc: ServiceContext, r: Record<string, unknown>): OtherIncomeRecord {
  const enteredBy = (r.entered_by as number | null) ?? null;
  const name = enteredBy
    ? ((sc.db.prepare('SELECT username FROM users WHERE id = ?').get(enteredBy) as
        | { username: string }
        | undefined)?.username ?? '')
    : '';
  return {
    id: r.id as number,
    title: r.title as string,
    amountPoisha: r.amount_poisha as number,
    receivedOn: r.received_on as string,
    method: r.method as PaymentMethod,
    notes: (r.notes as string) ?? '',
    enteredBy: name,
    createdAt: r.created_at as number,
  };
}

export function listOtherIncome(
  sc: ServiceContext,
  p: RangeSpec & { page: number; pageSize: number },
): Paged<OtherIncomeRecord> {
  const range = resolveRange(p);
  const total = (
    sc.db
      .prepare('SELECT COUNT(*) AS n FROM other_income WHERE created_at >= ? AND created_at < ?')
      .get(range.start, range.end) as { n: number }
  ).n;
  const rows = sc.db
    .prepare(
      `SELECT * FROM other_income WHERE created_at >= ? AND created_at < ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(range.start, range.end, p.pageSize, (p.page - 1) * p.pageSize) as Record<string, unknown>[];
  return {
    items: rows.map((r) => mapOtherIncome(sc, r)),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export type OtherIncomeSave = {
  id: number | null;
  title: string;
  amountPoisha: number;
  receivedOn: string;
  method: PaymentMethod;
  notes: string;
};

export function saveOtherIncome(sc: ServiceContext, p: OtherIncomeSave): OtherIncomeRecord {
  if (!Number.isSafeInteger(p.amountPoisha) || p.amountPoisha <= 0) {
    ipcError('VALIDATION', 'Amount must be a positive integer.');
  }
  const id = sc.db.transaction(() => {
    if (p.id) {
      const exists = sc.db.prepare('SELECT id FROM other_income WHERE id = ?').get(p.id);
      if (!exists) ipcError('NOT_FOUND', 'Entry not found.');
      sc.db
        .prepare(
          'UPDATE other_income SET title=?, amount_poisha=?, received_on=?, method=?, notes=? WHERE id=?',
        )
        .run(p.title, p.amountPoisha, p.receivedOn, p.method, p.notes, p.id);
      return p.id;
    }
    const info = sc.db
      .prepare(
        `INSERT INTO other_income (title, amount_poisha, received_on, method, notes, entered_by, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(p.title, p.amountPoisha, p.receivedOn, p.method, p.notes, sc.ctx.userId, sc.now());
    return Number(info.lastInsertRowid);
  })();
  audit(sc, {
    action: p.id ? 'other_income.update' : 'other_income.create',
    entityType: 'other_income',
    entityId: id,
    summary: `Recorded other income "${p.title}" (${(p.amountPoisha / 100).toFixed(2)} BDT)`,
  });
  const row = sc.db.prepare('SELECT * FROM other_income WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return mapOtherIncome(sc, row);
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export function reportSummary(sc: ServiceContext, p: RangeSpec): ReportSummary {
  const r = resolveRange(p);
  const collected = (
    sc.db
      .prepare(
        `SELECT COALESCE(SUM(amount_poisha), 0) AS total FROM payments
         WHERE is_voided = 0 AND paid_at >= ? AND paid_at < ?`,
      )
      .get(r.start, r.end) as { total: number }
  ).total;
  const billed = (
    sc.db
      .prepare(
        `SELECT COALESCE(SUM(total_poisha), 0) AS total FROM invoices
         WHERE status != 'void' AND created_at >= ? AND created_at < ?`,
      )
      .get(r.start, r.end) as { total: number }
  ).total;
  const outstanding = (
    sc.db
      .prepare(
        `SELECT COALESCE(SUM(i.total_poisha - COALESCE(p.paid, 0)), 0) AS total
         FROM invoices i
         LEFT JOIN (
           SELECT invoice_id, SUM(amount_poisha) AS paid FROM payments
           WHERE is_voided = 0 GROUP BY invoice_id
         ) p ON p.invoice_id = i.id
         WHERE i.status != 'void' AND i.created_at >= ? AND i.created_at < ?
           AND (i.total_poisha - COALESCE(p.paid, 0)) > 0`,
      )
      .get(r.start, r.end) as { total: number }
  ).total;
  const expenses = (
    sc.db
      .prepare(
        'SELECT COALESCE(SUM(amount_poisha), 0) AS total FROM expenses WHERE created_at >= ? AND created_at < ?',
      )
      .get(r.start, r.end) as { total: number }
  ).total;
  const otherIncome = (
    sc.db
      .prepare(
        'SELECT COALESCE(SUM(amount_poisha), 0) AS total FROM other_income WHERE created_at >= ? AND created_at < ?',
      )
      .get(r.start, r.end) as { total: number }
  ).total;
  return {
    billedPoisha: billed,
    collectedPoisha: collected,
    outstandingPoisha: outstanding,
    expensePoisha: expenses,
    otherIncomePoisha: otherIncome,
    netPoisha: collected + otherIncome - expenses,
  };
}

export function dailyRevenue(sc: ServiceContext, p: { from: string; to: string }): DailyRevenueRow[] {
  const start = dhakaDateToEpoch(p.from);
  const end = dhakaDateToEpoch(p.to) + 86_400_000;
  const rows = sc.db
    .prepare(
      `SELECT paid_at, SUM(amount_poisha) AS total, COUNT(*) AS n FROM payments
       WHERE is_voided = 0 AND paid_at >= ? AND paid_at < ? GROUP BY paid_at ORDER BY paid_at`,
    )
    .all(start, end) as { paid_at: number; total: number; n: number }[];
  return rows.map((r) => ({
    date: dayKey(r.paid_at),
    amountPoisha: r.total,
    count: r.n,
  }));
}

export function methodBreakdown(sc: ServiceContext, p: RangeSpec): MethodBreakdownRow[] {
  const r = resolveRange(p);
  const rows = sc.db
    .prepare(
      `SELECT method, SUM(amount_poisha) AS total, COUNT(*) AS n FROM payments
       WHERE is_voided = 0 AND paid_at >= ? AND paid_at < ? GROUP BY method`,
    )
    .all(r.start, r.end) as { method: PaymentMethod; total: number; n: number }[];
  const labels: Record<PaymentMethod, string> = {
    cash: 'Cash',
    bank: 'Bank Transfer',
    card: 'Card',
    bkash: 'bKash',
    nagad: 'Nagad',
    rocket: 'Rocket',
    upay: 'Upay',
    other: 'Others',
  };
  return rows.map((row) => ({
    method: row.method,
    label: labels[row.method],
    amountPoisha: row.total,
    count: row.n,
  }));
}

export function expensesByCategory(
  sc: ServiceContext,
  p: { from: string; to: string },
): CategorySpendRow[] {
  const start = dhakaDateToEpoch(p.from);
  const end = dhakaDateToEpoch(p.to) + 86_400_000;
  const rows = sc.db
    .prepare(
      `SELECT c.name AS category, COALESCE(SUM(e.amount_poisha), 0) AS total
       FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
       WHERE e.created_at >= ? AND e.created_at < ?
       GROUP BY e.category_id ORDER BY total DESC`,
    )
    .all(start, end) as { category: string | null; total: number }[];
  return rows.map((r) => ({ category: r.category ?? 'Uncategorized', amountPoisha: r.total }));
}

export function treatmentRevenue(
  sc: ServiceContext,
  p: { from: string; to: string },
): CategorySpendRow[] {
  const start = dhakaDateToEpoch(p.from);
  const end = dhakaDateToEpoch(p.to) + 86_400_000;
  const rows = sc.db
    .prepare(
      `SELECT COALESCE(t.category, 'Other') AS category,
              SUM(ii.total_poisha) AS total
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN treatments t ON t.id = ii.treatment_id
       WHERE i.status != 'void' AND i.created_at >= ? AND i.created_at < ?
       GROUP BY COALESCE(t.category, 'Other') ORDER BY total DESC`,
    )
    .all(start, end) as { category: string; total: number }[];
  return rows.map((r) => ({ category: r.category, amountPoisha: r.total }));
}

function dayKey(ms: number): string {
  const dhaka = new Date(ms + 6 * 3600_000);
  return dhaka.toISOString().slice(0, 10);
}
