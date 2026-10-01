/** Payments ledger: date-preset filters (default today), methods, voiding. */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { PAYMENT_METHODS, type PaymentMethod, type PaymentRecord } from '@shared/types';
import {
  Loading,
  Modal,
  Field,
  Money,
  PageHead,
  Pagination,
  statusBadge,
  EmptyState,
  fmtDateTime,
} from '../components/ui';
import { toast } from '../lib/store';
import { parseMoneyToPoisha, formatPoisha } from '@shared/money';
import { todayDhaka } from '@shared/datetime';

const PAGE_SIZE = 25;
/** payments.list accepts 'all'; payments.summary does not. */
type FilterPreset = 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'all' | 'custom';
type SummaryPreset = Exclude<FilterPreset, 'all'>;

function idempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function PaymentsPage(): JSX.Element {
  const [preset, setPreset] = useState<FilterPreset>('today');
  const [from, setFrom] = useState(todayDhaka());
  const [to, setTo] = useState(todayDhaka());
  const [method, setMethod] = useState<PaymentMethod | 'all'>('all');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [items, setItems] = useState<PaymentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<{ totalPoisha: number; count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openOpen, setOpenOpen] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('payments.list', {
        preset,
        ...(preset === 'custom' ? { from, to } : {}),
        method,
        includeVoided,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
      if (preset !== 'all') {
        const s = await api('payments.summary', {
          preset: preset as SummaryPreset,
          ...(preset === 'custom' ? { from, to } : {}),
        });
        setSummary({ totalPoisha: s.totalPoisha, count: s.count });
      } else {
        setSummary(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [preset, from, to, method, includeVoided, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const voidPayment = async (id: number): Promise<void> => {
    try {
      await api('payments.void', { id, reason: 'Voided from payments ledger' });
      toast.success('Payment voided.');
      void load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Payments"
        subtitle={summary
          ? `${summary.count} payments · ${formatPoisha(summary.totalPoisha)} in range`
          : `${total} payments${preset === 'all' ? ' · all time' : ''}`}
        actions={
          perms.has('payment.create') ? (
            <button className="btn btn-primary" onClick={() => setOpenOpen(true)}>
              <Plus size={16} /> Record payment
            </button>
          ) : null
        }
      />

      <div className="filters">
        <select
          className="select"
          value={preset}
          onChange={(e) => {
            setPage(1);
            setPreset(e.target.value as FilterPreset);
          }}
          aria-label="Date range"
        >
          <option value="today">Today</option>
          <option value="last7">Last 7 days</option>
          <option value="last30">Last 30 days</option>
          <option value="last90">Last 90 days</option>
          <option value="last365">Last 365 days</option>
          <option value="all">All time</option>
          <option value="custom">Custom range</option>
        </select>
        {preset === 'custom' ? (
          <>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </>
        ) : null}
        <select
          className="select"
          value={method}
          onChange={(e) => {
            setPage(1);
            setMethod(e.target.value as PaymentMethod | 'all');
          }}
          aria-label="Method"
        >
          <option value="all">All methods</option>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <label className="check-row inline">
          <input
            type="checkbox"
            checked={includeVoided}
            onChange={(e) => {
              setPage(1);
              setIncludeVoided(e.target.checked);
            }}
          />
          <span>Include voided</span>
        </label>
        <span className="muted">
          {preset === 'custom' ? `${from} → ${to}` : preset === 'all' ? 'All time' : `Range: ${preset}`}
        </span>
      </div>

      <div className="card mt">
        {error ? <div className="alert danger" style={{ margin: 16 }}>{error}</div> : null}
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Wallet size={26} />}
            title="No payments"
            body="Payments recorded for the selected range will appear here. The default filter is today."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Patient</th>
                    <th>Invoice</th>
                    <th>When</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Amount</th>
                    <th>By</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className={p.isVoided ? 'row-voided' : ''}>
                      <td className="mono">{p.paymentCode}</td>
                      <td className="bold">{p.patientName}</td>
                      <td className="mono">{p.invoiceCode ?? '—'}</td>
                      <td className="nowrap">{fmtDateTime(p.paidAt)}</td>
                      <td>{PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method}</td>
                      <td>{p.reference || '—'}</td>
                      <td><Money poisha={p.amountPoisha} /></td>
                      <td>{p.receivedBy}</td>
                      <td>
                        {p.isVoided ? (
                          statusBadge('void')
                        ) : perms.has('payment.void') ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => void voidPayment(p.id)}>Void</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px' }}>
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
            </div>
          </>
        )}
      </div>

      {openOpen ? (
        <StandalonePaymentModal
          onClose={() => setOpenOpen(false)}
          onSaved={() => {
            setOpenOpen(false);
            void load();
            toast.success('Payment recorded.');
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Standalone payment (against outstanding invoice or open balance)    */
/* ------------------------------------------------------------------ */

function StandalonePaymentModal(props: { onClose(): void; onSaved(): void }): JSX.Element {
  const [query, setQuery] = useState('');
  const [invoices, setInvoices] = useState<{ id: number; invoiceCode: string; patientName: string; patientId: number; duePoisha: number }[]>([]);
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [invoiceLabel, setInvoiceLabel] = useState('');
  const [duePoisha, setDuePoisha] = useState(0);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void api('invoices.list', {
        search: query,
        status: 'unpaid',
        preset: 'all',
        page: 1,
        pageSize: 8,
      })
        .then((r) => setInvoices(r.items.map((i) => ({
          id: i.id,
          invoiceCode: i.invoiceCode,
          patientName: i.patientName,
          patientId: i.patientId,
          duePoisha: i.duePoisha,
        }))))
        .catch(() => setInvoices([]));
      // Also include partial
      if (query) {
        void api('invoices.list', { search: query, status: 'partial', preset: 'all', page: 1, pageSize: 8 })
          .then((r) => {
            setInvoices((prev) => {
              const seen = new Set(prev.map((p) => p.id));
              return [
                ...prev,
                ...r.items.filter((i) => !seen.has(i.id)).map((i) => ({
                  id: i.id,
                  invoiceCode: i.invoiceCode,
                  patientName: i.patientName,
                  patientId: i.patientId,
                  duePoisha: i.duePoisha,
                })),
              ];
            });
          })
          .catch(() => undefined);
      }
    }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const submit = async (): Promise<void> => {
    if (!invoiceId || !patientId) {
      setErr('Choose an unpaid invoice.');
      return;
    }
    let amount: number;
    try {
      amount = parseMoneyToPoisha(amountText);
      if (amount <= 0) throw new Error('Amount must be greater than zero.');
      if (amount > duePoisha) throw new Error(`Amount exceeds due (${formatPoisha(duePoisha)}).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid amount.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api('payments.create', {
        patientId,
        invoiceId,
        amountPoisha: amount,
        method,
        reference: reference.trim(),
        notes: notes.trim(),
        idempotencyKey: idempotencyKey(),
      });
      props.onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Record payment"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
        <Field label="Unpaid invoice" required>
          <input
            className="input"
            value={invoiceLabel || query}
            placeholder="Search invoice code or patient…"
            onChange={(e) => {
              setQuery(e.target.value);
              setInvoiceLabel('');
              setInvoiceId(null);
              setPatientId(null);
            }}
            autoComplete="off"
          />
          {query && !invoiceId && invoices.length > 0 ? (
            <div className="search-results static">
              {invoices.map((inv) => (
                <button
                  key={inv.id}
                  className="search-result"
                  onClick={() => {
                    setInvoiceId(inv.id);
                    setPatientId(inv.patientId);
                    setDuePoisha(inv.duePoisha);
                    setInvoiceLabel(`${inv.invoiceCode} · ${inv.patientName} · due ${formatPoisha(inv.duePoisha)}`);
                    setAmountText((inv.duePoisha / 100).toFixed(2));
                    setQuery('');
                  }}
                >
                  <span className="primary">{inv.invoiceCode}</span>
                  <span className="secondary">{inv.patientName} · due {formatPoisha(inv.duePoisha)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </Field>
        <div className="grid cols-2">
          <Field label="Amount (৳)" required>
            <input className="input" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </Field>
          <Field label="Method" required>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Reference">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <div className="alert info">
          Payments are integer poisha amounts — no floating point rounding ever touches your money.
        </div>
      </div>
    </Modal>
  );
}
