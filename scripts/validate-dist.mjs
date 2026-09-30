/**
 * Post-build validation used by CI (and runnable locally after
 * `npm run package:win`).
 *
 * Checks:
 *  1. An NSIS installer .exe exists in dist/ whose name matches package.json.
 *  2. Writes dist/SHA256SUMS.txt with SHA-256 checksums of every artifact.
 *  3. package.json version matches the expected version (env EXPECTED_VERSION).
 *  4. Source hygiene: no 16-digit activation-code-shaped literals anywhere in
 *     tracked source, tests, or docs (plaintext activation codes are banned).
 *  5. No TODO/FIXME/placeholder markers in shipped source.
 *
 * Exits non-zero on any failure.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const failures = [];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/* 1 — installer present ------------------------------------------------ */
if (!existsSync(join(root, 'dist'))) {
  failures.push('dist/ directory does not exist — did electron-builder run?');
} else {
  const exes = readdirSync(join(root, 'dist')).filter((f) => f.endsWith('.exe'));
  const expected = `Dentiva Pro-${pkg.version}-setup.exe`;
  if (!exes.includes(expected)) {
    failures.push(
      `Expected installer "${expected}" in dist/, found: ${exes.join(', ') || '(none)'}`,
    );
  } else {
    console.log(`installer: ${expected}`);
  }
}

/* 2 — checksums -------------------------------------------------------- */
if (existsSync(join(root, 'dist'))) {
  const artifacts = readdirSync(join(root, 'dist')).filter((f) => f.endsWith('.exe'));
  const lines = artifacts.map((f) => {
    const buf = readFileSync(join(root, 'dist', f));
    const hash = createHash('sha256').update(buf).digest('hex');
    return `${hash}  ${f}`;
  });
  if (lines.length === 0) {
    failures.push('No .exe artifacts to checksum.');
  } else {
    writeFileSync(join(root, 'dist', 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
    console.log(`checksums: ${lines.length} artifact(s) -> dist/SHA256SUMS.txt`);
  }
}

/* 3 — version gate ----------------------------------------------------- */
if (process.env.EXPECTED_VERSION && process.env.EXPECTED_VERSION !== pkg.version) {
  failures.push(
    `Version mismatch: package.json=${pkg.version}, expected=${process.env.EXPECTED_VERSION}`,
  );
}
if (pkg.version !== '1.0.0') {
  console.warn(`note: package.json version is ${pkg.version} (first release target is 1.0.0)`);
}

/* 4 — plaintext activation-code hygiene -------------------------------- */
const SCAN_DIRS = ['src', 'tests', 'docs', 'scripts'];
const SKIP_EXT = new Set(['.png', '.jpg', '.ico', '.pdf', '.zip', '.exe', '.db']);
const CODE_PATTERN = /(?<!\d)\d{16}(?!\d)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'out') continue;
      walk(p, out);
    } else if (!SKIP_EXT.has(entry)) {
      out.push(p);
    }
  }
  return out;
}

for (const dir of SCAN_DIRS) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const text = readFileSync(file, 'utf8');
    const m = text.match(CODE_PATTERN);
    if (m) {
      failures.push(
        `Possible plaintext activation code (16-digit literal) in ${relative(root, file)}`,
      );
    }
  }
}

/* 5 — unfinished-work markers in shipped source ------------------------ */
const MARKER = /\b(TODO|FIXME|XXX|HACK)\b(?!.*eslint-disable)/;
for (const dir of ['src']) {
  const abs = join(root, dir);
  if (!existsSync(abs)) continue;
  for (const file of walk(abs)) {
    if (!/\.(ts|tsx|js|mjs|html|css)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (MARKER.test(text)) {
      const line = text.split('\n').findIndex((l) => MARKER.test(l)) + 1;
      failures.push(`Unfinished-work marker in ${relative(root, file)}:${line}`);
    }
  }
}

/* 6 — dependency license audit (permissive-only policy) --------------- */
const NON_PERMISSIVE =
  /(^|\s)(AGPL-[\d.]+|LGPL-[\d.]+|GPL-[\d.]+|SSPL-[\d.]+|BUSL-[\d.]+|SSPL|BUSL)(\s|$)/;
const BANNED_SUBSTRINGS = ['Commons Clause', 'Sleepycat', 'CC-BY-SA'];
if (existsSync(join(root, 'package-lock.json'))) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith('node_modules/')) continue;
    const lic =
      typeof pkg.license === 'string'
        ? pkg.license
        : pkg.license?.type ?? (Array.isArray(pkg.license) ? pkg.license.join(' OR ') : '');
    if (!lic) continue; // packages without license fields are reviewed manually
    if (NON_PERMISSIVE.test(lic) || BANNED_SUBSTRINGS.some((b) => lic.includes(b))) {
      failures.push(`Non-permissive license "${lic}" in dependency ${path}`);
    }
  }
  console.log('license scan: permissive-only policy applied to package-lock.json');
}

/* report ------------------------------------------------------------ */
if (failures.length > 0) {
  console.error('\nValidation FAILED:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nValidation passed.');
