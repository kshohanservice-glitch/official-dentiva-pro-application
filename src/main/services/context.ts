/** Shared service context passed to every service function. */

import type { DB } from '../db/database';
import type { Logger } from '../logging';
import { writeAudit, type AuditEntry } from '../audit';
import type { SessionManager } from '../session';
import type { HandlerContext } from '../ipc/dispatcher';

export interface ServiceContext {
  db: DB;
  logger: Logger;
  session: SessionManager;
  userDataDir: string;
  ctx: HandlerContext;
  now(): number;
}

export function audit(sc: ServiceContext, entry: Omit<AuditEntry, 'userId' | 'username'>): void {
  writeAudit(sc.db, {
    ...entry,
    userId: sc.ctx.userId,
    username: sc.ctx.username,
  }, sc.now());
}

export function requireUser(sc: ServiceContext): { id: number; username: string } {
  if (sc.ctx.userId === null) {
    const err = new Error('Authentication required') as Error & { code: string };
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  return { id: sc.ctx.userId, username: sc.ctx.username };
}
