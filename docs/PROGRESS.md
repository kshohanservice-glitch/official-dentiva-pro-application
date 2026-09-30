# Dentiva Pro — Progress Ledger

Single source of truth for continuation. Update this file at the end of every work
session: mark completed phases, list known issues, failed tests, release blockers, and
the exact next action.

## Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| 0. Requirements analysis & architecture plan | DONE | `docs/ARCHITECTURE.md`, `docs/SPECIFICATION.md` written before code. |
| 1. Scaffold: package/tooling/tsconfig/lint/format | DONE | package.json, tsconfigs, electron-vite, prettier, eslint flat config. |
| 2. Shared contracts (IPC schemas, permissions, money/date utils, types) | DONE | 113 channels, zod request schemas + response map, compile-time completeness assert. |
| 3. Database: schema + migrations + seed (permissions, roles, options, teeth) | DONE | WAL, FK, indexes, integrity check, 52-tooth FDI seed, built-in treatments/expense categories. |
| 4. Security: activation, Argon2id, session/auto-lock, RBAC dispatcher | DONE | Activation = salted derived proof only; dispatcher enforces per-channel permissions. |
| 5. Services: patients, visits, chart, appointments, queue, treatments | DONE | Conflict detection, queue transitions incl. check-in enqueue path. |
| 6. Services: prescriptions, invoices, payments, inventory, accounting, referrals | DONE | Price snapshots, integer poisha everywhere, idempotency keys on money writes. |
| 7. Platform: audit, notifications, attachments, search, backup/restore, scheduler, logging | DONE | Append-only audit; SHA-256-verified ZIP backups; 10-min background timer. |
| 8. Print engine (preview, printer profiles, PDF, per-paper CSS) | DONE | A4/A5/thermal CSS, preview HTML, print.run/print.toPdf via Windows workflow. |
| 9. Preload bridge + IPC registration | DONE | Sandboxed preload (`window.dentiva`), all 113 channels registered and typechecked. |
| 10. Renderer: design system + shell + auth/setup flows | DONE | tokens.css + components.css; activation → setup → login → lock gate flow. |
| 11. Renderer: all feature modules + states + shortcuts | DONE | 24 pages: Dashboard…Settings; Ctrl+K search, permission-aware nav, empty/loading/error states. |
| 12. Icon generation script + verification | DONE | `scripts/generate-icons.mjs` (ImageMagick) + committed `resources/icon.ico` (256px multi-res). |
| 13. Tests: unit + integration + component + e2e | DONE (partial) | 53/53 green: security (20), database (14), money (16), renderer boot (3). **Playwright e2e not executed** — no display/browser in this environment (see known issues). |
| 14. Docs: README, THIRD_PARTY_LICENSES, QA checklist | DONE | README rewritten; license audit shows 100% permissive; QA checklist = SPECIFICATION acceptance section. |
| 15. CI workflows (PR gates, windows packaging, release) | DONE | `.github/workflows/ci.yml` (windows-latest gate + artifact) and `release.yml` (tag → installer → checksums → GH Release, fallback `release-artifacts` branch). |
| 16. Full audit cycle (source/UX/functional/DB/permission/security/print/backup) | IN PROGRESS | Pass 1 (source/type/lint/test/build) complete; runtime/UX/print walkthrough pending. |
| 17. Second independent review + fixes + regression | PENDING | |
| 18. Packaging validation, PR opened (no merge), release readiness statement | PENDING | PR opened with work; installer packaging validated only in CI (no Wine/display locally). |

## Verification log (this session)

- `npx tsc --noEmit -p tsconfig.node.json` → exit 0
- `npx tsc --noEmit -p tsconfig.web.json` → exit 0 (renderer + renderer tests)
- `npx eslint .` → 0 errors, 0 warnings
- `npx vitest run` → **4 files, 53/53 tests pass** (security 20, database 14, money 16, renderer boot 3)
- `npx electron-vite build` → main + preload + renderer built; Bengali/Inter fonts bundled as local woff2
- `node scripts/validate-dist.mjs` → structural checks OK; full pass requires `dist/` from a Windows build

## Known issues / failed tests

- **Playwright e2e not run here**: no display server, no browsers, no Wine in this
  sandbox, so Electron cannot be launched locally. CI (`windows-latest`) runs unit +
  integration tests; the e2e suite (`tests/e2e/`) must be exercised on a real Windows
  machine before calling the release "verified end-to-end". Do not claim e2e passed
  until that happens.
- **Installer not built locally**: NSIS packaging requires Windows/Wine. The
  `release.yml`/`ci.yml` workflows build and validate it; confirm the first CI run.
- **Hardware printer untested**: no physical printer available — print/PDF output
  verified only via preview HTML and CI-level checks.

## Release blockers

1. Full audit cycles 16–17 (source/UX/functional/DB/permission/security/printer/
   backup/install/restart/stress/regression) with recorded evidence.
2. First successful `ci.yml` run on GitHub (Windows runner) — typecheck/lint/test/
   package/validate all green.
3. Manual Windows verification checklist: activation → setup → login → auto-lock →
   backup → restore → install → uninstall → restart.
4. E2E on real Windows + at least one real print job (A4 and 80 mm thermal).

## Next action

Continue Phase 16: runtime audit walkthrough (code-path review of every page against
the spec), fix findings, then Phase 17 second review, then push branch + open PR
(never merge).
