/** Audit trail — append-only security/financial event log stored in the database. */

import type { DB } from './db/database';

export interface AuditEntry {
  userId: number | null;
  username: string;
  action: string;
  entityType?: string;
  entityId?: string | number;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

export function writeAudit(db: DB, entry: AuditEntry, now = Date.now()): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs (at, user_id, username, action, entity_type, entity_id, summary, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      now,
      entry.userId,
      entry.username,
      entry.action,
      entry.entityType ?? '',
      entry.entityId !== undefined ? String(entry.entityId) : '',
      entry.summary ?? '',
      entry.before !== undefined ? JSON.stringify(entry.before) : '',
      entry.after !== undefined ? JSON.stringify(entry.after) : '',
    );
  } catch (err) {
    // Audit failures must be visible in technical logs but never crash a transaction
    // that already committed; callers run audit after commit.
    console.error('[audit] failed to write audit row', err);
  }
}
