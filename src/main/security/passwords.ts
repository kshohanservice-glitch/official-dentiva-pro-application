/**
 * Password hashing (Argon2id, OWASP-recommended parameters) and session policy.
 */

import { argon2id } from '@noble/hashes/argon2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const PARAMS = { t: 2, m: 19456, p: 1, dkLen: 32 } as const; // OWASP argon2id minimums
const SALT_BYTES = 16;

/** Hash a password → PHC-style string: $argon2id$v=19$m=...,t=...,p=...$salt$hash */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = argon2id(utf8ToBytes(password), salt, {
    t: PARAMS.t,
    m: PARAMS.m,
    p: PARAMS.p,
    dkLen: PARAMS.dkLen,
  });
  const saltB64 = salt.toString('base64');
  const hashB64 = Buffer.from(derived).toString('base64');
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${saltB64}$${hashB64}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[1] !== 'argon2id') return false;
    const paramsPart = parts[3] as string;
    const m = /m=(\d+)/.exec(paramsPart);
    const t = /t=(\d+)/.exec(paramsPart);
    const p = /p=(\d+)/.exec(paramsPart);
    if (!m || !t || !p) return false;
    const salt = Buffer.from(parts[4] as string, 'base64');
    const expected = Buffer.from(parts[5] as string, 'base64');
    const derived = argon2id(utf8ToBytes(password), salt, {
      t: Number(t[1]),
      m: Number(m[1]),
      p: Number(p[1]),
      dkLen: expected.length,
    });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(derived), expected);
  } catch {
    return false;
  }
}

/** Password strength rules — enforced at creation/reset/change. */
export interface PasswordCheck {
  ok: boolean;
  errors: string[];
}

export function checkPasswordStrength(password: string): PasswordCheck {
  const errors: string[] = [];
  if (password.length < 8) errors.push('Use at least 8 characters.');
  if (password.length > 128) errors.push('Use at most 128 characters.');
  if (!/[a-z]/.test(password)) errors.push('Include at least one lowercase letter.');
  if (!/[A-Z]/.test(password)) errors.push('Include at least one uppercase letter.');
  if (!/\d/.test(password)) errors.push('Include at least one digit.');
  const common = ['password', '12345678', 'qwerty', 'letmein', 'admin123', 'dentiva'];
  if (common.some((c) => password.toLowerCase().includes(c))) {
    errors.push('Avoid common words like “password” or “admin”.');
  }
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Login throttling constants                                          */
/* ------------------------------------------------------------------ */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 60_000; // first lockout window; escalates ×2 up to 15 min

export function lockoutDurationFor(failedAttempts: number): number {
  if (failedAttempts < MAX_FAILED_ATTEMPTS) return 0;
  const over = failedAttempts - MAX_FAILED_ATTEMPTS;
  return Math.min(LOCKOUT_MS * 2 ** over, 15 * 60_000);
}

export function constantTimeEqualsHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(hexToBytes(a), hexToBytes(b));
  } catch {
    return false;
  }
}

export { bytesToHex, hexToBytes };
