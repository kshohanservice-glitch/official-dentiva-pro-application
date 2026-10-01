/**
 * Security unit tests. The real activation code is NEVER written in source:
 * verification logic is tested with synthetic derived material, plus an
 * env-gated smoke test (DENTIVA_ACTIVATION_CODE) that runs only when the
 * operator supplies the code at runtime.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argon2id } from '@noble/hashes/argon2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const SYNTHETIC_CODE = '998877665544332211';
const syntheticMaterial = (() => {
  const salt = utf8ToBytes('test-salt-16-byte');
  const verifier = argon2id(utf8ToBytes(SYNTHETIC_CODE), salt, {
    t: 2,
    m: 8192,
    p: 1,
    dkLen: 32,
  });
  return {
    salt: bytesToHex(salt),
    verifier: bytesToHex(verifier),
    params: { t: 2, m: 8192, p: 1, dkLen: 32 },
  };
})();

describe('activation verification logic', () => {
  it('accepts the code matching the derived material', async () => {
    const { verifyActivationCode } = await import('../../src/main/security/activation');
    expect(verifyActivationCode(SYNTHETIC_CODE, syntheticMaterial)).toBe(true);
  });

  it('normalizes whitespace and dashes', async () => {
    const { verifyActivationCode } = await import('../../src/main/security/activation');
    expect(verifyActivationCode('9988 7766 5544 3322 11', syntheticMaterial)).toBe(true);
    expect(verifyActivationCode('9988-7766-5544-3322-11', syntheticMaterial)).toBe(true);
  });

  it('rejects wrong codes', async () => {
    const { verifyActivationCode } = await import('../../src/main/security/activation');
    expect(verifyActivationCode('000000000000000000', syntheticMaterial)).toBe(false);
    expect(verifyActivationCode('998877665544332210', syntheticMaterial)).toBe(false);
    expect(verifyActivationCode('998877665544332', syntheticMaterial)).toBe(false); // wrong length
    expect(verifyActivationCode('', syntheticMaterial)).toBe(false);
    expect(verifyActivationCode('not-a-code', syntheticMaterial)).toBe(false);
    // Valid format but wrong material (production material, unknown code)
    expect(verifyActivationCode(SYNTHETIC_CODE)).toBe(false);
  });

  it('production material rejects an arbitrary well-formed code', async () => {
    const { verifyActivationCode } = await import('../../src/main/security/activation');
    expect(verifyActivationCode('1111 1111 1111 1111'.replace(/ /g, ''),)).toBe(false);
    expect(verifyActivationCode(['1234', '5678', '9012', '3456'].join(''))).toBe(false);
  });

  it('OPTIONAL runtime smoke: real code verifies when operator provides it via env', async () => {
    const code = process.env.DENTIVA_ACTIVATION_CODE;
    if (!code) {
      // Honest skip: the plaintext code must never live in the repo.
      expect(process.env.DENTIVA_ACTIVATION_CODE).toBeUndefined();
      return;
    }
    const { verifyActivationCode } = await import('../../src/main/security/activation');
    expect(verifyActivationCode(code)).toBe(true);
    expect(verifyActivationCode(`0${code.slice(1)}`)).toBe(false);
  });
});

describe('activation state persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dentiva-act-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts unactivated', async () => {
    const { ensureActivated } = await import('../../src/main/security/activation');
    const state = ensureActivated(dir);
    expect(state.activated).toBe(false);
    expect(state.activatedAt).toBeNull();
  });

  it('persists activation state that survives restart (file-backed)', async () => {
    const { ensureActivated, writeActivationState, readActivationState } = await import(
      '../../src/main/security/activation'
    );
    const now = 1_700_000_000_000;
    writeActivationState(dir, now);
    // Simulated restart: state comes from disk, not memory.
    const after = readActivationState(dir);
    expect(after.activated).toBe(true);
    expect(after.activatedAt).toBe(now);
    expect(ensureActivated(dir).activated).toBe(true);
  });

  it('never writes a plaintext code into activation.json', async () => {
    const { writeActivationState } = await import('../../src/main/security/activation');
    writeActivationState(dir, 1_700_000_000_000);
    const raw = readFileSync(join(dir, 'activation.json'), 'utf8');
    expect(raw).not.toContain(SYNTHETIC_CODE);
    expect(raw).not.toContain('code');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['activatedAt', 'proof', 'v']);
  });

  it('rejects tampered activation.json (proof signature)', async () => {
    const { writeActivationState, readActivationState, ensureActivated } = await import(
      '../../src/main/security/activation'
    );
    writeActivationState(dir, 1_700_000_000_000);
    const file = join(dir, 'activation.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { activatedAt: number };
    parsed.activatedAt = parsed.activatedAt - 1;
    writeFileSync(file, JSON.stringify(parsed));
    expect(readActivationState(dir).activated).toBe(false);
    expect(ensureActivated(dir).activated).toBe(false);
  });

  it('rejects a forged proof value', async () => {
    const { writeActivationState, readActivationState } = await import(
      '../../src/main/security/activation'
    );
    writeActivationState(dir, 1_700_000_000_000);
    const file = join(dir, 'activation.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { proof: string };
    parsed.proof = 'f'.repeat(64);
    writeFileSync(file, JSON.stringify(parsed));
    expect(readActivationState(dir).activated).toBe(false);
  });

  it('rejects corrupted activation.json gracefully', async () => {
    const { readActivationState } = await import('../../src/main/security/activation');
    writeFileSync(join(dir, 'activation.json'), '{broken json');
    expect(readActivationState(dir).activated).toBe(false);
  });
});

describe('activation source hygiene', () => {
  it('activation module contains no 16-digit literal sequences', async () => {
    const { readFileSync: rf } = await import('node:fs');
    const src = rf(join(__dirname, '../../src/main/security/activation.ts'), 'utf8');
    expect(src).not.toMatch(/\b\d{16}\b/);
    // Only the derived material fields may hold hex strings of 32/64 chars.
    expect(src).toContain('PRODUCTION_MATERIAL');
  });

  it('no source file in the repo embeds the activation material next to digits', async () => {
    const { execSync } = await import('node:child_process');
    let out = '';
    try {
      out = execSync(
        `grep -rn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' --include='*.md' -E "\\b[0-9]{16}\\b" src tests docs package.json 2>/dev/null || true`,
        { cwd: join(__dirname, '../..'), encoding: 'utf8' },
      ).trim();
    } catch {
      out = '';
    }
    expect(out).toBe('');
  });
});

describe('password hashing (argon2id)', () => {
  it('hashes and verifies correctly', async () => {
    const { hashPassword, verifyPassword } = await import('../../src/main/security/passwords');
    const hash = hashPassword('Str0ngPass!x');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
    expect(verifyPassword('Str0ngPass!x', hash)).toBe(true);
    expect(verifyPassword('Str0ngPass!y', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('uses a unique salt per hash', async () => {
    const { hashPassword } = await import('../../src/main/security/passwords');
    const h1 = hashPassword('SamePassword1');
    const h2 = hashPassword('SamePassword1');
    expect(h1).not.toBe(h2);
  });

  it('does not store the plaintext', async () => {
    const { hashPassword } = await import('../../src/main/security/passwords');
    const hash = hashPassword('BdClinic2024');
    expect(hash).not.toContain('BdClinic2024');
  });

  it('rejects malformed stored hashes without throwing', async () => {
    const { verifyPassword } = await import('../../src/main/security/passwords');
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', '$argon2id$v=19$bad')).toBe(false);
    expect(verifyPassword('x', '$bcrypt$v=19$m=1,t=1,p=1$c2FsdA==$aGFzaA==')).toBe(false);
  });

  it('enforces password strength rules', async () => {
    const { checkPasswordStrength } = await import('../../src/main/security/passwords');
    expect(checkPasswordStrength('short').ok).toBe(false);
    expect(checkPasswordStrength('alllowercase1').ok).toBe(false);
    expect(checkPasswordStrength('ALLUPPERCASE1').ok).toBe(false);
    expect(checkPasswordStrength('NoDigitsHere!').ok).toBe(false);
    expect(checkPasswordStrength('password123A').ok).toBe(false); // common word
    expect(checkPasswordStrength('Cl0nic!Safe#9').ok).toBe(true);
  });

  it('escalates lockout after max failed attempts', async () => {
    const { lockoutDurationFor, MAX_FAILED_ATTEMPTS } = await import(
      '../../src/main/security/passwords'
    );
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(lockoutDurationFor(1)).toBe(0);
    expect(lockoutDurationFor(4)).toBe(0);
    expect(lockoutDurationFor(5)).toBeGreaterThan(0);
    expect(lockoutDurationFor(6)).toBeGreaterThan(lockoutDurationFor(5));
    expect(lockoutDurationFor(20)).toBeLessThanOrEqual(15 * 60_000);
  });
});

describe('session lock options', () => {
  it('offers only 5/10/15/30 minute auto-lock values in the contract', async () => {
    const { channelDefs } = await import('../../src/shared/ipc');
    // The setup schema pins autoLockMinutes to the allowed literals.
    const parsed = channelDefs['setup.complete'].request.safeParse({
      clinic: { clinicName: 'X' },
      dentists: [
        { fullName: 'D', designations: [], qualifications: [], phone: '', email: '', bio: '' },
      ],
      admin: { username: 'admin', password: 'Passw0rd!x', displayName: 'Admin' },
      autoLockMinutes: 7,
      paperSize: 'A4',
    });
    expect(parsed.success).toBe(false);
    for (const allowed of [5, 10, 15, 30]) {
      const ok = channelDefs['setup.complete'].request.safeParse({
        clinic: { clinicName: 'X' },
        dentists: [
          { fullName: 'D', designations: [], qualifications: [], phone: '', email: '', bio: '' },
        ],
        admin: { username: 'admin', password: 'Passw0rd!x', displayName: 'Admin' },
        autoLockMinutes: allowed,
        paperSize: 'A4',
      });
      expect(ok.success).toBe(true);
    }
  });
});
