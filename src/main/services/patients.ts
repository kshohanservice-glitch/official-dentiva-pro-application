/** Patient service: list/get/create/update/timeline/export. */

import type { ServiceContext } from './context';
import { audit } from './context';
import { ipcError } from '../ipc/dispatcher';
import { nextCode } from '../db/database';
import { presetRange, epochToDhakaDate, dhakaDateToEpoch, todayDhaka } from '@shared/datetime';
import type { Paged, PatientRecord, PatientSummary, TimelineEvent } from '@shared/types';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type ListParams = {
  search: string;
  preset: 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'all' | 'custom';
  from?: string;
  to?: string;
  status: 'active' | 'archived' | 'all';
  sort: 'registered_desc' | 'registered_asc' | 'name_asc' | 'last_visit';
  page: number;
  pageSize: number;
};

export function listPatients(sc: ServiceContext, p: ListParams): Paged<PatientSummary> {
  const where: string[] = [];
  const args: unknown[] = [];

  if (p.status !== 'all') {
    where.push('p.status = ?');
    args.push(p.status);
  }
  if (p.search.trim()) {
    const like = `%${p.search.trim()}%`;
    where.push('(p.full_name LIKE ? OR p.patient_code LIKE ? OR p.phone LIKE ?)');
    args.push(like, like, like);
  }
  let range: { start: number; end: number } | null = null;
  if (p.preset === 'custom') {
    if (!p.from || !p.to) ipcError('VALIDATION', 'Custom range requires from and to dates.');
    range = { start: dhakaDateToEpoch(p.from), end: dhakaDateToEpoch(p.to) + 86_400_000 };
  } else if (p.preset !== 'all') {
    range = presetRange(p.preset);
  }
  if (range) {
    where.push('p.registered_at >= ? AND p.registered_at < ?');
    args.push(range.start, range.end);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql =
    p.sort === 'registered_asc'
      ? 'ORDER BY p.registered_at ASC'
      : p.sort === 'name_asc'
        ? 'ORDER BY p.full_name COLLATE NOCASE ASC'
        : p.sort === 'last_visit'
          ? 'ORDER BY last_visit_at DESC NULLS LAST, p.registered_at DESC'
          : 'ORDER BY p.registered_at DESC';

  const total = (
    sc.db.prepare(`SELECT COUNT(*) AS n FROM patients p ${whereSql}`).get(...args) as { n: number }
  ).n;

  const offset = (p.page - 1) * p.pageSize;
  const rows = sc.db
    .prepare(
      `SELECT p.id, p.patient_code, p.full_name, p.gender, p.dob, p.age_years, p.phone,
              p.blood_group, p.status, p.registered_at,
              (SELECT MAX(v.visited_at) FROM visits v WHERE v.patient_id = p.id) AS last_visit_at,
              (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visit_count,
              COALESCE((SELECT SUM(i.total_poisha) - SUM(COALESCE((
                  SELECT SUM(pay.amount_poisha) FROM payments pay
                  WHERE pay.invoice_id = i.id AND pay.is_voided = 0
                ), 0))
                FROM invoices i WHERE i.patient_id = p.id AND i.status != 'void'), 0) AS due
       FROM patients p ${whereSql}
       ${orderSql}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, p.pageSize, offset) as Record<string, unknown>[];

  return {
    items: rows.map(mapSummary),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

function mapSummary(r: Record<string, unknown>): PatientSummary {
  return {
    id: r.id as number,
    patientCode: r.patient_code as string,
    fullName: r.full_name as string,
    gender: (r.gender as PatientSummary['gender']) ?? null,
    dob: (r.dob as string | null) ?? null,
    ageYears: (r.age_years as number | null) ?? null,
    phone: (r.phone as string) ?? '',
    bloodGroup: (r.blood_group as string) ?? '',
    status: r.status as PatientSummary['status'],
    registeredAt: r.registered_at as number,
    lastVisitAt: (r.last_visit_at as number | null) ?? null,
    visitCount: (r.visit_count as number) ?? 0,
    duePoisha: (r.due as number) ?? 0,
  };
}

export function getPatient(sc: ServiceContext, id: number): PatientRecord {
  const row = sc.db
    .prepare(
      `SELECT p.*,
              (SELECT MAX(v.visited_at) FROM visits v WHERE v.patient_id = p.id) AS last_visit_at,
              (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visit_count,
              COALESCE((SELECT SUM(i.total_poisha) - SUM(COALESCE((
                  SELECT SUM(pay.amount_poisha) FROM payments pay
                  WHERE pay.invoice_id = i.id AND pay.is_voided = 0
                ), 0))
                FROM invoices i WHERE i.patient_id = p.id AND i.status != 'void'), 0) AS due
       FROM patients p WHERE p.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) ipcError('NOT_FOUND', 'Patient not found.');
  const summary = mapSummary(row);
  return {
    ...summary,
    emergencyPhone: (row.emergency_phone as string) ?? '',
    emergencyContact: (row.emergency_contact as string) ?? '',
    address: (row.address as string) ?? '',
    presentingProblem: (row.presenting_problem as string) ?? '',
    previousHistory: (row.previous_history as string) ?? '',
    allergies: (row.allergies as string) ?? '',
    medicalHistory: (row.medical_history as string) ?? '',
    notes: (row.notes as string) ?? '',
    preferredLanguage: (row.preferred_language as string) ?? '',
    updatedAt: row.updated_at as number,
  };
}

type CreateParams = {
  fullName: string;
  gender: 'male' | 'female' | 'other' | null;
  dob: string | null;
  ageYears: number | null;
  bloodGroup: string;
  phone: string;
  emergencyPhone: string;
  emergencyContact: string;
  address: string;
  presentingProblem: string;
  previousHistory: string;
  allergies: string;
  medicalHistory: string;
  notes: string;
  preferredLanguage: string;
};

export function createPatient(sc: ServiceContext, p: CreateParams): PatientRecord {
  if (p.phone === '' && p.address.trim() === '') {
    ipcError('VALIDATION', 'Provide at least a phone number or an address.');
  }
  if (p.dob && p.ageYears !== null) {
    ipcError('VALIDATION', 'Provide either date of birth or age — not both.');
  }
  const now = sc.now();
  const create = sc.db.transaction(() => {
    const code = nextCode(sc.db, 'patient', 'DP-', 6);
    const info = sc.db
      .prepare(
        `INSERT INTO patients (
          patient_code, full_name, gender, dob, age_years, blood_group, phone,
          emergency_phone, emergency_contact, address, presenting_problem, previous_history,
          allergies, medical_history, notes, preferred_language, status, registered_at,
          created_by, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)`,
      )
      .run(
        code, p.fullName, p.gender, p.dob, p.ageYears, p.bloodGroup, p.phone,
        p.emergencyPhone, p.emergencyContact, p.address, p.presentingProblem, p.previousHistory,
        p.allergies, p.medicalHistory, p.notes, p.preferredLanguage,
        now, sc.ctx.userId, now, now,
      );
    return Number(info.lastInsertRowid);
  });
  const id = create();
  audit(sc, {
    action: 'patient.create',
    entityType: 'patient',
    entityId: id,
    summary: `Created patient`,
  });
  return getPatient(sc, id);
}

type UpdateParams = Partial<CreateParams> & { id: number; status?: 'active' | 'archived' };

const UPDATABLE: Record<string, string> = {
  fullName: 'full_name', gender: 'gender', dob: 'dob', ageYears: 'age_years',
  bloodGroup: 'blood_group', phone: 'phone', emergencyPhone: 'emergency_phone',
  emergencyContact: 'emergency_contact', address: 'address',
  presentingProblem: 'presenting_problem', previousHistory: 'previous_history',
  allergies: 'allergies', medicalHistory: 'medical_history', notes: 'notes',
  preferredLanguage: 'preferred_language', status: 'status',
};

export function updatePatient(sc: ServiceContext, p: UpdateParams): PatientRecord {
  const existing = getPatient(sc, p.id);
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const [key, col] of Object.entries(UPDATABLE)) {
    if (key in p) {
      sets.push(`${col} = ?`);
      args.push((p as Record<string, unknown>)[key]);
    }
  }
  if (sets.length === 0) return existing;
  sets.push('updated_at = ?');
  args.push(sc.now(), p.id);
  sc.db.prepare(`UPDATE patients SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  audit(sc, {
    action: 'patient.update',
    entityType: 'patient',
    entityId: p.id,
    summary: 'Updated patient record',
    before: { status: existing.status },
    after: { status: p.status ?? existing.status },
  });
  return getPatient(sc, p.id);
}

const TIMELINE_FILTERS = new Set([
  'all', 'registration', 'visit', 'prescription', 'appointment', 'invoice', 'payment',
  'referral', 'attachment',
]);

export function patientTimeline(
  sc: ServiceContext,
  p: { id: number; filter: string; page: number; pageSize: number },
): Paged<TimelineEvent> {
  if (!TIMELINE_FILTERS.has(p.filter)) ipcError('VALIDATION', 'Unknown timeline filter.');
  const patient = getPatient(sc, p.id);
  const events: TimelineEvent[] = [];

  events.push({
    id: `reg-${patient.id}`,
    type: 'registration',
    at: patient.registeredAt,
    title: 'Patient registered',
    detail: patient.patientCode,
    actor: null,
    entityId: patient.patientCode,
  });

  const wants = (t: TimelineEvent['type']) => p.filter === 'all' || p.filter === t;

  if (wants('visit')) {
    const visits = sc.db
      .prepare(
        `SELECT v.id, v.visit_code, v.visited_at, v.chief_complaint, v.diagnosis, d.full_name AS dentist
         FROM visits v JOIN dentists d ON d.id = v.dentist_id
         WHERE v.patient_id = ?`,
      )
      .all(p.id) as { id: number; visit_code: string; visited_at: number; chief_complaint: string; diagnosis: string; dentist: string }[];
    for (const v of visits) {
      events.push({
        id: `visit-${v.id}`,
        type: 'visit',
        at: v.visited_at,
        title: `Visit ${v.visit_code}`,
        detail: [v.chief_complaint, v.diagnosis].filter(Boolean).join(' · ') || `Dr. ${v.dentist}`,
        actor: v.dentist,
        entityId: v.visit_code,
      });
    }
  }
  if (wants('prescription')) {
    const rx = sc.db
      .prepare(
        `SELECT r.id, r.prescription_code, r.issued_at, d.full_name AS dentist,
                (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = r.id) AS n
         FROM prescriptions r JOIN dentists d ON d.id = r.dentist_id
         WHERE r.patient_id = ?`,
      )
      .all(p.id) as { id: number; prescription_code: string; issued_at: number; dentist: string; n: number }[];
    for (const r of rx) {
      events.push({
        id: `rx-${r.id}`,
        type: 'prescription',
        at: r.issued_at,
        title: `Prescription ${r.prescription_code}`,
        detail: `${r.n} medication${r.n === 1 ? '' : 's'}`,
        actor: r.dentist,
        entityId: r.prescription_code,
      });
    }
  }
  if (wants('appointment')) {
    const appts = sc.db
      .prepare(
        `SELECT id, appointment_code, starts_at, status, reason FROM appointments
         WHERE patient_id = ? `,
      )
      .all(p.id) as { id: number; appointment_code: string; starts_at: number; status: string; reason: string }[];
    for (const a of appts) {
      events.push({
        id: `apt-${a.id}`,
        type: 'appointment',
        at: a.starts_at,
        title: `Appointment ${a.appointment_code}`,
        detail: `${a.status.replace('_', ' ')}${a.reason ? ` · ${a.reason}` : ''}`,
        actor: null,
        entityId: a.appointment_code,
      });
    }
  }
  if (wants('invoice')) {
    const invs = sc.db
      .prepare(
        `SELECT id, invoice_code, created_at, total_poisha, status FROM invoices
         WHERE patient_id = ? `,
      )
      .all(p.id) as { id: number; invoice_code: string; created_at: number; total_poisha: number; status: string }[];
    for (const i of invs) {
      events.push({
        id: `inv-${i.id}`,
        type: 'invoice',
        at: i.created_at,
        title: `Invoice ${i.invoice_code}`,
        detail: `${(i.total_poisha / 100).toFixed(2)} BDT · ${i.status}`,
        actor: null,
        entityId: i.invoice_code,
      });
    }
  }
  if (wants('payment')) {
    const pays = sc.db
      .prepare(
        `SELECT id, payment_code, paid_at, amount_poisha, method FROM payments
         WHERE patient_id = ? AND is_voided = 0 `,
      )
      .all(p.id) as { id: number; payment_code: string; paid_at: number; amount_poisha: number; method: string }[];
    for (const pay of pays) {
      events.push({
        id: `pay-${pay.id}`,
        type: 'payment',
        at: pay.paid_at,
        title: `Payment ${pay.payment_code}`,
        detail: `${(pay.amount_poisha / 100).toFixed(2)} BDT · ${pay.method}`,
        actor: null,
        entityId: pay.payment_code,
      });
    }
  }
  if (wants('referral')) {
    const refs = sc.db
      .prepare(
        `SELECT id, referred_to, referred_on, status, reason FROM referrals
         WHERE patient_id = ? `,
      )
      .all(p.id) as { id: number; referred_to: string; referred_on: string; status: string; reason: string }[];
    for (const r of refs) {
      events.push({
        id: `ref-${r.id}`,
        type: 'referral',
        at: dhakaDateToEpoch(r.referred_on),
        title: `Referral to ${r.referred_to}`,
        detail: `${r.reason} · ${r.status}`,
        actor: null,
        entityId: String(r.id),
      });
    }
  }
  if (wants('attachment')) {
    const atts = sc.db
      .prepare(
        `SELECT id, file_name, created_at FROM attachments
         WHERE patient_id = ? `,
      )
      .all(p.id) as { id: number; file_name: string; created_at: number }[];
    for (const a of atts) {
      events.push({
        id: `att-${a.id}`,
        type: 'attachment',
        at: a.created_at,
        title: `Attachment added`,
        detail: a.file_name,
        actor: null,
        entityId: String(a.id),
      });
    }
  }

  const sorted = events.sort((a, b) => b.at - a.at);
  const filtered = p.filter === 'all' ? sorted : sorted.filter((e) => e.type === p.filter);
  const start = (p.page - 1) * p.pageSize;
  return {
    items: filtered.slice(start, start + p.pageSize),
    total: filtered.length,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export function exportPatients(
  sc: ServiceContext,
  p: { ids?: number[] },
): { path: string; count: number } {
  const now = sc.now();
  const stamp = epochToDhakaDate(now).replace(/-/g, '');
  mkdirSync(join(sc.userDataDir, 'exports'), { recursive: true });
  const path = join(sc.userDataDir, 'exports', `patients-${stamp}-${now}.csv`);

  const rows = p.ids?.length
    ? sc.db
        .prepare(
          `SELECT patient_code, full_name, gender, dob, age_years, phone, blood_group, address,
                  allergies, status, registered_at FROM patients WHERE id IN (${p.ids.map(() => '?').join(',')})`,
        )
        .all(...p.ids) as Record<string, unknown>[]
    : (sc.db
        .prepare(
          `SELECT patient_code, full_name, gender, dob, age_years, phone, blood_group, address,
                  allergies, status, registered_at FROM patients ORDER BY registered_at DESC`,
        )
        .all() as Record<string, unknown>[]);

  const header = [
    'patient_code', 'full_name', 'gender', 'dob', 'age_years', 'phone', 'blood_group',
    'address', 'allergies', 'status', 'registered_at',
  ];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => escape(h === 'registered_at' ? epochToDhakaDate(Number(r[h])) : r[h])).join(','));
  }
  writeFileSync(path, `\uFEFF${lines.join('\n')}`, 'utf8');
  audit(sc, {
    action: 'patient.export',
    entityType: 'patient',
    summary: `Exported ${rows.length} patient records`,
  });
  return { path, count: rows.length };
}

export { todayDhaka };
