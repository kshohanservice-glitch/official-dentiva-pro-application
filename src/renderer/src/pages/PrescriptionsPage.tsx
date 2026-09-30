/** Prescriptions: builder with structured C/C · O/E · R/E, print & PDF. */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Printer, FileDown, FileText } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { DentistRecord, MedicationLine, MedicineCatalogItem, PrescriptionRecord } from '@shared/types';
import {
  Loading,
  Modal,
  Field,
  PageHead,
  Pagination,
  EmptyState,
  fmtDateTime,
} from '../components/ui';
import { toast } from '../lib/store';
import { formatDhakaDateHuman, epochToDhakaDate } from '@shared/datetime';

const PAGE_SIZE = 25;

const blankMed = (): MedicationLine => ({
  medicineName: '',
  form: '',
  strength: '',
  dose: '',
  frequency: '',
  timing: '',
  beforeAfterFood: '',
  duration: '',
  quantity: '',
  route: '',
  instructions: '',
});

const FREQUENCIES = ['', 'Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every 6 hours', 'Every 8 hours', 'Every 12 hours', 'As needed'];
const TIMINGS = ['', 'Morning', 'Daytime', 'Night', 'Morning & night', 'Before meals', 'After meals'];
const FORMS = ['', 'Tablet', 'Capsule', 'Syrup', 'Suspension', 'Cream', 'Ointment', 'Drops', 'Gel', 'Mouthwash', 'Injection'];
const FOOD = ['', 'Before food', 'After food', 'With food'];

export default function PrescriptionsPage(): JSX.Element {
  const [items, setItems] = useState<PrescriptionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<PrescriptionRecord | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [canPrint, setCanPrint] = useState(false);

  useEffect(() => {
    void api('session.state', {}).then((s) => {
      const p = new Set(s.user?.permissions ?? []);
      setCanCreate(p.has('prescription.create'));
      setCanPrint(p.has('prescription.print'));
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api('prescriptions.list', { page, pageSize: PAGE_SIZE });
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

  const printPreview = async (id: number): Promise<void> => {
    try {
      const res = await api('print.preview', { docType: 'prescription', docId: id });
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

  const printNow = async (id: number): Promise<void> => {
    try {
      const res = await api('print.run', { docType: 'prescription', docId: id, profileId: null, printerName: null, silent: false });
      if (res.printed) toast.success(res.message || 'Sent to printer.');
      else toast.warning(res.message || 'Print job was not started.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const toPdf = async (id: number): Promise<void> => {
    try {
      const res = await api('print.toPdf', { docType: 'prescription', docId: id, paperSize: 'A4' });
      if (res.saved && res.path) toast.success(`Saved PDF: ${res.path}`);
      else toast.warning('PDF save was cancelled.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <PageHead
        title="Prescriptions"
        subtitle={`${total} issued`}
        actions={
          canCreate ? (
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> New prescription
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
            icon={<FileText size={26} />}
            title="No prescriptions yet"
            body="Create a prescription with structured chief complaints, examinations, and medications."
            action={
              canCreate ? (
                <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>New prescription</button>
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
                    <th>Patient</th>
                    <th>Dentist</th>
                    <th>Issued</th>
                    <th>Medicines</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((rx) => (
                    <tr key={rx.id}>
                      <td className="mono">{rx.prescriptionCode}</td>
                      <td className="bold">{rx.patientName}</td>
                      <td>{rx.dentistName}</td>
                      <td className="nowrap">{formatDhakaDateHuman(epochToDhakaDate(rx.issuedAt))}</td>
                      <td>{rx.items.length}</td>
                      <td className="nowrap">
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetail(rx)}>View</button>
                        {canPrint ? (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => void printPreview(rx.id)} title="Preview">
                              <Printer size={14} />
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => void printNow(rx.id)} title="Print">
                              Print
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => void toPdf(rx.id)} title="Save as PDF">
                              <FileDown size={14} />
                            </button>
                          </>
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

      {createOpen ? (
        <CreatePrescriptionModal
          onClose={() => setCreateOpen(false)}
          onSaved={(rx) => {
            setCreateOpen(false);
            setPage(1);
            void load();
            toast.success(`Prescription ${rx.prescriptionCode} created.`);
          }}
        />
      ) : null}

      {detail ? (
        <PrescriptionDetail
          rx={detail}
          canPrint={canPrint}
          onClose={() => setDetail(null)}
          onPrint={() => void printNow(detail.id)}
          onPdf={() => void toPdf(detail.id)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

function CreatePrescriptionModal(props: {
  onClose(): void;
  onSaved(rx: PrescriptionRecord): void;
}): JSX.Element {
  const [step, setStep] = useState<'patient' | 'doctor' | 'details' | 'meds'>('patient');
  const [patients, setPatients] = useState<{ id: number; fullName: string; patientCode: string; phone: string }[]>([]);
  const [query, setQuery] = useState('');
  const [patientId, setPatientId] = useState<number | null>(null);
  const [patientLabel, setPatientLabel] = useState('');
  const [dentists, setDentists] = useState<DentistRecord[]>([]);
  const [dentistId, setDentistId] = useState(0);
  const [chief, setChief] = useState('');
  const [oe, setOe] = useState('');
  const [re, setRe] = useState('');
  const [advice, setAdvice] = useState('');
  const [notes, setNotes] = useState('');
  const [ccOptions, setCcOptions] = useState<{ id: number; label: string }[]>([]);
  const [oeOptions, setOeOptions] = useState<{ id: number; label: string }[]>([]);
  const [reOptions, setReOptions] = useState<{ id: number; label: string }[]>([]);
  const [meds, setMeds] = useState<MedicationLine[]>([blankMed()]);
  const [catalog, setCatalog] = useState<MedicineCatalogItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api('dentists.list', { includeInactive: false })
      .then((list) => {
        setDentists(list);
        if (list[0]) setDentistId(list[0].id);
      })
      .catch(() => undefined);
    void api('clinical.options', { section: 'cc' }).then(setCcOptions).catch(() => undefined);
    void api('clinical.options', { section: 'oe' }).then(setOeOptions).catch(() => undefined);
    void api('clinical.options', { section: 're' }).then(setReOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void api('patients.list', { search: query, preset: 'all', status: 'active', sort: 'name_asc', page: 1, pageSize: 8 })
        .then((r) => setPatients(r.items))
        .catch(() => setPatients([]));
    }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (step === 'meds') {
      void api('prescriptions.medicines', { search: '' }).then(setCatalog).catch(() => undefined);
    }
  }, [step]);

  const appendOption = (label: string, current: string, set: (v: string) => void): void => {
    if (!label) return;
    set(current ? `${current}\n${label}` : label);
  };

  const setMed = (i: number, patch: Partial<MedicationLine>): void => {
    setMeds((list) => list.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };

  const submit = async (): Promise<void> => {
    if (!patientId) {
      setErr('Choose a patient.');
      setStep('patient');
      return;
    }
    if (!dentistId) {
      setErr('Choose a dentist.');
      setStep('doctor');
      return;
    }
    const validMeds = meds.filter((m) => m.medicineName.trim());
    if (validMeds.length === 0) {
      setErr('Add at least one medicine.');
      setStep('meds');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const rx = await api('prescriptions.create', {
        patientId,
        dentistId,
        visitId: null,
        chiefComplaint: chief.trim(),
        onExamination: oe.trim(),
        restExamination: re.trim(),
        advice: advice.trim(),
        notes: notes.trim(),
        items: validMeds.map((m) => ({
          medicineName: m.medicineName.trim(),
          form: m.form,
          strength: m.strength,
          dose: m.dose,
          frequency: m.frequency,
          timing: m.timing,
          beforeAfterFood: m.beforeAfterFood,
          duration: m.duration,
          quantity: m.quantity,
          route: m.route,
          instructions: m.instructions,
        })),
      });
      props.onSaved(rx);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const steps: { key: typeof step; label: string }[] = [
    { key: 'patient', label: 'Patient' },
    { key: 'doctor', label: 'Dentist' },
    { key: 'details', label: 'Clinical notes' },
    { key: 'meds', label: 'Medicines' },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <Modal
      title="New prescription"
      onClose={props.onClose}
      size="xl"
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          {stepIndex > 0 ? (
            <button className="btn btn-secondary" onClick={() => setStep(steps[stepIndex - 1]!.key)}>
              Back
            </button>
          ) : null}
          {step !== 'meds' ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                setErr(null);
                setStep(steps[stepIndex + 1]!.key);
              }}
            >
              Next
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Saving…' : 'Create prescription'}
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
        <ol className="wizard-steps compact">
          {steps.map((s, i) => (
            <li key={s.key} className={i === stepIndex ? 'active' : i < stepIndex ? 'done' : ''}>
              <span className="marker">{i < stepIndex ? '✓' : i + 1}</span>
              <span className="label">{s.label}</span>
            </li>
          ))}
        </ol>

        {step === 'patient' ? (
          <div className="stack">
            <Field label="Search patient" required>
              <input
                className="input"
                value={patientLabel || query}
                placeholder="Name, code or phone…"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPatientLabel('');
                  setPatientId(null);
                }}
                autoFocus
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
                        setErr(null);
                      }}
                    >
                      <span className="primary">{p.fullName}</span>
                      <span className="secondary">{p.patientCode} · {p.phone}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>
            {patientId ? <div className="alert info">Patient selected. Continue to the dentist step.</div> : null}
          </div>
        ) : null}

        {step === 'doctor' ? (
          <div className="stack">
            <Field label="Prescribing dentist" required>
              <select className="select" value={dentistId} onChange={(e) => setDentistId(Number(e.target.value))} autoFocus>
                {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
              </select>
            </Field>
            <p className="muted">
              Designations and qualifications print exactly as configured in Staff &amp; Users.
            </p>
          </div>
        ) : null}

        {step === 'details' ? (
          <div className="stack">
            <Field label="Chief complaint (C/C)" full
              hint="Click suggestions to append — you can edit freely">
              <textarea className="textarea" rows={3} value={chief} onChange={(e) => setChief(e.target.value)} />
            </Field>
            <div className="chip-row">
              {ccOptions.map((o) => (
                <button key={o.id} className="chip" onClick={() => appendOption(o.label, chief, setChief)} type="button">
                  + {o.label}
                </button>
              ))}
            </div>

            <Field label="On examination (O/E)" full>
              <textarea className="textarea" rows={3} value={oe} onChange={(e) => setOe(e.target.value)} />
            </Field>
            <div className="chip-row">
              {oeOptions.map((o) => (
                <button key={o.id} className="chip" onClick={() => appendOption(o.label, oe, setOe)} type="button">
                  + {o.label}
                </button>
              ))}
            </div>

            <Field label="Radiographic examination (R/E)" full>
              <textarea className="textarea" rows={3} value={re} onChange={(e) => setRe(e.target.value)} />
            </Field>
            <div className="chip-row">
              {reOptions.map((o) => (
                <button key={o.id} className="chip" onClick={() => appendOption(o.label, re, setRe)} type="button">
                  + {o.label}
                </button>
              ))}
            </div>

            <Field label="Advice" full>
              <textarea className="textarea" rows={2} value={advice} onChange={(e) => setAdvice(e.target.value)} />
            </Field>
            <Field label="Notes (internal)" full>
              <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        ) : null}

        {step === 'meds' ? (
          <div className="stack">
            {catalog.length > 0 ? (
              <div className="chip-row">
                {catalog.slice(0, 12).map((m) => (
                  <button
                    key={m.id}
                    className="chip"
                    type="button"
                    onClick={() => {
                      const idx = meds.findIndex((x) => !x.medicineName.trim());
                      const target = idx === -1 ? meds.length : idx;
                      const line: MedicationLine = {
                        ...(meds[target] ?? blankMed()),
                        medicineName: m.medicineName,
                        form: m.form,
                        strength: m.strength,
                        instructions: m.defaultInstructions,
                      };
                      if (idx === -1) setMeds([...meds, line]);
                      else setMed(target, line);
                    }}
                  >
                    + {m.medicineName}{m.strength ? ` ${m.strength}` : ''}
                  </button>
                ))}
              </div>
            ) : null}

            {meds.map((m, i) => (
              <div className="med-row card card-pad" key={i}>
                <div className="row between mb-sm">
                  <strong>Medicine {i + 1}</strong>
                  {meds.length > 1 ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setMeds(meds.filter((_, idx) => idx !== i))}>
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
                <div className="grid cols-3">
                  <Field label="Medicine" required>
                    <input className="input" list="med-catalog" value={m.medicineName} onChange={(e) => setMed(i, { medicineName: e.target.value })} />
                  </Field>
                  <Field label="Form">
                    <select className="select" value={m.form} onChange={(e) => setMed(i, { form: e.target.value })}>
                      {FORMS.map((f) => <option key={f} value={f}>{f || '—'}</option>)}
                    </select>
                  </Field>
                  <Field label="Strength">
                    <input className="input" value={m.strength} onChange={(e) => setMed(i, { strength: e.target.value })} placeholder="500 mg" />
                  </Field>
                  <Field label="Dose">
                    <input className="input" value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} placeholder="1 tablet" />
                  </Field>
                  <Field label="Frequency">
                    <select className="select" value={m.frequency} onChange={(e) => setMed(i, { frequency: e.target.value })}>
                      {FREQUENCIES.map((f) => <option key={f} value={f}>{f || '—'}</option>)}
                    </select>
                  </Field>
                  <Field label="Timing">
                    <select className="select" value={m.timing} onChange={(e) => setMed(i, { timing: e.target.value })}>
                      {TIMINGS.map((t) => <option key={t} value={t}>{t || '—'}</option>)}
                    </select>
                  </Field>
                  <Field label="Food">
                    <select className="select" value={m.beforeAfterFood} onChange={(e) => setMed(i, { beforeAfterFood: e.target.value })}>
                      {FOOD.map((f) => <option key={f} value={f}>{f || '—'}</option>)}
                    </select>
                  </Field>
                  <Field label="Duration">
                    <input className="input" value={m.duration} onChange={(e) => setMed(i, { duration: e.target.value })} placeholder="5 days" />
                  </Field>
                  <Field label="Quantity">
                    <input className="input" value={m.quantity} onChange={(e) => setMed(i, { quantity: e.target.value })} placeholder="10 tabs" />
                  </Field>
                </div>
                <Field label="Instructions">
                  <input className="input" value={m.instructions} onChange={(e) => setMed(i, { instructions: e.target.value })} />
                </Field>
              </div>
            ))}

            <datalist id="med-catalog">
              {catalog.map((c) => <option key={c.id} value={c.medicineName} />)}
            </datalist>

            <button className="btn btn-secondary" onClick={() => setMeds([...meds, blankMed()])}>
              <Plus size={15} /> Add another medicine
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

function PrescriptionDetail(props: {
  rx: PrescriptionRecord;
  canPrint: boolean;
  onClose(): void;
  onPrint(): void;
  onPdf(): void;
}): JSX.Element {
  const { rx } = props;
  return (
    <Modal
      title={`Prescription ${rx.prescriptionCode}`}
      onClose={props.onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Close</button>
          {props.canPrint ? (
            <>
              <button className="btn btn-secondary" onClick={props.onPdf}>
                <FileDown size={15} /> Save as PDF
              </button>
              <button className="btn btn-primary" onClick={props.onPrint}>
                <Printer size={15} /> Print
              </button>
            </>
          ) : null}
        </>
      }
    >
      <div className="rx-sheet">
        <div className="row between mb">
          <div>
            <strong>{rx.patientName}</strong>
            <div className="muted mono">{rx.patientCode}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted">{fmtDateTime(rx.issuedAt)}</div>
            <strong>{rx.dentistName}</strong>
          </div>
        </div>
        {rx.chiefComplaint ? (
          <section>
            <h4>C/C</h4>
            <p className="preserve-lines">{rx.chiefComplaint}</p>
          </section>
        ) : null}
        {rx.onExamination ? (
          <section>
            <h4>O/E</h4>
            <p className="preserve-lines">{rx.onExamination}</p>
          </section>
        ) : null}
        {rx.restExamination ? (
          <section>
            <h4>R/E</h4>
            <p className="preserve-lines">{rx.restExamination}</p>
          </section>
        ) : null}
        <section>
          <h4>Medications</h4>
          <table className="table rx-meds">
            <thead>
              <tr><th>#</th><th>Medicine</th><th>Dose</th><th>Frequency</th><th>Timing</th><th>Duration</th></tr>
            </thead>
            <tbody>
              {rx.items.map((m, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td className="bold">{m.medicineName} {m.strength}</td>
                  <td>{[m.dose, m.form].filter(Boolean).join(' · ')}</td>
                  <td>{[m.frequency, m.beforeAfterFood].filter(Boolean).join(', ')}</td>
                  <td>{[m.timing, m.instructions].filter(Boolean).join(' — ')}</td>
                  <td>{[m.duration, m.quantity].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {rx.advice ? (
          <section>
            <h4>Advice</h4>
            <p className="preserve-lines">{rx.advice}</p>
          </section>
        ) : null}
        <div className="rx-signature">
          <span>Signature</span>
          <div className="sig-line" />
          <small className="muted">{rx.dentistName}</small>
        </div>
      </div>
    </Modal>
  );
}
