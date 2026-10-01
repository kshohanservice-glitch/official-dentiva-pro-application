/**
 * Technical diagnostic logger — metadata only (no clinical text, no passwords,
 * no monetary payloads). Rotated by size; distinct from the audit log (DB).
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 3;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private dir: string;
  private file: string;

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, 'logs');
    this.file = join(this.dir, 'dentiva.log');
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* logging must never crash the app */
    }
  }

  private rotate(): void {
    try {
      if (!existsSync(this.file)) return;
      if (statSync(this.file).size < MAX_BYTES) return;
      for (let i = KEEP - 1; i >= 1; i--) {
        const from = `${this.file}.${i}`;
        const to = `${this.file}.${i + 1}`;
        if (existsSync(from)) renameSync(from, to);
      }
      renameSync(this.file, `${this.file}.1`);
    } catch {
      /* ignore rotation failures */
    }
  }

  private write(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    try {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (/pass|secret|token|code|activat|clinical|note|name|amount|poisha/i.test(k)) continue;
        safe[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
      }
      const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${event} ${JSON.stringify(safe)}\n`;
      this.rotate();
      appendFileSync(this.file, line);
    } catch {
      /* swallow */
    }
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.write('debug', event, fields);
  }
  info(event: string, fields?: Record<string, unknown>): void {
    this.write('info', event, fields);
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    this.write('warn', event, fields);
  }
  error(event: string, fields?: Record<string, unknown>): void {
    this.write('error', event, fields);
  }
}
