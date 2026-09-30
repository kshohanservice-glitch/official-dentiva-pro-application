# Dentiva Pro — Progress Ledger

Single source of truth for continuation. Update this file at the end of every work
session: mark completed phases, list known issues, failed tests, release blockers, and
the exact next action.

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0. Requirements analysis & architecture plan | DONE | `docs/ARCHITECTURE.md`, `docs/SPECIFICATION.md` written before code. |
| 1. Scaffold: package/tooling/tsconfig/lint/format | DONE | package.json, tsconfigs, electron-vite, prettier, eslint flat config. |
| 2. Shared contracts (IPC schemas, permissions, money/date utils, types) | DONE | 116 channels (incl. setup.pickLogo, database.integrity, staff.pickPhoto/staff.photo, reports.purchases/salaries), zod request schemas + response map, compile-time completeness assert. |
| 3. Database: schema + migrations + seed (permissions, roles, options, teeth) | DONE | WAL, FK, indexes, integrity check, 52-tooth FDI seed, built-in treatments/expense categories. Printer profiles now created only by setup (not re-seeded). |
| 4. Security: activation, Argon2id, session/auto-lock, RBAC dispatcher | DONE | Activation gate before schema; lock-exempt unlock/logout; pre-activation channel allowlist; real input-based activity for auto-lock. |
| 5. Services: patients, visits, chart, appointments, queue, treatments | DONE | Conflict detection, queue transitions incl. check-in enqueue path. |
| 6. Services: prescriptions, invoices, payments, inventory, accounting, referrals | DONE | Price snapshots, integer poisha everywhere, idempotency keys; invoice list paged in SQL with no row caps. |
| 7. Platform: audit, notifications, attachments, search, backup/restore, scheduler, logging | DONE | Append-only audit; SHA-256-verified ZIP backups; server-side RESTORE confirm; 10-min background timer; startup integrity logged. |
| 8. Print engine (preview, printer profiles, PDF, per-paper CSS) | DONE | Base64-embedded Inter + Noto Sans Bengali woff2 for preview/PDF popups (CSP-safe), long-document page-break rules, A4/A5/thermal CSS. |
| 9. Preload bridge + IPC registration | DONE | Sandboxed preload (`window.dentiva`), all channels registered and typechecked. |
| 10. Renderer: design system + shell + auth/setup flows | DONE | tokens.css + components.css (incl. search dropdown + reduced motion); activation → setup → login → lock gate flow; wizard resumable (no passwords persisted). |
| 11. Renderer: all feature modules + states + shortcuts | DONE | 24 pages incl. standalone About; exact spec IA; staff photos; Rx templates + reorder; error boundary; global search loading/empty + keyboard nav. |
| 12. Icon generation script + verification | DONE | `scripts/generate-icons.mjs` (ImageMagick) + committed `resources/icon.ico` (256px multi-res). |
| 13. Tests: unit + integration + component + e2e | DONE (partial) | **67/67 green**: security, database (incl. profile non-resurrection regression), money, dispatcher gates (14), renderer boot. **Playwright e2e not executed** — no display/browser here. |
| 14. Docs: README, THIRD_PARTY_LICENSES, QA traceability | DONE | License audit 100% permissive; `docs/QA.md` = audit findings + 30-module traceability + honest limitations. |
| 15. CI workflows (PR gates, windows packaging, release) | DONE | `.github/workflows/ci.yml` (windows-latest gate + artifact) and `release.yml` (tag → installer → checksums → GH Release, fallback `release-artifacts` branch). |
| 16. Full audit cycle (source/UX/functional/DB/permission/security/print/backup) | DONE | Findings recorded in `docs/QA.md` §2; all fixed and regression-tested. |
| 17. Second independent review + fixes + regression | DONE | Requirement-by-requirement sweep vs SPECIFICATION §2 (QA.md §3); gaps closed (IA, permissions, integrity tooling, staff photos, Rx templates, reports, search states). |
| 18. Packaging validation, PR opened (no merge), release readiness statement | DONE | PR #1 open (never merge): https://github.com/kshohanservice-glitch/official-dentiva-pro-application/pull/1 — **Windows CI green** (run 36785200107 on 7ed3bcd: typecheck/lint/67 tests/build/NSIS/validate all pass; installer artifact uploaded). Release claim still gated on the manual Windows checklist + physical print + tagged release run. |

## Verification log (latest full gate)

- `npm run typecheck` → exit 0 (node + web)
- `npx eslint .` → 0 errors, 0 warnings
- `npx vitest run` → **67/67 tests pass** (5 files)
- `npx electron-vite build` → exit 0; Bengali/Inter print fonts embedded as base64 in `src/main/printFonts.ts`
- `node scripts/validate-dist.mjs` → structural checks OK; full pass requires `dist/` from a Windows build

## Known issues / failed tests

- **Playwright e2e not run here**: no display server, no browsers, no Wine in this
  sandbox, so Electron cannot be launched locally. CI (`windows-latest`) runs unit +
  integration tests; the e2e suite must be exercised on a real Windows machine before
  calling the release "verified end-to-end".
- **Installer not built locally**: NSIS packaging requires Windows/Wine.
  `release.yml`/`ci.yml` build and validate it; confirm the first CI run.
- **Hardware printer untested**: no physical printer available — print/PDF output
  verified via embedded fonts + preview HTML only.
- **Print font regeneration**: after any `@fontsource` upgrade run
  `node scripts/generate-print-fonts.mjs` (output is committed).

## Release blockers

1. ~~First successful `ci.yml` run on GitHub (Windows runner)~~ — **CLEARED**:
   run 36785200107 on `7ed3bcd` green end-to-end (typecheck, lint, 67/67 tests,
   build, NSIS package, validate-dist); artifact `dentiva-pro-windows-installer`
   (≈111 MB with SHA256SUMS.txt, 30-day retention).
2. Manual Windows verification checklist: activation → setup (incl. resume) → login →
   auto-lock (verify it locks while idle) → backup → restore → install → uninstall →
   restart. *(Needs a person on Windows.)*
3. E2E on real Windows + at least one real print job (A4 Bengali prescription and
   80 mm thermal receipt).
4. Exercise `release.yml` on the `v1.0.0` tag (first tagged release) and confirm the
   GitHub Release publish (or `release-artifacts` branch fallback).

## Next action

PR #1 is green on CI and **ready for review** (never merge from the agent). Remaining
work needs a human on a Windows machine: manual checklist + physical prints; then tag
`v1.0.0` to exercise the release workflow.
