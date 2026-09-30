/**
 * Backup & restore: zip (manifest + VACUUM INTO db + attachments) with
 * SHA-256 per entry; restore verifies checksums, makes a pre-restore backup,
 * checks integrity, then swaps the database.
 */

import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  mkdtempSync,
  openSync,
  readSync,
  closeSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import type { ServiceContext } from './context';
import { audit } from './context';
import { ipcError } from '../ipc/dispatcher';
import type { BackupRecord, BackupStatus } from '@shared/types';

export function sha256Of(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256File(path: string): string {
  const hash = createHash('sha256');
  const buf = Buffer.alloc(64 * 1024);
  const fd = openSync(path, 'r');
  try {
    let bytes = 0;
    while ((bytes = readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytes));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

interface Manifest {
  version: 1;
  appVersion: string;
  createdAt: number;
  database: { file: string; sha256: string };
  attachments: { file: string; storedName: string; sha256: string; size: number }[];
  counts: Record<string, number>;
}

const COUNTED_TABLES = [
  'patients', 'visits', 'invoices', 'payments', 'appointments', 'prescriptions',
  'staff', 'users', 'inventory_items', 'expenses', 'audit_logs',
];

function tableCounts(db: ServiceContext['db']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of COUNTED_TABLES) {
    try {
      out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    } catch {
      out[t] = -1;
    }
  }
  return out;
}

function mapRecord(r: Record<string, unknown>): BackupRecord {
  return {
    id: r.id as number,
    createdAt: r.created_at as number,
    filePath: r.file_path as string,
    sizeBytes: r.size_bytes as number,
    kind: r.kind as BackupRecord['kind'],
    status: r.status as BackupRecord['status'],
    error: (r.error as string) ?? '',
  };
}

export function listBackups(sc: ServiceContext): BackupRecord[] {
  const rows = sc.db
    .prepare('SELECT * FROM backup_records ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map(mapRecord);
}

function insertRecord(
  sc: ServiceContext,
  rec: { path: string; size: number; kind: BackupRecord['kind']; status: 'success' | 'failed'; error: string },
): BackupRecord {
  const info = sc.db
    .prepare(
      `INSERT INTO backup_records (created_at, file_path, size_bytes, kind, status, error)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(sc.now(), rec.path, rec.size, rec.kind, rec.status, rec.error);
  const row = sc.db
    .prepare('SELECT * FROM backup_records WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
  return mapRecord(row);
}

function backupFolderFromSettings(sc: ServiceContext): string {
  const row = sc.db.prepare(`SELECT value FROM settings WHERE key = 'backupFolder'`).get() as
    | { value: string }
    | undefined;
  return row?.value || join(sc.userDataDir, 'backups');
}

export async function createBackup(
  sc: ServiceContext,
  p: { kind: 'manual' | 'auto' | 'pre_restore'; folder?: string; dbPath: string },
): Promise<BackupRecord> {
  const folder = p.folder && p.folder.trim() ? p.folder : backupFolderFromSettings(sc);
  mkdirSync(folder, { recursive: true });
  const now = sc.now();
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const fileName = `dentiva-backup-${stamp}-${p.kind}.zip`;
  const filePath = join(folder, fileName);

  const tmpDir = mkdtempSync(join(tmpdir(), 'dentiva-bk-'));
  try {
    // Detached consistent copy of the live database.
    const dbCopy = join(tmpDir, 'dentiva.db');
    sc.db.prepare('VACUUM INTO ?').run(dbCopy);

    // Verify the copy opens cleanly before packaging it.
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const probe = new BetterSqlite3(dbCopy, { readonly: true });
    const integrity = probe.pragma('integrity_check') as { integrity_check: string }[];
    probe.close();
    if (integrity[0]?.integrity_check !== 'ok') {
      throw new Error('Integrity check failed on backup copy');
    }

    const attachmentRows = sc.db
      .prepare('SELECT stored_path FROM attachments')
      .all() as { stored_path: string }[];

    const manifest: Manifest = {
      version: 1,
      appVersion: process.env.npm_package_version ?? '1.0.0',
      createdAt: now,
      database: { file: 'dentiva.db', sha256: sha256File(dbCopy) },
      attachments: [],
      counts: tableCounts(sc.db),
    };

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));
      archive.pipe(output);
      archive.file(dbCopy, { name: 'dentiva.db' });
      for (const row of attachmentRows) {
        if (!existsSync(row.stored_path)) continue;
        const storedName = basename(row.stored_path);
        const rel = `attachments/${storedName}`;
        archive.file(row.stored_path, { name: rel });
        manifest.attachments.push({
          file: rel,
          storedName,
          sha256: sha256File(row.stored_path),
          size: statSync(row.stored_path).size,
        });
      }
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      void archive.finalize();
    });

    const size = statSync(filePath).size;
    const record = insertRecord(sc, {
      path: filePath,
      size,
      kind: p.kind,
      status: 'success',
      error: '',
    });
    // Persist last-success timestamp for scheduling.
    sc.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('lastBackupAt', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(String(now), now);
    sc.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('lastBackupError', '', ?)
         ON CONFLICT(key) DO UPDATE SET value = '', updated_at = excluded.updated_at`,
      )
      .run(now);
    audit(sc, {
      action: 'backup.create',
      entityType: 'backup',
      entityId: String(record.id),
      summary: `Created ${p.kind} backup (${Math.round(size / 1024)} KB)`,
    });
    return record;
  } catch (err) {
    const message = (err as Error).message;
    try {
      if (existsSync(filePath)) rmSync(filePath, { force: true });
    } catch {
      /* ignore */
    }
    const record = insertRecord(sc, {
      path: filePath,
      size: 0,
      kind: p.kind,
      status: 'failed',
      error: message,
    });
    sc.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('lastBackupError', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(message, sc.now());
    audit(sc, {
      action: 'backup.create_failed',
      entityType: 'backup',
      entityId: String(record.id),
      summary: `Backup failed: ${message}`,
    });
    throw err;
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function backupStatus(sc: ServiceContext): BackupStatus {
  const folderRow = sc.db.prepare(`SELECT value FROM settings WHERE key = 'backupFolder'`).get() as
    | { value: string }
    | undefined;
  const intervalRow = sc.db
    .prepare(`SELECT value FROM settings WHERE key = 'backupIntervalDays'`)
    .get() as { value: string } | undefined;
  const lastRow = sc.db.prepare(`SELECT value FROM settings WHERE key = 'lastBackupAt'`).get() as
    | { value: string }
    | undefined;
  const errRow = sc.db
    .prepare(`SELECT value FROM settings WHERE key = 'lastBackupError'`)
    .get() as { value: string } | undefined;

  const folder = folderRow?.value || null;
  const intervalDays = intervalRow ? Number(intervalRow.value) : 0;
  const lastSuccessAt = lastRow ? Number(lastRow.value) || null : null;
  const nextDueAt =
    intervalDays > 0 && lastSuccessAt ? lastSuccessAt + intervalDays * 86_400_000 : null;
  const lastError = errRow?.value || null;
  const recent = listBackups(sc).slice(0, 10);
  return { folder, intervalDays, lastSuccessAt, nextDueAt, lastError, recent };
}

export function verifyArchive(path: string): { valid: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!existsSync(path)) return { valid: false, problems: ['File not found.'] };
  let manifest: Manifest;
  try {
    const zip = new AdmZip(path);
    const entries = zip.getEntries();
    const mEntry = entries.find((e) => e.entryName === 'manifest.json');
    if (!mEntry) return { valid: false, problems: ['manifest.json missing.'] };
    manifest = JSON.parse(mEntry.getData().toString('utf8')) as Manifest;
    if (manifest.version !== 1) {
      problems.push(`Unsupported manifest version ${String(manifest.version)}.`);
    }
    const dbEntry = entries.find((e) => e.entryName === 'dentiva.db');
    if (!dbEntry) {
      problems.push('Database file missing from archive.');
    } else if (sha256Of(dbEntry.getData()) !== manifest.database.sha256) {
      problems.push('Database checksum mismatch.');
    }
    for (const declared of manifest.attachments) {
      const found = entries.find((e) => e.entryName === declared.file);
      if (!found) {
        problems.push(`Missing attachment: ${declared.storedName}`);
        continue;
      }
      if (sha256Of(found.getData()) !== declared.sha256) {
        problems.push(`Checksum mismatch: ${declared.storedName}`);
      }
    }
  } catch (err) {
    return { valid: false, problems: [`Cannot read archive: ${(err as Error).message}`] };
  }
  return { valid: problems.length === 0, problems };
}

export type RestoreOutcome = { preRestorePath: string; patients: number; attachments: number };

/**
 * Restores from a verified archive. The caller MUST close the live database
 * before invoking this and reopen afterwards.
 */
export async function restoreBackup(
  sc: ServiceContext,
  p: { filePath: string; dbPath: string; attachmentsDir: string },
): Promise<RestoreOutcome> {
  const check = verifyArchive(p.filePath);
  if (!check.valid) {
    ipcError('VALIDATION', 'Backup failed verification. Restore aborted.', {
      problems: check.problems,
    });
  }

  // Safety copy of the current state first (DB is closed; copy files directly).
  const preRecord = await preRestoreCopy(sc, p.dbPath);

  const zip = new AdmZip(p.filePath);
  const entries = zip.getEntries();
  const manifest = JSON.parse(
    (entries.find((e) => e.entryName === 'manifest.json') as { getData(): Buffer })
      .getData()
      .toString('utf8'),
  ) as Manifest;

  const workDir = mkdtempSync(join(tmpdir(), 'dentiva-restore-'));
  try {
    const dbEntry = entries.find((e) => e.entryName === 'dentiva.db');
    if (!dbEntry) ipcError('VALIDATION', 'Archive has no database.');
    const restoredDb = join(workDir, 'dentiva.db');
    rmSync(restoredDb, { force: true });
    writeFileSync(restoredDb, dbEntry.getData());

    // Verify restored DB integrity before touching live files.
    const { default: BetterSqlite3 } = await import('better-sqlite3');
    const probe = new BetterSqlite3(restoredDb, { readonly: true });
    const integrity = probe.pragma('integrity_check') as { integrity_check: string }[];
    const patientCount = (probe.prepare('SELECT COUNT(*) AS n FROM patients').get() as { n: number }).n;
    probe.close();
    if (integrity[0]?.integrity_check !== 'ok') {
      ipcError('INTERNAL', 'Restored database failed its integrity check.');
    }

    // Replace live DB (WAL sidecars must go).
    const live = p.dbPath;
    for (const suffix of ['', '-wal', '-shm']) {
      const f = `${live}${suffix}`;
      if (existsSync(f)) rmSync(f, { force: true });
    }
    copyFileSync(restoredDb, live);

    // Merge attachments.
    mkdirSync(p.attachmentsDir, { recursive: true });
    let restoredAttachments = 0;
    for (const declared of manifest.attachments) {
      const attEntry = entries.find((e) => e.entryName === declared.file);
      if (!attEntry) continue;
      const dest = join(p.attachmentsDir, declared.storedName);
      rmSync(dest, { force: true });
      writeFileSync(dest, attEntry.getData());
      restoredAttachments++;
    }

    audit(sc, {
      action: 'backup.restore',
      entityType: 'backup',
      entityId: basename(p.filePath),
      summary: `Restored backup (${patientCount} patients, ${restoredAttachments} attachments)`,
    });

    return {
      preRestorePath: preRecord.filePath,
      patients: patientCount,
      attachments: restoredAttachments,
    };
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** File-level copy of the live DB taken while it is closed. */
async function preRestoreCopy(sc: ServiceContext, dbPath: string): Promise<BackupRecord> {
  const folder = backupFolderFromSettings(sc);
  mkdirSync(folder, { recursive: true });
  const now = sc.now();
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const filePath = join(folder, `dentiva-backup-${stamp}-pre_restore.zip`);
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    archive.pipe(output);
    if (existsSync(dbPath)) archive.file(dbPath, { name: 'dentiva.db' });
    const attDir = join(sc.userDataDir, 'attachments');
    if (existsSync(attDir)) {
      archive.directory(attDir, 'attachments');
    }
    void archive.finalize();
  });
  const record = insertRecord(sc, {
    path: filePath,
    size: statSync(filePath).size,
    kind: 'pre_restore',
    status: 'success',
    error: '',
  });
  audit(sc, {
    action: 'backup.pre_restore',
    entityType: 'backup',
    entityId: String(record.id),
    summary: 'Created pre-restore safety backup',
  });
  return record;
}

export function autoBackupDue(sc: ServiceContext): boolean {
  const intervalRow = sc.db
    .prepare(`SELECT value FROM settings WHERE key = 'backupIntervalDays'`)
    .get() as { value: string } | undefined;
  const intervalDays = intervalRow ? Number(intervalRow.value) : 0;
  if (intervalDays <= 0) return false;
  const lastRow = sc.db.prepare(`SELECT value FROM settings WHERE key = 'lastBackupAt'`).get() as
    | { value: string }
    | undefined;
  const last = lastRow ? Number(lastRow.value) || 0 : 0;
  return Date.now() - last >= intervalDays * 86_400_000;
}

export { backupFolderFromSettings };
