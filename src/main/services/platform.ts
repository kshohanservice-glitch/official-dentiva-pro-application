/** Platform services: settings, clinic, attachments, notifications, search, referrals, audit, dashboard. */

import type { ServiceContext } from './context';
import { audit } from './context';
import { ipcError } from '../ipc/dispatcher';
import type { Permission } from '@shared/permissions';
import {
  cpSync, existsSync, mkdirSync, writeFileSync, readFileSync, statSync, unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, basename } from 'node:path';
import { epochToDhakaDate, dhakaDateToEpoch, presetRange, todayDhaka } from '@shared/datetime';
import type {
  AppointmentRecord,
  AttachmentRecord,
  AuditLogRecord,
  ClinicConfig,
  DashboardData,
  InventoryItemRecord,
  MethodBreakdownRow,
  NotificationRecord,
  Paged,
  PatientSummary,
  SearchResult,
} from '@shared/types';

/* ------------------------------------------------------------------ */
/* Settings (generic key/value table: key, value TEXT)                 */
/* ------------------------------------------------------------------ */

export type SettingValue = string | number | boolean | null;

export const KNOWN_SETTING_KEYS = [
  'autoLockMinutes',
  'backupFolder',
  'backupIntervalDays',
  'defaultPaperSize',
  'notifyAppointments',
  'notifyInventory',
  'notifyFinancial',
  'notifyBackup',
  'lowStockThresholdDefault',
] as const;
export type SettingKey = (typeof KNOWN_SETTING_KEYS)[number];

function parseSetting(raw: string): SettingValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'null') return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      return v;
    }
  } catch {
    /* plain string */
  }
  return raw;
}

export function getAllSettings(sc: ServiceContext): Record<string, SettingValue> {
  const rows = sc.db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  const out: Record<string, SettingValue> = {};
  for (const r of rows) out[r.key] = parseSetting(r.value);
  return out;
}

export function setSetting(
  sc: ServiceContext,
  key: SettingKey,
  value: SettingValue,
): Record<string, SettingValue> {
  if (key === 'autoLockMinutes' && ![5, 10, 15, 30].includes(Number(value))) {
    ipcError('VALIDATION', 'Auto-lock must be 5, 10, 15 or 30 minutes.');
  }
  if (key === 'backupIntervalDays' && ![0, 7, 15, 30].includes(Number(value))) {
    ipcError('VALIDATION', 'Backup interval must be 0 (off), 7, 15 or 30 days.');
  }
  const stored =
    typeof value === 'string' ? value : JSON.stringify(value);
  sc.db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, stored, sc.now());
  if (key === 'autoLockMinutes') sc.session.setAutoLockMinutes(Number(value));
  audit(sc, {
    action: 'settings.set',
    entityType: 'settings',
    entityId: key,
    summary: `Updated setting ${key}`,
  });
  return getAllSettings(sc);
}

export function resetTemplateSetting(sc: ServiceContext, which: 'prescription' | 'invoice'): { done: true } {
  sc.db.prepare('DELETE FROM settings WHERE key = ?').run(`${which}TemplateHtml`);
  audit(sc, {
    action: 'settings.reset_template',
    entityType: 'settings',
    entityId: which,
    summary: `Reset ${which} template to default`,
  });
  return { done: true };
}

/* ------------------------------------------------------------------ */
/* Clinic config (single-row table)                                    */
/* ------------------------------------------------------------------ */

const CLINIC_COLUMNS: Record<string, keyof ClinicConfig> = {
  clinic_name: 'clinicName',
  logo_path: 'logoPath',
  address: 'address',
  phone: 'phone',
  email: 'email',
  website: 'website',
  registration_info: 'registrationInfo',
  operating_hours: 'operatingHours',
  currency: 'currency',
  footer_note: 'footerNote',
  prescription_footer: 'prescriptionFooter',
  invoice_footer: 'invoiceFooter',
};

/** Convert a raw clinic_config row (or undefined) into the shared ClinicConfig shape. */
export function clinicRowToConfig(row: Record<string, unknown> | undefined): ClinicConfig {
  const base: ClinicConfig = {
    id: 1,
    clinicName: '',
    logoPath: null,
    address: '',
    phone: '',
    email: '',
    website: '',
    registrationInfo: '',
    operatingHours: '',
    currency: 'BDT',
    footerNote: '',
    prescriptionFooter: '',
    invoiceFooter: '',
  };
  if (!row) return base;
  for (const [col, prop] of Object.entries(CLINIC_COLUMNS)) {
    const v = row[col];
    if (v === undefined || v === null) continue;
    (base as unknown as Record<string, unknown>)[prop] = v;
  }
  return base;
}

export function getClinicConfig(sc: ServiceContext): ClinicConfig {
  const row = sc.db.prepare('SELECT * FROM clinic_config WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined;
  return clinicRowToConfig(row);
}

type ClinicUpdate = Omit<ClinicConfig, 'id' | 'currency' | 'logoPath'>;

export function updateClinicConfig(sc: ServiceContext, p: ClinicUpdate): ClinicConfig {
  const before = getClinicConfig(sc);
  sc.db
    .prepare(
      `UPDATE clinic_config SET clinic_name=?, address=?, phone=?, email=?, website=?,
              registration_info=?, operating_hours=?, footer_note=?, prescription_footer=?,
              invoice_footer=?, updated_at=? WHERE id=1`,
    )
    .run(
      p.clinicName, p.address, p.phone, p.email, p.website,
      p.registrationInfo, p.operatingHours, p.footerNote, p.prescriptionFooter,
      p.invoiceFooter, sc.now(),
    );
  audit(sc, {
    action: 'clinic.update',
    entityType: 'clinic',
    entityId: 1,
    summary: 'Updated clinic profile',
    before: { clinicName: before.clinicName },
    after: { clinicName: p.clinicName },
  });
  return getClinicConfig(sc);
}

const MAX_LOGO_BYTES = 1_000_000;

export function setClinicLogo(sc: ServiceContext, sourcePath: string | null): ClinicConfig {
  const brandingDir = join(sc.userDataDir, 'branding');
  if (sourcePath === null) {
    const current = getClinicConfig(sc);
    if (current.logoPath && existsSync(current.logoPath)) {
      try {
        unlinkSync(current.logoPath);
      } catch {
        /* ignore */
      }
    }
    sc.db
      .prepare('UPDATE clinic_config SET logo_path = NULL, updated_at = ? WHERE id = 1')
      .run(sc.now());
    audit(sc, { action: 'clinic.clear_logo', entityType: 'clinic', summary: 'Removed clinic logo' });
    return getClinicConfig(sc);
  }
  if (!existsSync(sourcePath)) ipcError('VALIDATION', 'Logo file not found.');
  const st = statSync(sourcePath);
  if (!st.isFile()) ipcError('VALIDATION', 'Logo must be a file.');
  if (st.size > MAX_LOGO_BYTES) ipcError('VALIDATION', 'Logo must be 1 MB or smaller.');
  const ext = extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.svg', '.webp'].includes(ext)) {
    ipcError('VALIDATION', 'Logo must be PNG, JPEG, SVG or WebP.');
  }
  mkdirSync(brandingDir, { recursive: true });
  const dest = join(brandingDir, `logo${ext}`);
  cpSync(sourcePath, dest);
  sc.db
    .prepare('UPDATE clinic_config SET logo_path = ?, updated_at = ? WHERE id = 1')
    .run(dest, sc.now());
  audit(sc, { action: 'clinic.pick_logo', entityType: 'clinic', summary: 'Updated clinic logo' });
  return getClinicConfig(sc);
}

/** Returns logo as data URL for renderer/printing, or null. */
export function clinicLogoDataUrl(sc: ServiceContext): string | null {
  const cfg = getClinicConfig(sc);
  if (!cfg.logoPath || !existsSync(cfg.logoPath)) return null;
  try {
    const buf = readFileSync(cfg.logoPath);
    if (buf.length > 1_000_000) return null;
    const ext = extname(cfg.logoPath).toLowerCase().replace('.', '');
    const mime =
      ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Attachments (managed dir, entity-scoped)                            */
/* ------------------------------------------------------------------ */

const ALLOWED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.pdf', '.txt', '.docx', '.xlsx',
]);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function attachmentsDir(sc: ServiceContext): string {
  const dir = join(sc.userDataDir, 'attachments');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mapAttachment(r: Record<string, unknown>): AttachmentRecord {
  const path = r.stored_path as string;
  return {
    id: r.id as number,
    entityType: r.entity_type as string,
    entityId: r.entity_id as number,
    patientId: (r.patient_id as number | null) ?? null,
    fileName: r.file_name as string,
    mimeType: r.mime_type as string,
    sizeBytes: r.size_bytes as number,
    description: (r.description as string) ?? '',
    uploadedBy: (r.uploaded_by_name as string) ?? (r.uploaded_by as string) ?? '',
    createdAt: r.created_at as number,
    missing: !existsSync(path),
  };
}

export function listAttachments(
  sc: ServiceContext,
  p: { entityType: string; entityId: number },
): AttachmentRecord[] {
  const rows = sc.db
    .prepare(
      `SELECT a.*, u.username AS uploaded_by_name FROM attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
       WHERE a.entity_type = ? AND a.entity_id = ?
       ORDER BY a.created_at DESC`,
    )
    .all(p.entityType, p.entityId) as Record<string, unknown>[];
  return rows.map((r) => mapAttachment(r));
}

export function pickAttachment(
  sc: ServiceContext,
  p: { entityType: string; entityId: number; patientId: number | null; description: string },
  sourcePath: string,
): AttachmentRecord {
  if (!existsSync(sourcePath)) ipcError('VALIDATION', 'Selected file not found.');
  const st = statSync(sourcePath);
  if (!st.isFile()) ipcError('VALIDATION', 'Selected path is not a file.');
  if (st.size > MAX_ATTACHMENT_BYTES) {
    ipcError('VALIDATION', 'File is larger than the 25 MB attachment limit.');
  }
  const ext = extname(sourcePath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    ipcError('VALIDATION', `File type ${ext || '(none)'} is not allowed.`);
  }
  const dir = attachmentsDir(sc);
  const stamp = sc.now();
  const safeName = `${stamp}-${basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100)}`;
  const dest = join(dir, safeName);
  cpSync(sourcePath, dest);
  const buf = readFileSync(dest);
  const sha = createHash('sha256').update(buf).digest('hex');
  const info = sc.db
    .prepare(
      `INSERT INTO attachments
        (entity_type, entity_id, patient_id, file_name, stored_path, mime_type, size_bytes,
         sha256, description, uploaded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.entityType, p.entityId, p.patientId, safeName, dest,
      ext.slice(1) || 'bin', st.size, sha, p.description, sc.ctx.userId, stamp,
    );
  audit(sc, {
    action: 'attachment.pick',
    entityType: p.entityType,
    entityId: p.entityId,
    summary: `Uploaded attachment (${Math.round(st.size / 1024)} KB)`,
  });
  const row = sc.db
    .prepare(
      `SELECT a.*, u.username AS uploaded_by_name FROM attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.id = ?`,
    )
    .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
  return mapAttachment(row);
}

export function attachmentStoredPath(sc: ServiceContext, id: number): string {
  const row = sc.db.prepare('SELECT stored_path FROM attachments WHERE id = ?').get(id) as
    | { stored_path: string }
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Attachment not found.');
  const dir = attachmentsDir(sc);
  if (!row.stored_path.startsWith(dir)) ipcError('VALIDATION', 'Attachment path invalid.');
  if (!existsSync(row.stored_path)) ipcError('NOT_FOUND', 'Attachment file is missing on disk.');
  return row.stored_path;
}

export function deleteAttachment(sc: ServiceContext, id: number): { done: true } {
  const row = sc.db.prepare('SELECT stored_path FROM attachments WHERE id = ?').get(id) as
    | { stored_path: string }
    | undefined;
  if (!row) ipcError('NOT_FOUND', 'Attachment not found.');
  const dir = attachmentsDir(sc);
  if (!row.stored_path.startsWith(dir)) ipcError('VALIDATION', 'Attachment path invalid.');
  sc.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  try {
    if (existsSync(row.stored_path)) unlinkSync(row.stored_path);
  } catch {
    /* already gone */
  }
  audit(sc, { action: 'attachment.delete', entityType: 'attachment', entityId: id, summary: 'Deleted attachment' });
  return { done: true };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

function mapNotification(r: Record<string, unknown>): NotificationRecord {
  return {
    id: r.id as number,
    category: r.category as NotificationRecord['category'],
    severity: r.severity as NotificationRecord['severity'],
    title: r.title as string,
    body: (r.body as string) ?? '',
    createdAt: r.created_at as number,
    readAt: (r.read_at as number | null) ?? null,
    permission: (r.permission as NotificationRecord['permission']) ?? null,
  };
}

export function listNotifications(
  sc: ServiceContext,
  p: { page: number; pageSize: number },
): Paged<NotificationRecord> {
  const total = (sc.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n;
  const unread = (
    sc.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0').get() as { n: number }
  ).n;
  const rows = sc.db
    .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(p.pageSize, (p.page - 1) * p.pageSize) as Record<string, unknown>[];
  void unread;
  return { items: rows.map(mapNotification), total, page: p.page, pageSize: p.pageSize };
}

export function markNotificationRead(sc: ServiceContext, id: number): { done: true } {
  sc.db
    .prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?')
    .run(sc.now(), id);
  return { done: true };
}

export function markAllNotificationsRead(sc: ServiceContext): { done: true } {
  sc.db
    .prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE is_read = 0')
    .run(sc.now());
  return { done: true };
}

export function pushNotification(
  sc: ServiceContext,
  n: {
    category: NotificationRecord['category'];
    severity: NotificationRecord['severity'];
    title: string;
    body: string;
    permission?: Permission | null;
  },
): number {
  const info = sc.db
    .prepare(
      `INSERT INTO notifications (category, severity, title, body, permission, is_read, created_at)
       VALUES (?,?,?,?,?,0,?)`,
    )
    .run(n.category, n.severity, n.title, n.body, n.permission ?? null, sc.now());
  return Number(info.lastInsertRowid);
}

export function scanNotifications(sc: ServiceContext): { created: number } {
  let created = 0;
  const today = todayDhaka();
  const soon = epochToDhakaDate(Date.now() + 30 * 86_400_000);

  const low = sc.db
    .prepare(
      `SELECT name, sku, opening_stock + received_qty - used_qty AS qty, reorder_level
       FROM inventory_items WHERE is_active = 1
         AND (opening_stock + received_qty - used_qty) <= reorder_level`,
    )
    .all() as { name: string; sku: string; qty: number; reorder_level: number }[];
  for (const it of low.slice(0, 25)) {
    const dup = sc.db
      .prepare(
        `SELECT id FROM notifications WHERE category = 'inventory' AND title = ? AND is_read = 0`,
      )
      .get(`Low stock: ${it.name}`);
    if (!dup) {
      pushNotification(sc, {
        category: 'inventory',
        severity: 'warning',
        title: `Low stock: ${it.name}`,
        body: `Current stock ${it.qty} at or below reorder level ${it.reorder_level}.`,
        permission: 'inventory.view',
      });
      created++;
    }
  }

  const exp = sc.db
    .prepare(
      `SELECT name, sku, expiry_date FROM inventory_items
       WHERE is_active = 1 AND expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ?`,
    )
    .all(today, soon) as { name: string; sku: string; expiry_date: string }[];
  for (const it of exp.slice(0, 25)) {
    const title = `Expiring soon: ${it.name}`;
    const dup = sc.db
      .prepare(
        `SELECT id FROM notifications WHERE category = 'inventory' AND title = ? AND is_read = 0`,
      )
      .get(title);
    if (!dup) {
      pushNotification(sc, {
        category: 'inventory',
        severity: 'critical',
        title,
        body: `Expires on ${it.expiry_date}.`,
        permission: 'inventory.view',
      });
      created++;
    }
  }

  const now = sc.now();
  const missed = sc.db
    .prepare(
      `SELECT id, appointment_code FROM appointments
       WHERE status = 'scheduled' AND ends_at < ?`,
    )
    .all(now) as { id: number; appointment_code: string }[];
  for (const a of missed.slice(0, 25)) {
    const dup = sc.db
      .prepare(
        `SELECT id FROM notifications WHERE category = 'appointment' AND title = ?`,
      )
      .get(`Missed: ${a.appointment_code}`);
    if (!dup) {
      sc.db
        .prepare(
          `UPDATE appointments SET status = 'no_show', updated_at = ? WHERE id = ? AND status = 'scheduled'`,
        )
        .run(now, a.id);
      pushNotification(sc, {
        category: 'appointment',
        severity: 'warning',
        title: `Missed: ${a.appointment_code}`,
        body: 'Patient did not check in for this appointment.',
        permission: 'appointment.view',
      });
      created++;
    }
  }

  const followUps = sc.db
    .prepare(
      `SELECT v.id, v.visit_code, p.full_name FROM visits v
       JOIN patients p ON p.id = v.patient_id
       WHERE v.follow_up_at IS NOT NULL AND v.follow_up_at >= ? AND v.follow_up_at < ?`,
    )
    .all(now, now + 86_400_000) as { id: number; visit_code: string; full_name: string }[];
  for (const f of followUps.slice(0, 25)) {
    const title = `Follow-up today: ${f.full_name}`;
    const dup = sc.db
      .prepare(`SELECT id FROM notifications WHERE category = 'appointment' AND title = ?`)
      .get(title);
    if (!dup) {
      pushNotification(sc, {
        category: 'appointment',
        severity: 'info',
        title,
        body: `Visit ${f.visit_code} is due for follow-up today.`,
        permission: 'clinical.view',
      });
      created++;
    }
  }
  return { created };
}

/* ------------------------------------------------------------------ */
/* Global search (permission-respecting) → SearchResult                */
/* ------------------------------------------------------------------ */

export function globalSearch(
  sc: ServiceContext,
  query: string,
  kinds: string[],
): SearchResult[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const perms = sc.session.getUser()?.permissions ?? [];
  const has = (p: Permission) => perms.includes(p);
  const want = (k: string) => kinds.length === 0 || kinds.includes(k);
  const hits: SearchResult[] = [];

  if (want('patient') && has('patient.view')) {
    const rows = sc.db
      .prepare(
        `SELECT id, full_name, patient_code, phone FROM patients
         WHERE full_name LIKE ? OR patient_code LIKE ? OR phone LIKE ?
         ORDER BY registered_at DESC LIMIT 15`,
      )
      .all(like, like, like) as Record<string, unknown>[];
    for (const r of rows) {
      hits.push({
        kind: 'patient',
        id: String(r.id),
        title: r.full_name as string,
        subtitle: r.patient_code as string,
        detail: r.phone ? String(r.phone) : '',
      });
    }
  }
  if (want('appointment') && has('appointment.view')) {
    const rows = sc.db
      .prepare(
        `SELECT a.id, a.appointment_code, p.full_name, a.starts_at FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         WHERE a.appointment_code LIKE ? OR p.full_name LIKE ?
         ORDER BY a.starts_at DESC LIMIT 10`,
      )
      .all(like, like) as Record<string, unknown>[];
    for (const r of rows) {
      hits.push({
        kind: 'appointment',
        id: String(r.id),
        title: r.appointment_code as string,
        subtitle: r.full_name as string,
        detail: epochToDhakaDate(r.starts_at as number),
      });
    }
  }
  if (want('invoice') && has('invoice.view')) {
    const rows = sc.db
      .prepare(
        `SELECT i.id, i.invoice_code, p.full_name, i.total_poisha FROM invoices i
         JOIN patients p ON p.id = i.patient_id
         WHERE i.invoice_code LIKE ? OR p.full_name LIKE ?
         ORDER BY i.created_at DESC LIMIT 10`,
      )
      .all(like, like) as Record<string, unknown>[];
    for (const r of rows) {
      hits.push({
        kind: 'invoice',
        id: String(r.id),
        title: r.invoice_code as string,
        subtitle: r.full_name as string,
        detail: `৳${((r.total_poisha as number) / 100).toFixed(2)}`,
      });
    }
  }
  if (want('prescription') && has('prescription.view')) {
    const rows = sc.db
      .prepare(
        `SELECT r.id, r.prescription_code, p.full_name FROM prescriptions r
         JOIN patients p ON p.id = r.patient_id
         WHERE r.prescription_code LIKE ? OR p.full_name LIKE ?
         ORDER BY r.issued_at DESC LIMIT 10`,
      )
      .all(like, like) as Record<string, unknown>[];
    for (const r of rows) {
      hits.push({
        kind: 'prescription',
        id: String(r.id),
        title: r.prescription_code as string,
        subtitle: r.full_name as string,
        detail: '',
      });
    }
  }
  if (want('visit') && has('clinical.view')) {
    const rows = sc.db
      .prepare(
        `SELECT v.id, v.visit_code, p.full_name, v.diagnosis FROM visits v
         JOIN patients p ON p.id = v.patient_id
         WHERE v.visit_code LIKE ? OR p.full_name LIKE ? OR v.diagnosis LIKE ?
         ORDER BY v.visited_at DESC LIMIT 10`,
      )
      .all(like, like, like) as Record<string, unknown>[];
    for (const r of rows) {
      hits.push({
        kind: 'visit',
        id: String(r.id),
        title: r.visit_code as string,
        subtitle: r.full_name as string,
        detail: (r.diagnosis as string) ?? '',
      });
    }
  }
  if (want('treatment') && has('treatment.view')) {
    const rows = sc.db
      .prepare(
        `SELECT id, name, category FROM treatments
         WHERE name LIKE ? OR code LIKE ? OR category LIKE ? LIMIT 10`,
      )
      .all(like, like, like) as Record<string, unknown>[];
    for (const r of rows) {
      hits.push({
        kind: 'treatment',
        id: String(r.id),
        title: r.name as string,
        subtitle: r.category as string,
        detail: '',
      });
    }
  }
  if (want('inventory') && has('inventory.view')) {
    const rows = sc.db
      .prepare(
        `SELECT id, name, sku FROM inventory_items
         WHERE (name LIKE ? OR sku LIKE ?) AND is_active = 1 LIMIT 10`,
      )
      .all(like, like) as Record<string, unknown>[];
    for (const r of rows) {
      hits.push({
        kind: 'inventory',
        id: String(r.id),
        title: r.name as string,
        subtitle: r.sku as string,
        detail: '',
      });
    }
  }
  if (want('staff') && has('staff.view')) {
    const rows = sc.db
      .prepare(`SELECT id, full_name, phone FROM staff WHERE full_name LIKE ? LIMIT 10`)
      .all(like) as Record<string, unknown>[];
    for (const r of rows) {
      hits.push({
        kind: 'staff',
        id: String(r.id),
        title: r.full_name as string,
        subtitle: 'Staff',
        detail: (r.phone as string) ?? '',
      });
    }
  }
  return hits.slice(0, 40);
}

/* ------------------------------------------------------------------ */
/* Referrals                                                           */
/* ------------------------------------------------------------------ */

export interface ReferralListItem {
  id: number;
  patientId: number;
  patientName: string;
  referredTo: string;
  reason: string;
  notes: string;
  referredOn: string;
  followUpOn: string | null;
  status: string;
  createdAt: number;
}

export function listReferrals(
  sc: ServiceContext,
  p: { patientId?: number; page: number; pageSize: number },
): Paged<ReferralListItem> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.patientId) {
    where.push('r.patient_id = ?');
    args.push(p.patientId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    sc.db.prepare(`SELECT COUNT(*) AS n FROM referrals r ${whereSql}`).get(...args) as { n: number }
  ).n;
  const rows = sc.db
    .prepare(
      `SELECT r.*, p.full_name AS patient_name FROM referrals r
       JOIN patients p ON p.id = r.patient_id
       ${whereSql} ORDER BY r.referred_on DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as Record<string, unknown>[];
  return {
    items: rows.map((r) => ({
      id: r.id as number,
      patientId: r.patient_id as number,
      patientName: r.patient_name as string,
      referredTo: r.referred_to as string,
      reason: r.reason as string,
      notes: (r.notes as string) ?? '',
      referredOn: r.referred_on as string,
      followUpOn: (r.follow_up_on as string) ?? null,
      status: r.status as string,
      createdAt: r.created_at as number,
    })),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

export function createReferral(
  sc: ServiceContext,
  p: {
    patientId: number;
    visitId: number | null;
    referredTo: string;
    reason: string;
    notes: string;
    referredOn: string;
    followUpOn: string | null;
    status: 'pending' | 'completed' | 'cancelled';
  },
): { id: number } {
  const patient = sc.db.prepare('SELECT id FROM patients WHERE id = ?').get(p.patientId);
  if (!patient) ipcError('NOT_FOUND', 'Patient not found.');
  const info = sc.db
    .prepare(
      `INSERT INTO referrals
        (patient_id, visit_id, referred_to, reason, notes, referred_on, follow_up_on, status,
         created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.patientId, p.visitId, p.referredTo, p.reason, p.notes, p.referredOn,
      p.followUpOn, p.status, sc.ctx.userId, sc.now(), sc.now(),
    );
  const id = Number(info.lastInsertRowid);
  audit(sc, {
    action: 'referral.create',
    entityType: 'referral',
    entityId: id,
    summary: `Referred patient to ${p.referredTo}`,
  });
  return { id };
}

export function updateReferral(
  sc: ServiceContext,
  p: { id: number; status: 'pending' | 'completed' | 'cancelled'; notes: string; followUpOn: string | null },
): { done: true } {
  const before = sc.db.prepare('SELECT status FROM referrals WHERE id = ?').get(p.id) as
    | { status: string }
    | undefined;
  if (!before) ipcError('NOT_FOUND', 'Referral not found.');
  sc.db
    .prepare(
      `UPDATE referrals SET status=?, notes=?, follow_up_on=?, updated_at=? WHERE id=?`,
    )
    .run(p.status, p.notes, p.followUpOn, sc.now(), p.id);
  audit(sc, {
    action: 'referral.update',
    entityType: 'referral',
    entityId: p.id,
    summary: `Referral marked ${p.status}`,
    before: { status: before.status },
    after: { status: p.status },
  });
  return { done: true };
}

/* ------------------------------------------------------------------ */
/* Audit log (read-only to renderer; append-only storage)              */
/* ------------------------------------------------------------------ */

export function listAudit(
  sc: ServiceContext,
  p: {
    search: string;
    action: string;
    preset: 'today' | 'last7' | 'last30' | 'last90' | 'last365' | 'custom';
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  },
): Paged<AuditLogRecord> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.search.trim()) {
    where.push('(username LIKE ? OR summary LIKE ? OR entity_id LIKE ?)');
    const like = `%${p.search.trim()}%`;
    args.push(like, like, like);
  }
  if (p.action.trim()) {
    where.push('action LIKE ?');
    args.push(`%${p.action.trim()}%`);
  }
  let range: { start: number; end: number } | null = null;
  if (p.preset === 'custom') {
    if (!p.from || !p.to) ipcError('VALIDATION', 'Custom range requires from and to dates.');
    range = { start: dhakaDateToEpoch(p.from), end: dhakaDateToEpoch(p.to) + 86_400_000 };
  } else {
    range = presetRange(p.preset);
  }
  if (range) {
    where.push('at >= ? AND at < ?');
    args.push(range.start, range.end);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    sc.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs ${whereSql}`).get(...args) as { n: number }
  ).n;
  const rows = sc.db
    .prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY at DESC LIMIT ? OFFSET ?`)
    .all(...args, p.pageSize, (p.page - 1) * p.pageSize) as Record<string, unknown>[];
  return {
    items: rows.map((r) => ({
      id: r.id as number,
      at: r.at as number,
      username: r.username as string,
      action: r.action as string,
      entityType: (r.entity_type as string) ?? '',
      entityId: (r.entity_id as string) ?? '',
      summary: (r.summary as string) ?? '',
      beforeJson: (r.before_json as string) ?? '',
      afterJson: (r.after_json as string) ?? '',
    })),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function mapAppt(r: Record<string, unknown>): AppointmentRecord {
  return {
    id: r.id as number,
    appointmentCode: r.appointment_code as string,
    patientId: r.patient_id as number,
    patientName: r.patient_name as string,
    patientCode: r.patient_code as string,
    dentistId: r.dentist_id as number,
    dentistName: r.dentist_name as string,
    startsAt: r.starts_at as number,
    endsAt: r.ends_at as number,
    reason: (r.reason as string) ?? '',
    notes: (r.notes as string) ?? '',
    status: r.status as AppointmentRecord['status'],
    checkedInAt: (r.checked_in_at as number | null) ?? null,
    cancelReason: (r.cancel_reason as string) ?? '',
    createdAt: r.created_at as number,
  };
}

function mapPatientSummary(r: Record<string, unknown>): PatientSummary {
  return {
    id: r.id as number,
    patientCode: r.patient_code as string,
    fullName: r.full_name as string,
    gender: (r.gender as PatientSummary['gender']) ?? null,
    dob: (r.dob as string | null) ?? null,
    ageYears: (r.age_years as number | null) ?? null,
    phone: (r.phone as string) ?? '',
    bloodGroup: (r.blood_group as string | null) ?? '',
    status: r.status as PatientSummary['status'],
    registeredAt: r.registered_at as number,
    lastVisitAt: (r.last_visit_at as number | null) ?? null,
    visitCount: (r.visit_count as number) ?? 0,
    duePoisha: (r.due_poisha as number) ?? 0,
  };
}

export function dashboard(sc: ServiceContext): DashboardData {
  const now = sc.now();
  const today = todayDhaka();
  const dayStart = dhakaDateToEpoch(today);
  const dayEnd = dayStart + 86_400_000;

  const appointmentsToday = (
    sc.db
      .prepare(
        `SELECT COUNT(*) AS n FROM appointments
         WHERE starts_at >= ? AND starts_at < ? AND status != 'cancelled'`,
      )
      .get(dayStart, dayEnd) as { n: number }
  ).n;
  const checkedIn = (
    sc.db
      .prepare(
        `SELECT COUNT(*) AS n FROM appointments
         WHERE starts_at >= ? AND starts_at < ? AND status IN ('checked_in','in_progress')`,
      )
      .get(dayStart, dayEnd) as { n: number }
  ).n;
  const waitingInQueue = (
    sc.db
      .prepare(
        `SELECT COUNT(*) AS n FROM queue_entries WHERE queue_date = ? AND status = 'waiting'`,
      )
      .get(today) as { n: number }
  ).n;
  const completedVisits = (
    sc.db
      .prepare(
        `SELECT COUNT(*) AS n FROM queue_entries WHERE queue_date = ? AND status = 'completed'`,
      )
      .get(today) as { n: number }
  ).n;
  const missedToday = (
    sc.db
      .prepare(
        `SELECT COUNT(*) AS n FROM appointments
         WHERE starts_at >= ? AND starts_at < ? AND status = 'no_show'`,
      )
      .get(dayStart, dayEnd) as { n: number }
  ).n;

  const todayRevenuePoisha = (
    sc.db
      .prepare(
        `SELECT COALESCE(SUM(amount_poisha), 0) AS total FROM payments
         WHERE is_voided = 0 AND paid_at >= ? AND paid_at < ?`,
      )
      .get(dayStart, dayEnd) as { total: number }
  ).total;

  const outstandingPoisha = (
    sc.db
      .prepare(
        `SELECT COALESCE(SUM(i.total_poisha - COALESCE(p.paid, 0)), 0) AS total
         FROM invoices i
         LEFT JOIN (
           SELECT invoice_id, SUM(amount_poisha) AS paid FROM payments
           WHERE is_voided = 0 GROUP BY invoice_id
         ) p ON p.invoice_id = i.id
         WHERE i.status != 'void' AND (i.total_poisha - COALESCE(p.paid, 0)) > 0`,
      )
      .get() as { total: number }
  ).total;

  const upcoming = sc.db
    .prepare(
      `SELECT a.*, p.full_name AS patient_name, p.patient_code, d.full_name AS dentist_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN dentists d ON d.id = a.dentist_id
       WHERE a.starts_at >= ? AND a.status IN ('scheduled','checked_in','in_progress')
       ORDER BY a.starts_at LIMIT 8`,
    )
    .all(now) as Record<string, unknown>[];

  const recentPatients = sc.db
    .prepare(
      `SELECT p.*, (SELECT MAX(v.visited_at) FROM visits v WHERE v.patient_id = p.id) AS last_visit_at,
              (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visit_count, 0 AS due_poisha
       FROM patients p WHERE p.status = 'active' ORDER BY p.registered_at DESC LIMIT 8`,
    )
    .all() as Record<string, unknown>[];

  const methodRows = sc.db
    .prepare(
      `SELECT method, SUM(amount_poisha) AS total, COUNT(*) AS n FROM payments
       WHERE is_voided = 0 AND paid_at >= ? AND paid_at < ?
       GROUP BY method`,
    )
    .all(dayStart - 29 * 86_400_000, dayEnd) as {
    method: MethodBreakdownRow['method'];
    total: number;
    n: number;
  }[];
  const labels: Record<string, string> = {
    cash: 'Cash', bank: 'Bank Transfer', card: 'Card', bkash: 'bKash',
    nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay', other: 'Others',
  };
  const methodBreakdown: MethodBreakdownRow[] = methodRows.map((r) => ({
    method: r.method,
    label: labels[r.method] ?? r.method,
    amountPoisha: r.total,
    count: r.n,
  }));

  const trendRows = sc.db
    .prepare(
      `SELECT paid_at, SUM(amount_poisha) AS total, COUNT(*) AS n FROM payments
       WHERE is_voided = 0 AND paid_at >= ? AND paid_at < ?
       GROUP BY paid_at ORDER BY paid_at`,
    )
    .all(dayStart - 13 * 86_400_000, dayEnd) as {
    paid_at: number;
    total: number;
    n: number;
  }[];
  const trendMap = new Map<string, { amountPoisha: number; count: number }>();
  for (let d = 13; d >= 0; d--) {
    trendMap.set(epochToDhakaDate(dayStart - d * 86_400_000), { amountPoisha: 0, count: 0 });
  }
  for (const r of trendRows) {
    const key = epochToDhakaDate(r.paid_at);
    const slot = trendMap.get(key);
    if (slot) {
      slot.amountPoisha += r.total;
      slot.count += r.n;
    }
  }
  const revenueTrend = [...trendMap.entries()].map(([date, v]) => ({
    date,
    amountPoisha: v.amountPoisha,
    count: v.count,
  }));

  const lowStockItems = sc.db
    .prepare(
      `SELECT *, (opening_stock + received_qty - used_qty) AS current_stock, 0 AS supplier_name
       FROM inventory_items
       WHERE is_active = 1 AND (opening_stock + received_qty - used_qty) <= reorder_level
       ORDER BY (opening_stock + received_qty - used_qty) ASC LIMIT 8`,
    )
    .all() as unknown as InventoryItemRecord[];

  const alerts: DashboardData['alerts'] = [];
  const expiringCount = (
    sc.db
      .prepare(
        `SELECT COUNT(*) AS n FROM inventory_items
         WHERE is_active = 1 AND expiry_date IS NOT NULL AND expiry_date < ?`,
      )
      .get(soonDate()) as { n: number }
  ).n;
  if (expiringCount > 0) {
    alerts.push({
      severity: 'warning',
      title: `${expiringCount} item(s) expiring soon`,
      body: 'Review inventory expiry dates and rotate stock.',
    });
  }
  if (missedToday > 0) {
    alerts.push({
      severity: 'warning',
      title: `${missedToday} missed appointment(s) today`,
      body: 'Patients were marked as no-show.',
    });
  }
  if (outstandingPoisha > 0) {
    alerts.push({
      severity: 'info',
      title: 'Outstanding dues',
      body: `৳${(outstandingPoisha / 100).toFixed(2)} yet to be collected.`,
    });
  }

  return {
    today,
    appointmentsToday,
    checkedIn,
    waitingInQueue,
    completedVisits,
    todayRevenuePoisha,
    outstandingPoisha,
    missedToday,
    upcomingAppointments: upcoming.map(mapAppt),
    recentPatients: recentPatients.map(mapPatientSummary),
    methodBreakdown,
    revenueTrend,
    lowStockItems,
    alerts,
  };
}

function soonDate(): string {
  return epochToDhakaDate(Date.now() + 7 * 86_400_000);
}

export { writeFileSync };
