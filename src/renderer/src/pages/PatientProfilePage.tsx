/** Patient profile: identity, clinical record, timeline, attachments, billing. */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Pencil,
  Stethoscope,
  CalendarPlus,
  Paperclip,
  Printer,
  UserPlus,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type {
  AttachmentRecord,
  InvoiceRecord,
  PatientRecord,
  PrescriptionRecord,
  TimelineEvent,
  VisitRecord,
} from '@shared/types';
import {
  Modal,
  Field,
  Money,
  statusBadge,
  Loading,
  fmtDateTime,
  fmtBytes,
} from '../components/ui';
import { toast } from '../lib/store';
import { formatDhakaDateHuman, epochToDhakaDate, ageFromDob } from '@shared/datetime';

type Tab = 'overview' | 'timeline' | 'visits' | 'prescriptions' | 'invoices' | 'attachments';

const TIMELINE_FILTERS = ['all', 'visit', 'prescription', 'invoice', 'payment', 'appointment', 'referral', 'attachment'] as const;

export default function PatientProfilePage(): JSX.Element {
  const { id } = useParams();
  const nav = useNavigate();
  const patientId = Number(id);
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [timelineFilter, setTimelineFilter] = useState<string>('all');
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [rxs, setRxs] = useState<PrescriptionRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [visitOpen, setVisitOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
  }, []);

  const loadPatient = useCallback(() => {
    void api('patients.get', { id: patientId })
      .then(setPatient)
      .catch((e) => setError(errorMessage(e)));
  }, [patientId]);

  useEffect(() => {
    if (Number.isFinite(patientId)) loadPatient();
  }, [patientId, loadPatient]);

  useEffect(() => {
    if (!patient) return;
    if (tab === 'timeline') {
      void api('patients.timeline', { id: patientId, filter: timelineFilter, page: 1, pageSize: 100 })
        .then((r) => setTimeline(r.items))
        .catch((e) => toast.error(errorMessage(e)));
    }
    if (tab === 'visits') {
      void api('visits.listByPatient', { patientId })
        .then(setVisits)
        .catch((e) => toast.error(errorMessage(e)));
    }
    if (tab === 'prescriptions') {
      void api('prescriptions.list', { patientId, page: 1, pageSize: 100 })
        .then((r) => setRxs(r.items))
        .catch((e) => toast.error(errorMessage(e)));
    }
    if (tab === 'invoices') {
      void api('invoices.list', { patientId, status: 'all', search: '', preset: 'all', page: 1, pageSize: 100 })
        .then((r) => setInvoices(r.items))
        .catch((e) => toast.error(errorMessage(e)));
    }
    if (tab === 'attachments') {
      void api('attachments.list', { entityType: 'patient', entityId: patientId })
        .then(setAttachments)
        .catch((e) => toast.error(errorMessage(e)));
    }
  }, [tab, patient, patientId, timelineFilter]);

  if (error) {
    return (
      <div className="page">
        <div className="alert danger">{error}</div>
        <button className="btn btn-secondary mt" onClick={() => nav('/patients')}>
          <ArrowLeft size={16} /> Back to patients
        </button>
      </div>
    );
  }
  if (!patient) return <Loading />;

  const age = patient.ageYears ?? (patient.dob ? ageFromDob(patient.dob) : null);

  return (
    <div className="page">
      <button className="btn btn-ghost btn-sm mb" onClick={() => nav('/patients')}>
        <ArrowLeft size={15} /> All patients
      </button>

      <div className="patient-hero">
        <div className="patient-hero-main">
          <span className="avatar xl">{patient.fullName.slice(0, 1).toUpperCase()}</span>
          <div>
            <div className="row gap-sm">
              <h1>{patient.fullName}</h1>
              {statusBadge(patient.status)}
            </div>
            <div className="patient-meta">
              <span className="mono">{patient.patientCode}</span>
              <span>{age != null ? `${age} years` : 'Age unknown'}</span>
              {patient.gender ? <span>{patient.gender}</span> : null}
              {patient.bloodGroup ? <span>Blood {patient.bloodGroup}</span> : null}
              <span>{patient.phone || 'No phone'}</span>
              <span>Registered {formatDhakaDateHuman(epochToDhakaDate(patient.registeredAt))}</span>
            </div>
            {patient.allergies ? (
              <div className="alert danger mt-sm">
                <strong>Allergies:</strong> {patient.allergies}
              </div>
            ) : null}
            {patient.medicalHistory ? <div className="muted mt-sm">History: {patient.medicalHistory}</div> : null}
          </div>
        </div>
        <div className="patient-hero-actions">
          <div className="money-block">
            <span className="muted">Outstanding</span>
            {patient.duePoisha > 0 ? (
              <Money poisha={patient.duePoisha} className="danger-text" />
            ) : (
              <span className="muted">Settled</span>
            )}
          </div>
          {perms.has('clinical.create') ? (
            <button className="btn btn-primary" onClick={() => setVisitOpen(true)}>
              <Stethoscope size={16} /> New visit
            </button>
          ) : null}
          {perms.has('appointment.create') ? (
            <button className="btn btn-secondary" onClick={() => nav('/appointments')}>
              <CalendarPlus size={16} /> Book appointment
            </button>
          ) : null}
          <div className="row gap-sm">
            <button className="btn btn-secondary" onClick={() => nav(`/patients/${patient.id}/chart`)}>
              Dental chart
            </button>
            {perms.has('referral.manage') ? (
              <button className="btn btn-secondary" onClick={() => setRefOpen(true)}>
                <UserPlus size={16} /> Refer
              </button>
            ) : null}
            {perms.has('referral.view') ? (
              <button className="btn btn-ghost btn-sm" onClick={() => nav('/referrals')}>
                All referrals
              </button>
            ) : null}
            {perms.has('patient.edit') ? (
              <button className="btn btn-ghost btn-icon" onClick={() => setEditOpen(true)} aria-label="Edit patient">
                <Pencil size={16} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(['overview', 'timeline', 'visits', 'prescriptions', 'invoices', 'attachments'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'invoices' ? 'Invoices' : t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="tab-panel">
        {tab === 'overview' ? (
          <div className="grid cols-2">
            <div className="card card-pad">
              <h3 className="mb">Registration</h3>
              <dl className="def-grid">
                <dt>Registered</dt><dd>{formatDhakaDateHuman(epochToDhakaDate(patient.registeredAt))}</dd>
                <dt>Phone</dt><dd>{patient.phone || '—'}</dd>
                <dt>Emergency</dt><dd>{patient.emergencyContact || '—'} {patient.emergencyPhone}</dd>
                <dt>Address</dt><dd>{patient.address || '—'}</dd>
                <dt>Language</dt><dd>{patient.preferredLanguage || 'Not specified'}</dd>
                <dt>Visits</dt><dd>{patient.visitCount}</dd>
                <dt>Last visit</dt><dd>{patient.lastVisitAt ? formatDhakaDateHuman(epochToDhakaDate(patient.lastVisitAt)) : '—'}</dd>
              </dl>
            </div>
            <div className="card card-pad">
              <h3 className="mb">Clinical summary</h3>
              <dl className="def-grid">
                <dt>Presenting problem</dt><dd>{patient.presentingProblem || '—'}</dd>
                <dt>Allergies</dt><dd>{patient.allergies || 'None recorded'}</dd>
                <dt>Medical history</dt><dd>{patient.medicalHistory || '—'}</dd>
                <dt>Previous dental</dt><dd>{patient.previousHistory || '—'}</dd>
                <dt>Notes</dt><dd>{patient.notes || '—'}</dd>
              </dl>
            </div>
          </div>
        ) : null}

        {tab === 'timeline' ? (
          <div className="stack">
            <div className="filters">
              <select className="select" value={timelineFilter} onChange={(e) => setTimelineFilter(e.target.value)} aria-label="Timeline filter">
                {TIMELINE_FILTERS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            {timeline.length === 0 ? (
              <p className="muted">No timeline events yet.</p>
            ) : (
              <ol className="timeline">
                {timeline.map((ev) => (
                  <li key={ev.id}>
                    <span className={`dot ${ev.type}`} />
                    <div className="tl-body">
                      <div className="row between">
                        <strong>{ev.title}</strong>
                        <span className="muted nowrap">{fmtDateTime(ev.at)}</span>
                      </div>
                      {ev.detail ? <p className="muted">{ev.detail}</p> : null}
                      {ev.actor ? <small className="muted">by {ev.actor}</small> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}

        {tab === 'visits' ? (
          visits.length === 0 ? (
            <p className="muted">No visits recorded. Use “New visit” to document a consultation.</p>
          ) : (
            <div className="stack">
              {visits.map((v) => (
                <div className="card card-pad" key={v.id}>
                  <div className="row between mb-sm">
                    <div className="row gap-sm">
                      <strong>{v.visitCode}</strong>
                      <span className="muted">{fmtDateTime(v.visitedAt)}</span>
                      <span className="muted">· {v.dentistName}</span>
                    </div>
                    {v.followUpAt ? <span className="badge badge-amber">Follow-up {formatDhakaDateHuman(epochToDhakaDate(v.followUpAt))}</span> : null}
                  </div>
                  <dl className="def-grid">
                    {v.chiefComplaint ? <><dt>CC</dt><dd>{v.chiefComplaint}</dd></> : null}
                    {v.examination ? <><dt>Examination</dt><dd>{v.examination}</dd></> : null}
                    {v.findings ? <><dt>Findings</dt><dd>{v.findings}</dd></> : null}
                    {v.diagnosis ? <><dt>Diagnosis</dt><dd>{v.diagnosis}</dd></> : null}
                    {v.treatmentPerformed ? <><dt>Treatment done</dt><dd>{v.treatmentPerformed}</dd></> : null}
                    {v.treatmentPlan ? <><dt>Plan</dt><dd>{v.treatmentPlan}</dd></> : null}
                    {v.advice ? <><dt>Advice</dt><dd>{v.advice}</dd></> : null}
                    {v.notes ? <><dt>Notes</dt><dd>{v.notes}</dd></> : null}
                  </dl>
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === 'prescriptions' ? (
          rxs.length === 0 ? (
            <p className="muted">No prescriptions yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-hover">
                <thead><tr><th>Code</th><th>Issued</th><th>Dentist</th><th>Medicines</th><th></th></tr></thead>
                <tbody>
                  {rxs.map((rx) => (
                    <tr key={rx.id}>
                      <td className="mono">{rx.prescriptionCode}</td>
                      <td>{formatDhakaDateHuman(epochToDhakaDate(rx.issuedAt))}</td>
                      <td>{rx.dentistName}</td>
                      <td>{rx.items.length}</td>
                      <td className="nowrap">
                        <button className="btn btn-ghost btn-sm" onClick={() => void printDoc('prescription', rx.id)}>
                          <Printer size={14} /> Print
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === 'invoices' ? (
          invoices.length === 0 ? (
            <p className="muted">No invoices yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-hover">
                <thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Paid</th><th>Due</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="mono">{inv.invoiceCode}</td>
                      <td>{inv.invoiceDate}</td>
                      <td><Money poisha={inv.totalPoisha} /></td>
                      <td><Money poisha={inv.paidPoisha} /></td>
                      <td><Money poisha={inv.duePoisha} /></td>
                      <td>{statusBadge(inv.status)}</td>
                      <td className="nowrap">
                        <button className="btn btn-ghost btn-sm" onClick={() => nav(`/billing/invoices/${inv.id}`)}>
                          Open
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => void printDoc('invoice', inv.id)}>
                          <Printer size={14} /> Print
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === 'attachments' ? (
          <div className="stack">
            <div className="row gap">
              <button
                className="btn btn-secondary"
                disabled={!perms.has('attachment.upload')}
                onClick={() => pickAttachment()}
              >
                <Paperclip size={16} /> Add attachment
              </button>
              <span className="muted">Files are stored in the managed attachment folder and included in backups.</span>
            </div>
            {attachments.length === 0 ? (
              <p className="muted">No attachments.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>File</th><th>Size</th><th>Uploaded</th><th>By</th><th></th></tr></thead>
                  <tbody>
                    {attachments.map((a) => (
                      <tr key={a.id}>
                        <td>{a.fileName} {a.missing ? <span className="badge badge-red">missing</span> : null}</td>
                        <td>{fmtBytes(a.sizeBytes)}</td>
                        <td>{fmtDateTime(a.createdAt)}</td>
                        <td>{a.uploadedBy}</td>
                        <td className="nowrap">
                          <button className="btn btn-ghost btn-sm" onClick={() => void openAttachment(a.id)}>Open</button>
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={!perms.has('attachment.delete')}
                            onClick={() => void deleteAttachment(a.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {editOpen ? (
        <EditPatientModal
          patient={patient}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            loadPatient();
            toast.success('Patient updated.');
          }}
        />
      ) : null}

      {visitOpen ? (
        <NewVisitModal
          patientId={patient.id}
          onClose={() => setVisitOpen(false)}
          onSaved={() => {
            setVisitOpen(false);
            loadPatient();
            toast.success('Visit recorded.');
            setTab('visits');
          }}
        />
      ) : null}

      {refOpen ? (
        <NewReferralModal
          patientId={patient.id}
          onClose={() => setRefOpen(false)}
          onSaved={() => {
            setRefOpen(false);
            toast.success('Referral recorded.');
          }}
        />
      ) : null}
    </div>
  );

  async function printDoc(docType: 'prescription' | 'invoice', docId: number): Promise<void> {
    try {
      const res = await api('print.preview', { docType, docId });
      const w = window.open('', '_blank', 'width=900,height=1200');
      if (!w) {
        toast.error('Allow pop-ups to preview print documents.');
        return;
      }
      w.document.write(res.previewHtml);
      w.document.close();
      w.focus();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function pickAttachment(): Promise<void> {
    try {
      const rec = await api('attachments.pick', {
        entityType: 'patient',
        entityId: patientId,
        patientId,
        description: '',
      });
      setAttachments((list) => [rec, ...list]);
      toast.success(`Attached ${rec.fileName}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function openAttachment(attId: number): Promise<void> {
    try {
      await api('attachments.open', { id: attId });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function deleteAttachment(attId: number): Promise<void> {
    try {
      await api('attachments.delete', { id: attId });
      setAttachments((list) => list.filter((a) => a.id !== attId));
      toast.success('Attachment deleted.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
}

/* ------------------------------------------------------------------ */
/* Edit patient                                                        */
/* ------------------------------------------------------------------ */

function EditPatientModal(props: {
  patient: PatientRecord;
  onClose(): void;
  onSaved(): void;
}): JSX.Element {
  const p = props.patient;
  const [form, setForm] = useState({
    fullName: p.fullName,
    gender: p.gender,
    dob: p.dob ?? '',
    ageYears: p.ageYears != null ? String(p.ageYears) : '',
    bloodGroup: p.bloodGroup ?? '',
    phone: p.phone,
    emergencyPhone: p.emergencyPhone,
    emergencyContact: p.emergencyContact,
    address: p.address,
    presentingProblem: p.presentingProblem,
    previousHistory: p.previousHistory,
    allergies: p.allergies,
    medicalHistory: p.medicalHistory,
    notes: p.notes,
    preferredLanguage: p.preferredLanguage,
    status: p.status,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setErr(null);
    try {
      await api('patients.update', {
        id: p.id,
        fullName: form.fullName.trim(),
        gender: form.gender,
        dob: form.dob || null,
        ageYears: form.ageYears === '' ? null : Number(form.ageYears),
        bloodGroup: form.bloodGroup,
        phone: form.phone.trim(),
        emergencyPhone: form.emergencyPhone.trim(),
        emergencyContact: form.emergencyContact,
        address: form.address,
        presentingProblem: form.presentingProblem,
        previousHistory: form.previousHistory,
        allergies: form.allergies,
        medicalHistory: form.medicalHistory,
        notes: form.notes,
        preferredLanguage: form.preferredLanguage,
        status: form.status,
      });
      props.onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Edit ${p.patientCode}`}
      onClose={props.onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
        <div className="grid cols-2">
          <Field label="Full name" required full>
            <input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </Field>
          <Field label="Gender">
            <select className="select" value={form.gender ?? ''} onChange={(e) => setForm({ ...form, gender: (e.target.value || null) as typeof form.gender })}>
              <option value="">Not specified</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Date of birth">
            <input className="input" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          </Field>
          <Field label="Age (years)">
            <input className="input" type="number" min={0} max={120} value={form.ageYears} onChange={(e) => setForm({ ...form, ageYears: e.target.value })} />
          </Field>
          <Field label="Blood group">
            <select className="select" value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}>
              <option value="">Unknown</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'archived' })}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Emergency phone"><input className="input" value={form.emergencyPhone} onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })} /></Field>
          <Field label="Emergency contact" full><input className="input" value={form.emergencyContact} onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })} /></Field>
          <Field label="Address" full><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label="Presenting problem" full><textarea className="textarea" rows={2} value={form.presentingProblem} onChange={(e) => setForm({ ...form, presentingProblem: e.target.value })} /></Field>
          <Field label="Allergies" full><textarea className="textarea" rows={2} value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} /></Field>
          <Field label="Medical history" full><textarea className="textarea" rows={2} value={form.medicalHistory} onChange={(e) => setForm({ ...form, medicalHistory: e.target.value })} /></Field>
          <Field label="Previous dental history" full><textarea className="textarea" rows={2} value={form.previousHistory} onChange={(e) => setForm({ ...form, previousHistory: e.target.value })} /></Field>
          <Field label="Preferred language"><input className="input" value={form.preferredLanguage} onChange={(e) => setForm({ ...form, preferredLanguage: e.target.value })} /></Field>
          <Field label="Notes" full><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* New visit (clinical documentation)                                  */
/* ------------------------------------------------------------------ */

function NewVisitModal(props: { patientId: number; onClose(): void; onSaved(): void }): JSX.Element {
  const [dentists, setDentists] = useState<{ id: number; fullName: string }[]>([]);
  const [form, setForm] = useState({
    dentistId: 0,
    chiefComplaint: '',
    examination: '',
    findings: '',
    diagnosis: '',
    treatmentPerformed: '',
    treatmentPlan: '',
    advice: '',
    notes: '',
    followUp: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api('dentists.list', { includeInactive: false })
      .then((list) => {
        setDentists(list);
        if (list[0]) setForm((f) => ({ ...f, dentistId: list[0]!.id }));
      })
      .catch((e) => setErr(errorMessage(e)));
  }, []);

  const save = async (): Promise<void> => {
    if (!form.dentistId) {
      setErr('No active dentist available. Add a dentist under Staff & Users first.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api('visits.create', {
        patientId: props.patientId,
        dentistId: form.dentistId,
        appointmentId: null,
        chiefComplaint: form.chiefComplaint,
        examination: form.examination,
        findings: form.findings,
        diagnosis: form.diagnosis,
        treatmentPerformed: form.treatmentPerformed,
        treatmentPlan: form.treatmentPlan,
        advice: form.advice,
        followUpAt: form.followUp ? new Date(`${form.followUp}T06:00:00Z`).getTime() : null,
        notes: form.notes,
        clinicalOptions: [],
        treatments: [],
      });
      props.onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Record a visit"
      onClose={props.onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save visit'}
          </button>
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
        <div className="grid cols-2">
          <Field label="Dentist" required full>
            <select className="select" value={form.dentistId} onChange={(e) => setForm({ ...form, dentistId: Number(e.target.value) })}>
              {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
          </Field>
          <Field label="Chief complaint" full><textarea className="textarea" rows={2} value={form.chiefComplaint} onChange={(e) => setForm({ ...form, chiefComplaint: e.target.value })} /></Field>
          <Field label="Examination (O/E)" full><textarea className="textarea" rows={2} value={form.examination} onChange={(e) => setForm({ ...form, examination: e.target.value })} /></Field>
          <Field label="Findings" full><textarea className="textarea" rows={2} value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} /></Field>
          <Field label="Diagnosis" full><textarea className="textarea" rows={2} value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></Field>
          <Field label="Treatment performed" full><textarea className="textarea" rows={2} value={form.treatmentPerformed} onChange={(e) => setForm({ ...form, treatmentPerformed: e.target.value })} /></Field>
          <Field label="Treatment plan" full><textarea className="textarea" rows={2} value={form.treatmentPlan} onChange={(e) => setForm({ ...form, treatmentPlan: e.target.value })} /></Field>
          <Field label="Advice" full><textarea className="textarea" rows={2} value={form.advice} onChange={(e) => setForm({ ...form, advice: e.target.value })} /></Field>
          <Field label="Follow-up date"><input className="input" type="date" value={form.followUp} onChange={(e) => setForm({ ...form, followUp: e.target.value })} /></Field>
          <Field label="Notes" full><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Referral                                                            */
/* ------------------------------------------------------------------ */

function NewReferralModal(props: { patientId: number; onClose(): void; onSaved(): void }): JSX.Element {
  const [form, setForm] = useState({
    referredTo: '',
    reason: '',
    notes: '',
    referredOn: new Date().toISOString().slice(0, 10),
    followUpOn: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (!form.referredTo.trim() || !form.reason.trim()) {
      setErr('Referral destination and reason are required.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api('referrals.create', {
        patientId: props.patientId,
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
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New referral"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save referral'}
          </button>
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
        <Field label="Referred to" required>
          <input className="input" value={form.referredTo} onChange={(e) => setForm({ ...form, referredTo: e.target.value })} placeholder="Specialist / hospital name" />
        </Field>
        <Field label="Reason" required>
          <textarea className="textarea" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <div className="grid cols-2">
          <Field label="Referred on"><input className="input" type="date" value={form.referredOn} onChange={(e) => setForm({ ...form, referredOn: e.target.value })} /></Field>
          <Field label="Follow-up on"><input className="input" type="date" value={form.followUpOn} onChange={(e) => setForm({ ...form, followUpOn: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><textarea className="textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
