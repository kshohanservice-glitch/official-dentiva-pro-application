/** Staff, dentists, users and roles with granular permission editing. */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, KeyRound, UserCog, Stethoscope, ShieldCheck, Users } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { DentistRecord, RoleSummary, StaffRecord, UserSummary } from '@shared/types';
import { PERMISSIONS } from '@shared/permissions';
import {
  Loading,
  Modal,
  Field,
  PageHead,
  ChipInput,
  statusBadge,
  fmtDateTime,
} from '../components/ui';
import { toast } from '../lib/store';
import { parseMoneyToPoisha, formatPoisha } from '@shared/money';

type Tab = 'staff' | 'dentists' | 'users' | 'roles';

const PERMISSION_GROUPS: { label: string; codes: string[] }[] = [
  { label: 'Patients', codes: ['patient.view', 'patient.create', 'patient.edit', 'patient.delete', 'patient.export'] },
  { label: 'Clinical', codes: ['clinical.view', 'clinical.create', 'clinical.edit', 'prescription.view', 'prescription.create', 'prescription.print'] },
  { label: 'Appointments & queue', codes: ['appointment.view', 'appointment.create', 'appointment.edit', 'appointment.cancel', 'queue.manage'] },
  { label: 'Treatments', codes: ['treatment.view', 'treatment.manage'] },
  { label: 'Billing', codes: ['invoice.view', 'invoice.create', 'invoice.edit', 'invoice.void', 'payment.view', 'payment.create', 'payment.void'] },
  { label: 'Finance & accounting', codes: ['financial.report.view', 'accounting.view', 'accounting.manage'] },
  { label: 'Inventory', codes: ['inventory.view', 'inventory.manage', 'supplier.manage'] },
  { label: 'Staff & security', codes: ['staff.view', 'staff.manage', 'user.manage', 'role.manage'] },
  { label: 'Platform', codes: ['attachment.view', 'attachment.upload', 'attachment.delete', 'referral.view', 'referral.manage', 'notification.view', 'audit.view', 'backup.create', 'backup.restore', 'settings.manage', 'printer.manage', 'search.global', 'destructive.actions'] },
];

// Guard: every group code must exist in the permission catalogue.
for (const g of PERMISSION_GROUPS) {
  for (const c of g.codes) {
    if (!(PERMISSIONS as readonly string[]).includes(c)) {
      throw new Error(`Unknown permission in UI grouping: ${c}`);
    }
  }
}

export default function PeoplePage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('staff');
  const [perms, setPerms] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api('session.state', {}).then((s) => setPerms(new Set(s.user?.permissions ?? [])));
  }, []);

  return (
    <div className="page">
      <PageHead title="Staff & Users" subtitle="People, login accounts, and role-based permissions" />
      <div className="tabs">
        <button className={`tab${tab === 'staff' ? ' active' : ''}`} onClick={() => setTab('staff')}>
          <Users size={14} /> Staff
        </button>
        <button className={`tab${tab === 'dentists' ? ' active' : ''}`} onClick={() => setTab('dentists')}>
          <Stethoscope size={14} /> Dentists
        </button>
        <button className={`tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')} style={{ display: perms.has('user.manage') ? undefined : 'none' }}>
          <UserCog size={14} /> Users
        </button>
        <button className={`tab${tab === 'roles' ? ' active' : ''}`} onClick={() => setTab('roles')} style={{ display: perms.has('role.manage') ? undefined : 'none' }}>
          <ShieldCheck size={14} /> Roles
        </button>
      </div>

      {tab === 'staff' ? <StaffTab canManage={perms.has('staff.manage')} /> : null}
      {tab === 'dentists' ? <DentistsTab canManage={perms.has('staff.manage')} /> : null}
      {tab === 'users' ? <UsersTab /> : null}
      {tab === 'roles' ? <RolesTab /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

function StaffTab(props: { canManage: boolean }): JSX.Element {
  const [items, setItems] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [draft, setDraft] = useState<Parameters<typeof saveStaff>[0] | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void api('staff.list', { includeInactive })
      .then(setItems)
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [includeInactive]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card mt">
      <div className="card-head">
        <h3>Staff members</h3>
        <div className="row gap-sm">
          <label className="check-row inline">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            <span>Inactive</span>
          </label>
          {props.canManage ? (
            <button className="btn btn-primary btn-sm" onClick={() => setDraft(blankStaff())}>
              <Plus size={14} /> Add staff
            </button>
          ) : null}
        </div>
      </div>
      <div className="card-body">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className="muted">No staff records yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr><th>Name</th><th>Section</th><th>Phone</th><th>Salary</th><th>Joined</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id}>
                    <td className="bold">{s.fullName}</td>
                    <td>{s.section || '—'}</td>
                    <td>{s.phone || '—'}</td>
                    <td>{s.salaryPoisha > 0 ? formatPoisha(s.salaryPoisha) : '—'}</td>
                    <td>{s.joiningDate ?? '—'}</td>
                    <td>{statusBadge(s.status)}</td>
                    <td>
                      {props.canManage ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setDraft(toStaffDraft(s));
                            if (s.photoPath) {
                              void api('staff.photo', { id: s.id })
                                .then((r) =>
                                  setDraft((cur) =>
                                    cur && cur.id === s.id
                                      ? { ...cur, photoDataUrl: r.dataUrl }
                                      : cur,
                                  ),
                                )
                                .catch(() => undefined);
                            }
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {draft ? (
        <StaffModal
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            load();
            toast.success('Staff member saved.');
          }}
        />
      ) : null}
    </div>
  );
}

interface StaffDraft {
  id: number | null;
  fullName: string;
  dob: string;
  gender: 'male' | 'female' | 'other' | null;
  bloodGroup: string;
  address: string;
  phone: string;
  idNumber: string;
  photoPath: string | null;
  photoDataUrl: string | null;
  section: string;
  salary: string;
  joiningDate: string;
  status: 'active' | 'inactive';
  notes: string;
}

function blankStaff(): StaffDraft {
  return {
    id: null, fullName: '', dob: '', gender: null, bloodGroup: '', address: '', phone: '',
    idNumber: '', photoPath: null, photoDataUrl: null, section: '', salary: '', joiningDate: '',
    status: 'active', notes: '',
  };
}

function toStaffDraft(s: StaffRecord): StaffDraft {
  return {
    id: s.id, fullName: s.fullName, dob: s.dob ?? '', gender: s.gender, bloodGroup: s.bloodGroup ?? '',
    address: s.address, phone: s.phone, idNumber: s.idNumber, photoPath: s.photoPath,
    photoDataUrl: null, section: s.section,
    salary: (s.salaryPoisha / 100).toFixed(2), joiningDate: s.joiningDate ?? '', status: s.status, notes: s.notes,
  };
}

async function saveStaff(draft: StaffDraft): Promise<void> {
  let salary = 0;
  if (draft.salary.trim()) salary = parseMoneyToPoisha(draft.salary);
  await api('staff.save', {
    id: draft.id,
    fullName: draft.fullName.trim(),
    dob: draft.dob || null,
    gender: draft.gender,
    bloodGroup: draft.bloodGroup,
    address: draft.address,
    phone: draft.phone,
    idNumber: draft.idNumber,
    photoPath: draft.photoPath,
    section: draft.section,
    salaryPoisha: salary,
    joiningDate: draft.joiningDate || null,
    status: draft.status,
    notes: draft.notes,
  });
}

function StaffModal(props: {
  draft: StaffDraft;
  onChange(d: StaffDraft): void;
  onClose(): void;
  onSaved(): void;
}): JSX.Element {
  const d = props.draft;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickPhoto = async (): Promise<void> => {
    try {
      const res = await api('staff.pickPhoto', {});
      if (res.photoPath) props.onChange({ ...d, photoPath: res.photoPath, photoDataUrl: res.dataUrl });
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const save = async (): Promise<void> => {
    if (!d.fullName.trim()) {
      setErr('Full name is required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await saveStaff(d);
      props.onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={d.id ? 'Edit staff' : 'Add staff'}
      onClose={props.onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save staff'}
          </button>
        </>
      }
    >
      <div className="stack">
        {err ? <div className="alert danger">{err}</div> : null}
        <div className="grid cols-2">
          <Field label="Full name" required full>
            <input className="input" value={d.fullName} onChange={(e) => props.onChange({ ...d, fullName: e.target.value })} autoFocus />
          </Field>
          <Field label="Section / department">
            <input className="input" value={d.section} onChange={(e) => props.onChange({ ...d, section: e.target.value })} placeholder="Front desk, Hygiene…" />
          </Field>
          <Field label="Phone">
            <input className="input" value={d.phone} onChange={(e) => props.onChange({ ...d, phone: e.target.value })} />
          </Field>
          <Field label="Date of birth">
            <input className="input" type="date" value={d.dob} onChange={(e) => props.onChange({ ...d, dob: e.target.value })} />
          </Field>
          <Field label="Gender">
            <select className="select" value={d.gender ?? ''} onChange={(e) => props.onChange({ ...d, gender: (e.target.value || null) as StaffDraft['gender'] })}>
              <option value="">Not specified</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Blood group">
            <select className="select" value={d.bloodGroup} onChange={(e) => props.onChange({ ...d, bloodGroup: e.target.value })}>
              <option value="">Unknown</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="National ID">
            <input className="input" value={d.idNumber} onChange={(e) => props.onChange({ ...d, idNumber: e.target.value })} />
          </Field>
          <Field label="Photo" full>
            <div className="row gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              {d.photoDataUrl ? (
                <img
                  src={d.photoDataUrl}
                  alt=""
                  style={{ width: 44, height: 44, borderRadius: 22, objectFit: 'cover', border: '1px solid var(--border)' }}
                />
              ) : null}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void pickPhoto()}>
                {d.photoPath ? 'Change photo…' : 'Choose photo…'}
              </button>
              {d.photoPath ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => props.onChange({ ...d, photoPath: null, photoDataUrl: null })}
                >
                  Remove
                </button>
              ) : null}
              <span className="muted" style={{ fontSize: 12 }}>
                {d.photoPath ? 'Stored in the managed staff photo folder.' : 'No photo on file.'}
              </span>
            </div>
          </Field>
          <Field label="Salary (৳/month)">
            <input className="input" inputMode="decimal" value={d.salary} onChange={(e) => props.onChange({ ...d, salary: e.target.value })} />
          </Field>
          <Field label="Joining date">
            <input className="input" type="date" value={d.joiningDate} onChange={(e) => props.onChange({ ...d, joiningDate: e.target.value })} />
          </Field>
          <Field label="Status">
            <select className="select" value={d.status} onChange={(e) => props.onChange({ ...d, status: e.target.value as 'active' | 'inactive' })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <Field label="Address" full>
            <input className="input" value={d.address} onChange={(e) => props.onChange({ ...d, address: e.target.value })} />
          </Field>
          <Field label="Notes" full>
            <textarea className="textarea" rows={2} value={d.notes} onChange={(e) => props.onChange({ ...d, notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Dentists                                                            */
/* ------------------------------------------------------------------ */

function DentistsTab(props: { canManage: boolean }): JSX.Element {
  const [items, setItems] = useState<DentistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [draft, setDraft] = useState<{
    id: number | null;
    fullName: string;
    phone: string;
    email: string;
    bio: string;
    isActive: boolean;
    designations: string[];
    qualifications: string[];
  } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void api('dentists.list', { includeInactive })
      .then(setItems)
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [includeInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.fullName.trim()) {
      toast.error('Full name is required.');
      return;
    }
    if (draft.designations.length === 0) {
      toast.error('Add at least one designation — it prints on prescriptions.');
      return;
    }
    try {
      await api('dentists.save', draft);
      toast.success('Dentist saved.');
      setDraft(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="card mt">
      <div className="card-head">
        <h3>Dentists</h3>
        <div className="row gap-sm">
          <label className="check-row inline">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
            <span>Inactive</span>
          </label>
          {props.canManage ? (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setDraft({ id: null, fullName: '', phone: '', email: '', bio: '', isActive: true, designations: [], qualifications: [] })}
            >
              <Plus size={14} /> Add dentist
            </button>
          ) : null}
        </div>
      </div>
      <div className="card-body">
        {loading ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className="muted">No dentists yet. Add the clinicians who treat patients.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-hover">
              <thead><tr><th>Name</th><th>Designations</th><th>Qualifications</th><th>Phone</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td className="bold">{d.fullName}</td>
                    <td>{d.designations.join(', ')}</td>
                    <td>{d.qualifications.join(', ') || '—'}</td>
                    <td>{d.phone || '—'}</td>
                    <td>
                      <span className={`badge badge-${d.isActive ? 'green' : 'neutral'}`}>{d.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td>
                      {props.canManage ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            setDraft({
                              id: d.id,
                              fullName: d.fullName,
                              phone: d.phone,
                              email: d.email,
                              bio: d.bio,
                              isActive: d.isActive,
                              designations: [...d.designations],
                              qualifications: [...d.qualifications],
                            })
                          }
                        >
                          <Pencil size={14} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {draft ? (
        <Modal
          title={draft.id ? 'Edit dentist' : 'Add dentist'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save()}>Save dentist</button>
            </>
          }
        >
          <div className="stack">
            <div className="grid cols-2">
              <Field label="Full name" required full>
                <input className="input" value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} autoFocus />
              </Field>
              <Field label="Phone"><input className="input" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
              <Field label="Email"><input className="input" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            </div>
            <Field label="Designations" required hint="Shown under the dentist's name on prescriptions, e.g. Consultant">
              <ChipInput values={draft.designations} onChange={(v) => setDraft({ ...draft, designations: v })} placeholder="Add designation" />
            </Field>
            <Field label="Qualifications" hint="Degrees, e.g. BDS, FCPS">
              <ChipInput values={draft.qualifications} onChange={(v) => setDraft({ ...draft, qualifications: v })} placeholder="Add qualification" />
            </Field>
            <Field label="Bio"><textarea className="textarea" rows={2} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} /></Field>
            <label className="check-row">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              <span>Active</span>
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

function UsersTab(): JSX.Element {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{
    id: number | null;
    username: string;
    displayName: string;
    staffId: number | null;
    password: string;
    isActive: boolean;
    roleIds: number[];
  } | null>(null);
  const [resetTarget, setResetTarget] = useState<UserSummary | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api('users.list', {}), api('roles.list', {}), api('staff.list', { includeInactive: true })])
      .then(([u, r, s]) => {
        setUsers(u);
        setRoles(r);
        setStaff(s);
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.username.trim() || !draft.displayName.trim()) {
      toast.error('Username and display name are required.');
      return;
    }
    if (draft.roleIds.length === 0) {
      toast.error('Assign at least one role.');
      return;
    }
    if (!draft.id && draft.password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    try {
      await api('users.save', {
        id: draft.id,
        username: draft.username.trim(),
        displayName: draft.displayName.trim(),
        staffId: draft.staffId,
        ...(draft.id ? {} : { password: draft.password }),
        isActive: draft.isActive,
        roleIds: draft.roleIds,
      });
      toast.success('User saved.');
      setDraft(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="card mt">
      <div className="card-head">
        <h3>Login accounts</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setDraft({ id: null, username: '', displayName: '', staffId: null, password: '', isActive: true, roleIds: roles[0] ? [roles[0].id] : [] })}
        >
          <Plus size={14} /> Add user
        </button>
      </div>
      <div className="card-body">
        {loading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr><th>Username</th><th>Name</th><th>Roles</th><th>Last login</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.username}</td>
                    <td className="bold">{u.displayName}</td>
                    <td>{u.roles.join(', ')}</td>
                    <td>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'Never'}</td>
                    <td>
                      <span className={`badge badge-${u.isActive ? 'green' : 'neutral'}`}>
                        {u.isActive ? 'Active' : 'Disabled'}
                      </span>
                      {u.mustChangePassword ? <span className="badge badge-amber">must change password</span> : null}
                    </td>
                    <td className="nowrap">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setDraft({
                            id: u.id,
                            username: u.username,
                            displayName: u.displayName,
                            staffId: u.staffId,
                            password: '',
                            isActive: u.isActive,
                            roleIds: roles.filter((r) => u.roles.includes(r.name)).map((r) => r.id),
                          })
                        }
                      >
                        <Pencil size={14} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setResetTarget(u)} title="Reset password">
                        <KeyRound size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {draft ? (
        <Modal
          title={draft.id ? `Edit ${draft.username}` : 'Add user'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save()}>Save user</button>
            </>
          }
        >
          <div className="stack">
            <div className="grid cols-2">
              <Field label="Username" required hint="3–40 chars: letters, digits, . _ -">
                <input className="input" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} disabled={!!draft.id} spellCheck={false} />
              </Field>
              <Field label="Display name" required>
                <input className="input" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
              </Field>
              {!draft.id ? (
                <Field label="Initial password" required hint="At least 8 characters; user is prompted to change it">
                  <input className="input" type="text" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="off" />
                </Field>
              ) : null}
              <Field label="Linked staff member">
                <select className="select" value={draft.staffId ?? ''} onChange={(e) => setDraft({ ...draft, staffId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Not linked</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Roles" required>
              <div className="stack" style={{ gap: 6 }}>
                {roles.map((r) => (
                  <label className="check-row" key={r.id}>
                    <input
                      type="checkbox"
                      checked={draft.roleIds.includes(r.id)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          roleIds: e.target.checked
                            ? [...draft.roleIds, r.id]
                            : draft.roleIds.filter((x) => x !== r.id),
                        })
                      }
                    />
                    <span>{r.name} <span className="muted">— {r.description || `${r.permissions.length} permissions`}</span></span>
                  </label>
                ))}
              </div>
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              <span>Account active</span>
            </label>
          </div>
        </Modal>
      ) : null}

      {resetTarget ? (
        <Modal
          title={`Reset password · ${resetTarget.username}`}
          onClose={() => { setResetTarget(null); setNewPassword(''); }}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => { setResetTarget(null); setNewPassword(''); }}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={newPassword.length < 8}
                onClick={async () => {
                  try {
                    await api('users.resetPassword', { id: resetTarget.id, newPassword });
                    toast.success('Password reset.');
                    setResetTarget(null);
                    setNewPassword('');
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Reset password
              </button>
            </>
          }
        >
          <Field label="New password" required hint="At least 8 characters">
            <input className="input" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="off" autoFocus />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roles & permissions                                                 */
/* ------------------------------------------------------------------ */

function RolesTab(): JSX.Element {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{
    id: number | null;
    name: string;
    description: string;
    permissions: string[];
  } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void api('roles.list', {})
      .then(setRoles)
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Role name is required.');
      return;
    }
    try {
      await api('roles.save', {
        id: draft.id,
        name: draft.name.trim(),
        description: draft.description.trim(),
        permissions: draft.permissions,
      });
      toast.success('Role saved.');
      setDraft(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="card mt">
      <div className="card-head">
        <h3>Roles</h3>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setDraft({ id: null, name: '', description: '', permissions: ['patient.view'] })}
        >
          <Plus size={14} /> Add role
        </button>
      </div>
      <div className="card-body stack">
        {loading ? (
          <Loading />
        ) : (
          roles.map((r) => (
            <div className="card card-pad" key={r.id}>
              <div className="row between mb-sm">
                <div>
                  <strong>{r.name}</strong>
                  {r.isBuiltIn ? <span className="badge badge-blue" style={{ marginLeft: 8 }}>built-in</span> : null}
                  <div className="muted">{r.description || 'No description'}</div>
                  <small className="muted">{r.userCount} user(s) · {r.permissions.length} permissions</small>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => setDraft({ id: r.id, name: r.name, description: r.description, permissions: [...r.permissions] })}>
                  <Pencil size={14} /> Edit
                </button>
              </div>
              <div className="badge-row">
                {r.permissions.length === 0 ? (
                  <span className="muted">No permissions — this role cannot do anything yet.</span>
                ) : (
                  r.permissions.slice(0, 12).map((p) => <span className="badge badge-neutral" key={p}>{p}</span>)
                )}
                {r.permissions.length > 12 ? <span className="badge badge-neutral">+{r.permissions.length - 12} more</span> : null}
              </div>
            </div>
          ))
        )}
      </div>

      {draft ? (
        <Modal
          title={draft.id ? `Edit role · ${draft.name}` : 'Add role'}
          onClose={() => setDraft(null)}
          size="lg"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void save()}>Save role</button>
            </>
          }
        >
          <div className="stack">
            <div className="grid cols-2">
              <Field label="Role name" required>
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
              </Field>
              <Field label="Description">
                <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </Field>
            </div>

            <div className="row gap-sm">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setDraft({ ...draft, permissions: [...PERMISSIONS] })}
              >
                Grant all
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setDraft({ ...draft, permissions: [] })}
              >
                Clear all
              </button>
              <span className="muted">{draft.permissions.length} selected</span>
            </div>

            {PERMISSION_GROUPS.map((g) => (
              <div key={g.label} className="perm-group">
                <div className="row between">
                  <strong>{g.label}</strong>
                  <div className="row gap-sm">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          permissions: Array.from(new Set([...draft.permissions, ...g.codes])),
                        })
                      }
                    >
                      All
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          permissions: draft.permissions.filter((p) => !g.codes.includes(p)),
                        })
                      }
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="perm-grid">
                  {g.codes.map((code) => (
                    <label className="check-row" key={code}>
                      <input
                        type="checkbox"
                        checked={draft.permissions.includes(code)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            permissions: e.target.checked
                              ? [...draft.permissions, code]
                              : draft.permissions.filter((p) => p !== code),
                          })
                        }
                      />
                      <span className="mono">{code}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            <div className="alert warning">
              Financial permissions (<span className="mono">payment.void</span>,{' '}
              <span className="mono">accounting.manage</span>,{' '}
              <span className="mono">financial.report.view</span>,{' '}
              <span className="mono">destructive.actions</span>) grant the ability to alter money
              records — assign them carefully. Permissions are enforced on every request inside the
              main process, not just hidden in the UI.
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
