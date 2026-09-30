/** Inventory: stock items, movements, expiry & low-stock alerts, suppliers. */

import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Pencil,
  Package,
  AlertTriangle,
  ArrowDownUp,
  Download,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { InventoryItemRecord, InventoryTransaction, SupplierRecord } from '@shared/types';
import {
  Loading,
  Modal,
  Field,
  Money,
  PageHead,
  Pagination,
  SearchInput,
  EmptyState,
  fmtDateTime,
} from '../components/ui';
import { toast } from '../lib/store';
import { parseMoneyToPoisha } from '@shared/money';

const PAGE_SIZE = 25;

const emptyItem = {
  id: null as number | null,
  sku: '',
  name: '',
  category: '',
  unit: 'pcs',
  supplierId: null as number | null,
  purchasePrice: '',
  salePrice: '',
  reorderLevel: 0,
  expiryDate: '',
  batchNumber: '',
  isActive: true,
  notes: '',
};

export default function InventoryPage(): JSX.Element {
  const [tab, setTab] = useState<'items' | 'alerts' | 'suppliers'>('items');
  const [items, setItems] = useState<InventoryItemRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof emptyItem | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<InventoryItemRecord | null>(null);
  const [txnTarget, setTxnTarget] = useState<InventoryItemRecord | null>(null);
  const [alerts, setAlerts] = useState<{
    lowStock: InventoryItemRecord[];
    expiring: InventoryItemRecord[];
    expired: InventoryItemRecord[];
  } | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [supplierDraft, setSupplierDraft] = useState<{ id: number | null; name: string; contactPerson: string; phone: string; email: string; address: string; notes: string } | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('inventory.list', {
        search,
        category: 'all',
        lowStockOnly,
        includeInactive: false,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [search, lowStockOnly, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    if (tab === 'alerts') {
      void api('inventory.alerts', {}).then(setAlerts).catch((e) => toast.error(errorMessage(e)));
    }
    if (tab === 'suppliers') {
      void api('suppliers.list', {}).then(setSuppliers).catch((e) => toast.error(errorMessage(e)));
    }
  }, [tab]);

  const saveItem = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.sku.trim() || !draft.name.trim() || !draft.category.trim() || !draft.unit.trim()) {
      toast.error('SKU, name, category and unit are required.');
      return;
    }
    let purchase: number;
    let sale: number;
    try {
      purchase = draft.purchasePrice.trim() ? parseMoneyToPoisha(draft.purchasePrice) : 0;
      sale = draft.salePrice.trim() ? parseMoneyToPoisha(draft.salePrice) : 0;
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    try {
      await api('inventory.save', {
        id: draft.id,
        sku: draft.sku.trim(),
        name: draft.name.trim(),
        category: draft.category.trim(),
        unit: draft.unit.trim(),
        supplierId: draft.supplierId,
        purchasePricePoisha: purchase,
        salePricePoisha: sale,
        reorderLevel: Number(draft.reorderLevel) || 0,
        expiryDate: draft.expiryDate || null,
        batchNumber: draft.batchNumber.trim(),
        isActive: draft.isActive,
        notes: draft.notes.trim(),
      });
      toast.success('Item saved.');
      setDraft(null);
      void load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const saveSupplier = async (): Promise<void> => {
    if (!supplierDraft) return;
    if (!supplierDraft.name.trim()) {
      toast.error('Supplier name is required.');
      return;
    }
    try {
      await api('suppliers.save', {
        id: supplierDraft.id,
        name: supplierDraft.name.trim(),
        contactPerson: supplierDraft.contactPerson,
        phone: supplierDraft.phone,
        email: supplierDraft.email,
        address: supplierDraft.address,
        notes: supplierDraft.notes,
        isActive: true,
      });
      toast.success('Supplier saved.');
      setSupplierDraft(null);
      void api('suppliers.list', {}).then(setSuppliers).catch(() => undefined);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const exportCsv = async (): Promise<void> => {
    try {
      const res = await api('inventory.exportCsv', {});
      toast.success(`Exported ${res.count} items to ${res.path}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const canManage = perms.has('inventory.manage');

  return (
    <div className="page">
      <PageHead
        title="Inventory"
        subtitle="Stock movements, expiry, and reorder tracking"
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => void exportCsv()} disabled={!canManage}>
              <Download size={16} /> CSV
            </button>
            {canManage ? (
              <button className="btn btn-primary" onClick={() => setDraft({ ...emptyItem })}>
                <Plus size={16} /> Add item
              </button>
            ) : null}
          </>
        }
      />

      <div className="tabs">
        <button className={`tab${tab === 'items' ? ' active' : ''}`} onClick={() => setTab('items')}>Items</button>
        <button className={`tab${tab === 'alerts' ? ' active' : ''}`} onClick={() => setTab('alerts')}>
          Alerts {alerts && alerts.lowStock.length + alerts.expiring.length + alerts.expired.length > 0
            ? <span className="nav-badge">{alerts.lowStock.length + alerts.expiring.length + alerts.expired.length}</span>
            : null}
        </button>
        <button className={`tab${tab === 'suppliers' ? ' active' : ''}`} onClick={() => setTab('suppliers')}>Suppliers</button>
      </div>

      {tab === 'items' ? (
        <>
          <div className="filters">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, SKU…" />
            <label className="check-row inline">
              <input type="checkbox" checked={lowStockOnly} onChange={(e) => { setPage(1); setLowStockOnly(e.target.checked); }} />
              <span>Low stock only</span>
            </label>
          </div>
          <div className="card mt">
            {error ? <div className="alert danger" style={{ margin: 16 }}>{error}</div> : null}
            {loading ? (
              <Loading />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Package size={26} />}
                title="No inventory items"
                body="Track consumables, materials and products with full movement history."
                action={canManage ? <button className="btn btn-primary" onClick={() => setDraft({ ...emptyItem })}>Add item</button> : undefined}
              />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Stock</th>
                        <th>Reorder</th>
                        <th>Expiry</th>
                        <th>Supplier</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => {
                        const low = it.currentStock <= it.reorderLevel;
                        const expired = it.expiryDate && it.expiryDate < new Date().toISOString().slice(0, 10);
                        return (
                          <tr key={it.id}>
                            <td className="mono">{it.sku}</td>
                            <td className="bold">{it.name}</td>
                            <td>{it.category}</td>
                            <td>
                              <span className={`badge badge-${low ? 'amber' : 'green'}`}>
                                {it.currentStock} {it.unit}
                              </span>
                            </td>
                            <td>{it.reorderLevel}</td>
                            <td>
                              {it.expiryDate ? (
                                expired ? <span className="badge badge-red">{it.expiryDate}</span> : <span>{it.expiryDate}</span>
                              ) : '—'}
                            </td>
                            <td>{it.supplierName ?? '—'}</td>
                            <td className="nowrap">
                              {canManage ? (
                                <>
                                  <button className="btn btn-ghost btn-sm" onClick={() => setAdjustTarget(it)} title="Adjust stock">
                                    <ArrowDownUp size={14} />
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() =>
                                      setDraft({
                                        id: it.id,
                                        sku: it.sku,
                                        name: it.name,
                                        category: it.category,
                                        unit: it.unit,
                                        supplierId: it.supplierId,
                                        purchasePrice: (it.purchasePricePoisha / 100).toFixed(2),
                                        salePrice: (it.salePricePoisha / 100).toFixed(2),
                                        reorderLevel: it.reorderLevel,
                                        expiryDate: it.expiryDate ?? '',
                                        batchNumber: it.batchNumber,
                                        isActive: it.isActive,
                                        notes: it.notes,
                                      })
                                    }
                                  >
                                    <Pencil size={14} />
                                  </button>
                                </>
                              ) : null}
                              <button className="btn btn-ghost btn-sm" onClick={() => setTxnTarget(it)}>History</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding: '10px 16px' }}>
                  <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
                </div>
              </>
            )}
          </div>
        </>
      ) : null}

      {tab === 'alerts' ? (
        <div className="stack mt">
          {!alerts ? <Loading /> : (
            <>
              <AlertBlock title="Low stock" tone="warning" items={alerts.lowStock} empty="Nothing below reorder level." />
              <AlertBlock title="Expiring within 60 days" tone="warning" items={alerts.expiring} empty="Nothing expiring soon." />
              <AlertBlock title="Expired" tone="danger" items={alerts.expired} empty="Nothing expired." />
            </>
          )}
        </div>
      ) : null}

      {tab === 'suppliers' ? (
        <div className="card mt">
          <div className="card-head">
            <h3>Suppliers</h3>
            {perms.has('supplier.manage') ? (
              <button className="btn btn-secondary btn-sm" onClick={() => setSupplierDraft({ id: null, name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' })}>
                <Plus size={14} /> Add supplier
              </button>
            ) : null}
          </div>
          <div className="card-body">
            {suppliers.length === 0 ? (
              <p className="muted">No suppliers recorded.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th></th></tr></thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id}>
                        <td className="bold">{s.name}</td>
                        <td>{s.contactPerson || '—'}</td>
                        <td>{s.phone || '—'}</td>
                        <td>{s.email || '—'}</td>
                        <td>
                          {perms.has('supplier.manage') ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setSupplierDraft({ id: s.id, name: s.name, contactPerson: s.contactPerson, phone: s.phone, email: s.email, address: s.address, notes: s.notes })}
                            >
                              <Pencil size={14} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {draft ? (
        <Modal
          title={draft.id ? 'Edit item' : 'Add inventory item'}
          onClose={() => setDraft(null)}
          size="lg"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void saveItem()}>Save item</button>
            </>
          }
        >
          <div className="grid cols-2">
            <Field label="SKU" required>
              <input className="input" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} autoFocus />
            </Field>
            <Field label="Name" required>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Category" required>
              <input className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Composite, Anesthetic, PPE…" />
            </Field>
            <Field label="Unit" required>
              <input className="input" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="pcs, box, ml…" />
            </Field>
            <Field label="Purchase price (৳)">
              <input className="input" inputMode="decimal" value={draft.purchasePrice} onChange={(e) => setDraft({ ...draft, purchasePrice: e.target.value })} />
            </Field>
            <Field label="Sale price (৳)">
              <input className="input" inputMode="decimal" value={draft.salePrice} onChange={(e) => setDraft({ ...draft, salePrice: e.target.value })} />
            </Field>
            <Field label="Reorder level">
              <input className="input" type="number" min={0} value={draft.reorderLevel} onChange={(e) => setDraft({ ...draft, reorderLevel: Number(e.target.value) })} />
            </Field>
            <Field label="Expiry date">
              <input className="input" type="date" value={draft.expiryDate} onChange={(e) => setDraft({ ...draft, expiryDate: e.target.value })} />
            </Field>
            <Field label="Batch number">
              <input className="input" value={draft.batchNumber} onChange={(e) => setDraft({ ...draft, batchNumber: e.target.value })} />
            </Field>
            <Field label="Supplier">
              <select className="select" value={draft.supplierId ?? ''} onChange={(e) => setDraft({ ...draft, supplierId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Notes" full>
              <textarea className="textarea" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              <span>Active</span>
            </label>
            {draft.id === null ? (
              <div className="alert info" style={{ gridColumn: '1 / -1' }}>
                Opening stock is recorded with the first stock movement after saving.
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {adjustTarget ? (
        <AdjustModal
          item={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onSaved={() => {
            setAdjustTarget(null);
            void load();
            toast.success('Stock adjusted.');
          }}
        />
      ) : null}

      {txnTarget ? (
        <TransactionsModal item={txnTarget} onClose={() => setTxnTarget(null)} />
      ) : null}

      {supplierDraft ? (
        <Modal
          title={supplierDraft.id ? 'Edit supplier' : 'Add supplier'}
          onClose={() => setSupplierDraft(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setSupplierDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void saveSupplier()}>Save supplier</button>
            </>
          }
        >
          <div className="grid cols-2">
            <Field label="Name" required full><input className="input" value={supplierDraft.name} onChange={(e) => setSupplierDraft({ ...supplierDraft, name: e.target.value })} autoFocus /></Field>
            <Field label="Contact person"><input className="input" value={supplierDraft.contactPerson} onChange={(e) => setSupplierDraft({ ...supplierDraft, contactPerson: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={supplierDraft.phone} onChange={(e) => setSupplierDraft({ ...supplierDraft, phone: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={supplierDraft.email} onChange={(e) => setSupplierDraft({ ...supplierDraft, email: e.target.value })} /></Field>
            <Field label="Address"><input className="input" value={supplierDraft.address} onChange={(e) => setSupplierDraft({ ...supplierDraft, address: e.target.value })} /></Field>
            <Field label="Notes" full><textarea className="textarea" rows={2} value={supplierDraft.notes} onChange={(e) => setSupplierDraft({ ...supplierDraft, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function AlertBlock(props: {
  title: string;
  tone: 'warning' | 'danger';
  items: InventoryItemRecord[];
  empty: string;
}): JSX.Element {
  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <AlertTriangle size={15} style={{ verticalAlign: -2, color: props.tone === 'danger' ? 'var(--danger)' : 'var(--warning)' }} />{' '}
          {props.title} ({props.items.length})
        </h3>
      </div>
      <div className="card-body">
        {props.items.length === 0 ? (
          <p className="muted">{props.empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Item</th><th>Stock</th><th>Reorder</th><th>Expiry</th></tr></thead>
              <tbody>
                {props.items.map((it) => (
                  <tr key={it.id}>
                    <td className="bold">{it.name}</td>
                    <td>{it.currentStock} {it.unit}</td>
                    <td>{it.reorderLevel}</td>
                    <td>{it.expiryDate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdjustModal(props: {
  item: InventoryItemRecord;
  onClose(): void;
  onSaved(): void;
}): JSX.Element {
  const [type, setType] = useState<'purchase' | 'usage' | 'adjustment' | 'wastage' | 'return'>('purchase');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!qty) {
      setErr('Quantity cannot be zero.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let unitPrice: number | null = null;
      if (price.trim()) unitPrice = parseMoneyToPoisha(price);
      await api('inventory.adjust', {
        itemId: props.item.id,
        type,
        quantity: qty,
        unitPricePoisha: unitPrice,
        reference: reference.trim(),
        note: note.trim(),
      });
      props.onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const net = props.item.currentStock + (type === 'usage' || type === 'wastage' ? -Math.abs(qty) : Math.abs(qty));

  return (
    <Modal
      title={`Adjust stock · ${props.item.name}`}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Save movement'}
          </button>
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
        <div className="grid cols-2">
          <Field label="Movement type" required>
            <select className="select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="purchase">Purchase (stock in)</option>
              <option value="usage">Usage (stock out)</option>
              <option value="adjustment">Adjustment (+/−)</option>
              <option value="wastage">Wastage (stock out)</option>
              <option value="return">Return (stock in)</option>
            </select>
          </Field>
          <Field label="Quantity" required hint={type === 'adjustment' ? 'Use negative to reduce' : 'Always positive'}>
            <input className="input" type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </Field>
          <Field label="Unit price (৳)" hint="For purchases">
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Reference">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO / bill no." />
          </Field>
          <Field label="Note" full>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="alert info">
          Current stock {props.item.currentStock} {props.item.unit} → projected{' '}
          <strong>{type === 'usage' || type === 'wastage' ? props.item.currentStock - Math.abs(qty) : type === 'adjustment' ? props.item.currentStock + qty : net} {props.item.unit}</strong>
        </div>
      </div>
    </Modal>
  );
}

function TransactionsModal(props: { item: InventoryItemRecord; onClose(): void }): JSX.Element {
  const [rows, setRows] = useState<InventoryTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const total = rows.length;

  useEffect(() => {
    setLoading(true);
    void api('inventory.transactions', { itemId: props.item.id, page, pageSize: 50 })
      .then((r) => setRows(r.items))
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [props.item.id, page]);

  return (
    <Modal title={`Stock history · ${props.item.name}`} onClose={props.onClose} size="lg"
      footer={<button className="btn btn-secondary" onClick={props.onClose}>Close</button>}>
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="muted">No movements recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Type</th><th>Qty</th><th>Price</th><th>Ref</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="nowrap">{fmtDateTime(t.createdAt)}</td>
                  <td><span className="badge badge-blue">{t.type}</span></td>
                  <td className={t.quantity < 0 ? 'danger-text' : ''}>{t.quantity}</td>
                  <td>{t.unitPricePoisha != null ? <Money poisha={t.unitPricePoisha} /> : '—'}</td>
                  <td>{t.reference || '—'}</td>
                  <td>{t.performedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total >= 50 ? <Pagination page={page} pageSize={50} total={total + 1} onPage={setPage} /> : null}
        </div>
      )}
    </Modal>
  );
}
