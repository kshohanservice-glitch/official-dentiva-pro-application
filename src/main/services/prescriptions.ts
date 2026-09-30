/** Prescriptions service: list/get/create + medicine catalog. */

import type { ServiceContext } from './context';
import { audit, requireUser } from './context';
import { ipcError } from '../ipc/dispatcher';
import { nextCode } from '../db/database';
import type { MedicationLine, MedicineCatalogItem, Paged, PrescriptionRecord } from '@shared/types';

function mapRx(row: Record<string, unknown>, items: MedicationLine[]): PrescriptionRecord {
  return {
    id: row.id as number,
    prescriptionCode: row.prescription_code as string,
    patientId: row.patient_id as number,
    patientName: row.patient_name as string,
    patientCode: row.patient_code as string,
    dentistId: row.dentist_id as number,
    dentistName: row.dentist_name as string,
    issuedAt: row.issued_at as number,
    chiefComplaint: row.chief_complaint as string,
    onExamination: row.on_examination as string,
    restExamination: row.rest_examination as string,
    advice: row.advice as string,
    notes: row.notes as string,
    visitId: row.visit_id as number | null,
    items,
    createdAt: row.created_at as number,
  };
}

const RX_SELECT = `
  SELECT r.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
  FROM prescriptions r
  JOIN patients p ON p.id = r.patient_id
  JOIN dentists d ON d.id = r.dentist_id`;

function loadItems(sc: ServiceContext, prescriptionId: number): MedicationLine[] {
  const rows = sc.db
    .prepare(
      `SELECT id, medicine_name, form, strength, dose, frequency, timing, before_after_food,
              duration, quantity, route, instructions
       FROM prescription_items WHERE prescription_id = ? ORDER BY seq`,
    )
    .all(prescriptionId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    medicineName: r.medicine_name as string,
    form: r.form as string,
    strength: r.strength as string,
    dose: r.dose as string,
    frequency: r.frequency as string,
    timing: r.timing as string,
    beforeAfterFood: r.before_after_food as string,
    duration: r.duration as string,
    quantity: r.quantity as string,
    route: r.route as string,
    instructions: r.instructions as string,
  }));
}

export function listPrescriptions(
  sc: ServiceContext,
  p: { patientId?: number; page: number; pageSize: number },
): Paged<PrescriptionRecord> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.patientId) {
    where.push('r.patient_id = ?');
    args.push(p.patientId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    sc.db.prepare(`SELECT COUNT(*) AS n FROM prescriptions r ${whereSql}`).get(...args) as {
      n: number;
    }
  ).n;
  const rows = sc.db
    .prepare(`${RX_SELECT} ${whereSql} ORDER BY r.issued_at DESC LIMIT ? OFFSET ?`)
    .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as Record<string, unknown>[];
  return {
    items: rows.map((r) => mapRx(r, loadItems(sc, r.id as number))),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export function getPrescription(sc: ServiceContext, id: number): PrescriptionRecord {
  const row = sc.db.prepare(`${RX_SELECT} WHERE r.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Prescription not found.');
  return mapRx(row, loadItems(sc, id));
}

type CreatePrescription = {
  patientId: number;
  dentistId: number;
  visitId: number | null;
  issuedAt?: number;
  chiefComplaint: string;
  onExamination: string;
  restExamination: string;
  advice: string;
  notes: string;
  items: {
    medicineName: string;
    form: string;
    strength: string;
    dose: string;
    frequency: string;
    timing: string;
    beforeAfterFood: string;
    duration: string;
    quantity: string;
    route: string;
    instructions: string;
  }[];
};

export function createPrescription(sc: ServiceContext, p: CreatePrescription): PrescriptionRecord {
  const user = requireUser(sc);
  if (p.items.length === 0) ipcError('VALIDATION', 'Add at least one medication.');
  const now = sc.now();
  const issuedAt = p.issuedAt ?? now;

  const id = sc.db.transaction(() => {
    const code = nextCode(sc.db, 'prescription', 'RX-', 6);
    const info = sc.db
      .prepare(
        `INSERT INTO prescriptions
          (prescription_code, patient_id, dentist_id, visit_id, issued_at, chief_complaint,
           on_examination, rest_examination, advice, notes, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        code, p.patientId, p.dentistId, p.visitId, issuedAt, p.chiefComplaint,
        p.onExamination, p.restExamination, p.advice, p.notes, user.id, now,
      );
    const rxId = Number(info.lastInsertRowid);
    const ins = sc.db.prepare(
      `INSERT INTO prescription_items
        (prescription_id, seq, medicine_name, form, strength, dose, frequency, timing,
         before_after_food, duration, quantity, route, instructions)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    p.items.forEach((it, idx) => {
      ins.run(
        rxId, idx + 1, it.medicineName, it.form, it.strength, it.dose, it.frequency,
        it.timing, it.beforeAfterFood, it.duration, it.quantity, it.route, it.instructions,
      );
    });
    return rxId;
  })();

  audit(sc, {
    action: 'prescription.create',
    entityType: 'prescription',
    entityId: id,
    summary: `Created prescription with ${p.items.length} medication(s)`,
  });
  return getPrescription(sc, id);
}

export function listMedicines(sc: ServiceContext, search: string): MedicineCatalogItem[] {
  const args: unknown[] = [];
  let sql = 'SELECT id, medicine_name, form, strength, default_instructions FROM medicine_catalog';
  if (search.trim()) {
    sql += ' WHERE medicine_name LIKE ?';
    args.push(`%${search.trim()}%`);
  }
  sql += ' ORDER BY medicine_name LIMIT 100';
  const rows = sc.db.prepare(sql).all(...args) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    medicineName: r.medicine_name as string,
    form: r.form as string,
    strength: r.strength as string,
    defaultInstructions: r.default_instructions as string,
  }));
}

export function upsertMedicine(
  sc: ServiceContext,
  p: {
    id: number | null;
    medicineName: string;
    form: string;
    strength: string;
    defaultInstructions: string;
  },
): MedicineCatalogItem {
  if (p.id) {
    sc.db
      .prepare(
        'UPDATE medicine_catalog SET medicine_name=?, form=?, strength=?, default_instructions=? WHERE id=?',
      )
      .run(p.medicineName, p.form, p.strength, p.defaultInstructions, p.id);
    audit(sc, {
      action: 'medicine.update',
      entityType: 'medicine',
      entityId: p.id,
      summary: 'Updated catalog medicine',
    });
  } else {
    const dup = sc.db
      .prepare('SELECT id FROM medicine_catalog WHERE medicine_name = ? AND form = ? AND strength = ?')
      .get(p.medicineName, p.form, p.strength);
    if (dup) ipcError('CONFLICT', 'That medicine already exists in the catalog.');
    const info = sc.db
      .prepare(
        'INSERT INTO medicine_catalog (medicine_name, form, strength, default_instructions) VALUES (?,?,?,?)',
      )
      .run(p.medicineName, p.form, p.strength, p.defaultInstructions);
    p.id = Number(info.lastInsertRowid);
    audit(sc, {
      action: 'medicine.create',
      entityType: 'medicine',
      entityId: p.id,
      summary: 'Added catalog medicine',
    });
  }
  const row = sc.db
    .prepare(
      'SELECT id, medicine_name, form, strength, default_instructions FROM medicine_catalog WHERE id = ?',
    )
    .get(p.id) as Record<string, unknown>;
  return {
    id: row.id as number,
    medicineName: row.medicine_name as string,
    form: row.form as string,
    strength: row.strength as string,
    defaultInstructions: row.default_instructions as string,
  };
}
