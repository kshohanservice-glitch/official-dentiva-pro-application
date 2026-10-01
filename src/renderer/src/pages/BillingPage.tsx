/** Invoices: builder with historical price snapshots, detail, payments, print. */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Printer, FileDown, Receipt, Wallet } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { InvoiceRecord, PaymentMethod, TreatmentDef } from '@shared/types';
import { PAYMENT_METHODS } from '@shared/types';
import {
  Loading,
  Modal,
  Field,
  Money,
  PageHead,
  Pagination,
  SearchInput,
  statusBadge,
  EmptyState,
  fmtDateTime,
} from '../components/ui';
import { toast } from '../lib/store';
import { parseMoneyToPoisha, formatPoisha } from '@shared/money';
import { todayDhaka } from '@shared/datetime';

const PAGE_SIZE = 25;

function idempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

interface LineDraft {
  treatmentId: number | null;
  name: string;
  quantity: number;
  unitPriceText: string;
  discountText: string;
}

export default function BillingPage(): JSX.Element {
  const nav = useNavigate();
  const params = useParams();
  const focusId = params.id ? Number(params.id) : null;
  const [items, setItems] = useState<InvoiceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'unpaid' | 'partial' | 'paid' | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<InvoiceRecord | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('invoices.list', { search, status, preset: 'all', page, pageSize: PAGE_SIZE });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Deep-linked invoice (e.g. after creating one).
  useEffect(() => {
    if (focusId) {
      void api('invoices.get', { id: focusId })
        .then(setDetail)
        .catch(() => toast.error('Invoice not found.'));
    }
  }, [focusId]);

  return (
    <div className="page">
      <PageHead
        title="Invoices"
        subtitle={`${total} invoices`}
        actions={
          perms.has('invoice.create') ? (
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> New invoice
            </button>
          ) : null
        }
      />

      <div className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Search invoice code or patient…" />
        <select className="select" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value as typeof status); }} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partially paid</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      <div className="card mt">
        {error ? <div className="alert danger" style={{ margin: 16 }}>{error}</div> : null}
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Receipt size={26} />}
            title="No invoices"
            body="Create an invoice from the treatment catalog with automatic price snapshots."
            action={
              perms.has('invoice.create') ? (
                <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>New invoice</button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Patient</th>
                    <th>Date</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((inv) => (
                    <tr key={inv.id} onClick={() => setDetail(inv)} tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') setDetail(inv); }}>
                      <td className="mono">{inv.invoiceCode}</td>
                      <td className="bold">{inv.patientName}</td>
                      <td className="nowrap">{inv.invoiceDate}</td>
                      <td><Money poisha={inv.totalPoisha} /></td>
                      <td><Money poisha={inv.paidPoisha} /></td>
                      <td>{inv.duePoisha > 0 ? <Money poisha={inv.duePoisha} className="danger-text" /> : <span className="muted">৳0</span>}</td>
                      <td>{statusBadge(inv.status)}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setDetail(inv); }}>
                          Open
                        </button>
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

      {createOpen ? (
        <CreateInvoiceModal
          onClose={() => setCreateOpen(false)}
          onCreated={(inv) => {
            setCreateOpen(false);
            toast.success(`Invoice ${inv.invoiceCode} created.`);
            setDetail(inv);
            setPage(1);
            void load();
          }}
        />
      ) : null}

      {detail ? (
        <InvoiceDetail
          invoice={detail}
          canPay={perms.has('payment.create')}
          canVoid={perms.has('invoice.void')}
          canPrint={perms.has('prescription.print')}
          onClose={() => {
            setDetail(null);
            nav('/billing', { replace: true });
          }}
          onChanged={() => {
            void api('invoices.get', { id: detail.id }).then(setDetail).catch(() => setDetail(null));
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create invoice                                                      */
/* ------------------------------------------------------------------ */

function CreateInvoiceModal(props: {
  onClose(): void;
  onCreated(inv: InvoiceRecord): void;
}): JSX.Element {
  const [patients, setPatients] = useState<{ id: number; fullName: string; patientCode: string; phone: string }[]>([]);
  const [query, setQuery] = useState('');
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayDhaka());
  const [treatments, setTreatments] = useState<TreatmentDef[]>([]);
  const [lines, setLines] = useState<LineDraft[]>([
    { treatmentId: null, name: '', quantity: 1, unitPriceText: '', discountText: '0' },
  ]);
  const [adjustmentText, setAdjustmentText] = useState('0');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api('treatments.list', { includeInactive: false, search: '' })
      .then(setTreatments)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void api('patients.list', { search: query, preset: 'all', status: 'active', sort: 'name_asc', page: 1, pageSize: 8 })
        .then((r) => setPatients(r.items))
        .catch(() => setPatients([]));
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const toPoisha = (text: string): number => {
    const t = text.trim();
    if (t === '') return 0;
    return parseMoneyToPoisha(t);
  };

  let subtotal = 0;
  const lineErrors: string[] = [];
  const parsedLines = lines.map((l) => {
    try {
      const unit = toPoisha(l.unitPriceText);
      const disc = toPoisha(l.discountText);
      const total = unit * l.quantity - disc;
      if (unit < 0 || disc < 0 || total < 0) throw new Error('Amounts must be non-negative.');
      subtotal += Math.max(0, total);
      return { ...l, unitPricePoisha: unit, discountPoisha: disc };
    } catch (e) {
      lineErrors.push(e instanceof Error ? e.message : 'Invalid amount.');
      return { ...l, unitPricePoisha: 0, discountPoisha: 0 };
    }
  });

  let adjustment = 0;
  try {
    adjustment = toPoisha(adjustmentText);
  } catch (e) {
    lineErrors.push(`Adjustment: ${e instanceof Error ? e.message : 'invalid'}`);
  }
  const grand = subtotal + adjustment;

  const submit = async (): Promise<void> => {
    if (!patientId) {
      setErr('Choose a patient.');
      return;
    }
    const valid = parsedLines.filter((l) => l.name.trim());
    if (valid.length === 0) {
      setErr('Add at least one line item.');
      return;
    }
    if (lineErrors.length > 0) {
      setErr(`Fix amounts first: ${lineErrors.join(' ')}`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const inv = await api('invoices.create', {
        patientId,
        visitId: null,
        invoiceDate,
        adjustmentPoisha: adjustment,
        notes: notes.trim(),
        items: valid.map((l) => ({
          treatmentId: l.treatmentId,
          name: l.name.trim(),
          quantity: l.quantity,
          unitPricePoisha: l.unitPricePoisha,
          discountPoisha: l.discountPoisha,
        })),
        idempotencyKey: idempotencyKey(),
      });
      props.onCreated(inv);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New invoice"
      onClose={props.onClose}
      size="xl"
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : `Create invoice · ${formatPoisha(grand)}`}
          </button>
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
        <div className="grid cols-2">
          <Field label="Patient" required>
            <input
              className="input"
              value={patientLabel || query}
              placeholder="Search name, code or phone…"
              onChange={(e) => {
                setQuery(e.target.value);
                setPatientLabel('');
                setPatientId(null);
              }}
              autoComplete="off"
            />
            {query && !patientId && patients.length > 0 ? (
              <div className="search-results static">
                {patients.map((p) => (
                  <button
                    key={p.id}
                    className="search-result"
                    onClick={() => {
                      setPatientId(p.id);
                      setPatientLabel(`${p.fullName} (${p.patientCode})`);
                      setQuery('');
                    }}
                  >
                    <span className="primary">{p.fullName}</span>
                    <span className="secondary">{p.patientCode} · {p.phone}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </Field>
          <Field label="Invoice date" required>
            <input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </Field>
        </div>

        <div className="invoice-lines">
          <div className="line-head">
            <span>Treatment / service</span>
            <span>Qty</span>
            <span>Unit price ৳</span>
            <span>Discount ৳</span>
            <span>Total</span>
            <span />
          </div>
          {parsedLines.map((l, i) => (
            <div className="line-row" key={i}>
              <div>
                <input
                  className="input"
                  list="treatment-pick"
                  value={l.name}
                  placeholder="Type or pick a treatment"
                  onChange={(e) => {
                    const name = e.target.value;
                    const t = treatments.find((x) => x.name === name);
                    setLines((list) =>
                      list.map((row, idx) =>
                        idx === i
                          ? {
                              ...row,
                              name,
                              treatmentId: t ? t.id : null,
                              unitPriceText: t ? (t.defaultPricePoisha / 100).toFixed(2) : row.unitPriceText,
                            }
                          : row,
                      ),
                    );
                  }}
                />
              </div>
              <div>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((list) => list.map((row, idx) => (idx === i ? { ...row, quantity: Math.max(1, Number(e.target.value) || 1) } : row)))
                  }
                />
              </div>
              <div>
                <input
                  className="input"
                  inputMode="decimal"
                  value={l.unitPriceText}
                  onChange={(e) => setLines((list) => list.map((row, idx) => (idx === i ? { ...row, unitPriceText: e.target.value } : row)))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <input
                  className="input"
                  inputMode="decimal"
                  value={l.discountText}
                  onChange={(e) => setLines((list) => list.map((row, idx) => (idx === i ? { ...row, discountText: e.target.value } : row)))}
                  placeholder="0"
                />
              </div>
              <div className="line-total">
                {formatPoisha(l.unitPricePoisha * l.quantity - l.discountPoisha)}
              </div>
              <div>
                <button
                  className="btn btn-ghost btn-icon"
                  disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                  aria-label="Remove line"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <datalist id="treatment-pick">
          {treatments.map((t) => (
            <option key={t.id} value={t.name}>{t.category} · {(t.defaultPricePoisha / 100).toFixed(2)}</option>
          ))}
        </datalist>

        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setLines([...lines, { treatmentId: null, name: '', quantity: 1, unitPriceText: '', discountText: '0' }])}
        >
          <Plus size={14} /> Add line
        </button>

        <div className="grid cols-2">
          <Field label="Invoice notes" full>
            <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Adjustment (৳)" hint="Negative to reduce the total; positive to add">
            <input className="input" inputMode="decimal" value={adjustmentText} onChange={(e) => setAdjustmentText(e.target.value)} />
          </Field>
          <div className="invoice-summary card card-pad">
            <div className="row between"><span>Subtotal</span><Money poisha={subtotal} /></div>
            <div className="row between"><span>Adjustment</span><Money poisha={adjustment} /></div>
            <div className="row between bold grand"><span>Grand total</span><Money poisha={grand} /></div>
          </div>
        </div>
        <div className="alert info">
          Every line stores its own price snapshot — later edits to the treatment catalog never rewrite this invoice.
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Invoice detail                                                      */
/* ------------------------------------------------------------------ */

function InvoiceDetail(props: {
  invoice: InvoiceRecord;
  canPay: boolean;
  canVoid: boolean;
  canPrint: boolean;
  onClose(): void;
  onChanged(): void;
}): JSX.Element {
  const { invoice } = props;
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);

  const printPreview = async (): Promise<void> => {
    try {
      const res = await api('print.preview', { docType: 'invoice', docId: invoice.id });
      const w = window.open('', '_blank', 'width=900,height=1200');
      if (!w) {
        toast.error('Allow pop-ups to preview documents.');
        return;
      }
      w.document.write(res.previewHtml);
      w.document.close();
      w.focus();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const printRun = async (): Promise<void> => {
    try {
      const res = await api('print.run', { docType: 'invoice', docId: invoice.id, profileId: null, printerName: null, silent: false });
      if (res.printed) toast.success(res.message || 'Sent to printer.');
      else toast.warning(res.message || 'Print job not started.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const toPdf = async (): Promise<void> => {
    try {
      const res = await api('print.toPdf', { docType: 'invoice', docId: invoice.id, paperSize: 'A4' });
      if (res.saved && res.path) toast.success(`Saved PDF: ${res.path}`);
      else toast.warning('PDF save was cancelled.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Modal
      title={`Invoice ${invoice.invoiceCode}`}
      onClose={props.onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Close</button>
          {props.canPrint ? (
            <>
              <button className="btn btn-secondary" onClick={void printPreview}>Preview</button>
              <button className="btn btn-secondary" onClick={void toPdf}><FileDown size={15} /> PDF</button>
              <button className="btn btn-secondary" onClick={void printRun}><Printer size={15} /> Print</button>
            </>
          ) : null}
          {props.canVoid && invoice.status !== 'void' ? (
            <button className="btn btn-danger-outline" onClick={() => setVoidOpen(true)}>Void invoice</button>
          ) : null}
          {props.canPay && invoice.status !== 'void' && invoice.duePoisha > 0 ? (
            <button className="btn btn-primary" onClick={() => setPayOpen(true)}>
              <Wallet size={15} /> Record payment
            </button>
          ) : null}
        </>
      }
    >
      <div className="invoice-sheet">
        <div className="row between mb">
          <div>
            <strong className="bold">{invoice.patientName}</strong>
            <div className="muted mono">{invoice.patientCode}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted">Date {invoice.invoiceDate}</div>
            {statusBadge(invoice.status)}
          </div>
        </div>

        <table className="table">
          <thead>
            <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Discount</th><th>Total</th></tr>
          </thead>
          <tbody>
            {invoice.items.map((it) => (
              <tr key={it.id}>
                <td>{it.name}</td>
                <td>{it.quantity}</td>
                <td><Money poisha={it.unitPricePoisha} /></td>
                <td><Money poisha={it.discountPoisha} /></td>
                <td><Money poisha={it.totalPoisha} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-summary card card-pad">
          <div className="row between"><span>Subtotal</span><Money poisha={invoice.subtotalPoisha} /></div>
          <div className="row between"><span>Discount</span><Money poisha={invoice.discountPoisha} /></div>
          <div className="row between"><span>Adjustment</span><Money poisha={invoice.adjustmentPoisha} /></div>
          <div className="row between bold"><span>Total</span><Money poisha={invoice.totalPoisha} /></div>
          <div className="row between"><span>Paid</span><Money poisha={invoice.paidPoisha} /></div>
          <div className="row between bold grand"><span>Due</span><Money poisha={invoice.duePoisha} /></div>
        </div>

        {invoice.notes ? <p className="muted mt">Note: {invoice.notes}</p> : null}

        <h4 className="mt">Payment history</h4>
        {invoice.payments.length === 0 ? (
          <p className="muted">No payments recorded yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Code</th><th>When</th><th>Method</th><th>Amount</th><th>By</th></tr></thead>
            <tbody>
              {invoice.payments.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.paymentCode}</td>
                  <td>{fmtDateTime(p.paidAt)}</td>
                  <td>{p.method}</td>
                  <td><Money poisha={p.amountPoisha} /></td>
                  <td>{p.receivedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {payOpen ? (
        <RecordPaymentModal
          invoice={invoice}
          onClose={() => setPayOpen(false)}
          onSaved={() => {
            setPayOpen(false);
            toast.success('Payment recorded.');
            props.onChanged();
          }}
        />
      ) : null}

      {voidOpen ? (
        <Modal
          title="Void invoice"
          onClose={() => setVoidOpen(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setVoidOpen(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                disabled={busy || !voidReason.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api('invoices.void', { id: invoice.id, reason: voidReason.trim() });
                    toast.success('Invoice voided.');
                    setVoidOpen(false);
                    props.onChanged();
                  } catch (e) {
                    toast.error(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Void invoice
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="alert danger">
              Voiding keeps the record for audit purposes but removes it from totals. This cannot be undone.
            </div>
            <Field label="Reason" required>
              <input className="input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Record payment (partial payments supported)                         */
/* ------------------------------------------------------------------ */

export function RecordPaymentModal(props: {
  invoice: InvoiceRecord;
  onClose(): void;
  onSaved(): void;
}): JSX.Element {
  const [amountText, setAmountText] = useState((props.invoice.duePoisha / 100).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    let amount: number;
    try {
      amount = parseMoneyToPoisha(amountText);
      if (amount <= 0) throw new Error('Amount must be greater than zero.');
      if (amount > props.invoice.duePoisha) {
        throw new Error(`Amount exceeds outstanding due (${formatPoisha(props.invoice.duePoisha)}).`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid amount.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api('payments.create', {
        patientId: props.invoice.patientId,
        invoiceId: props.invoice.id,
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
      title={`Record payment · ${props.invoice.invoiceCode}`}
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
        <div className="alert info">
          Outstanding due: <strong>{formatPoisha(props.invoice.duePoisha)}</strong>. Partial payments are stored as
          separate transaction records — the invoice itself is never rewritten.
        </div>
        <div className="grid cols-2">
          <Field label="Amount (৳)" required>
            <input className="input" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} autoFocus />
          </Field>
          <Field label="Method" required>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Reference" hint="Txn ID for mobile money / cheque no.">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
