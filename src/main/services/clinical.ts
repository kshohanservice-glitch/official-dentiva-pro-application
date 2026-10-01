/** Clinical services: visits, clinical options, dental chart, treatments. */

import type { ServiceContext } from './context';
import { audit, requireUser } from './context';
import { ipcError } from '../ipc/dispatcher';
import { nextCode } from '../db/database';
import { buildTeeth, TOOTH_CONDITIONS } from '../db/seed';
import type { ChartEntry, ClinicalOption, TreatmentDef, VisitRecord } from '@shared/types';

/* ------------------------------------------------------------------ */
/* Visits                                                              */
/* ------------------------------------------------------------------ */

type CreateVisitParams = {
  patientId: number;
  dentistId: number;
  appointmentId: number | null;
  visitedAt?: number;
  chiefComplaint: string;
  examination: string;
  findings: string;
  diagnosis: string;
  treatmentPerformed: string;
  treatmentPlan: string;
  advice: string;
  followUpAt: number | null;
  notes: string;
  clinicalOptions: string[];
  treatments: { treatmentId: number; quantity: number }[];
};

export function createVisit(sc: ServiceContext, p: CreateVisitParams): VisitRecord {
  const user = requireUser(sc);
  const patient = sc.db.prepare('SELECT id FROM patients WHERE id = ?').get(p.patientId);
  if (!patient) ipcError('NOT_FOUND', 'Patient not found.');
  const dentist = sc.db.prepare('SELECT id FROM dentists WHERE id = ?').get(p.dentistId);
  if (!dentist) ipcError('NOT_FOUND', 'Dentist not found.');

  const now = sc.now();
  const visitedAt = p.visitedAt ?? now;
  const visitId = sc.db.transaction(() => {
    const code = nextCode(sc.db, 'visit', 'V-', 6);
    const info = sc.db
      .prepare(
        `INSERT INTO visits (
          visit_code, patient_id, dentist_id, appointment_id, visited_at,
          chief_complaint, examination, findings, diagnosis, treatment_performed,
          treatment_plan, advice, follow_up_at, notes, created_by, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        code, p.patientId, p.dentistId, p.appointmentId, visitedAt,
        p.chiefComplaint, p.examination, p.findings, p.diagnosis, p.treatmentPerformed,
        p.treatmentPlan, p.advice, p.followUpAt, p.notes, user.id, now, now,
      );
    const id = Number(info.lastInsertRowid);

    if (p.clinicalOptions.length > 0) {
      const ins = sc.db.prepare(
        `INSERT OR IGNORE INTO visit_clinical_options (visit_id, option_code, label)
         VALUES (?, ?, (SELECT label FROM clinical_options WHERE code = ?))`,
      );
      for (const codeOpt of p.clinicalOptions) ins.run(id, codeOpt, codeOpt);
    }
    if (p.treatments.length > 0) {
      const ins = sc.db.prepare(
        'INSERT INTO visit_treatments (visit_id, treatment_id, quantity) VALUES (?, ?, ?)',
      );
      for (const t of p.treatments) ins.run(id, t.treatmentId, t.quantity);
    }
    if (p.appointmentId) {
      sc.db
        .prepare(`UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ?`)
        .run(now, p.appointmentId);
    }
    return id;
  })();

  audit(sc, {
    action: 'visit.create',
    entityType: 'visit',
    entityId: visitId,
    summary: `Created visit for patient #${p.patientId}`,
  });
  return getVisit(sc, visitId);
}

function mapVisit(row: Record<string, unknown>): VisitRecord {
  return {
    id: row.id as number,
    visitCode: row.visit_code as string,
    patientId: row.patient_id as number,
    dentistId: row.dentist_id as number,
    dentistName: (row.dentist_name as string) ?? '',
    appointmentId: (row.appointment_id as number | null) ?? null,
    visitedAt: row.visited_at as number,
    chiefComplaint: (row.chief_complaint as string) ?? '',
    examination: (row.examination as string) ?? '',
    findings: (row.findings as string) ?? '',
    diagnosis: (row.diagnosis as string) ?? '',
    treatmentPerformed: (row.treatment_performed as string) ?? '',
    treatmentPlan: (row.treatment_plan as string) ?? '',
    advice: (row.advice as string) ?? '',
    followUpAt: (row.follow_up_at as number | null) ?? null,
    notes: (row.notes as string) ?? '',
    createdAt: row.created_at as number,
  };
}

export function getVisit(sc: ServiceContext, id: number): VisitRecord {
  const row = sc.db
    .prepare(
      `SELECT v.*, d.full_name AS dentist_name FROM visits v
       JOIN dentists d ON d.id = v.dentist_id WHERE v.id = ?`,
    )
    .get(id);
  if (!row) ipcError('NOT_FOUND', 'Visit not found.');
  return mapVisit(row as Record<string, unknown>);
}

export function listVisitsByPatient(sc: ServiceContext, patientId: number): VisitRecord[] {
  const rows = sc.db
    .prepare(
      `SELECT v.*, d.full_name AS dentist_name FROM visits v
       JOIN dentists d ON d.id = v.dentist_id
       WHERE v.patient_id = ? ORDER BY v.visited_at DESC LIMIT 500`,
    )
    .all(patientId) as Record<string, unknown>[];
  return rows.map(mapVisit);
}

/* ------------------------------------------------------------------ */
/* Clinical options                                                    */
/* ------------------------------------------------------------------ */

export function listClinicalOptions(
  sc: ServiceContext,
  section: 'cc' | 'oe' | 're',
): { id: number; code: string; label: string }[] {
  return sc.db
    .prepare('SELECT id, code, label FROM clinical_options WHERE section = ? ORDER BY label')
    .all(section) as { id: number; code: string; label: string }[];
}

export function createClinicalOption(
  sc: ServiceContext,
  p: { section: 'cc' | 'oe' | 're'; label: string },
): { id: number; code: string; label: string } {
  const code = `${p.section}_${p.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)}_${Date.now().toString(36)}`;
  const existing = sc.db
    .prepare('SELECT id FROM clinical_options WHERE section = ? AND label = ?')
    .get(p.section, p.label);
  if (existing) ipcError('CONFLICT', 'That option already exists in this section.');
  const info = sc.db
    .prepare('INSERT INTO clinical_options (section, code, label, is_builtin) VALUES (?, ?, ?, 0)')
    .run(p.section, code, p.label);
  audit(sc, {
    action: 'clinical_option.create',
    entityType: 'clinical_option',
    entityId: Number(info.lastInsertRowid),
    summary: `Added ${p.section.toUpperCase()} option`,
  });
  return { id: Number(info.lastInsertRowid), code, label: p.label };
}

/* ------------------------------------------------------------------ */
/* Dental chart                                                        */
/* ------------------------------------------------------------------ */

export function chartCatalog(): {
  teeth: ReturnType<typeof buildTeeth>;
  conditions: { id: number; code: string; label: string; category: string; color: string; isCustom: boolean }[];
} {
  // DB-dependent variant is provided via getChartCatalog below.
  return { teeth: buildTeeth(), conditions: [] };
}

export function getChartCatalog(sc: ServiceContext): {
  teeth: ReturnType<typeof buildTeeth>;
  conditions: { id: number; code: string; label: string; category: string; color: string; isCustom: boolean }[];
} {
  const conditions = sc.db
    .prepare('SELECT id, code, label, category, color, is_custom FROM tooth_conditions ORDER BY sort_order, label')
    .all() as { id: number; code: string; label: string; category: string; color: string; is_custom: number }[];
  return {
    teeth: buildTeeth(),
    conditions: conditions.map((c) => ({ ...c, isCustom: c.is_custom === 1 })),
  };
}

export function getChart(sc: ServiceContext, patientId: number): ChartEntry[] {
  const patient = sc.db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
  if (!patient) ipcError('NOT_FOUND', 'Patient not found.');
  const rows = sc.db
    .prepare(
      `SELECT e.id, e.patient_id, e.fdi, e.condition_code, e.severity, e.notes, e.recorded_at,
              c.label AS condition_label, c.color AS condition_color,
              u.username AS recorded_by
       FROM dental_chart_entries e
       LEFT JOIN tooth_conditions c ON c.code = e.condition_code
       LEFT JOIN users u ON u.id = e.recorded_by
       WHERE e.patient_id = ?
       ORDER BY e.fdi, c.label`,
    )
    .all(patientId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    patientId: r.patient_id as number,
    fdi: r.fdi as string,
    conditionCode: r.condition_code as string,
    conditionLabel: (r.condition_label as string) ?? (r.condition_code as string),
    conditionColor: (r.condition_color as string) ?? '#64748b',
    severity: r.severity as ChartEntry['severity'],
    notes: r.notes as string,
    visitId: null,
    recordedBy: (r.recorded_by as string) ?? 'system',
    recordedAt: r.recorded_at as number,
  }));
}

export function setChartEntry(
  sc: ServiceContext,
  p: {
    patientId: number;
    fdi: string;
    conditionCode: string;
    severity: 'mild' | 'moderate' | 'severe' | null;
    notes: string;
    visitId: number | null;
  },
): ChartEntry {
  const tooth = sc.db.prepare('SELECT fdi FROM teeth WHERE fdi = ?').get(p.fdi);
  if (!tooth) ipcError('VALIDATION', `Unknown tooth: ${p.fdi}`);
  const cond = sc.db
    .prepare('SELECT code FROM tooth_conditions WHERE code = ?')
    .get(p.conditionCode);
  if (!cond) ipcError('VALIDATION', 'Unknown tooth condition.');

  const now = sc.now();
  sc.db
    .prepare(
      `INSERT INTO dental_chart_entries (patient_id, fdi, condition_code, severity, notes, visit_id, recorded_by, recorded_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(patient_id, fdi, condition_code)
       DO UPDATE SET severity = excluded.severity, notes = excluded.notes,
                     visit_id = excluded.visit_id, recorded_at = excluded.recorded_at`,
    )
    .run(p.patientId, p.fdi, p.conditionCode, p.severity, p.notes, p.visitId, sc.ctx.userId, now);

  audit(sc, {
    action: 'chart.set',
    entityType: 'dental_chart',
    entityId: `${p.patientId}:${p.fdi}`,
    summary: `Set ${p.conditionCode} on tooth ${p.fdi}`,
  });
  const entries = getChart(sc, p.patientId);
  const found = entries.find((e) => e.fdi === p.fdi && e.conditionCode === p.conditionCode);
  if (!found) ipcError('INTERNAL', 'Chart entry missing after write.');
  return found;
}

export function clearChartEntry(
  sc: ServiceContext,
  p: { patientId: number; fdi: string; conditionCode: string },
): { done: true } {
  sc.db
    .prepare(
      'DELETE FROM dental_chart_entries WHERE patient_id = ? AND fdi = ? AND condition_code = ?',
    )
    .run(p.patientId, p.fdi, p.conditionCode);
  audit(sc, {
    action: 'chart.clear',
    entityType: 'dental_chart',
    entityId: `${p.patientId}:${p.fdi}`,
    summary: `Removed ${p.conditionCode} from tooth ${p.fdi}`,
  });
  return { done: true };
}

export function addToothCondition(
  sc: ServiceContext,
  p: { code: string; label: string; category: string; color: string },
): { id: number; code: string; label: string; category: string; color: string; isCustom: boolean } {
  const exists = sc.db.prepare('SELECT id FROM tooth_conditions WHERE code = ?').get(p.code);
  if (exists) ipcError('CONFLICT', 'A condition with that code already exists.');
  const info = sc.db
    .prepare(
      'INSERT INTO tooth_conditions (code, label, category, color, is_custom, sort_order) VALUES (?,?,?,?,1,1000)',
    )
    .run(p.code, p.label, p.category, p.color);
  audit(sc, {
    action: 'chart.condition_add',
    entityType: 'tooth_condition',
    entityId: Number(info.lastInsertRowid),
    summary: `Added condition ${p.label}`,
  });
  return { id: Number(info.lastInsertRowid), ...p, isCustom: true };
}

/* ------------------------------------------------------------------ */
/* Treatments                                                          */
/* ------------------------------------------------------------------ */

type TreatmentParams = {
  id: number | null;
  code: string;
  name: string;
  category: string;
  defaultPricePoisha: number;
  description: string;
  durationMinutes: number;
  isActive: boolean;
};

export function listTreatments(
  sc: ServiceContext,
  p: { includeInactive: boolean; search: string },
): TreatmentDef[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (!p.includeInactive) where.push('is_active = 1');
  if (p.search.trim()) {
    where.push('(name LIKE ? OR code LIKE ? OR category LIKE ?)');
    const like = `%${p.search.trim()}%`;
    args.push(like, like, like);
  }
  const sql = `SELECT id, code, name, category, default_price_poisha, description,
                      duration_minutes, is_active
               FROM treatments ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY category, name`;
  const rows = sc.db.prepare(sql).all(...args) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    code: r.code as string,
    name: r.name as string,
    category: r.category as string,
    defaultPricePoisha: r.default_price_poisha as number,
    description: r.description as string,
    durationMinutes: r.duration_minutes as number,
    isActive: r.is_active === 1,
  }));
}

export function saveTreatment(sc: ServiceContext, p: TreatmentParams): TreatmentDef {
  const now = sc.now();
  if (p.id) {
    const before = sc.db.prepare('SELECT * FROM treatments WHERE id = ?').get(p.id);
    if (!before) ipcError('NOT_FOUND', 'Treatment not found.');
    const used = sc.db
      .prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE treatment_id = ?')
      .get(p.id) as { n: number };
    // Price changes are safe: invoice items snapshot name/price at billing time.
    sc.db
      .prepare(
        `UPDATE treatments SET code=?, name=?, category=?, default_price_poisha=?,
                description=?, duration_minutes=?, is_active=?, updated_at=? WHERE id=?`,
      )
      .run(p.code, p.name, p.category, p.defaultPricePoisha, p.description,
        p.durationMinutes, p.isActive ? 1 : 0, now, p.id);
    audit(sc, {
      action: 'treatment.update',
      entityType: 'treatment',
      entityId: p.id,
      summary: `Updated treatment${used.n > 0 ? ` (used on ${used.n} invoice items — snapshots preserved)` : ''}`,
    });
  } else {
    const info = sc.db
      .prepare(
        `INSERT INTO treatments (code, name, category, default_price_poisha, description, duration_minutes, is_active, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(p.code, p.name, p.category, p.defaultPricePoisha, p.description,
        p.durationMinutes, p.isActive ? 1 : 0, now, now);
    audit(sc, {
      action: 'treatment.create',
      entityType: 'treatment',
      entityId: Number(info.lastInsertRowid),
      summary: `Created treatment ${p.name}`,
    });
    p.id = Number(info.lastInsertRowid);
  }
  const row = sc.db
    .prepare(
      `SELECT id, code, name, category, default_price_poisha, description, duration_minutes, is_active
       FROM treatments WHERE id = ?`,
    )
    .get(p.id) as Record<string, unknown>;
  return {
    id: row.id as number,
    code: row.code as string,
    name: row.name as string,
    category: row.category as string,
    defaultPricePoisha: row.default_price_poisha as number,
    description: row.description as string,
    durationMinutes: row.duration_minutes as number,
    isActive: row.is_active === 1,
  };
}

export type { ClinicalOption };
export { TOOTH_CONDITIONS };
