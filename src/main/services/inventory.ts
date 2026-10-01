/** Inventory: items, suppliers, transactions — schema-aligned (derived current stock). */

import type { ServiceContext } from './context';
import { audit } from './context';
import { ipcError } from '../ipc/dispatcher';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  InventoryItemRecord,
  InventoryTransaction,
  Paged,
  SupplierRecord,
} from '@shared/types';

const ITEM_SELECT = `
  SELECT i.*, s.name AS supplier_name,
         (i.opening_stock + i.received_qty - i.used_qty) AS current_stock
  FROM inventory_items i
  LEFT JOIN suppliers s ON s.id = i.supplier_id`;

function mapItem(r: Record<string, unknown>): InventoryItemRecord {
  return {
    id: r.id as number,
    sku: r.sku as string,
    name: r.name as string,
    category: r.category as string,
    unit: r.unit as string,
    supplierId: (r.supplier_id as number | null) ?? null,
    supplierName: (r.supplier_name as string | null) ?? null,
    purchasePricePoisha: r.purchase_price_poisha as number,
    salePricePoisha: r.sale_price_poisha as number,
    openingStock: r.opening_stock as number,
    receivedQty: r.received_qty as number,
    usedQty: r.used_qty as number,
    currentStock: (r.current_stock as number) ?? 0,
    reorderLevel: r.reorder_level as number,
    expiryDate: (r.expiry_date as string | null) ?? null,
    batchNumber: (r.batch_number as string) ?? '',
    isActive: r.is_active === 1,
    notes: (r.notes as string) ?? '',
  };
}

export function getItem(sc: ServiceContext, id: number): InventoryItemRecord {
  const row = sc.db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Inventory item not found.');
  return mapItem(row);
}

export function listItems(
  sc: ServiceContext,
  p: {
    search: string;
    category: string;
    lowStockOnly: boolean;
    includeInactive: boolean;
    page: number;
    pageSize: number;
  },
): Paged<InventoryItemRecord> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (!p.includeInactive) where.push('i.is_active = 1');
  if (p.search.trim()) {
    where.push('(i.name LIKE ? OR i.sku LIKE ?)');
    const like = `%${p.search.trim()}%`;
    args.push(like, like);
  }
  if (p.category !== 'all') {
    where.push('i.category = ?');
    args.push(p.category);
  }
  if (p.lowStockOnly) {
    where.push('(i.opening_stock + i.received_qty - i.used_qty) <= i.reorder_level');
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    sc.db.prepare(`SELECT COUNT(*) AS n FROM inventory_items i ${whereSql}`).get(...args) as {
      n: number;
    }
  ).n;
  const rows = sc.db
    .prepare(`${ITEM_SELECT} ${whereSql} ORDER BY i.name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as Record<string, unknown>[];
  return { items: rows.map(mapItem), total, page: p.page, pageSize: p.pageSize };
}

export function stockAlerts(sc: ServiceContext): {
  lowStock: InventoryItemRecord[];
  expiring: InventoryItemRecord[];
  expired: InventoryItemRecord[];
} {
  const today = todayIso();
  const soon = isoPlusDays(30);
  const low = sc.db
    .prepare(
      `${ITEM_SELECT} WHERE i.is_active = 1
         AND (i.opening_stock + i.received_qty - i.used_qty) <= i.reorder_level
       ORDER BY (i.opening_stock + i.received_qty - i.used_qty) ASC`,
    )
    .all() as Record<string, unknown>[];
  const expiring = sc.db
    .prepare(
      `${ITEM_SELECT} WHERE i.is_active = 1 AND i.expiry_date IS NOT NULL
         AND i.expiry_date >= ? AND i.expiry_date <= ?
       ORDER BY i.expiry_date`,
    )
    .all(today, soon) as Record<string, unknown>[];
  const expired = sc.db
    .prepare(
      `${ITEM_SELECT} WHERE i.is_active = 1 AND i.expiry_date IS NOT NULL AND i.expiry_date < ?
       ORDER BY i.expiry_date`,
    )
    .all(today) as Record<string, unknown>[];
  return {
    lowStock: low.map(mapItem),
    expiring: expiring.map(mapItem),
    expired: expired.map(mapItem),
  };
}

function todayIso(): string {
  return new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
}

function isoPlusDays(days: number): string {
  return new Date(Date.now() + (days + 6) * 86_400_000).toISOString().slice(0, 10);
}

export type ItemSave = {
  id: number | null;
  sku: string;
  name: string;
  category: string;
  unit: string;
  supplierId: number | null;
  purchasePricePoisha: number;
  salePricePoisha: number;
  reorderLevel: number;
  expiryDate: string | null;
  batchNumber: string;
  isActive: boolean;
  notes: string;
};

export function saveItem(sc: ServiceContext, p: ItemSave): InventoryItemRecord {
  if (!Number.isSafeInteger(p.purchasePricePoisha) || p.purchasePricePoisha < 0) {
    ipcError('VALIDATION', 'Purchase price must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(p.salePricePoisha) || p.salePricePoisha < 0) {
    ipcError('VALIDATION', 'Sale price must be a non-negative integer.');
  }
  const now = sc.now();
  const id = sc.db.transaction(() => {
    if (p.id) {
      const exists = sc.db.prepare('SELECT id FROM inventory_items WHERE id = ?').get(p.id);
      if (!exists) ipcError('NOT_FOUND', 'Inventory item not found.');
      const dup = sc.db
        .prepare('SELECT id FROM inventory_items WHERE sku = ? COLLATE NOCASE AND id != ?')
        .get(p.sku, p.id);
      if (dup) ipcError('CONFLICT', 'Another item already uses that SKU.');
      sc.db
        .prepare(
          `UPDATE inventory_items SET sku=?, name=?, category=?, unit=?, supplier_id=?,
                  purchase_price_poisha=?, sale_price_poisha=?, reorder_level=?, expiry_date=?,
                  batch_number=?, is_active=?, notes=?, updated_at=? WHERE id=?`,
        )
        .run(
          p.sku, p.name, p.category, p.unit, p.supplierId,
          p.purchasePricePoisha, p.salePricePoisha, p.reorderLevel, p.expiryDate,
          p.batchNumber, p.isActive ? 1 : 0, p.notes, now, p.id,
        );
      return p.id;
    }
    const dup = sc.db.prepare('SELECT id FROM inventory_items WHERE sku = ? COLLATE NOCASE').get(p.sku);
    if (dup) ipcError('CONFLICT', 'Another item already uses that SKU.');
    const info = sc.db
      .prepare(
        `INSERT INTO inventory_items (sku, name, category, unit, supplier_id, purchase_price_poisha,
            sale_price_poisha, opening_stock, received_qty, used_qty, reorder_level, expiry_date,
            batch_number, is_active, notes, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?,?)`,
      )
      .run(
        p.sku, p.name, p.category, p.unit, p.supplierId,
        p.purchasePricePoisha, p.salePricePoisha, p.reorderLevel, p.expiryDate,
        p.batchNumber, p.isActive ? 1 : 0, p.notes, now, now,
      );
    return Number(info.lastInsertRowid);
  })();
  audit(sc, {
    action: p.id ? 'inventory.save' : 'inventory.create',
    entityType: 'inventory_item',
    entityId: id,
    summary: `${p.id ? 'Updated' : 'Created'} inventory item: ${p.name}`,
  });
  return getItem(sc, id);
}

export type AdjustParams = {
  itemId: number;
  type: 'purchase' | 'usage' | 'adjustment' | 'wastage' | 'return';
  quantity: number; // signed: positive increases stock, negative decreases
  unitPricePoisha: number | null;
  reference: string;
  note: string;
};

export function adjustStock(sc: ServiceContext, p: AdjustParams): InventoryItemRecord {
  if (p.quantity === 0) ipcError('VALIDATION', 'Quantity cannot be zero.');
  const delta = p.quantity;
  const now = sc.now();
  sc.db.transaction(() => {
    const item = sc.db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(p.itemId) as
      | Record<string, unknown>
      | undefined;
    if (!item || item.is_active !== 1) ipcError('NOT_FOUND', 'Inventory item not found.');
    const current =
      (item.opening_stock as number) + (item.received_qty as number) - (item.used_qty as number);
    if (current + delta < 0) {
      ipcError('CONFLICT', `Only ${current} in stock; cannot remove ${Math.abs(delta)}.`);
    }
    if (delta >= 0) {
      sc.db
        .prepare('UPDATE inventory_items SET received_qty = received_qty + ?, updated_at = ? WHERE id = ?')
        .run(delta, now, p.itemId);
    } else {
      sc.db
        .prepare('UPDATE inventory_items SET used_qty = used_qty + ?, updated_at = ? WHERE id = ?')
        .run(-delta, now, p.itemId);
    }
    sc.db
      .prepare(
        `INSERT INTO inventory_transactions (item_id, type, quantity, unit_price_poisha, reference, note, performed_by, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(p.itemId, p.type, delta, p.unitPricePoisha, p.reference, p.note, sc.ctx.userId, now);
  })();
  audit(sc, {
    action: 'inventory.adjust',
    entityType: 'inventory_item',
    entityId: p.itemId,
    summary: `Stock ${p.type}: ${p.quantity > 0 ? '+' : ''}${p.quantity}`,
  });
  return getItem(sc, p.itemId);
}

export function listTransactions(
  sc: ServiceContext,
  p: { itemId: number; page: number; pageSize: number },
): Paged<InventoryTransaction> {
  const total = (
    sc.db.prepare('SELECT COUNT(*) AS n FROM inventory_transactions WHERE item_id = ?').get(p.itemId) as {
      n: number;
    }
  ).n;
  const rows = sc.db
    .prepare(
      `SELECT t.*, i.name AS item_name, u.username AS performed_by_name
       FROM inventory_transactions t
       JOIN inventory_items i ON i.id = t.item_id
       LEFT JOIN users u ON u.id = t.performed_by
       WHERE t.item_id = ? ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(p.itemId, p.pageSize, (p.page - 1) * p.pageSize) as Record<string, unknown>[];
  return {
    items: rows.map((r) => ({
      id: r.id as number,
      itemId: r.item_id as number,
      itemName: r.item_name as string,
      type: r.type as InventoryTransaction['type'],
      quantity: r.quantity as number,
      unitPricePoisha: (r.unit_price_poisha as number | null) ?? null,
      reference: (r.reference as string) ?? '',
      note: (r.note as string) ?? '',
      performedBy: (r.performed_by_name as string) ?? 'system',
      createdAt: r.created_at as number,
    })),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export function exportCsv(sc: ServiceContext): { path: string; count: number } {
  const rows = sc.db
    .prepare(`${ITEM_SELECT} WHERE i.is_active = 1 ORDER BY i.name COLLATE NOCASE`)
    .all() as Record<string, unknown>[];
  const dir = join(sc.userDataDir, 'exports');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `inventory-${Date.now()}.csv`);
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    'sku', 'name', 'category', 'unit', 'supplier', 'purchase_price_poisha',
    'sale_price_poisha', 'current_stock', 'reorder_level', 'expiry_date', 'batch_number',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.sku, r.name, r.category, r.unit, r.supplier_name, r.purchase_price_poisha,
        r.sale_price_poisha, r.current_stock, r.reorder_level, r.expiry_date, r.batch_number,
      ]
        .map(esc)
        .join(','),
    );
  }
  writeFileSync(path, `\uFEFF${lines.join('\n')}`, 'utf8');
  audit(sc, {
    action: 'inventory.export',
    entityType: 'inventory',
    summary: `Exported ${rows.length} items`,
  });
  return { path, count: rows.length };
}

/* ------------------------------------------------------------------ */
/* Suppliers                                                           */
/* ------------------------------------------------------------------ */

function mapSupplier(r: Record<string, unknown>): SupplierRecord {
  return {
    id: r.id as number,
    name: r.name as string,
    contactPerson: (r.contact_person as string) ?? '',
    phone: (r.phone as string) ?? '',
    email: (r.email as string) ?? '',
    address: (r.address as string) ?? '',
    notes: (r.notes as string) ?? '',
    isActive: r.is_active === 1,
  };
}

export function listSuppliers(sc: ServiceContext): SupplierRecord[] {
  const rows = sc.db
    .prepare('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE')
    .all() as Record<string, unknown>[];
  return rows.map(mapSupplier);
}

export type SupplierSave = {
  id: number | null;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
};

export function saveSupplier(sc: ServiceContext, p: SupplierSave): SupplierRecord {
  const now = sc.now();
  const id = sc.db.transaction(() => {
    if (p.id) {
      const exists = sc.db.prepare('SELECT id FROM suppliers WHERE id = ?').get(p.id);
      if (!exists) ipcError('NOT_FOUND', 'Supplier not found.');
      sc.db
        .prepare(
          `UPDATE suppliers SET name=?, contact_person=?, phone=?, email=?, address=?, notes=?,
                  is_active=?, updated_at=? WHERE id=?`,
        )
        .run(p.name, p.contactPerson, p.phone, p.email, p.address, p.notes, p.isActive ? 1 : 0, now, p.id);
      return p.id;
    }
    const info = sc.db
      .prepare(
        `INSERT INTO suppliers (name, contact_person, phone, email, address, notes, is_active, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(p.name, p.contactPerson, p.phone, p.email, p.address, p.notes, p.isActive ? 1 : 0, now, now);
    return Number(info.lastInsertRowid);
  })();
  audit(sc, {
    action: p.id ? 'supplier.update' : 'supplier.create',
    entityType: 'supplier',
    entityId: id,
    summary: `${p.id ? 'Updated' : 'Created'} supplier: ${p.name}`,
  });
  const row = sc.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Record<string, unknown>;
  return mapSupplier(row);
}
