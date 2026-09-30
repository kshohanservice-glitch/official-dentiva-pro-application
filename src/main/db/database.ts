import Database from 'better-sqlite3';
import { migrations } from './migrations';

export type DB = Database.Database;

export interface OpenDbOptions {
  /** Full path to the .db file, or ':memory:' for tests. */
  path: string;
  readonly?: boolean;
}

/**
 * Open the SQLite database with production pragmas and run pending migrations.
 */
export function openDatabase(opts: OpenDbOptions): DB {
  const db = new Database(opts.path, { readonly: opts.readonly ?? false });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  if (!opts.readonly) {
    migrate(db);
  }
  return db;
}

export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id),
  );
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        Date.now(),
      );
    });
    run();
  }
}

/** Quick health probe used at startup and before backups. */
export function integrityCheck(db: DB): { ok: boolean; problems: string[] } {
  const rows = db.pragma('integrity_check') as { integrity_check: string }[];
  const problems = rows.map((r) => r.integrity_check).filter((v) => v !== 'ok');
  const fk = db.pragma('foreign_key_check') as unknown[];
  if (fk.length > 0) problems.push(`${fk.length} foreign key violation(s)`);
  return { ok: problems.length === 0, problems };
}

/**
 * Human-readable sequence codes, generated inside the caller's transaction.
 * e.g. nextCode(db, 'patient', 'DP-', 6) -> DP-000123
 */
export function nextCode(db: DB, scope: string, prefix: string, width: number): string {
  const key = `${scope}:${prefix}`;
  db.prepare(
    `INSERT INTO sequences (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1
     RETURNING value`,
  ).get(key) as { value: number };
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get(key) as {
    value: number;
  };
  return `${prefix}${String(row.value).padStart(width, '0')}`;
}

/** Date-scoped code, e.g. INV-260930-0001 */
export function nextDateCode(
  db: DB,
  scope: string,
  prefix: string,
  dateCompact: string,
  width = 4,
): string {
  const key = `${scope}:${prefix}${dateCompact}`;
  db.prepare(
    `INSERT INTO sequences (name, value) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1`,
  ).run(key);
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get(key) as {
    value: number;
  };
  return `${prefix}${dateCompact}-${String(row.value).padStart(width, '0')}`;
}
