/** Referrals: outgoing specialist referrals with follow-up tracking. */

import { useCallback, useEffect, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import {
  Loading,
  Modal,
  Field,
  PageHead,
  Pagination,
  statusBadge,
  EmptyState,
} from '../components/ui';
import { toast } from '../lib/store';
import { todayDhaka } from '@shared/datetime';

const PAGE_SIZE = 25;

interface ReferralRow {
  id: number;
  patientId: number;
  patientName: string;
  referredTo: string;
  reason: string;
  notes: string;
  referredOn: string;
  followUpOn: string | null;
  status: string;
  createdAt: number;
}

export default function ReferralsPage(): JSX.Element {
  const [items, setItems] = useState<ReferralRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<ReferralRow | null>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('referrals.list', { page, pageSize: PAGE_SIZE });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHead
        title="Referrals"
        subtitle={`${total} referrals`}
        actions={
          perms.has('referral.manage') ? (
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> New referral
            </button>
          ) : null
        }
      />

      <div className="card">
        {error ? <div className="alert danger" style={{ margin: 16 }}>{error}</div> : null}
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<UserPlus size={26} />}
            title="No referrals"
            body="Record referrals to specialists with follow-up dates so nothing falls through."
            action={
              perms.has('referral.manage') ? (
                <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>New referral</button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Referred to</th>
                    <th>Reason</th>
                    <th>Referred on</th>
                    <th>Follow-up</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} onClick={() => setDetail(r)}>
                      <td className="bold">{r.patientName}</td>
                      <td>{r.referredTo}</td>
                      <td className="truncate">{r.reason}</td>
                      <td>{r.referredOn}</td>
                      <td>{r.followUpOn ?? '—'}</td>
                      <td>{statusBadge(r.status)}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setDetail(r); }}>
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
        <CreateReferralModal
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            setPage(1);
            void load();
            toast.success('Referral recorded.');
          }}
        />
      ) : null}

      {detail ? (
        <DetailModal
          row={detail}
          canEdit={perms.has('referral.manage')}
          onClose={() => setDetail(null)}
          onSaved={() => {
            setDetail(null);
            void load();
            toast.success('Referral updated.');
          }}
        />
      ) : null}
    </div>
  );
}

function CreateReferralModal(props: { onClose(): void; onSaved(): void }): JSX.Element {
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<{ id: number; fullName: string; patientCode: string }[]>([]);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [form, setForm] = useState({
    referredTo: '',
    reason: '',
    notes: '',
    referredOn: todayDhaka(),
    followUpOn: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      void api('patients.list', { search: query, preset: 'all', status: 'active', sort: 'name_asc', page: 1, pageSize: 8 })
        .then((r) => setPatients(r.items))
        .catch(() => setPatients([]));
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);

  const submit = async (): Promise<void> => {
    if (!patientId) {
      setErr('Choose a patient.');
      return;
    }
    if (!form.referredTo.trim() || !form.reason.trim()) {
      setErr('Destination and reason are required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api('referrals.create', {
        patientId,
        visitId: null,
        referredTo: form.referredTo.trim(),
        reason: form.reason.trim(),
        notes: form.notes,
        referredOn: form.referredOn,
        followUpOn: form.followUpOn || null,
        status: 'pending',
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
      title="New referral"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Create referral'}
          </button>
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
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
                  <span className="secondary">{p.patientCode}</span>
                </button>
              ))}
            </div>
          ) : null}
        </Field>
        <div className="grid cols-2">
          <Field label="Referred to" required full>
            <input className="input" value={form.referredTo} onChange={(e) => setForm({ ...form, referredTo: e.target.value })} placeholder="Specialist / hospital" />
          </Field>
          <Field label="Reason" required full>
            <textarea className="textarea" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
          <Field label="Referred on"><input className="input" type="date" value={form.referredOn} onChange={(e) => setForm({ ...form, referredOn: e.target.value })} /></Field>
          <Field label="Follow-up on"><input className="input" type="date" value={form.followUpOn} onChange={(e) => setForm({ ...form, followUpOn: e.target.value })} /></Field>
          <Field label="Notes" full><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function DetailModal(props: {
  row: ReferralRow;
  canEdit: boolean;
  onClose(): void;
  onSaved(): void;
}): JSX.Element {
  const [status, setStatus] = useState(props.row.status);
  const [notes, setNotes] = useState(props.row.notes);
  const [followUpOn, setFollowUpOn] = useState(props.row.followUpOn ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('referrals.update', {
        id: props.row.id,
        status: status as 'pending' | 'completed' | 'cancelled',
        notes,
        followUpOn: followUpOn || null,
      });
      props.onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Referral · ${props.row.patientName}`}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Close</button>
          {props.canEdit ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          ) : null}
        </>
      }
    >
      <div className="stack">
        <dl className="def-grid">
          <dt>Referred to</dt><dd className="bold">{props.row.referredTo}</dd>
          <dt>Reason</dt><dd>{props.row.reason}</dd>
          <dt>Referred on</dt><dd>{props.row.referredOn}</dd>
        </dl>
        <div className="grid cols-2">
          <Field label="Status">
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} disabled={!props.canEdit}>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <Field label="Follow-up on">
            <input className="input" type="date" value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} disabled={!props.canEdit} />
          </Field>
          <Field label="Notes" full>
            <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!props.canEdit} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
