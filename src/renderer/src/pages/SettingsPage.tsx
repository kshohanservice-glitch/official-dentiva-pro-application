/** Settings: clinic profile, security, notifications, backup, data, about. */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Lock, Bell, HardDrive, Database, Info, Palette } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { Permission } from '@shared/permissions';
import type { ClinicConfig, SessionState } from '@shared/types';
import { Loading, Field, PageHead } from '../components/ui';
import { toast, useSession } from '../lib/store';

type Tab = 'clinic' | 'security' | 'notifications' | 'backup' | 'data' | 'about';

export default function SettingsPage(props: { session: SessionState }): JSX.Element {
  const [params, setParams] = useSearchParams();
  const initialTab = (params.get('tab') as Tab) || 'clinic';
  const [tab, setTab] = useState<Tab>(['clinic', 'security', 'notifications', 'backup', 'data', 'about'].includes(initialTab) ? initialTab : 'clinic');
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    setPerms(new Set(props.session.user?.permissions ?? []));
  }, [props.session.user]);

  const switchTab = (t: Tab): void => {
    setTab(t);
    setParams(t === 'clinic' ? {} : { tab: t }, { replace: true });
  };

  const canManage = perms.has('settings.manage');

  return (
    <div className="page">
      <PageHead title="Settings" subtitle="Clinic profile, security, notifications and data" />

      <div className="tabs">
        <button className={`tab${tab === 'clinic' ? ' active' : ''}`} onClick={() => switchTab('clinic')}>
          <Building2 size={14} /> Clinic
        </button>
        <button className={`tab${tab === 'security' ? ' active' : ''}`} onClick={() => switchTab('security')}>
          <Lock size={14} /> Security
        </button>
        <button className={`tab${tab === 'notifications' ? ' active' : ''}`} onClick={() => switchTab('notifications')}>
          <Bell size={14} /> Notifications
        </button>
        <button className={`tab${tab === 'backup' ? ' active' : ''}`} onClick={() => switchTab('backup')}>
          <HardDrive size={14} /> Backup
        </button>
        <button className={`tab${tab === 'data' ? ' active' : ''}`} onClick={() => switchTab('data')}>
          <Database size={14} /> Data
        </button>
        <button className={`tab${tab === 'about' ? ' active' : ''}`} onClick={() => switchTab('about')}>
          <Info size={14} /> About
        </button>
      </div>

      {tab === 'clinic' ? <ClinicTab canManage={canManage} /> : null}
      {tab === 'security' ? <SecurityTab session={props.session} /> : null}
      {tab === 'notifications' ? <NotificationsTab canManage={canManage} /> : null}
      {tab === 'backup' ? <BackupTab canManage={canManage} /> : null}
      {tab === 'data' ? <DataTab /> : null}
      {tab === 'about' ? <AboutTab /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Clinic                                                              */
/* ------------------------------------------------------------------ */

function ClinicTab(props: { canManage: boolean }): JSX.Element {
  const [clinic, setClinic] = useState<ClinicConfig | null>(null);
  const [draft, setDraft] = useState<ClinicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    void api('clinic.get', {})
      .then((c) => {
        setClinic(c);
        setDraft(c);
      })
      .catch((e) => setLoadError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.clinicName.trim()) {
      toast.error('Clinic name is required.');
      return;
    }
    setBusy(true);
    try {
      const updated = await api('clinic.update', {
        clinicName: draft.clinicName.trim(),
        address: draft.address,
        phone: draft.phone,
        email: draft.email,
        website: draft.website,
        registrationInfo: draft.registrationInfo,
        operatingHours: draft.operatingHours,
        footerNote: draft.footerNote,
        prescriptionFooter: draft.prescriptionFooter,
        invoiceFooter: draft.invoiceFooter,
      });
      setClinic(updated);
      setDraft(updated);
      toast.success('Clinic profile saved.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pickLogo = async (): Promise<void> => {
    try {
      const updated = await api('clinic.pickLogo', {});
      setClinic(updated);
      setDraft(updated);
      toast.success('Logo updated.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const clearLogo = async (): Promise<void> => {
    try {
      const updated = await api('clinic.clearLogo', {});
      setClinic(updated);
      setDraft(updated);
      toast.success('Logo removed.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (loading) return <Loading />;
  if (loadError || !draft) {
    return (
      <div className="card mt">
        <div className="card-head"><h3>Clinic profile</h3></div>
        <div className="card-body">
          <div className="alert warning">
            {loadError ?? 'Clinic profile is unavailable.'} Viewing or editing clinic information
            requires the <span className="mono">settings.manage</span> permission.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card mt">
      <div className="card-head"><h3>Clinic profile</h3></div>
      <div className="card-body stack">
        {!props.canManage ? (
          <div className="alert warning">View only — your account lacks the settings.manage permission.</div>
        ) : null}
        <div className="grid cols-2">
          <Field label="Clinic name" required full>
            <input className="input" value={draft.clinicName} onChange={(e) => setDraft({ ...draft, clinicName: e.target.value })} disabled={!props.canManage} />
          </Field>
          <Field label="Address" full>
            <input className="input" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} disabled={!props.canManage} />
          </Field>
          <Field label="Phone"><input className="input" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} disabled={!props.canManage} /></Field>
          <Field label="Email"><input className="input" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} disabled={!props.canManage} /></Field>
          <Field label="Website"><input className="input" value={draft.website} onChange={(e) => setDraft({ ...draft, website: e.target.value })} disabled={!props.canManage} /></Field>
          <Field label="Registration info"><input className="input" value={draft.registrationInfo} onChange={(e) => setDraft({ ...draft, registrationInfo: e.target.value })} disabled={!props.canManage} /></Field>
          <Field label="Operating hours"><input className="input" value={draft.operatingHours} onChange={(e) => setDraft({ ...draft, operatingHours: e.target.value })} disabled={!props.canManage} /></Field>
          <Field label="Footer note" full><input className="input" value={draft.footerNote} onChange={(e) => setDraft({ ...draft, footerNote: e.target.value })} disabled={!props.canManage} /></Field>
          <Field label="Prescription footer" full hint="Printed at the bottom of every prescription">
            <input className="input" value={draft.prescriptionFooter} onChange={(e) => setDraft({ ...draft, prescriptionFooter: e.target.value })} disabled={!props.canManage} />
          </Field>
          <Field label="Invoice footer" full hint="Printed at the bottom of every invoice">
            <input className="input" value={draft.invoiceFooter} onChange={(e) => setDraft({ ...draft, invoiceFooter: e.target.value })} disabled={!props.canManage} />
          </Field>
        </div>

        <div className="row gap">
          <button className="btn btn-secondary" onClick={() => void pickLogo()} disabled={!props.canManage}>
            <Palette size={15} /> Choose logo…
          </button>
          {clinic?.logoPath ? (
            <button className="btn btn-ghost" onClick={() => void clearLogo()} disabled={!props.canManage}>
              Remove logo
            </button>
          ) : null}
          <span className="muted">{clinic?.logoPath ? `Current: ${clinic.logoPath}` : 'No logo set'}</span>
        </div>

        <div className="row gap">
          <span className="muted">Currency: <strong>BDT (৳)</strong> — fixed, all amounts are stored as integer poisha.</span>
        </div>

        {props.canManage ? (
          <div className="row gap">
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save clinic profile'}
            </button>
            <button className="btn btn-secondary" onClick={() => setDraft(clinic)}>Reset</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

function SecurityTab(props: { session: SessionState }): JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockMin, setLockMin] = useState<number>(props.session.autoLockMinutes ?? 15);
  const [lockSaved, setLockSaved] = useState(true);

  const changePassword = async (): Promise<void> => {
    if (next.length < 8) {
      toast.error('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      toast.error('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('session.changePassword', { currentPassword: current, newPassword: next });
      toast.success('Password changed.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveLock = async (): Promise<void> => {
    if (![5, 10, 15, 30].includes(lockMin)) {
      toast.error('Auto-lock must be 5, 10, 15 or 30 minutes.');
      return;
    }
    try {
      await api('settings.set', { key: 'autoLockMinutes', value: lockMin });
      setLockSaved(true);
      toast.success('Auto-lock updated.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid cols-2 mt">
      <div className="card">
        <div className="card-head"><h3>Change password</h3></div>
        <div className="card-body stack">
          <div className="field">
            <label>Current password</label>
            <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="field">
            <label>New password</label>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            <span className="hint">At least 8 characters. Hashed with Argon2id (memory-hard).</span>
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            {confirm && next !== confirm ? <span className="error">Passwords do not match.</span> : null}
          </div>
          <button className="btn btn-primary" disabled={busy || !current || !next} onClick={() => void changePassword()}>
            {busy ? 'Updating…' : 'Change password'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Session lock</h3></div>
        <div className="card-body stack">
          <div className="field">
            <label>Auto-lock after inactivity</label>
            <select
              className="select"
              value={lockMin}
              onChange={(e) => {
                setLockMin(Number(e.target.value));
                setLockSaved(false);
              }}
            >
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
            </select>
            <span className="hint">
              The screen locks automatically and every privileged channel refuses work until the
              user unlocks with their password.
            </span>
          </div>
          <button className="btn btn-primary" onClick={() => void saveLock()} disabled={lockSaved}>
            Save auto-lock
          </button>
          <div className="alert info">
            Signed in as <strong>{props.session.user?.displayName}</strong> ({props.session.user?.username}) ·
            roles: {(props.session.user?.roleNames ?? []).join(', ') || '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

function NotificationsTab(props: { canManage: boolean }): JSX.Element {
  const [settings, setSettings] = useState<Record<string, string | number | boolean | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!props.canManage) {
      setLoading(false);
      return;
    }
    void api('settings.get', {})
      .then(setSettings)
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [props.canManage]);

  const set = async (key: string, value: boolean): Promise<void> => {
    try {
      const updated = await api('settings.set', { key: key as never, value });
      setSettings((s) => ({ ...s, [key]: updated[key] ?? value }));
      toast.success('Preference saved.');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (loading) return <Loading />;

  const toggles: { key: string; label: string; hint: string }[] = [
    { key: 'notifyAppointments', label: 'Appointment reminders', hint: 'Upcoming appointments and no-shows' },
    { key: 'notifyInventory', label: 'Inventory alerts', hint: 'Low stock, expiry and expired items' },
    { key: 'notifyFinancial', label: 'Financial alerts', hint: 'Large outstanding balances and void events' },
    { key: 'notifyBackup', label: 'Backup alerts', hint: 'Failed or overdue automatic backups' },
  ];

  return (
    <div className="card mt">
      <div className="card-head"><h3>Notification preferences</h3></div>
      <div className="card-body stack">
        {!props.canManage ? (
          <div className="alert warning">View only — your account lacks the settings.manage permission.</div>
        ) : null}
        {toggles.map((t) => (
          <label className="check-row card card-pad" key={t.key}>
            <input
              type="checkbox"
              checked={Boolean(settings[t.key])}
              disabled={!props.canManage}
              onChange={(e) => void set(t.key, e.target.checked)}
            />
            <span>
              <strong>{t.label}</strong>
              <div className="muted">{t.hint}</div>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Backup preferences                                                  */
/* ------------------------------------------------------------------ */

function BackupTab(props: { canManage: boolean }): JSX.Element {
  const [settings, setSettings] = useState<Record<string, string | number | boolean | null>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.canManage) {
      setLoading(false);
      return;
    }
    void api('settings.get', {})
      .then(setSettings)
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [props.canManage]);

  const pickFolder = async (): Promise<void> => {
    try {
      const res = await api('backup.pickFolder', {});
      if (res.folder) {
        await api('settings.set', { key: 'backupFolder', value: res.folder });
        setSettings((s) => ({ ...s, backupFolder: res.folder }));
        toast.success('Backup folder set.');
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const setIntervalDays = async (days: number): Promise<void> => {
    setBusy(true);
    try {
      await api('settings.set', { key: 'backupIntervalDays', value: days });
      setSettings((s) => ({ ...s, backupIntervalDays: days }));
      toast.success('Backup schedule updated.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="card mt">
      <div className="card-head"><h3>Automatic backups</h3></div>
      <div className="card-body stack">
        {!props.canManage ? (
          <div className="alert warning">View only — your account lacks the settings.manage permission.</div>
        ) : null}
        <div className="grid cols-2">
          <Field label="Backup folder" full>
            <div className="row gap">
              <input className="input mono" readOnly value={(settings.backupFolder as string) ?? 'Not set'} />
              <button className="btn btn-secondary" onClick={() => void pickFolder()} disabled={!props.canManage}>
                Browse
              </button>
            </div>
          </Field>
          <Field label="Automatic backup interval" full>
            <select
              className="select"
              value={Number(settings.backupIntervalDays ?? 7)}
              disabled={!props.canManage || busy}
              onChange={(e) => void setIntervalDays(Number(e.target.value))}
            >
              <option value={7}>Every 7 days</option>
              <option value={15}>Every 15 days</option>
              <option value={30}>Every 30 days</option>
              <option value={0}>Off</option>
            </select>
          </Field>
        </div>
        <div className="alert info">
          Manual backups, restore, and history live on the <strong>Backup &amp; Restore</strong> page.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function DataTab(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const perms = useSession((st) => st.state?.user?.permissions ?? []);
  const [dbInfo, setDbInfo] = useState<{
    ok: boolean;
    problems: string[];
    sizeBytes: number;
    walSizeBytes: number;
    pageCount: number;
    foreignKeyViolations: number;
  } | null>(null);

  const runIntegrity = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api('database.integrity', {});
      setDbInfo(res);
      if (res.ok) {
        toast.success('Integrity check passed — no problems found.');
      } else {
        toast.error(`Integrity check found problems: ${res.problems.join('; ')}`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportPatients = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api('patients.export', {});
      toast.success(`Exported ${res.count} patients to ${res.path}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const fmtBytes = (n: number): string =>
    n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  const links: { label: string; to: string; perm: Permission }[] = [
    { label: 'Printer profiles', to: '/printers', perm: 'printer.manage' },
    { label: 'Audit log', to: '/audit', perm: 'audit.view' },
    { label: 'Staff & Users', to: '/people', perm: 'staff.view' },
  ];

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h3>Database information</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => void runIntegrity()} disabled={busy}>
            Run integrity check
          </button>
        </div>
        <div className="card-body stack">
          <div className="alert info">
            Dentiva Pro stores everything locally in a SQLite database (WAL mode, foreign keys
            enforced) inside the app data folder. No data ever leaves this computer. The integrity
            check runs automatically at startup and before every backup.
          </div>
          {dbInfo ? (
            <dl className="def-grid">
              <dt>Integrity</dt>
              <dd>{dbInfo.ok ? 'OK — no problems found' : `Problems: ${dbInfo.problems.join('; ')}`}</dd>
              <dt>Foreign keys</dt>
              <dd>{dbInfo.foreignKeyViolations === 0 ? 'All violations: 0' : `${dbInfo.foreignKeyViolations} violation(s)`}</dd>
              <dt>Database size</dt>
              <dd>{fmtBytes(dbInfo.sizeBytes)} · {dbInfo.pageCount} pages</dd>
              <dt>WAL size</dt>
              <dd>{fmtBytes(dbInfo.walSizeBytes)}</dd>
            </dl>
          ) : (
            <p className="muted">Run the integrity check to see database health and size details.</p>
          )}
          <div className="row gap">
            <button className="btn btn-secondary" onClick={() => void exportPatients()} disabled={busy}>
              <Database size={15} /> Export patients CSV
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Related centres</h3></div>
        <div className="card-body stack">
          <p className="muted">Specialised management screens live outside this settings hub:</p>
          <div className="row gap" style={{ flexWrap: 'wrap' }}>
            {links
              .filter((l) => perms.includes(l.perm))
              .map((l) => (
                <button key={l.to} className="btn btn-secondary" onClick={() => nav(l.to)}>
                  {l.label}
                </button>
              ))}
          </div>
          <p className="muted">
            For full backups — including attachments — use the Backup &amp; Restore tab.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */

export function AboutTab(): JSX.Element {
  const [status, setStatus] = useState<{ appVersion: string; clinicName: string | null } | null>(null);

  useEffect(() => {
    void api('app.status', {}).then(setStatus).catch(() => undefined);
  }, []);

  return (
    <div className="card mt">
      <div className="card-head"><h3>About Dentiva Pro</h3></div>
      <div className="card-body stack">
        <div className="about-hero">
          <span className="brand-mark xl">D</span>
          <div>
            <h2>Dentiva Pro</h2>
            <p className="muted">Professional dental clinic management · Fully offline</p>
          </div>
        </div>
        <dl className="def-grid">
          <dt>Version</dt><dd>{status?.appVersion ?? '—'}</dd>
          <dt>Clinic</dt><dd>{status?.clinicName ?? '—'}</dd>
          <dt>Platform</dt><dd>Windows desktop (Electron)</dd>
          <dt>Currency</dt><dd>BDT (৳) — integer poisha storage</dd>
          <dt>Developer</dt>
          <dd>
            Shohan Khan
            <br />
            <a href="mailto:helloiamshohan@gmail.com">helloiamshohan@gmail.com</a>
          </dd>
        </dl>
        <div className="alert info">
          All processing is local. Dentiva Pro contains no telemetry, no analytics, and makes no
          network requests at runtime. Third-party components are open-source under permissive
          licenses; see the repository&apos;s LICENSES documentation for the full inventory.
        </div>
        <div className="alert warning">
          This build has no in-app updater. Updates are distributed as signed installers through
          official release channels.
        </div>
      </div>
    </div>
  );
}
