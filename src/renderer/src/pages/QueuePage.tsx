/** Today's queue: walk-ins, check-in, start/complete/skip/recall flow. */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListOrdered, UserPlus, Play, CheckCircle2, SkipForward, RotateCcw, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { DentistRecord, QueueEntry } from '@shared/types';
import { Loading, Modal, Field, PageHead, EmptyState, fmtDateTime } from '../components/ui';
import { toast } from '../lib/store';
import { todayDhaka } from '@shared/datetime';

export default function QueuePage(): JSX.Element {
  const nav = useNavigate();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [dentists, setDentists] = useState<DentistRecord[]>([]);
  const [dentistFilter, setDentistFilter] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const date = todayDhaka();

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
    void api('dentists.list', { includeInactive: false }).then(setDentists).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('queue.list', {
        date,
        ...(dentistFilter !== 'all' ? { dentistId: dentistFilter } : {}),
      });
      setEntries(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [date, dentistFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const advance = async (id: number, action: 'start' | 'complete' | 'skip' | 'recall'): Promise<void> => {
    try {
      const res = await api('queue.advance', { id, action });
      setEntries(res.entries);
      toast.success(
        action === 'start' ? 'Visit started.'
        : action === 'complete' ? 'Visit completed.'
        : action === 'skip' ? 'Patient skipped — they return to the waiting list.'
        : 'Patient recalled to the queue.',
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async (id: number): Promise<void> => {
    try {
      await api('queue.remove', { id });
      setEntries((list) => list.filter((e) => e.id !== id));
      toast.success('Removed from queue.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const canManage = perms.has('queue.manage');
  const waiting = entries.filter((e) => e.status === 'waiting');
  const inProgress = entries.filter((e) => e.status === 'in_progress');
  const others = entries.filter((e) => e.status === 'completed' || e.status === 'skipped');

  const renderRow = (e: QueueEntry): JSX.Element => (
    <div className={`queue-row status-${e.status}`} key={e.id}>
      <span className="q-pos">{e.status === 'in_progress' ? '▶' : e.position}</span>
      <div className="q-main">
        <div className="row gap-sm">
          <button className="link bold" onClick={() => nav(`/patients/${e.patientId}`)}>
            {e.patientName}
          </button>
          <span className="mono muted">{e.patientCode}</span>
          {e.walkIn ? <span className="badge badge-blue">walk-in</span> : null}
        </div>
        <small className="muted">
          {e.dentistName} · checked in {fmtDateTime(e.checkedInAt)}
          {e.waitedMinutes > 0 && e.status === 'waiting' ? ` · waiting ${e.waitedMinutes} min` : ''}
        </small>
      </div>
      <div className="q-actions">
        {canManage && e.status === 'waiting' ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => void advance(e.id, 'start')}>
              <Play size={14} /> Start
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => void advance(e.id, 'skip')} title="Skip">
              <SkipForward size={14} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void remove(e.id)} title="Remove">
              <X size={14} />
            </button>
          </>
        ) : null}
        {canManage && e.status === 'in_progress' ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => void advance(e.id, 'complete')}>
              <CheckCircle2 size={14} /> Complete
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => void advance(e.id, 'recall')} title="Back to waiting">
              <RotateCcw size={14} /> Recall
            </button>
          </>
        ) : null}
        {canManage && e.status === 'skipped' ? (
          <button className="btn btn-secondary btn-sm" onClick={() => void advance(e.id, 'recall')}>
            <RotateCcw size={14} /> Recall
          </button>
        ) : null}
        {e.status === 'completed' ? <span className="badge badge-green">completed</span> : null}
      </div>
    </div>
  );

  return (
    <div className="page">
      <PageHead
        title="Queue"
        subtitle={`${date} · ${waiting.length} waiting · ${inProgress.length} in progress`}
        actions={
          <div className="row gap-sm">
            <select
              className="select"
              value={dentistFilter === 'all' ? 'all' : String(dentistFilter)}
              onChange={(e) => setDentistFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              aria-label="Dentist"
            >
              <option value="all">All dentists</option>
              {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
            {perms.has('appointment.view') ? (
              <button className="btn btn-primary" onClick={() => setWalkInOpen(true)} disabled={!canManage}>
                <UserPlus size={16} /> Add walk-in
              </button>
            ) : null}
          </div>
        }
      />

      {error ? <div className="alert danger">{error}</div> : null}
      {loading ? (
        <Loading />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<ListOrdered size={26} />}
          title="Queue is empty"
          body="Patients appear here when their appointment is checked in, or when you add a walk-in."
        />
      ) : (
        <div className="grid cols-2 mt">
          <div className="card">
            <div className="card-head"><h3>In progress ({inProgress.length})</h3></div>
            <div className="card-body stack">
              {inProgress.length === 0 ? <p className="muted">No one in the chair right now.</p> : inProgress.map(renderRow)}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Waiting ({waiting.length})</h3></div>
            <div className="card-body stack">
              {waiting.length === 0 ? <p className="muted">No one waiting.</p> : waiting.map(renderRow)}
            </div>
          </div>
          {others.length > 0 ? (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div className="card-head"><h3>Earlier today ({others.length})</h3></div>
              <div className="card-body stack">{others.map(renderRow)}</div>
            </div>
          ) : null}
        </div>
      )}

      {walkInOpen ? (
        <WalkInModal
          dentists={dentists}
          onClose={() => setWalkInOpen(false)}
          onAdded={() => {
            setWalkInOpen(false);
            void load();
            toast.success('Walk-in added to the queue.');
          }}
        />
      ) : null}
    </div>
  );
}

function WalkInModal(props: {
  dentists: DentistRecord[];
  onClose(): void;
  onAdded(): void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [patients, setPatients] = useState<{ id: number; fullName: string; patientCode: string; phone: string }[]>([]);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [dentistId, setDentistId] = useState<number>(props.dentists[0]?.id ?? 0);
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
      setErr('Choose a patient first.');
      return;
    }
    if (!dentistId) {
      setErr('Choose a dentist.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api('queue.addWalkIn', { patientId, dentistId, date: todayDhaka() });
      props.onAdded();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add walk-in to queue"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Adding…' : 'Add to queue'}
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
            placeholder="Search by name, code or phone…"
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
        <Field label="Dentist" required>
          <select className="select" value={dentistId} onChange={(e) => setDentistId(Number(e.target.value))}>
            {props.dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
        </Field>
        <div className="alert info">
          Walk-ins skip appointment conflict checks — they are added straight to today&apos;s queue.
        </div>
      </div>
    </Modal>
  );
}
