/** Appointments: day & week views, conflict-safe booking, status changes. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { AppointmentRecord, DentistRecord } from '@shared/types';
import { Loading, Modal, Field, statusBadge, fmtDateTime, ConfirmDialog } from '../components/ui';
import { toast } from '../lib/store';
import { addDays, todayDhaka } from '@shared/datetime';

type ViewMode = 'day' | 'week';

const DAY_START = 9; // 09:00
const DAY_END = 21; // 21:00
const SLOT_MINUTES = 30;

function dhakaNowParts(): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Dhaka',
  });
  const [h, m] = fmt.format(new Date()).split(':');
  return { hour: Number(h), minute: Number(m) };
}

/** Epoch ms for a Dhaka wall-clock time on a YYYY-MM-DD date. */
function dhakaWallClock(date: string, hour: number, minute: number): number {
  // 2024-01-01T00:00 in Dhaka = 2023-12-31T18:00Z (offset +06:00)
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    hour - 6,
    minute,
  );
}

export default function AppointmentsPage(): JSX.Element {
  const [view, setView] = useState<ViewMode>('day');
  const [anchor, setAnchor] = useState(todayDhaka());
  const [items, setItems] = useState<AppointmentRecord[]>([]);
  const [dentists, setDentists] = useState<DentistRecord[]>([]);
  const [dentistFilter, setDentistFilter] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Captured once so clearing the URL param does not drop the prefill mid-flight.
  const [contextPatientId] = useState<number | null>(() => Number(searchParams.get('patient')) || null);

  useEffect(() => {
    if (contextPatientId) {
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume once on mount
  }, []);
  const [detail, setDetail] = useState<AppointmentRecord | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentRecord | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    void api('session.state', {}).then((s) => {
      const p = new Set(s.user?.permissions ?? []);
      setCanCreate(p.has('appointment.create'));
      setCanEdit(p.has('appointment.edit'));
    });
  }, []);

  useEffect(() => {
    void api('dentists.list', { includeInactive: false })
      .then(setDentists)
      .catch(() => setDentists([]));
  }, []);

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor };
    const dow = new Date(`${anchor}T06:00:00Z`).getUTCDay(); // Dhaka dow
    const start = addDays(anchor, -((dow + 6) % 7)); // Monday start
    const end = addDays(start, 6);
    return { from: start, to: end };
  }, [view, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('appointments.list', {
        from: range.from,
        to: range.to,
        status: 'all',
        ...(dentistFilter !== 'all' ? { dentistId: dentistFilter } : {}),
      });
      setItems(res);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, dentistFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const weekDays = useMemo(() => {
    if (view === 'day') return [anchor];
    return Array.from({ length: 7 }, (_, i) => addDays(range.from, i));
  }, [view, anchor, range.from]);

  const slots = useMemo(() => {
    const out: { hour: number; minute: number }[] = [];
    for (let h = DAY_START; h < DAY_END; h++) {
      for (let m = 0; m < 60; m += SLOT_MINUTES) out.push({ hour: h, minute: m });
    }
    return out;
  }, []);

  const statusOf = (day: string, slot: typeof slots[number]): AppointmentRecord[] =>
    items.filter((a) => {
      const p = toDhakaPartsSimple(a.startsAt);
      return p.date === day && p.hour === slot.hour && Math.floor(p.minute / SLOT_MINUTES) === Math.floor(slot.minute / SLOT_MINUTES);
    });

  const shift = (dir: 1 | -1): void => {
    if (view === 'day') setAnchor((a) => addDays(a, dir));
    else setAnchor((a) => addDays(a, dir * 7));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">
          <h1>Appointments</h1>
          <p>Conflicts are blocked before saving · Dhaka time</p>
        </div>
        <div className="page-actions">
          <div className="segmented">
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Day</button>
            <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Week</button>
          </div>
          <select
            className="select"
            value={dentistFilter === 'all' ? 'all' : String(dentistFilter)}
            onChange={(e) => setDentistFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            aria-label="Dentist filter"
          >
            <option value="all">All dentists</option>
            {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </select>
          <button className="btn btn-secondary" onClick={() => setAnchor(todayDhaka())}>Today</button>
          {canCreate ? (
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> New appointment
            </button>
          ) : null}
        </div>
      </div>

      <div className="cal-toolbar">
        <button className="btn btn-secondary btn-sm" onClick={() => shift(-1)} aria-label="Previous">
          <ChevronLeft size={15} />
        </button>
        <strong>
          {view === 'day'
            ? new Date(`${anchor}T06:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
            : `${range.from} → ${range.to}`}
        </strong>
        <button className="btn btn-secondary btn-sm" onClick={() => shift(1)} aria-label="Next">
          <ChevronRight size={15} />
        </button>
      </div>

      {error ? <div className="alert danger">{error}</div> : null}

      {loading ? (
        <Loading />
      ) : (
        <div className={`calendar ${view === 'week' ? 'week' : 'day'}`}>
          <div className="cal-head">
            <div className="cal-corner">Time</div>
            {weekDays.map((d) => (
              <div className={`cal-day-col-head${d === todayDhaka() ? ' today' : ''}`} key={d}>
                {new Date(`${d}T06:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}
              </div>
            ))}
          </div>
          <div className="cal-body">
            {slots.map((slot) => (
              <div className="cal-row" key={`${slot.hour}-${slot.minute}`}>
                <div className="cal-time">
                  {String(slot.hour).padStart(2, '0')}:{String(slot.minute).padStart(2, '0')}
                </div>
                {weekDays.map((d) => {
                  const appts = statusOf(d, slot);
                  return (
                    <div className="cal-cell" key={`${d}-${slot.hour}-${slot.minute}`}>
                      {appts.map((a) => (
                        <button
                          key={a.id}
                          className={`cal-event status-${a.status}`}
                          onClick={() => setDetail(a)}
                          title={`${a.patientName} · ${a.reason || a.dentistName}`}
                        >
                          <strong>{a.patientName}</strong>
                          <small>{a.dentistName}{a.reason ? ` · ${a.reason}` : ''}</small>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && !loading ? (
        <div className="alert info mt">
          <Calendar size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
          No appointments in this range. Use “New appointment” to book one.
        </div>
      ) : null}

      {createOpen ? (
        <AppointmentModal
          initialPatientId={contextPatientId}
          dentists={dentists}
          defaultDate={anchor}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            void load();
            toast.success('Appointment booked.');
          }}
        />
      ) : null}

      {detail ? (
        <AppointmentDetail
          appt={detail}
          canEdit={canEdit}
          onClose={() => setDetail(null)}
          onChanged={() => {
            setDetail(null);
            void load();
          }}
          onCancel={(a) => {
            setDetail(null);
            setCancelTarget(a);
          }}
        />
      ) : null}

      {cancelTarget ? (
        <ConfirmDialog
          title="Cancel appointment"
          danger
          confirmLabel="Cancel appointment"
          body={
            <div className="stack">
              <p>
                Cancel the appointment for <strong>{cancelTarget.patientName}</strong> on{' '}
                {fmtDateTime(cancelTarget.startsAt)}?
              </p>
              <div className="alert warning">This keeps the record but marks it as cancelled.</div>
            </div>
          }
          onCancel={() => setCancelTarget(null)}
          onConfirm={async () => {
            try {
              await api('appointments.update', {
                id: cancelTarget.id,
                status: 'cancelled',
                cancelReason: 'Cancelled from calendar',
              });
              toast.success('Appointment cancelled.');
              setCancelTarget(null);
              void load();
            } catch (e) {
              toast.error(errorMessage(e));
            }
          }}
        />
      ) : null}
    </div>
  );
}

function toDhakaPartsSimple(epoch: number): { date: string; hour: number; minute: number } {
  const fmtDate = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Dhaka',
  });
  const fmtTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dhaka',
  });
  const d = new Date(epoch);
  const [h, m] = fmtTime.format(d).split(':');
  return { date: fmtDate.format(d), hour: Number(h), minute: Number(m) };
}

/* ------------------------------------------------------------------ */
/* Create appointment                                                  */
/* ------------------------------------------------------------------ */

function AppointmentModal(props: {
  dentists: DentistRecord[];
  defaultDate: string;
  onClose(): void;
  onSaved(): void;
  initialPatientId?: number | null;
}): JSX.Element {
  const [patients, setPatients] = useState<{ id: number; fullName: string; patientCode: string; phone: string }[]>([]);
  const [query, setQuery] = useState('');
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [dentistId, setDentistId] = useState<number>(props.dentists[0]?.id ?? 0);
  const [date, setDate] = useState(props.defaultDate);
  const now = dhakaNowParts();
  const [time, setTime] = useState(`${String(now.hour).padStart(2, '0')}:${String(Math.ceil(now.minute / 15) * 15 % 60).padStart(2, '0')}`);
  const [duration, setDuration] = useState(30);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
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

  // Patient-context booking: prefill the patient passed via ?patient=.
  useEffect(() => {
    const id = props.initialPatientId;
    if (!id) return;
    void api('patients.get', { id })
      .then((p) => {
        setPatientId(p.id);
        setPatientLabel(`${p.fullName} (${p.patientCode})`);
      })
      .catch(() => undefined);
  }, [props.initialPatientId]);

  const startsAt = useMemo(() => {
    const [h, m] = time.split(':').map(Number);
    return dhakaWallClock(date, h ?? 9, m ?? 0);
  }, [date, time]);
  const endsAt = startsAt + duration * 60_000;

  const submit = async (): Promise<void> => {
    if (!patientId) {
      setErr('Choose a patient.');
      return;
    }
    if (!dentistId) {
      setErr('Choose a dentist.');
      return;
    }
    if (endsAt <= startsAt) {
      setErr('End time must be after start time.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Conflict pre-check for friendly messaging.
      const conflict = await api('appointments.conflicts', {
        dentistId,
        startsAt,
        endsAt,
      });
      if (conflict.conflicts.length > 0) {
        const c = conflict.conflicts[0]!;
        setErr(
          `That slot overlaps an existing appointment (${c.patientName}, ${fmtDateTime(c.startsAt)}–${fmtDateTime(c.endsAt)}). Pick another time.`,
        );
        return;
      }
      await api('appointments.create', {
        patientId,
        dentistId,
        startsAt,
        endsAt,
        reason: reason.trim(),
        notes: notes.trim(),
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
      title="New appointment"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Booking…' : 'Book appointment'}
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
          {patientId ? <span className="hint">Selected patient id {patientId}</span> : null}
        </Field>
        <div className="grid cols-2">
          <Field label="Dentist" required>
            <select className="select" value={dentistId} onChange={(e) => setDentistId(Number(e.target.value))}>
              {props.dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time" required>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Duration">
            <select className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
              <option value={90}>90 min</option>
            </select>
          </Field>
          <Field label="Reason" full>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Checkup, pain, filling…" />
          </Field>
          <Field label="Notes" full>
            <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Appointment detail / status transitions                             */
/* ------------------------------------------------------------------ */

function AppointmentDetail(props: {
  appt: AppointmentRecord;
  canEdit: boolean;
  onClose(): void;
  onChanged(): void;
  onCancel(a: AppointmentRecord): void;
}): JSX.Element {
  const { appt } = props;
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const update = async (patch: { status?: AppointmentRecord['status'] }): Promise<void> => {
    setBusy(true);
    try {
      await api('appointments.update', { id: appt.id, cancelReason: '', ...patch });
      toast.success('Appointment updated.');
      props.onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const advance = (): void => {
    if (appt.status === 'scheduled') {
      // Dedicated check-in path: sets appointment status AND enqueues the patient.
      setBusy(true);
      void api('queue.checkIn', { appointmentId: appt.id })
        .then(() => {
          toast.success('Patient checked in and added to the queue.');
          props.onChanged();
        })
        .catch((e) => toast.error(errorMessage(e)))
        .finally(() => setBusy(false));
    } else if (appt.status === 'checked_in') void update({ status: 'in_progress' });
    else if (appt.status === 'in_progress') void update({ status: 'completed' });
  };

  const nextLabel =
    appt.status === 'scheduled' ? 'Check in'
    : appt.status === 'checked_in' ? 'Start visit'
    : appt.status === 'in_progress' ? 'Complete'
    : null;

  return (
    <Modal
      title={appt.appointmentCode}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Close</button>
          <button
            className="btn btn-secondary"
            onClick={() => nav(`/patients/${appt.patientId}`)}
          >
            Open patient
          </button>
          {props.canEdit && appt.status !== 'cancelled' && appt.status !== 'completed' && appt.status !== 'no_show' ? (
            <>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void update({ status: 'no_show' })}
                title="Mark as no-show"
              >
                No-show
              </button>
              <button className="btn btn-danger-outline" disabled={busy} onClick={() => props.onCancel(appt)}>
                Cancel
              </button>
              {nextLabel ? (
                <button className="btn btn-primary" disabled={busy} onClick={advance}>
                  {nextLabel}
                </button>
              ) : null}
            </>
          ) : null}
        </>
      }
    >
      <dl className="def-grid">
        <dt>Status</dt><dd>{statusBadge(appt.status)}</dd>
        <dt>Patient</dt><dd className="bold">{appt.patientName} <span className="mono muted">{appt.patientCode}</span></dd>
        <dt>Dentist</dt><dd>{appt.dentistName}</dd>
        <dt>When</dt><dd>{fmtDateTime(appt.startsAt)} → {fmtDateTime(appt.endsAt)}</dd>
        <dt>Reason</dt><dd>{appt.reason || '—'}</dd>
        <dt>Notes</dt><dd>{appt.notes || '—'}</dd>
        {appt.cancelReason ? (<><dt>Cancellation</dt><dd>{appt.cancelReason}</dd></>) : null}
        {appt.checkedInAt ? (<><dt>Checked in</dt><dd>{fmtDateTime(appt.checkedInAt)}</dd></>) : null}
      </dl>
    </Modal>
  );
}
