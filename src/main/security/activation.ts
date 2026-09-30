/**
 * Offline activation.
 *
 * The raw activation code exists nowhere in this repository, the bundle, the
 * database, configuration files, or the installer. Only the salt, Argon2id
 * parameters, and the derived verifier are embedded (generated once at build
 * time from the fixed code). Verification derives from user input and compares
 * in constant time.
 */

import { argon2id } from '@noble/hashes/argon2.js';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

/* Derived material: salt + params + verifier (never the raw code). */
export interface ActivationMaterial {
  salt: string;
  verifier: string;
  params: { t: number; m: number; p: number; dkLen: number };
}

const PRODUCTION_MATERIAL: ActivationMaterial = {
  salt: '9e9b907466be251379c0dd4db14bda24',
  verifier:
    'a079522a9e96c5e36a6ba00c8c04203811fe9d97a3b680c18bccb805bf6b26c3',
  params: { t: 3, m: 65536, p: 1, dkLen: 32 },
};

interface ActivationFile {
  v: 1;
  activatedAt: number;
  proof: string;
}

export function computeActivationProof(activatedAt: number, verifierHex: string): string {
  return createHmac('sha256', hexToBytes(verifierHex))
    .update(`dentiva-activation|${activatedAt}`)
    .digest('hex');
}

/** Derive the verifier for a candidate code and compare with the embedded one. */
export function verifyActivationCode(
  code: string,
  material: ActivationMaterial = PRODUCTION_MATERIAL,
): boolean {
  const trimmed = code.replace(/[\s-]/g, '');
  if (!/^\d{10,24}$/.test(trimmed)) return false;
  let candidate: Uint8Array;
  try {
    candidate = argon2id(utf8ToBytes(trimmed), hexToBytes(material.salt), {
      t: material.params.t,
      m: material.params.m,
      p: material.params.p,
      dkLen: material.params.dkLen,
    });
  } catch {
    return false;
  }
  const expected = hexToBytes(material.verifier);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function activationPath(userDataDir: string): string {
  return join(userDataDir, 'activation.json');
}

/** Read and validate persisted activation state (signature-checked). */
export function readActivationState(userDataDir: string): { activated: boolean; activatedAt: number | null } {
  const file = activationPath(userDataDir);
  if (!existsSync(file)) return { activated: false, activatedAt: null };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ActivationFile;
    if (parsed.v !== 1 || typeof parsed.activatedAt !== 'number') return { activated: false, activatedAt: null };
    const expected = computeActivationProof(parsed.activatedAt, PRODUCTION_MATERIAL.verifier);
    if (parsed.proof !== expected) return { activated: false, activatedAt: null };
    return { activated: true, activatedAt: parsed.activatedAt };
  } catch {
    return { activated: false, activatedAt: null };
  }
}

/** Persist activation after successful code verification. Atomic write. */
export function writeActivationState(userDataDir: string, now: number): void {
  const file = activationPath(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  const payload: ActivationFile = {
    v: 1,
    activatedAt: now,
    proof: computeActivationProof(now, PRODUCTION_MATERIAL.verifier),
  };
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * Full activation gate: verify code (when needed) + validate persisted state.
 * Returns the current state; writes state when `attemptCode` verifies.
 */
export function ensureActivated(
  userDataDir: string,
  attemptCode?: string,
): { activated: boolean; activatedAt: number | null; justActivated: boolean } {
  const current = readActivationState(userDataDir);
  if (current.activated) return { ...current, justActivated: false };
  if (attemptCode !== undefined) {
    if (verifyActivationCode(attemptCode)) {
      const now = Date.now();
      writeActivationState(userDataDir, now);
      return { activated: true, activatedAt: now, justActivated: true };
    }
    return { activated: false, activatedAt: null, justActivated: false };
  }
  return { ...current, justActivated: false };
}
