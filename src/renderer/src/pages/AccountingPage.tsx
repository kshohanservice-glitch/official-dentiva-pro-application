/** Accounting: expenses (with categories) and other income — kept distinct from revenue. */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, BookOpen } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import {
  PAYMENT_METHODS,
  type ExpenseCategoryRecord,
  type ExpenseRecord,
  type OtherIncomeRecord,
  type PaymentMethod,
} from '@shared/types';
import {
  Loading,
  Modal,
  Field,
  Money,
  PageHead,
  Pagination,
  EmptyState,
} from '../components/ui';
import { toast } from '../lib/store';
import { parseMoneyToPoisha, formatPoisha } from '@shared/money';
import { todayDhaka } from '@shared/datetime';

/** Channel preset enum for accounting/reports (no 'all'). */
type RangePreset = 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'custom';

const PAGE_SIZE = 25;

export default function AccountingPage(): JSX.Element {
  const [tab, setTab] = useState<'expenses' | 'income' | 'categories'>('expenses');
  const [preset, setPreset] = useState<RangePreset>('last30');
  const [from, setFrom] = useState(todayDhaka());
  const [to, setTo] = useState(todayDhaka());
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
  }, []);

  const canManage = perms.has('accounting.manage');
  const canView = perms.has('accounting.view');
  const range: { preset: RangePreset; from?: string; to?: string } = { preset, ...(preset === 'custom' ? { from, to } : {}) };

  if (!canView) {
    return (
      <div className="page">
        <div className="alert danger">You do not have permission to view accounting data.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        title="Accounting"
        subtitle="Operating expenses and non-clinic income — separate from patient revenue"
        actions={
          <div className="row gap-sm">
            <select className="select" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} aria-label="Range">
              <option value="today">Today</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="last90">Last 90 days</option>
              <option value="last365">Last 365 days</option>
              <option value="custom">Custom</option>
            </select>
            {preset === 'custom' ? (
              <>
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
              </>
            ) : null}
          </div>
        }
      />

      <div className="alert info">
        Income vs expense: patient collections live under Payments and Reports; this module tracks
        clinic operating costs and unrelated income so profit reporting stays accurate.
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'expenses' ? ' active' : ''}`} onClick={() => setTab('expenses')}>Expenses</button>
        <button className={`tab${tab === 'income' ? ' active' : ''}`} onClick={() => setTab('income')}>Other income</button>
        <button className={`tab${tab === 'categories' ? ' active' : ''}`} onClick={() => setTab('categories')}>Categories</button>
      </div>

      {tab === 'expenses' ? (
        <ExpensesTab range={range} canManage={canManage} />
      ) : null}
      {tab === 'income' ? (
        <IncomeTab range={range} canManage={canManage} />
      ) : null}
      {tab === 'categories' ? (
        <CategoriesTab canManage={canManage} />
      ) : null}
    </div>
  );
}

type RangeArg = { preset: RangePreset; from?: string; to?: string };

function ExpensesTab(props: { range: RangeArg; canManage: boolean }): JSX.Element {
  const { range, canManage } = props;
  const [items, setItems] = useState<ExpenseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{
    id: number | null;
    categoryId: number;
    amount: string;
    spentOn: string;
    method: PaymentMethod;
    description: string;
  } | null>(null);
  const [categories, setCategories] = useState<ExpenseCategoryRecord[]>([]);

  useEffect(() => {
    void api('accounting.expenseCategories', {}).then(setCategories).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('accounting.expenses', {
        preset: range.preset,
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [range.preset, range.from, range.to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    let amount: number;
    try {
      amount = parseMoneyToPoisha(draft.amount);
      if (amount <= 0) throw new Error('Amount must be greater than zero.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid amount.');
      return;
    }
    try {
      await api('accounting.expenseSave', {
        id: draft.id,
        categoryId: draft.categoryId,
        amountPoisha: amount,
        spentOn: draft.spentOn,
        method: draft.method,
        description: draft.description.trim(),
      });
      toast.success('Expense saved.');
      setDraft(null);
      void load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const totalPoisha = items.reduce((sum, i) => sum + i.amountPoisha, 0);

  return (
    <div className="card mt">
      <div className="card-head">
        <h3>Expenses · {total} records ({formatPoisha(totalPoisha)} shown)</h3>
        {canManage ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={() =>
              setDraft({
                id: null,
                categoryId: categories[0]?.id ?? 0,
                amount: '',
                spentOn: todayDhaka(),
                method: 'cash',
                description: '',
              })
            }
            disabled={categories.length === 0}
          >
            <Plus size={14} /> Add expense
          </button>
        ) : null}
      </div>
      {categories.length === 0 && canManage ? (
        <div className="alert warning" style={{ margin: 16 }}>
          Create an expense category first (Categories tab).
        </div>
      ) : null}
      <div className="card-body">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState icon={<BookOpen size={26} />} title="No expenses in range" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-hover">
                <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Method</th><th>Amount</th><th>By</th><th></th></tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td>{e.spentOn}</td>
                      <td className="bold">{e.categoryName}</td>
                      <td>{e.description || '—'}</td>
                      <td>{PAYMENT_METHODS.find((m) => m.value === e.method)?.label ?? e.method}</td>
                      <td><Money poisha={e.amountPoisha} /></td>
                      <td>{e.enteredBy}</td>
                      <td>
                        {canManage ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setDraft({
                                id: e.id,
                                categoryId: e.categoryId,
                                amount: (e.amountPoisha / 100).toFixed(2),
                                spentOn: e.spentOn,
                                method: e.method,
                                description: e.description,
                              })
                            }
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
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </div>

      {draft ? (
        <Modal
          title={draft.id ? 'Edit expense' : 'Add expense'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save()}>Save expense</button>
            </>
          }
        >
          <div className="grid cols-2">
            <Field label="Category" required>
              <select className="select" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: Number(e.target.value) })}>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Amount (৳)" required>
              <input className="input" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} autoFocus />
            </Field>
            <Field label="Spent on" required>
              <input className="input" type="date" value={draft.spentOn} onChange={(e) => setDraft({ ...draft, spentOn: e.target.value })} />
            </Field>
            <Field label="Method" required>
              <select className="select" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value as PaymentMethod })}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Description" full>
              <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function IncomeTab(props: { range: RangeArg; canManage: boolean }): JSX.Element {
  const { range, canManage } = props;
  const [items, setItems] = useState<OtherIncomeRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{
    id: number | null;
    title: string;
    amount: string;
    receivedOn: string;
    method: PaymentMethod;
    notes: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('accounting.otherIncome', {
        preset: range.preset,
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [range.preset, range.from, range.to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error('Title is required.');
      return;
    }
    let amount: number;
    try {
      amount = parseMoneyToPoisha(draft.amount);
      if (amount <= 0) throw new Error('Amount must be greater than zero.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid amount.');
      return;
    }
    try {
      await api('accounting.otherIncomeSave', {
        id: draft.id,
        title: draft.title.trim(),
        amountPoisha: amount,
        receivedOn: draft.receivedOn,
        method: draft.method,
        notes: draft.notes.trim(),
      });
      toast.success('Income saved.');
      setDraft(null);
      void load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const totalPoisha = items.reduce((sum, i) => sum + i.amountPoisha, 0);

  return (
    <div className="card mt">
      <div className="card-head">
        <h3>Other income · {total} records ({formatPoisha(totalPoisha)} shown)</h3>
        {canManage ? (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setDraft({ id: null, title: '', amount: '', receivedOn: todayDhaka(), method: 'cash', notes: '' })}
          >
            <Plus size={14} /> Add income
          </button>
        ) : null}
      </div>
      <div className="card-body">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState icon={<BookOpen size={26} />} title="No other income in range" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-hover">
                <thead><tr><th>Date</th><th>Title</th><th>Method</th><th>Amount</th><th>By</th><th></th></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.receivedOn}</td>
                      <td className="bold">{i.title}</td>
                      <td>{PAYMENT_METHODS.find((m) => m.value === i.method)?.label ?? i.method}</td>
                      <td><Money poisha={i.amountPoisha} /></td>
                      <td>{i.enteredBy}</td>
                      <td>
                        {canManage ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setDraft({
                                id: i.id,
                                title: i.title,
                                amount: (i.amountPoisha / 100).toFixed(2),
                                receivedOn: i.receivedOn,
                                method: i.method,
                                notes: i.notes,
                              })
                            }
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
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </div>

      {draft ? (
        <Modal
          title={draft.id ? 'Edit other income' : 'Add other income'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save()}>Save</button>
            </>
          }
        >
          <div className="grid cols-2">
            <Field label="Title" required full>
              <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} autoFocus />
            </Field>
            <Field label="Amount (৳)" required>
              <input className="input" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </Field>
            <Field label="Received on" required>
              <input className="input" type="date" value={draft.receivedOn} onChange={(e) => setDraft({ ...draft, receivedOn: e.target.value })} />
            </Field>
            <Field label="Method" required>
              <select className="select" value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value as PaymentMethod })}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Notes">
              <input className="input" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function CategoriesTab(props: { canManage: boolean }): JSX.Element {
  const [items, setItems] = useState<ExpenseCategoryRecord[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    void api('accounting.expenseCategories', {})
      .then(setItems)
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (): Promise<void> => {
    if (!name.trim()) return;
    try {
      await api('accounting.expenseCategorySave', { id: null, name: name.trim(), isActive: true });
      setName('');
      toast.success('Category added.');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="card mt">
      <div className="card-head"><h3>Expense categories</h3></div>
      <div className="card-body stack">
        {props.canManage ? (
          <div className="row gap">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" />
            <button className="btn btn-primary" onClick={() => void add()}>Add</button>
          </div>
        ) : null}
        {loading ? (
          <Loading />
        ) : (
          <div className="badge-row">
            {items.map((c) => (
              <span key={c.id} className={`badge ${c.isActive ? 'badge-teal' : 'badge-neutral'}`}>
                {c.name}{c.isBuiltIn ? ' · built-in' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
