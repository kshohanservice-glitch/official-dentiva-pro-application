/** Billing: invoices + payments. All money is integer poisha; payments are immutable rows. */

import type { ServiceContext } from './context';
import { audit, requireUser } from './context';
import { ipcError } from '../ipc/dispatcher';
import { nextDateCode } from '../db/database';
import { presetRange, epochToDhakaDate, todayDhaka, dhakaDateToEpoch } from '@shared/datetime';
import { sumPoisha, applyPercentPoisha } from '@shared/money';
import type {
  InvoiceRecord,
  MethodBreakdownRow,
  Paged,
  PaymentMethod,
  PaymentRecord,
} from '@shared/types';

function mapInvoiceItems(sc: ServiceContext, invoiceId: number): InvoiceRecord['items'] {
  const rows = sc.db
    .prepare(
      `SELECT id, treatment_id, name, quantity, unit_price_poisha, discount_poisha, total_poisha
       FROM invoice_items WHERE invoice_id = ? ORDER BY seq`,
    )
    .all(invoiceId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    treatmentId: r.treatment_id as number | null,
    name: r.name as string,
    quantity: r.quantity as number,
    unitPricePoisha: r.unit_price_poisha as number,
    discountPoisha: r.discount_poisha as number,
    totalPoisha: r.total_poisha as number,
  }));
}

function paidFor(sc: ServiceContext, invoiceId: number): number {
  const row = sc.db
    .prepare(
      'SELECT COALESCE(SUM(amount_poisha), 0) AS paid FROM payments WHERE invoice_id = ? AND is_voided = 0',
    )
    .get(invoiceId) as { paid: number };
  return row.paid;
}

function mapInvoice(sc: ServiceContext, row: Record<string, unknown>): InvoiceRecord {
  const id = row.id as number;
  const total = row.total_poisha as number;
  const paid = paidFor(sc, id);
  const status = row.status as string;
  const derived =
    status === 'void'
      ? 'void'
      : paid <= 0
        ? 'unpaid'
        : paid >= total
          ? 'paid'
          : 'partial';
  const paymentRows = sc.db
    .prepare(
      `SELECT pay.*, p.full_name AS patient_name, p.patient_code, i.invoice_code
       FROM payments pay
       JOIN patients p ON p.id = pay.patient_id
       LEFT JOIN invoices i ON i.id = pay.invoice_id
       WHERE pay.invoice_id = ? ORDER BY pay.paid_at DESC`,
    )
    .all(id) as Record<string, unknown>[];
  return {
    id,
    invoiceCode: row.invoice_code as string,
    patientId: row.patient_id as number,
    patientName: row.patient_name as string,
    patientCode: row.patient_code as string,
    invoiceDate: row.invoice_date as string,
    items: mapInvoiceItems(sc, id),
    subtotalPoisha: row.subtotal_poisha as number,
    discountPoisha: row.discount_poisha as number,
    adjustmentPoisha: row.adjustment_poisha as number,
    totalPoisha: total,
    paidPoisha: paid,
    duePoisha: Math.max(0, total - paid),
    status: derived,
    notes: row.notes as string,
    createdAt: row.created_at as number,
    payments: paymentRows.map(mapPayment),
  };
}

function mapPayment(row: Record<string, unknown>): PaymentRecord {
  return {
    id: row.id as number,
    paymentCode: row.payment_code as string,
    patientId: row.patient_id as number,
    patientName: (row.patient_name as string) ?? '',
    patientCode: (row.patient_code as string) ?? '',
    invoiceId: row.invoice_id as number | null,
    invoiceCode: (row.invoice_code as string) ?? null,
    amountPoisha: row.amount_poisha as number,
    method: row.method as PaymentMethod,
    reference: row.reference as string,
    paidAt: row.paid_at as number,
    notes: row.notes as string,
    receivedBy: (row.received_by_name as string) ?? '',
    isVoided: row.is_voided === 1,
    voidReason: (row.void_reason as string) ?? '',
  };
}

const INV_SELECT = `
  SELECT i.*, p.full_name AS patient_name, p.patient_code
  FROM invoices i JOIN patients p ON p.id = i.patient_id`;

type ListInvoices = {
  search: string;
  status: 'unpaid' | 'partial' | 'paid' | 'all';
  preset: 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'all' | 'custom';
  from?: string;
  to?: string;
  patientId?: number;
  page: number;
  pageSize: number;
};

export function listInvoices(sc: ServiceContext, p: ListInvoices): Paged<InvoiceRecord> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.search.trim()) {
    where.push('(i.invoice_code LIKE ? OR p.full_name LIKE ? OR p.patient_code LIKE ?)');
    const like = `%${p.search.trim()}%`;
    args.push(like, like, like);
  }
  if (p.patientId) {
    where.push('i.patient_id = ?');
    args.push(p.patientId);
  }
  let range: { start: number; end: number } | null = null;
  if (p.preset === 'custom') {
    if (!p.from || !p.to) ipcError('VALIDATION', 'Custom range requires from and to dates.');
    range = { start: dhakaDateToEpoch(p.from), end: dhakaDateToEpoch(p.to) + 86_400_000 };
  } else if (p.preset !== 'all') {
    range = presetRange(p.preset);
  }
  if (range) {
    where.push('i.created_at >= ? AND i.created_at < ?');
    args.push(range.start, range.end);
  }
  // Derived status (void / unpaid / partial / paid from non-voided payments) filtered in SQL
  // so paging and totals are exact with no row caps.
  const paidSum = `(SELECT COALESCE(SUM(pay.amount_poisha), 0) FROM payments pay
                    WHERE pay.invoice_id = i.id AND pay.is_voided = 0)`;
  if (p.status === 'unpaid') {
    where.push(`i.status != 'void' AND (${paidSum}) <= 0`);
  } else if (p.status === 'paid') {
    where.push(`i.status != 'void' AND (${paidSum}) > 0 AND (${paidSum}) >= i.total_poisha`);
  } else if (p.status === 'partial') {
    where.push(`i.status != 'void' AND (${paidSum}) > 0 AND (${paidSum}) < i.total_poisha`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const joinSql = ' FROM invoices i JOIN patients p ON p.id = i.patient_id ';

  const total = (
    sc.db.prepare(`SELECT COUNT(*) AS n ${joinSql} ${whereSql}`).get(...args) as { n: number }
  ).n;
  const pageSize = Math.max(1, p.pageSize);
  const offset = (Math.max(1, p.page) - 1) * pageSize;
  const rows = sc.db
    .prepare(`${INV_SELECT} ${whereSql} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset) as Record<string, unknown>[];
  return {
    items: rows.map((r) => mapInvoice(sc, r)),
    total,
    page: p.page,
    pageSize,
  };
}

export function getInvoice(sc: ServiceContext, id: number): InvoiceRecord {
  const row = sc.db.prepare(`${INV_SELECT} WHERE i.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Invoice not found.');
  return mapInvoice(sc, row);
}

type CreateInvoice = {
  patientId: number;
  visitId: number | null;
  invoiceDate: string;
  adjustmentPoisha: number;
  notes: string;
  items: {
    treatmentId: number | null;
    name: string;
    quantity: number;
    unitPricePoisha: number;
    discountPoisha: number;
  }[];
  idempotencyKey: string;
};

export function createInvoice(sc: ServiceContext, p: CreateInvoice): InvoiceRecord {
  const user = requireUser(sc);
  if (p.items.length === 0) ipcError('VALIDATION', 'Add at least one line item.');

  // Idempotency: double-click protection returns the same invoice.
  const existingKey = sc.db
    .prepare('SELECT id FROM invoices WHERE idempotency_key = ?')
    .get(p.idempotencyKey) as { id: number } | undefined;
  if (existingKey) return getInvoice(sc, existingKey.id);

  // Integer math for all totals.
  let subtotal = 0;
  let totalDiscount = 0;
  const lineTotals: number[] = [];
  for (const it of p.items) {
    if (!Number.isSafeInteger(it.unitPricePoisha) || it.unitPricePoisha < 0) {
      ipcError('VALIDATION', 'Unit price must be a non-negative integer amount.');
    }
    if (!Number.isSafeInteger(it.quantity) || it.quantity < 1) {
      ipcError('VALIDATION', 'Quantity must be at least 1.');
    }
    if (!Number.isSafeInteger(it.discountPoisha) || it.discountPoisha < 0) {
      ipcError('VALIDATION', 'Discount must be a non-negative integer amount.');
    }
    const gross = it.unitPricePoisha * it.quantity;
    if (!Number.isSafeInteger(gross)) ipcError('VALIDATION', 'Line total is out of range.');
    if (it.discountPoisha > gross) ipcError('VALIDATION', 'Discount exceeds the line amount.');
    const net = gross - it.discountPoisha;
    subtotal += gross;
    totalDiscount += it.discountPoisha;
    lineTotals.push(net);
  }
  const linesNet = sumPoisha(lineTotals);
  if (!Number.isSafeInteger(p.adjustmentPoisha)) {
    ipcError('VALIDATION', 'Adjustment must be an integer amount.');
  }
  const total = linesNet + p.adjustmentPoisha;
  if (total < 0) ipcError('VALIDATION', 'Adjustment makes the total negative.');

  const patient = sc.db.prepare('SELECT id FROM patients WHERE id = ?').get(p.patientId);
  if (!patient) ipcError('NOT_FOUND', 'Patient not found.');

  const now = sc.now();
  const id = sc.db.transaction(() => {
    const compact = p.invoiceDate.replace(/-/g, '').slice(2);
    const code = nextDateCode(sc.db, 'invoice', 'INV-', compact);
    const info = sc.db
      .prepare(
        `INSERT INTO invoices
          (invoice_code, patient_id, visit_id, invoice_date, subtotal_poisha, discount_poisha,
           adjustment_poisha, total_poisha, status, notes, idempotency_key, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'unpaid', ?, ?, ?, ?, ?)`,
      )
      .run(
        code, p.patientId, p.visitId, p.invoiceDate, subtotal, totalDiscount,
        p.adjustmentPoisha, total, p.notes, p.idempotencyKey, user.id, now, now,
      );
    const invoiceId = Number(info.lastInsertRowid);
    const ins = sc.db.prepare(
      `INSERT INTO invoice_items
        (invoice_id, seq, treatment_id, name, quantity, unit_price_poisha, discount_poisha, total_poisha)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    p.items.forEach((it, idx) => {
      ins.run(
        invoiceId, idx + 1, it.treatmentId, it.name, it.quantity,
        it.unitPricePoisha, it.discountPoisha,
        it.unitPricePoisha * it.quantity - it.discountPoisha,
      );
    });
    return invoiceId;
  })();

  audit(sc, {
    action: 'invoice.create',
    entityType: 'invoice',
    entityId: id,
    summary: `Created invoice (${(total / 100).toFixed(2)} BDT)`,
  });
  return getInvoice(sc, id);
}

export function voidInvoice(
  sc: ServiceContext,
  p: { id: number; reason: string },
): InvoiceRecord {
  const inv = getInvoice(sc, p.id);
  if (inv.status === 'void') ipcError('CONFLICT', 'Invoice is already void.');
  if (inv.paidPoisha > 0) {
    ipcError(
      'CONFLICT',
      'This invoice has payments. Void the payments first, or leave the invoice as-is.',
    );
  }
  sc.db
    .prepare(`UPDATE invoices SET status = 'void', void_reason = ?, updated_at = ? WHERE id = ?`)
    .run(p.reason, sc.now(), p.id);
  audit(sc, {
    action: 'invoice.void',
    entityType: 'invoice',
    entityId: p.id,
    summary: 'Voided invoice',
    before: { status: inv.status },
    after: { status: 'void', reason: p.reason },
  });
  return getInvoice(sc, p.id);
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

function mapPaymentRow(sc: ServiceContext, row: Record<string, unknown>): PaymentRecord {
  const full = sc.db
    .prepare(
      `SELECT pay.*, p.full_name AS patient_name, p.patient_code, i.invoice_code,
              u.display_name AS received_by_name
       FROM payments pay
       JOIN patients p ON p.id = pay.patient_id
       LEFT JOIN invoices i ON i.id = pay.invoice_id
       LEFT JOIN users u ON u.id = pay.received_by
       WHERE pay.id = ?`,
    )
    .get(row.id) as Record<string, unknown>;
  return mapPayment(full);
}

type ListPayments = {
  preset: 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'all' | 'custom';
  from?: string;
  to?: string;
  method: PaymentMethod | 'all';
  patientId?: number;
  includeVoided: boolean;
  page: number;
  pageSize: number;
};

export function listPayments(sc: ServiceContext, p: ListPayments): Paged<PaymentRecord> {
  const range =
    p.preset === 'custom'
      ? p.from && p.to
        ? { start: dhakaDateToEpoch(p.from), end: dhakaDateToEpoch(p.to) + 86_400_000 }
        : null
      : presetRange(p.preset);
  const where: string[] = [];
  const args: unknown[] = [];
  if (range) {
    where.push('pay.paid_at >= ? AND pay.paid_at < ?');
    args.push(range.start, range.end);
  }
  if (p.method !== 'all') {
    where.push('pay.method = ?');
    args.push(p.method);
  }
  if (p.patientId) {
    where.push('pay.patient_id = ?');
    args.push(p.patientId);
  }
  if (!p.includeVoided) where.push('pay.is_voided = 0');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    sc.db.prepare(`SELECT COUNT(*) AS n FROM payments pay ${whereSql}`).get(...args) as {
      n: number;
    }
  ).n;
  const rows = sc.db
    .prepare(
      `SELECT pay.id FROM payments pay ${whereSql} ORDER BY pay.paid_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as { id: number }[];
  const items = rows.map(
    (r) =>
      sc.db
        .prepare(
          `SELECT pay.*, p.full_name AS patient_name, p.patient_code, i.invoice_code,
                  u.display_name AS received_by_name
           FROM payments pay
           JOIN patients p ON p.id = pay.patient_id
           LEFT JOIN invoices i ON i.id = pay.invoice_id
           LEFT JOIN users u ON u.id = pay.received_by
           WHERE pay.id = ?`,
        )
        .get(r.id) as Record<string, unknown>,
  ).map(mapPayment);

  return { items, total, page: p.page, pageSize: p.pageSize };
}

type CreatePayment = {
  patientId: number;
  invoiceId: number | null;
  amountPoisha: number;
  method: PaymentMethod;
  reference: string;
  paidAt?: number;
  notes: string;
  idempotencyKey: string;
};

export function createPayment(sc: ServiceContext, p: CreatePayment): PaymentRecord {
  const user = requireUser(sc);
  if (!Number.isSafeInteger(p.amountPoisha) || p.amountPoisha <= 0) {
    ipcError('VALIDATION', 'Payment amount must be a positive integer.');
  }

  const existingKey = sc.db
    .prepare('SELECT id FROM payments WHERE idempotency_key = ?')
    .get(p.idempotencyKey) as { id: number } | undefined;
  if (existingKey) {
    const row = sc.db
      .prepare('SELECT * FROM payments WHERE id = ?')
      .get(existingKey.id) as Record<string, unknown>;
    return mapPaymentRow(sc, row);
  }

  const paidAt = p.paidAt ?? sc.now();
  const now = sc.now();

  const id = sc.db.transaction(() => {
    if (p.invoiceId) {
      const inv = sc.db
        .prepare('SELECT id, status, total_poisha, patient_id FROM invoices WHERE id = ?')
        .get(p.invoiceId) as Record<string, unknown> | undefined;
      if (!inv) ipcError('NOT_FOUND', 'Invoice not found.');
      if (inv.status === 'void') ipcError('CONFLICT', 'Cannot pay a void invoice.');
      if (inv.patient_id !== p.patientId) {
        ipcError('VALIDATION', 'Invoice belongs to a different patient.');
      }
      const alreadyPaid = paidFor(sc, p.invoiceId);
      const total = inv.total_poisha as number;
      if (alreadyPaid >= total) {
        ipcError('CONFLICT', 'This invoice is already fully paid.');
      }
      if (alreadyPaid + p.amountPoisha > total) {
        ipcError(
          'CONFLICT',
          `Payment exceeds the outstanding balance of ৳${((total - alreadyPaid) / 100).toFixed(2)}.`,
        );
      }
    }
    const compact = epochToDhakaDate(paidAt).replace(/-/g, '').slice(2);
    const code = nextDateCode(sc.db, 'payment', 'PAY-', compact);
    const info = sc.db
      .prepare(
        `INSERT INTO payments
          (payment_code, patient_id, invoice_id, amount_poisha, method, reference, paid_at,
           notes, received_by, idempotency_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        code, p.patientId, p.invoiceId, p.amountPoisha, p.method, p.reference, paidAt,
        p.notes, user.id, p.idempotencyKey, now,
      );
    return Number(info.lastInsertRowid);
  })();

  audit(sc, {
    action: 'payment.create',
    entityType: 'payment',
    entityId: id,
    summary: `Recorded payment (${(p.amountPoisha / 100).toFixed(2)} BDT, ${p.method})`,
  });
  const row = sc.db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return mapPaymentRow(sc, row);
}

export function voidPayment(
  sc: ServiceContext,
  p: { id: number; reason: string },
): PaymentRecord {
  const row = sc.db.prepare('SELECT * FROM payments WHERE id = ?').get(p.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Payment not found.');
  if (row.is_voided === 1) ipcError('CONFLICT', 'Payment is already voided.');
  const now = sc.now();
  sc.db
    .prepare(
      `UPDATE payments SET is_voided = 1, void_reason = ?, voided_at = ?, voided_by = ? WHERE id = ?`,
    )
    .run(p.reason, now, sc.ctx.userId, p.id);
  audit(sc, {
    action: 'payment.void',
    entityType: 'payment',
    entityId: p.id,
    summary: 'Voided payment',
    before: { amountPoisha: row.amount_poisha },
    after: { reason: p.reason },
  });
  const updated = sc.db.prepare('SELECT * FROM payments WHERE id = ?').get(p.id) as Record<
    string,
    unknown
  >;
  return mapPaymentRow(sc, updated);
}

export function paymentSummary(
  sc: ServiceContext,
  p: {
    preset: 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'custom';
    from?: string;
    to?: string;
  },
): { totalPoisha: number; byMethod: MethodBreakdownRow[]; count: number } {
  const range =
    p.preset === 'custom'
      ? p.from && p.to
        ? { start: dhakaDateToEpoch(p.from), end: dhakaDateToEpoch(p.to) + 86_400_000 }
        : null
      : presetRange(p.preset);
  const where = ['is_voided = 0'];
  const args: unknown[] = [];
  if (range) {
    where.push('paid_at >= ? AND paid_at < ?');
    args.push(range.start, range.end);
  }
  const rows = sc.db
    .prepare(
      `SELECT method, SUM(amount_poisha) AS total, COUNT(*) AS n
       FROM payments WHERE ${where.join(' AND ')} GROUP BY method`,
    )
    .all(...args) as { method: PaymentMethod; total: number; n: number }[];
  const labels: Record<PaymentMethod, string> = {
    cash: 'Cash', bank: 'Bank Transfer', card: 'Card', bkash: 'bKash',
    nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay', other: 'Others',
  };
  const byMethod = rows.map((r) => ({
    method: r.method,
    label: labels[r.method],
    amountPoisha: r.total,
    count: r.n,
  }));
  return {
    totalPoisha: byMethod.reduce((s, m) => s + m.amountPoisha, 0),
    byMethod,
    count: byMethod.reduce((s, m) => s + m.count, 0),
  };
}

export { todayDhaka, applyPercentPoisha };
