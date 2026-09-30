/** First-run setup wizard: clinic info → dentists → admin → backup → printers. */

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Building2, Stethoscope, UserCog, HardDrive, Printer } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { toast } from '../lib/store';
import { ChipInput, Field, Loading } from '../components/ui';

const STEPS = [
  { key: 'clinic', label: 'Clinic Information', icon: <Building2 size={16} /> },
  { key: 'dentists', label: 'Dentists', icon: <Stethoscope size={16} /> },
  { key: 'admin', label: 'Administrator', icon: <UserCog size={16} /> },
  { key: 'backup', label: 'Backup Folder', icon: <HardDrive size={16} /> },
  { key: 'printers', label: 'Printer Profiles', icon: <Printer size={16} /> },
] as const;

interface DentistDraft {
  name: string;
  designations: string[];
  qualifications: string[];
  phone: string;
  email: string;
}

export default function SetupWizard(props: { onComplete(): void }): JSX.Element {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clinic
  const [clinicName, setClinicName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');

  // Dentists
  const [dentists, setDentists] = useState<DentistDraft[]>([
    { name: '', designations: [], qualifications: [], phone: '', email: '' },
  ]);

  // Admin
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [lockMin, setLockMin] = useState<5 | 10 | 15 | 30>(15);

  // Backup
  const [backupPath, setBackupPath] = useState('');
  const [autoBackup, setAutoBackup] = useState(true);
  const [autoSchedule, setAutoSchedule] = useState<'7d' | '15d' | '30d'>('7d');

  // Printers
  const [loadSuggested, setLoadSuggested] = useState(true);

  const pickFolder = async (): Promise<void> => {
    try {
      const res = await api('backup.pickFolder', {});
      if (res.folder) setBackupPath(res.folder);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const validateStep = (): string | null => {
    if (step === 0) {
      if (!clinicName.trim()) return 'Clinic name is required.';
      if (!phone.trim() && !address.trim())
        return 'Add at least a phone number or address so invoices can carry contact details.';
    }
    if (step === 1) {
      const filled = dentists.filter((d) => d.name.trim());
      if (filled.length === 0) return 'Add at least one dentist.';
      for (const d of filled) {
        if (d.designations.length === 0) return `Add at least one designation for ${d.name.trim()}.`;
      }
    }
    if (step === 2) {
      if (!displayName.trim()) return 'Administrator full name is required.';
      if (!/^[a-z0-9._-]{3,30}$/i.test(username)) {
        return 'Username must be 3–30 characters (letters, numbers, dot, underscore, dash).';
      }
      if (password.length < 10) return 'Password must be at least 10 characters.';
      if (password !== password2) return 'Passwords do not match.';
      if (![5, 10, 15, 30].includes(lockMin)) return 'Choose a valid auto-lock interval.';
    }
    if (step === 3) {
      if (autoBackup && !backupPath.trim())
        return 'Choose a backup folder, or turn off automatic backups.';
    }
    return null;
  };

  const next = (): void => {
    const err = validateStep();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const back = (): void => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const finish = async (): Promise<void> => {
    const err = validateStep();
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('setup.complete', {
        clinic: {
          clinicName: clinicName.trim(),
          address: address.trim(),
          phone: phone.trim(),
          email: email.trim(),
          website: website.trim(),
          registrationInfo: '',
          operatingHours: '',
          logoPath: null,
          footerNote: '',
          prescriptionFooter: '',
          invoiceFooter: '',
        },
        dentists: dentists
          .filter((d) => d.name.trim())
          .map((d) => ({
            fullName: d.name.trim(),
            phone: d.phone.trim(),
            email: d.email.trim(),
            bio: '',
            designations: d.designations,
            qualifications: d.qualifications,
          })),
        admin: {
          displayName: displayName.trim(),
          username: username.trim(),
          password,
        },
        autoLockMinutes: lockMin,
        backupFolder: backupPath.trim() || null,
        printerName: null,
        paperSize: 'A4' as const,
      });
      toast.success('Setup complete — welcome to Dentiva Pro!');
      props.onComplete();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <Loading label="Finishing setup…" />;

  const updateDentist = (i: number, patch: Partial<DentistDraft>): void => {
    setDentists((list) => list.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };

  return (
    <div className="wizard-shell">
      <div className="wizard-top">
        <span className="brand-mark lg">D</span>
        <div>
          <h1>Welcome to Dentiva Pro</h1>
          <p className="muted">First-run setup · takes about two minutes</p>
        </div>
      </div>

      <ol className="wizard-steps" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === step ? 'active' : i < step ? 'done' : ''}>
            <span className="marker">{i < step ? <Check size={13} /> : i + 1}</span>
            <span className="label">{s.label}</span>
          </li>
        ))}
      </ol>

      <div className="wizard-panel">
        {step === 0 ? (
          <div className="stack">
            <div className="section-title">
              <h3>Clinic information</h3>
              <p className="muted">Shown on invoices, prescriptions, reports, and printouts.</p>
            </div>
            <div className="grid cols-2">
              <Field label="Clinic name" required full>
                <input className="input" value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="e.g. Smile Dental Care" autoFocus />
              </Field>
              <Field label="Address" full>
                <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, area, city" />
              </Field>
              <Field label="Phone">
                <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+880 …" />
              </Field>
              <Field label="Email">
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="clinic@example.com" />
              </Field>
              <Field label="Website" full>
                <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
              </Field>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="stack">
            <div className="section-title">
              <h3>Dentists</h3>
              <p className="muted">
                Designations and qualifications appear exactly as entered on prescriptions and
                printouts. You can add more dentists later from Staff &amp; Users.
              </p>
            </div>
            {dentists.map((d, i) => (
              <div className="card card-pad" key={i}>
                <div className="row between mb">
                  <strong>Dentist {i + 1}</strong>
                  {dentists.length > 1 ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => setDentists((l) => l.filter((_, idx) => idx !== i))}>
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="grid cols-2">
                  <Field label="Full name" required>
                    <input className="input" value={d.name} onChange={(e) => updateDentist(i, { name: e.target.value })} placeholder="Dr. …" />
                  </Field>
                  <Field label="Phone">
                    <input className="input" value={d.phone} onChange={(e) => updateDentist(i, { phone: e.target.value })} />
                  </Field>
                  <Field label="Designations" required hint="Press Enter after each, e.g. Consultant" full>
                    <ChipInput values={d.designations} onChange={(v) => updateDentist(i, { designations: v })} placeholder="Add designation" />
                  </Field>
                  <Field label="Qualifications" hint="Degrees and certificates, e.g. BDS, FCPS" full>
                    <ChipInput values={d.qualifications} onChange={(v) => updateDentist(i, { qualifications: v })} placeholder="Add qualification" />
                  </Field>
                </div>
              </div>
            ))}
            <button
              className="btn btn-secondary"
              onClick={() => setDentists((l) => [...l, { name: '', designations: [], qualifications: [], phone: '', email: '' }])}
            >
              + Add another dentist
            </button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="stack">
            <div className="section-title">
              <h3>Administrator account</h3>
              <p className="muted">
                The administrator has every permission, including financial reports and user
                management. You can create more users after setup.
              </p>
            </div>
            <div className="grid cols-2">
              <Field label="Full name" required>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
              </Field>
              <Field label="Username" required hint="3–30 characters, letters and numbers">
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoComplete="off" />
              </Field>
              <Field label="Password" required hint="At least 10 characters">
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Confirm password" required error={password2 && password !== password2 ? 'Passwords do not match.' : undefined}>
                <input className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
              </Field>
              <Field label="Auto-lock screen after" full>
                <select className="select" value={lockMin} onChange={(e) => setLockMin(Number(e.target.value) as 5 | 10 | 15 | 30)}>
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                </select>
              </Field>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="stack">
            <div className="section-title">
              <h3>Backup folder</h3>
              <p className="muted">
                Backups are timestamped ZIP files with SHA-256 checksums. Choose a folder on a
                different drive when possible.
              </p>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={autoBackup} onChange={(e) => setAutoBackup(e.target.checked)} />
              <span>Run automatic backups on a schedule</span>
            </label>
            {autoBackup ? (
              <>
                <div className="grid cols-2">
                  <Field label="Schedule">
                    <select className="select" value={autoSchedule} onChange={(e) => setAutoSchedule(e.target.value as '7d' | '15d' | '30d')}>
                      <option value="7d">Every 7 days</option>
                      <option value="15d">Every 15 days</option>
                      <option value="30d">Every 30 days</option>
                    </select>
                  </Field>
                  <Field label="Backup folder" required>
                    <div className="row gap">
                      <input className="input" value={backupPath} onChange={(e) => setBackupPath(e.target.value)} placeholder="Choose a folder…" />
                      <button className="btn btn-secondary" type="button" onClick={() => void pickFolder()}>
                        Browse
                      </button>
                    </div>
                  </Field>
                </div>
                <div className="alert info">You can change the schedule and run manual backups later from Backup &amp; Restore.</div>
              </>
            ) : (
              <div className="alert warning">
                Automatic backups are off. You can enable them any time in Backup &amp; Restore.
              </div>
            )}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="stack">
            <div className="section-title">
              <h3>Printer profiles</h3>
              <p className="muted">
                Suggested profiles: A4 documents, A5 prescriptions, and 80&nbsp;mm thermal receipts.
                Dynamic paper-size adaptation works with any printer you attach later.
              </p>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={loadSuggested} onChange={(e) => setLoadSuggested(e.target.checked)} />
              <span>Create the three suggested printer profiles (A4, A5, thermal 80 mm)</span>
            </label>
            <div className="alert info">
              PDF export uses the Windows print workflow: pick “Microsoft Print to PDF” and the
              app adapts the layout to that paper size automatically.
            </div>
          </div>
        ) : null}

        {error ? <div className="alert danger mt">{error}</div> : null}
      </div>

      <div className="wizard-actions">
        <button className="btn btn-secondary" onClick={back} disabled={step === 0}>
          <ArrowLeft size={16} /> Back
        </button>
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary" onClick={next}>
            Continue <ArrowRight size={16} />
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => void finish()}>
            <Check size={16} /> Finish setup
          </button>
        )}
      </div>
    </div>
  );
}
