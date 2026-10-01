/** Appointments & queue services: conflict detection, statuses, queue flow. */

import type { ServiceContext } from './context';
import { audit, requireUser } from './context';
import { ipcError } from '../ipc/dispatcher';
import { nextCode } from '../db/database';
import { epochToDhakaDate, dhakaDateToEpoch, minutesBetween } from '@shared/datetime';
import type { AppointmentRecord, QueueEntry } from '@shared/types';

function mapAppointment(row: Record<string, unknown>): AppointmentRecord {
  return {
    id: row.id as number,
    appointmentCode: row.appointment_code as string,
    patientId: row.patient_id as number,
    patientName: row.patient_name as string,
    patientCode: row.patient_code as string,
    dentistId: row.dentist_id as number,
    dentistName: row.dentist_name as string,
    startsAt: row.starts_at as number,
    endsAt: row.ends_at as number,
    reason: row.reason as string,
    notes: row.notes as string,
    status: row.status as AppointmentRecord['status'],
    checkedInAt: row.checked_in_at as number | null,
    cancelReason: row.cancel_reason as string,
    createdAt: row.created_at as number,
  };
}

const APPT_SELECT = `
  SELECT a.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN dentists d ON d.id = a.dentist_id`;

export function listAppointments(
  sc: ServiceContext,
  p: {
    from: string;
    to: string;
    dentistId?: number;
    status: string;
    patientId?: number;
  },
): AppointmentRecord[] {
  const start = dhakaDateToEpoch(p.from);
  const end = dhakaDateToEpoch(p.to) + 86_400_000;
  const where = ['a.starts_at >= ?', 'a.starts_at < ?'];
  const args: unknown[] = [start, end];
  if (p.dentistId) {
    where.push('a.dentist_id = ?');
    args.push(p.dentistId);
  }
  if (p.status !== 'all') {
    where.push('a.status = ?');
    args.push(p.status);
  }
  if (p.patientId) {
    where.push('a.patient_id = ?');
    args.push(p.patientId);
  }
  const rows = sc.db
    .prepare(`${APPT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.starts_at`)
    .all(...args) as Record<string, unknown>[];
  return rows.map(mapAppointment);
}

export function findConflicts(
  sc: ServiceContext,
  p: { dentistId: number; startsAt: number; endsAt: number; excludeId?: number },
): { conflicts: AppointmentRecord[] } {
  const args: unknown[] = [p.dentistId, p.startsAt, p.endsAt];
  let sql = `${APPT_SELECT}
    WHERE a.dentist_id = ? AND a.starts_at < ? AND a.ends_at > ?
      AND a.status NOT IN ('cancelled','no_show')`;
  if (p.excludeId) {
    sql += ' AND a.id != ?';
    args.push(p.excludeId);
  }
  const rows = sc.db.prepare(sql).all(...args) as Record<string, unknown>[];
  return { conflicts: rows.map(mapAppointment) };
}

type CreateAppointment = {
  patientId: number;
  dentistId: number;
  startsAt: number;
  endsAt: number;
  reason: string;
  notes: string;
};

export function createAppointment(sc: ServiceContext, p: CreateAppointment): AppointmentRecord {
  if (p.endsAt <= p.startsAt) ipcError('VALIDATION', 'End time must be after start time.');
  if (p.startsAt < sc.now() - 60 * 60_000) {
    ipcError('VALIDATION', 'Appointment time is in the past.');
  }
  const { conflicts } = findConflicts(sc, {
    dentistId: p.dentistId,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
  });
  const first = conflicts[0];
  if (first) {
    ipcError(
      'CONFLICT',
      `This dentist already has an appointment ${new Date(first.startsAt).toLocaleTimeString()}–${new Date(first.endsAt).toLocaleTimeString()} overlapping the selected time.`,
      { conflictCodes: conflicts.map((c) => c.appointmentCode) },
    );
  }
  const now = sc.now();
  const user = requireUser(sc);
  const id = sc.db.transaction(() => {
    const compact = epochToDhakaDate(p.startsAt).replace(/-/g, '').slice(2);
    const code = nextCode(sc.db, 'appointment', 'APT-', 6);
    void compact;
    const info = sc.db
      .prepare(
        `INSERT INTO appointments
          (appointment_code, patient_id, dentist_id, starts_at, ends_at, reason, notes,
           status, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,'scheduled',?,?,?)`,
      )
      .run(code, p.patientId, p.dentistId, p.startsAt, p.endsAt, p.reason, p.notes,
        user.id, now, now);
    return Number(info.lastInsertRowid);
  })();
  audit(sc, {
    action: 'appointment.create',
    entityType: 'appointment',
    entityId: id,
    summary: `Created appointment`,
  });
  const row = sc.db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(id) as Record<string, unknown>;
  return mapAppointment(row);
}

type UpdateAppointment = {
  id: number;
  dentistId?: number;
  startsAt?: number;
  endsAt?: number;
  reason?: string;
  notes?: string;
  status?: AppointmentRecord['status'];
  cancelReason: string;
};

export function updateAppointment(sc: ServiceContext, p: UpdateAppointment): AppointmentRecord {
  const before = sc.db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(p.id) as
    | Record<string, unknown>
    | undefined;
  if (!before) ipcError('NOT_FOUND', 'Appointment not found.');
  const current = mapAppointment(before);

  const dentistId = p.dentistId ?? current.dentistId;
  const startsAt = p.startsAt ?? current.startsAt;
  const endsAt = p.endsAt ?? current.endsAt;
  if (endsAt <= startsAt) ipcError('VALIDATION', 'End time must be after start time.');

  const moving = p.startsAt !== undefined || p.endsAt !== undefined || p.dentistId !== undefined;
  if (moving) {
    const { conflicts } = findConflicts(sc, {
      dentistId,
      startsAt,
      endsAt,
      excludeId: p.id,
    });
    if (conflicts.length > 0) {
      ipcError('CONFLICT', 'The dentist has another appointment at that time.', {
        conflictCodes: conflicts.map((c) => c.appointmentCode),
      });
    }
  }

  const now = sc.now();
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (p.dentistId !== undefined) push('dentist_id', p.dentistId);
  if (p.startsAt !== undefined) push('starts_at', p.startsAt);
  if (p.endsAt !== undefined) push('ends_at', p.endsAt);
  if (p.reason !== undefined) push('reason', p.reason);
  if (p.notes !== undefined) push('notes', p.notes);
  if (p.status !== undefined) {
    push('status', p.status);
    if (p.status === 'checked_in') push('checked_in_at', now);
    if (p.status === 'cancelled') push('cancel_reason', p.cancelReason);
    if (p.status === 'scheduled') push('checked_in_at', null);
  }
  sets.push('updated_at = ?');
  args.push(now, p.id);
  sc.db.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  audit(sc, {
    action: `appointment.${p.status ? `status_${p.status}` : 'update'}`,
    entityType: 'appointment',
    entityId: p.id,
    summary: `Appointment updated`,
    before: { status: current.status },
    after: { status: p.status ?? current.status },
  });
  const row = sc.db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(p.id) as Record<string, unknown>;
  return mapAppointment(row);
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

function mapQueue(row: Record<string, unknown>): QueueEntry {
  const checkedInAt = row.checked_in_at as number;
  const status = row.status as QueueEntry['status'];
  const finishedAt = row.finished_at as number | null;
  const now = Date.now();
  return {
    id: row.id as number,
    queueDate: row.queue_date as string,
    position: row.position as number,
    patientId: row.patient_id as number,
    patientName: row.patient_name as string,
    patientCode: row.patient_code as string,
    dentistId: row.dentist_id as number,
    dentistName: row.dentist_name as string,
    appointmentId: row.appointment_id as number | null,
    walkIn: row.walk_in === 1,
    status,
    checkedInAt,
    startedAt: row.started_at as number | null,
    finishedAt,
    waitedMinutes: minutesBetween(checkedInAt, finishedAt ?? now),
  };
}

const QUEUE_SELECT = `
  SELECT q.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
  FROM queue_entries q
  JOIN patients p ON p.id = q.patient_id
  JOIN dentists d ON d.id = q.dentist_id`;

export function listQueue(
  sc: ServiceContext,
  p: { date: string; dentistId?: number },
): QueueEntry[] {
  const args: unknown[] = [p.date];
  let sql = `${QUEUE_SELECT} WHERE q.queue_date = ?`;
  if (p.dentistId) {
    sql += ' AND q.dentist_id = ?';
    args.push(p.dentistId);
  }
  sql += ` ORDER BY CASE q.status WHEN 'waiting' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, q.position`;
  const rows = sc.db.prepare(sql).all(...args) as Record<string, unknown>[];
  return rows.map(mapQueue);
}

function nextPosition(sc: ServiceContext, date: string): number {
  const row = sc.db
    .prepare('SELECT COALESCE(MAX(position), 0) AS m FROM queue_entries WHERE queue_date = ?')
    .get(date) as { m: number };
  return row.m + 1;
}

export function addWalkIn(
  sc: ServiceContext,
  p: { patientId: number; dentistId: number; date: string },
): QueueEntry {
  const now = sc.now();
  const id = sc.db.transaction(() => {
    const active = sc.db
      .prepare(
        `SELECT id FROM queue_entries
         WHERE queue_date = ? AND patient_id = ? AND dentist_id = ?
           AND status IN ('waiting','in_progress')`,
      )
      .get(p.date, p.patientId, p.dentistId);
    if (active) ipcError('CONFLICT', 'This patient is already in today’s queue for this dentist.');
    const pos = nextPosition(sc, p.date);
    const info = sc.db
      .prepare(
        `INSERT INTO queue_entries
          (queue_date, position, patient_id, dentist_id, appointment_id, walk_in, status, checked_in_at, created_at, updated_at)
         VALUES (?,?,?,?,NULL,1,'waiting',?,?,?)`,
      )
      .run(p.date, pos, p.patientId, p.dentistId, now, now, now);
    return Number(info.lastInsertRowid);
  })();
  audit(sc, { action: 'queue.walk_in', entityType: 'queue', entityId: id, summary: 'Walk-in added to queue' });
  const row = sc.db.prepare(`${QUEUE_SELECT} WHERE q.id = ?`).get(id) as Record<string, unknown>;
  return mapQueue(row);
}

export function checkIn(sc: ServiceContext, appointmentId: number): QueueEntry {
  const now = sc.now();
  const id = sc.db.transaction(() => {
    const appt = sc.db
      .prepare('SELECT * FROM appointments WHERE id = ?')
      .get(appointmentId) as Record<string, unknown> | undefined;
    if (!appt) ipcError('NOT_FOUND', 'Appointment not found.');
    const status = appt.status as string;
    if (status === 'cancelled') ipcError('CONFLICT', 'Cannot check in a cancelled appointment.');
    if (status === 'no_show') ipcError('CONFLICT', 'Cannot check in a no-show appointment.');
    if (status === 'completed') ipcError('CONFLICT', 'This appointment is already completed.');

    const date = epochToDhakaDate(appt.starts_at as number);
    const existing = sc.db
      .prepare(
        `SELECT id FROM queue_entries
         WHERE queue_date = ? AND patient_id = ? AND dentist_id = ?
           AND status IN ('waiting','in_progress')`,
      )
      .get(date, appt.patient_id, appt.dentist_id);
    let queueId: number;
    if (existing) {
      queueId = (existing as { id: number }).id;
    } else {
      const pos = nextPosition(sc, date);
      const info = sc.db
        .prepare(
          `INSERT INTO queue_entries
            (queue_date, position, patient_id, dentist_id, appointment_id, walk_in, status, checked_in_at, created_at, updated_at)
           VALUES (?,?,?,?,?,0,'waiting',?,?,?)`,
        )
        .run(date, pos, appt.patient_id, appt.dentist_id, appointmentId, now, now, now);
      queueId = Number(info.lastInsertRowid);
    }
    sc.db
      .prepare(`UPDATE appointments SET status = 'checked_in', checked_in_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, appointmentId);
    return queueId;
  })();
  audit(sc, {
    action: 'queue.check_in',
    entityType: 'queue',
    entityId: id,
    summary: `Checked in appointment #${appointmentId}`,
  });
  const row = sc.db.prepare(`${QUEUE_SELECT} WHERE q.id = ?`).get(id) as Record<string, unknown>;
  return mapQueue(row);
}

export function advanceQueue(
  sc: ServiceContext,
  p: { id: number; action: 'start' | 'complete' | 'skip' | 'recall' },
): { entries: QueueEntry[] } {
  const now = sc.now();
  const row = sc.db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(p.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Queue entry not found.');
  const status = row.status as string;

  sc.db.transaction(() => {
    switch (p.action) {
      case 'start': {
        if (status !== 'waiting') ipcError('CONFLICT', 'Only waiting patients can be started.');
        const inProgress = sc.db
          .prepare(
            `SELECT id FROM queue_entries WHERE queue_date = ? AND dentist_id = ? AND status = 'in_progress'`,
          )
          .get(row.queue_date, row.dentist_id);
        if (inProgress) {
          ipcError('CONFLICT', 'Finish the patient currently in progress first.');
        }
        sc.db
          .prepare(`UPDATE queue_entries SET status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ?`)
          .run(now, now, p.id);
        if (row.appointment_id) {
          sc.db
            .prepare(`UPDATE appointments SET status = 'in_progress', updated_at = ? WHERE id = ?`)
            .run(now, row.appointment_id);
        }
        break;
      }
      case 'complete': {
        if (status === 'completed') ipcError('CONFLICT', 'Already completed.');
        sc.db
          .prepare(`UPDATE queue_entries SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ?`)
          .run(now, now, p.id);
        if (row.appointment_id) {
          sc.db
            .prepare(`UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ?`)
            .run(now, row.appointment_id);
        }
        break;
      }
      case 'skip': {
        if (status !== 'waiting') ipcError('CONFLICT', 'Only waiting patients can be skipped.');
        sc.db
          .prepare(`UPDATE queue_entries SET status = 'skipped', finished_at = ?, updated_at = ? WHERE id = ?`)
          .run(now, now, p.id);
        break;
      }
      case 'recall': {
        if (status !== 'skipped') ipcError('CONFLICT', 'Only skipped patients can be recalled.');
        sc.db
          .prepare(`UPDATE queue_entries SET status = 'waiting', finished_at = NULL, updated_at = ? WHERE id = ?`)
          .run(now, p.id);
        break;
      }
    }
  })();

  audit(sc, {
    action: `queue.${p.action}`,
    entityType: 'queue',
    entityId: p.id,
    summary: `Queue ${p.action}`,
  });
  return { entries: listQueue(sc, { date: row.queue_date as string }) };
}

export function removeQueueEntry(sc: ServiceContext, id: number): { done: true } {
  const row = sc.db.prepare('SELECT queue_date FROM queue_entries WHERE id = ?').get(id) as
    | { queue_date: string }
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Queue entry not found.');
  sc.db.prepare('DELETE FROM queue_entries WHERE id = ?').run(id);
  audit(sc, { action: 'queue.remove', entityType: 'queue', entityId: id, summary: 'Queue entry removed' });
  void row;
  return { done: true };
}
