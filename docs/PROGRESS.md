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
| 13. Tests: unit + integration + component + e2e | DONE | **67/67 unit/integration green** + e2e boot suite green on Windows CI; workflow suites (`tests/e2e/`: setup+resume, login/lock + real 5-min idle auto-lock, patients/visits/chart, appointments+queue, invoice+payments, RBAC+inventory, backup/restore, print/PDF) with isolated temp profiles and SQLite assertions after every close. Run 36793829011 on `bc16e15`: package job green, **e2e job failed** (31 min of execution; logs/artifacts unreachable from the sandbox). Root causes found by source review and **fixed** (duplicate "New invoice"/"Register patient" strict-mode locators; payment Amount taka→poisha 200 vs 2000; Dhaka-midnight queue-date booking; preview popup gate accepting `window.open('')`); CI now converts Playwright JSON results into check-run annotations for future diagnosis. Awaiting a new run's observed result. |
| 14. Docs: README, THIRD_PARTY_LICENSES, QA traceability | DONE | License audit 100% permissive; `docs/QA.md` = audit findings + 30-module traceability + honest limitations. |
| 15. CI workflows (PR gates, windows packaging, release) | DONE | `.github/workflows/ci.yml` (windows-latest gate + artifact) and `release.yml` (tag → installer → checksums → GH Release, fallback `release-artifacts` branch). |
| 16. Full audit cycle (source/UX/functional/DB/permission/security/print/backup) | DONE | Findings recorded in `docs/QA.md` §2; all fixed and regression-tested. |
| 17. Second independent review + fixes + regression | DONE | Requirement-by-requirement sweep vs SPECIFICATION §2 (QA.md §3); gaps closed (IA, permissions, integrity tooling, staff photos, Rx templates, reports, search states). |
| 18. Packaging validation, PR opened (no merge), release readiness statement | DONE | PR #1 open (never merge): https://github.com/kshohanservice-glitch/official-dentiva-pro-application/pull/1 — **Windows CI green** (run 36785200107 on 7ed3bcd: typecheck/lint/67 tests/build/NSIS/validate all pass; installer artifact uploaded). Release claim still gated on the manual Windows checklist + physical print + tagged release run. |

## Verification log (latest full gate)

- `npm run typecheck` → exit 0 (node + web + e2e tsconfigs) — re-run after the
  e2e root-cause fixes (finance/clinical specs, window-open gate, annotation step)
- `npx eslint .` → 0 errors, 0 warnings
- `npx vitest run` → **67/67 tests pass** (5 files)
- `npm run build` → exit 0 (electron-vite; Bengali/Inter woff2 emitted)
- `npx playwright test --list` → 20 tests in 8 files parse cleanly
- `node scripts/e2e-annotations.mjs` smoke-tested against a mock report
- Windows CI run **36793829011** (`bc16e15`): package job **success (observed)**;
  e2e job 110152590913 **failure (observed)** — `Electron e2e` step
  00:00:51Z→00:32:09Z (31 min, full suite ran), only annotation "exit code 1",
  logs + artifacts unreachable (endpoint EOFs). Fixes committed with docs; a
  NEW run must be watched to completion (BOTH jobs) and recorded in QA §4.

## Known issues / failed tests

- **Run 36793829011 e2e job FAILED (observed)**: per-test results unavailable
  (log/artifact endpoints unreachable from the sandbox). Diagnosis by source
  review found and fixed 5 issues (see QA §4): duplicate accessible-name
  locators ("New invoice", "Register patient"), payment Amount unit bug
  (200 taka vs asserted 200,000 poisha), Phone-field filter matching
  "Emergency phone", Dhaka-midnight queue-date booking, preview popup gate
  rejecting `window.open('')`. Next run's per-test failures (if any) will
  surface as check-run annotations via `scripts/e2e-annotations.mjs`.
- **Playwright e2e not run here**: no display server, no browsers, no Wine in this
  sandbox, so Electron cannot be launched locally — suites run on `windows-latest`.
- **Installer not built locally**: NSIS packaging requires Windows/Wine.
  `release.yml`/`ci.yml` build and validate it; confirmed green in run 36785200107.
- **Hardware printer untested**: no physical printer available — preview HTML,
  embedded fonts, PDF bytes/geometry are CI-checked; paper output needs a human.
- **Native dialogs (backup folder, logo, attachments)**: not automatable headlessly;
  manual acceptance item (QA §6).
- **Print font regeneration**: after any `@fontsource` upgrade run
  `node scripts/generate-print-fonts.mjs` (output is committed).

## Release blockers

1. ~~First successful `ci.yml` run on GitHub (Windows runner)~~ — **CLEARED**:
   run 36785200107 on `7ed3bcd` green end-to-end (typecheck, lint, 67/67 tests,
   build, NSIS package, validate-dist); artifact `dentiva-pro-windows-installer`
   (≈111 MB with SHA256SUMS.txt, 30-day retention).
2. **Workflow e2e confirmation**: run 36793829011 (`bc16e15`) — package job
   green, **e2e job failed (observed; logs/artifacts unreachable)**. Root-cause
   fixes are committed; a **new run must be watched to completion with BOTH
   jobs green** before any readiness claim, and its run ID/SHA/jobs recorded in
   QA §4. Suites cover: setup+resume, login/lock/real-time idle auto-lock,
   patients/visits/adult+pediatric chart persistence, appointment conflict +
   queue lifecycle, invoice/partial+full/overpay/idempotency/void, RBAC
   (FORBIDDEN + money masking), inventory math/alerts, backup manifest+SHA-256,
   restore with pre-restore proof, Bengali print previews + A4/thermal PDF
   geometry.
3. Human-only acceptance (QA §6 — do not mark passed without a person): clean-Windows
   install → first launch → activation → setup → restart → persistence → uninstall;
   native picker dialogs; **physical prints** (A4 Bengali Rx incl. long text, multiple
   qualifications/medicines, clinical sections, logo, signature space; invoice; 80 mm
   thermal) with clipping/overlap/page-break/glyph/logo/scaling judgement; high-DPI.
4. Exercise `release.yml` on the `v1.0.0` tag (first tagged release) and confirm the
   GitHub Release publish (or `release-artifacts` branch fallback) — blocked until the
   user tags after acceptance.

## Next action

Commit the docs re-sync + e2e root-cause fixes + annotation step → push to
`arena/01a0f39e-official-dentiva-pro-applicati` → watch the NEW Windows CI run
to completion (**both** jobs) → record the observed result (run ID, SHA, jobs,
annotations) in QA §4 → if the e2e job fails again, read the new annotations and
fix root causes without weakening tests → when automatable work is green, post
the reviewer-facing PR #1 comment (ready for review; verified vs human-remaining)
and stop at the human acceptance gate (QA §6). PR #1 is NOT merged (user merges
manually). Do NOT tag `v1.0.0`, publish a release, or claim production
readiness.
