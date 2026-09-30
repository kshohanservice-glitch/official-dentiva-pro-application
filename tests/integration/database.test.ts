import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DB } from '../../src/main/db/database';
import { openDatabase, migrate, integrityCheck, nextCode, nextDateCode } from '../../src/main/db/database';
import { seedReferenceData, buildTeeth, TOOTH_CONDITIONS, CLINICAL_OPTIONS, DEFAULT_TREATMENTS } from '../../src/main/db/seed';

describe('migrations', () => {
  let db: DB;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'dentiva-test-'));
    db = openDatabase({ path: join(dir, 'test.db') });
  });

  afterEach(() => {
    db.close();
    try {
      const dir = db.name.replace(/\/test\.db$/, '');
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('applies all migrations in order and records them', () => {
    const rows = db.prepare('SELECT id, name FROM schema_migrations ORDER BY id').all() as {
      id: number;
      name: string;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.name).toBe('initial_schema');
    expect(rows.some((r) => r.name === 'session_lock_policy')).toBe(true);
  });

  it('is idempotent (second migrate is a no-op)', () => {
    const before = (
      db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }
    ).n;
    migrate(db);
    const after = (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it('enforces foreign keys', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() =>
      db
        .prepare(
          `INSERT INTO visits (visit_code, patient_id, dentist_id, visited_at, created_at, updated_at)
           VALUES (?,?,?,?,?,?)`,
        )
        .run('V-X', 999999, 1, Date.now(), Date.now(), Date.now()),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('creates every core table with expected indexes', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    for (const t of [
      'settings', 'clinic_config', 'users', 'roles', 'permissions', 'role_permissions',
      'user_roles', 'staff', 'dentists', 'patients', 'teeth', 'tooth_conditions',
      'dental_chart_entries', 'clinical_options', 'treatments', 'visits', 'appointments',
      'queue_entries', 'prescriptions', 'prescription_items', 'invoices', 'invoice_items',
      'payments', 'suppliers', 'inventory_items', 'inventory_transactions',
      'expense_categories', 'expenses', 'other_income', 'attachments', 'printer_profiles',
      'backup_records', 'notifications', 'audit_logs', 'idempotency_keys',
    ]) {
      expect(tables, `missing table ${t}`).toContain(t);
    }
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(indexes).toContain('idx_patients_name');
    expect(indexes).toContain('idx_payments_paid_at');
    expect(indexes).toContain('idx_appt_dentist_time');
  });

  it('passes integrity + FK checks', () => {
    const result = integrityCheck(db);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('uses WAL journal mode', () => {
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal');
  });

  it('generates sequence codes', () => {
    db.exec("INSERT INTO sequences (name, value) VALUES ('t', 0)");
    const a = nextCode(db, 'test', 'DP-', 6);
    const b = nextCode(db, 'test', 'DP-', 6);
    expect(a).toBe('DP-000001');
    expect(b).toBe('DP-000002');
    const c = nextDateCode(db, 'invoice', 'INV-', '260930');
    expect(c).toBe('INV-260930-0001');
    const d = nextDateCode(db, 'invoice', 'INV-', '260930');
    expect(d).toBe('INV-260930-0002');
  });
});

describe('seed', () => {
  let db: DB;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dentiva-seed-'));
    db = openDatabase({ path: join(dir, 'test.db') });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('seeds all reference data exactly once (idempotent)', () => {
    seedReferenceData(db, Date.now());
    const first = {
      permissions: (db.prepare('SELECT COUNT(*) AS n FROM permissions').get() as { n: number }).n,
      roles: (db.prepare('SELECT COUNT(*) AS n FROM roles').get() as { n: number }).n,
      teeth: (db.prepare('SELECT COUNT(*) AS n FROM teeth').get() as { n: number }).n,
      conditions: (db.prepare('SELECT COUNT(*) AS n FROM tooth_conditions').get() as { n: number }).n,
      treatments: (db.prepare('SELECT COUNT(*) AS n FROM treatments').get() as { n: number }).n,
      profiles: (db.prepare('SELECT COUNT(*) AS n FROM printer_profiles').get() as { n: number }).n,
    };
    seedReferenceData(db, Date.now());
    const second = {
      permissions: (db.prepare('SELECT COUNT(*) AS n FROM permissions').get() as { n: number }).n,
      roles: (db.prepare('SELECT COUNT(*) AS n FROM roles').get() as { n: number }).n,
      teeth: (db.prepare('SELECT COUNT(*) AS n FROM teeth').get() as { n: number }).n,
      conditions: (db.prepare('SELECT COUNT(*) AS n FROM tooth_conditions').get() as { n: number }).n,
      treatments: (db.prepare('SELECT COUNT(*) AS n FROM treatments').get() as { n: number }).n,
      profiles: (db.prepare('SELECT COUNT(*) AS n FROM printer_profiles').get() as { n: number }).n,
    };
    expect(second).toEqual(first);
    expect(first.teeth).toBe(52); // 32 permanent + 20 primary
    expect(first.roles).toBeGreaterThanOrEqual(6);
    expect(first.treatments).toBeGreaterThanOrEqual(20);
    expect(first.profiles).toBe(5);
  });

  it('builds a complete FDI dentition (32 permanent + 20 primary)', () => {
    const teeth = buildTeeth();
    expect(teeth).toHaveLength(52);
    const permanent = teeth.filter((t) => t.dentition === 'permanent');
    const primary = teeth.filter((t) => t.dentition === 'primary');
    expect(permanent).toHaveLength(32);
    expect(primary).toHaveLength(20);
    for (const q of [1, 2, 3, 4]) {
      expect(permanent.filter((t) => t.quadrant === q)).toHaveLength(8);
    }
    for (const q of [5, 6, 7, 8]) {
      expect(primary.filter((t) => t.quadrant === q)).toHaveLength(5);
    }
    const fdıs = new Set(teeth.map((t) => t.fdi));
    expect(fdıs.size).toBe(52);
  });

  it('has unique condition codes and clinical option codes', () => {
    const codes = TOOTH_CONDITIONS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    const optCodes = CLINICAL_OPTIONS.map((o) => `${o.section}:${o.code}`);
    expect(new Set(optCodes).size).toBe(optCodes.length);
    for (const o of CLINICAL_OPTIONS) {
      expect(['cc', 'oe', 're']).toContain(o.section);
    }
  });

  it('stores treatment prices as integer poisha (×100 from BDT)', () => {
    for (const t of DEFAULT_TREATMENTS) {
      expect(Number.isInteger(t.priceBdt * 100)).toBe(true);
    }
    seedReferenceData(db, Date.now());
    const rows = db.prepare('SELECT default_price_poisha FROM treatments').all() as {
      default_price_poisha: number;
    }[];
    expect(rows.length).toBe(DEFAULT_TREATMENTS.length);
    for (const r of rows) {
      expect(Number.isInteger(r.default_price_poisha)).toBe(true);
      expect(r.default_price_poisha).toBeGreaterThanOrEqual(0);
    }
  });

  it('seeds permissions matching the shared catalogue', () => {
    seedReferenceData(db, Date.now());
    const perms = (
      db.prepare('SELECT code FROM permissions').all() as { code: string }[]
    ).map((r) => r.code);
    expect(perms).toContain('patient.view');
    expect(perms).toContain('payment.void');
    expect(perms).toContain('backup.restore');
    expect(perms).toContain('financial.report.view');
    // Administrator role has every permission
    const adminPerms = (
      db
        .prepare(
          `SELECT rp.permission_code FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id WHERE r.name = 'Administrator / Owner'`,
        )
        .all() as { permission_code: string }[]
    ).map((r) => r.permission_code);
    expect(adminPerms.sort()).toEqual([...perms].sort());
  });

  it('seeds a clinic_config row and session policy settings', () => {
    seedReferenceData(db, Date.now());
    const clinic = db.prepare('SELECT id FROM clinic_config WHERE id = 1').get();
    expect(clinic).toBeTruthy();
    const auto = db.prepare(`SELECT value FROM settings WHERE key = 'autoLockMinutes'`).get() as
      | { value: string }
      | undefined;
    expect(['5', '10', '15', '30']).toContain(auto?.value);
  });
});

describe('in-memory database', () => {
  it('works without migrations for isolated unit scenarios', () => {
    const mem = new Database(':memory:');
    mem.pragma('foreign_keys = ON');
    mem.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    mem.prepare('INSERT INTO t VALUES (1)').run();
    expect((mem.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(1);
    mem.close();
  });
});
