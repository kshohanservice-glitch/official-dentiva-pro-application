/** Patient registry: search, filters, registration, quick actions. */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Download, Users } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { PatientRecord, PatientSummary } from '@shared/types';
import {
  Money,
  Modal,
  PageHead,
  Pagination,
  SearchInput,
  statusBadge,
  EmptyState,
  Loading,
  Field,
} from '../components/ui';
import { toast } from '../lib/store';
import { formatDhakaDateHuman, epochToDhakaDate } from '@shared/datetime';

const PAGE_SIZE = 25;

const emptyDraft = {
  fullName: '',
  gender: null as 'male' | 'female' | 'other' | null,
  dob: '',
  ageYears: '' as string | number,
  bloodGroup: '',
  phone: '',
  emergencyPhone: '',
  emergencyContact: '',
  address: '',
  presentingProblem: '',
  previousHistory: '',
  allergies: '',
  medicalHistory: '',
  notes: '',
  preferredLanguage: '',
};

export default function PatientsPage(): JSX.Element {
  const nav = useNavigate();
  const [items, setItems] = useState<PatientSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [sort, setSort] = useState<'registered_desc' | 'registered_asc' | 'name_asc' | 'last_visit'>(
    'registered_desc',
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);

  useEffect(() => {
    void api('session.state', {}).then((s) => {
      setCanCreate((s.user?.permissions ?? []).includes('patient.create'));
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('patients.list', {
        search,
        preset: 'all',
        status,
        sort,
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
  }, [search, status, sort, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const save = async (): Promise<void> => {
    if (!draft.fullName.trim()) {
      setFormError('Patient full name is required.');
      return;
    }
    const phoneOk = (v: string): boolean =>
      v.trim() === '' || /^(?:\+?880|0)?1[3-9]\d{8}$/.test(v.trim());
    if (!phoneOk(draft.phone) || !phoneOk(draft.emergencyPhone)) {
      setFormError('Phone numbers must be valid Bangladeshi numbers, e.g. 01712345678 (or empty).');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        fullName: draft.fullName.trim(),
        gender: draft.gender,
        dob: draft.dob || null,
        ageYears: draft.ageYears === '' ? null : Number(draft.ageYears),
        bloodGroup: draft.bloodGroup.trim(),
        phone: draft.phone.trim(),
        emergencyPhone: draft.emergencyPhone.trim(),
        emergencyContact: draft.emergencyContact.trim(),
        address: draft.address.trim(),
        presentingProblem: draft.presentingProblem.trim(),
        previousHistory: draft.previousHistory.trim(),
        allergies: draft.allergies.trim(),
        medicalHistory: draft.medicalHistory.trim(),
        notes: draft.notes.trim(),
        preferredLanguage: draft.preferredLanguage.trim(),
      };
      const created: PatientRecord = await api('patients.create', payload);
      toast.success(`Registered ${created.fullName} · ${created.patientCode}`);
      setShowForm(false);
      setDraft({ ...emptyDraft });
      setPage(1);
      await load();
      nav(`/patients/${created.id}`);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = async (): Promise<void> => {
    try {
      const res = await api('patients.export', {});
      toast.success(`Exported ${res.count} patients to ${res.path}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Patients"
        subtitle={`${total} registered`}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => void exportCsv()}>
              <Download size={16} /> Export
            </button>
            {canCreate ? (
              <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                <UserPlus size={16} /> Register patient
              </button>
            ) : null}
          </>
        }
      />

      <div className="filters">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, or phone…" />
        <select
          className="select"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as typeof status);
          }}
          aria-label="Status"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <select
          className="select"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label="Sort"
        >
          <option value="registered_desc">Newest first</option>
          <option value="registered_asc">Oldest first</option>
          <option value="name_asc">Name A–Z</option>
          <option value="last_visit">Last visit</option>
        </select>
      </div>

      <div className="card mt">
        {error ? <div className="alert danger" style={{ margin: 16 }}>{error}</div> : null}
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Users size={26} />}
            title="No patients found"
            body={search ? `Nothing matches “${search}”.` : 'Register your first patient to begin.'}
            action={
              canCreate ? (
                <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                  <UserPlus size={16} /> Register patient
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Age / Sex</th>
                    <th>Phone</th>
                    <th>Last visit</th>
                    <th>Visits</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} onClick={() => nav(`/patients/${p.id}`)} tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') nav(`/patients/${p.id}`); }}>
                      <td className="mono">{p.patientCode}</td>
                      <td className="bold">{p.fullName}</td>
                      <td>{p.ageYears != null ? `${p.ageYears}y` : p.dob ? formatDhakaDateHuman(p.dob) : '—'}
                        {p.gender ? ` · ${p.gender[0]?.toUpperCase()}` : ''}</td>
                      <td className="nowrap">{p.phone || '—'}</td>
                      <td className="nowrap">{p.lastVisitAt ? formatDhakaDateHuman(epochToDhakaDate(p.lastVisitAt)) : '—'}</td>
                      <td>{p.visitCount}</td>
                      <td>{p.duePoisha > 0 ? <Money poisha={p.duePoisha} className="danger-text" /> : <span className="muted">৳0</span>}</td>
                      <td>{statusBadge(p.status)}</td>
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

      {showForm ? (
        <Modal
          title="Register new patient"
          onClose={() => setShowForm(false)}
          size="lg"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Register patient'}
              </button>
            </>
          }
        >
          <div className="stack">
            {formError ? <div className="alert danger">{formError}</div> : null}
            <div className="grid cols-2">
              <Field label="Full name" required full>
                <input className="input" value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} autoFocus />
              </Field>
              <Field label="Gender">
                <select className="select" value={draft.gender ?? ''} onChange={(e) => setDraft({ ...draft, gender: (e.target.value || null) as typeof draft.gender })}>
                  <option value="">Not specified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Date of birth" hint="or fill age below">
                <input className="input" type="date" value={draft.dob} onChange={(e) => setDraft({ ...draft, dob: e.target.value })} />
              </Field>
              <Field label="Age (years)" hint="used when DOB is unknown">
                <input className="input" type="number" min={0} max={120} value={draft.ageYears} onChange={(e) => setDraft({ ...draft, ageYears: e.target.value })} />
              </Field>
              <Field label="Blood group">
                <select className="select" value={draft.bloodGroup} onChange={(e) => setDraft({ ...draft, bloodGroup: e.target.value })}>
                  <option value="">Unknown</option>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Phone" hint="required for search & reminders">
                <input className="input" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+880 …" />
              </Field>
              <Field label="Emergency contact name" full>
                <input className="input" value={draft.emergencyContact} onChange={(e) => setDraft({ ...draft, emergencyContact: e.target.value })} />
              </Field>
              <Field label="Emergency phone" full>
                <input className="input" value={draft.emergencyPhone} onChange={(e) => setDraft({ ...draft, emergencyPhone: e.target.value })} />
              </Field>
              <Field label="Address" full>
                <input className="input" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
              </Field>
              <Field label="Presenting problem" full>
                <textarea className="textarea" rows={2} value={draft.presentingProblem} onChange={(e) => setDraft({ ...draft, presentingProblem: e.target.value })} />
              </Field>
              <Field label="Allergies" full>
                <textarea className="textarea" rows={2} value={draft.allergies} onChange={(e) => setDraft({ ...draft, allergies: e.target.value })} />
              </Field>
              <Field label="Medical history" full>
                <textarea className="textarea" rows={2} value={draft.medicalHistory} onChange={(e) => setDraft({ ...draft, medicalHistory: e.target.value })} />
              </Field>
              <Field label="Previous dental history" full>
                <textarea className="textarea" rows={2} value={draft.previousHistory} onChange={(e) => setDraft({ ...draft, previousHistory: e.target.value })} />
              </Field>
              <Field label="Preferred language" hint="e.g. Bangla, English">
                <input className="input" value={draft.preferredLanguage} onChange={(e) => setDraft({ ...draft, preferredLanguage: e.target.value })} />
              </Field>
              <Field label="Notes" full>
                <textarea className="textarea" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </Field>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
