# Dentiva Pro — Pre-release QA & Requirement Traceability

This document records the full audit cycle (source, UX, functional, DB, permission,
security, printer, backup, install/uninstall, restart, stress, regression) and the
second independent-style requirement-to-implementation review against
`docs/SPECIFICATION.md`. Findings below were fixed before this document was written;
test evidence is reproduced by the regression command.

## 1. Regression command & evidence

```
npm run typecheck && npx eslint . && npx vitest run && npx electron-vite build
```

Latest local run: **67/67 tests passed**, eslint 0 problems, both tsconfigs clean,
`electron-vite build` exit 0. Tests cover security hygiene (no plaintext activation
material anywhere in source/tests/docs/scripts), database migrations/integrity/
seed idempotency, money maths (integer poisha), dispatcher gate order (activation →
schema → session/lock → RBAC), and renderer boot/render smoke.

## 2. Audit findings fixed (Phases 16–17)

### Security & gates
1. **Lock screen dead-end (critical)** — `session.unlock`/`session.logout` were blocked
   by the lock gate. Added a lock-exempt set (still session-authenticated; never
   pre-auth). Covered by dispatcher tests.
2. **Pre-activation IPC (critical)** — main only *warned* pre-activation, and
   `setup.complete` was guarded solely by `userCount > 0`. Dispatcher now fails
   `ACTIVATION_REQUIRED` before schema validation for every channel except
   `app.status`, `activation.verify`, `session.state`.
3. **Dashboard financial exposure** — revenue/outstanding/method breakdown/trend are
   now gated on `payment.view` or `financial.report.view`; patient due balances come
   from a real invoice-minus-payments subquery (was a hardcoded zero).
4. **Backup restore double-confirm** — the renderer's `RESTORE` phrase was never
   checked by main; it is now enforced server-side. Restore ends with logout +
   reload, matching what the UI promises.
5. **Auto-lock defeated by design (critical)** — an unconditional 45-second activity
   heartbeat refreshed `lastActivityAt` even when the user was idle, so the
   5/10/15/30-minute auto-lock could never fire. Replaced with throttled real input
   events (pointer/keyboard/wheel/touch).
6. **Phantom permission codes** — the sidebar and pages checked non-existent
   permissions (`users.view`, `backup.view`, `treatments.view`, `reports.view`,
   `printers.view`), which silently hid navigation from *everyone* without `*`.
   All checks now use canonical codes (`staff.view`/`user.manage`,
   `backup.create`/`backup.restore`, `treatment.view`, `financial.report.view`,
   `printer.manage`).
7. **Setup logo channel** — wizard logo picking uses a setup-only channel guarded in
   the handler (`FORBIDDEN` once any user exists) and blocked pre-activation.

### Honesty / dead UI removed
8. **Fake integrity check** — the Settings data tab's "Run integrity check" only
   showed a canned toast. Now a real `database.integrity` channel runs
   `PRAGMA integrity_check` + `PRAGMA foreign_key_check` and reports file/WAL sizes;
   startup also logs an integrity result.
9. **Printer checkbox did nothing** — the wizard's suggested-profiles checkbox now
   actually creates the profiles via `setup.complete`, and printer profiles are no
   longer re-seeded from `seed.ts` (deleting a profile survives restart; regression
   test added).
10. **Orphan routes** — Referrals/Reports/Audit/Printer Profiles lost sidebar slots to
    the spec's exact IA and gained real entry points (patient profile, Accounting,
    Settings related centres).
11. **No in-app updater, no network calls** — source scan confirms zero runtime
    `fetch`/XHR/HTTP usage; fonts and assets are bundled locally.

### Spec gaps closed
12. Exact sidebar IA (Practice · Clinical · Billing · Administration) + About page.
13. Staff photos (managed folder, path guard, preview, cleanup on replace).
14. Prescription templates ("Use as template") + medication reorder.
15. Setup wizard resumability (localStorage draft, passwords never persisted).
16. Header business date (Asia/Dhaka); reduced-motion support; top-level error
    boundary; styled + keyboard-navigable global search with loading/empty states.
17. Reports complete the spec list: daily revenue, method breakdown, income vs
    expense, receivables, expense categories, treatment revenue, **purchase costs**,
    **salaries**, all with date ranges.
18. No artificial record caps: invoice paging is SQL `COUNT` + `LIMIT/OFFSET` (was a
    5,000-row cap with in-memory paging), patient-timeline and backup-history caps
    removed.

### Printer fidelity
19. Preview/PDF popups only inherit the renderer CSP, so bundled `@fontsource` CSS
    was unreachable and `'Inter'`/`'Noto Sans Bengali'` were dead family names —
    Bengali glyphs would fall back per system. Fixed by embedding the woff2 subsets
    as base64 `@font-face` inside generated print HTML
    (`src/main/printFonts.ts`, regenerate with
    `scripts/generate-print-fonts.mjs`).
20. Long-document print CSS: table header repetition, row/section page-break
    avoidance, signature block kept whole.

## 3. Requirement traceability (spec §2)

| # | Module | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Activation | Enforced | `dispatcher` activation gate tests; salted derived-hash verifier; `activation.json` in userData survives restart |
| 2 | Setup wizard | Complete | 5 steps incl. logo, multi-designation dentists, admin (no defaults), auto-lock, backup folder, printer profiles + paper preference; resumable draft |
| 3 | Auth | Complete | Argon2id, main-side session, manual/auto lock (lock-exempt unlock/logout tests) |
| 4 | RBAC | Complete | Permission checked per channel after session gate; financial permissions separate |
| 5 | Shell | Complete | Exact IA groups; header brand/clinic/date/search/notification bell/profile/lock/logout; Ctrl+K |
| 6 | Dashboard | Complete | All KPIs computed in SQL; money fields permission-gated |
| 7 | Patients | Complete | SQL-paged unlimited list, unique codes, filterable timeline without caps |
| 8 | Dental chart | Complete | 52-tooth FDI build test, condition painting incl. custom conditions, button-based keyboard access, persistence |
| 9 | Visits | Complete | Structured visit capture in profile |
| 10 | Clinical options | Complete | Seeded C/C · O/E · R/E option sets + custom notes |
| 11 | Treatments | Complete | Catalog with price history; invoice items store price snapshots |
| 12 | Appointments | Complete | Day/week views; conflict detection; status transitions; check-in enqueues queue |
| 13 | Queue | Complete | Positions, waited minutes, start/complete/skip/recall, walk-ins |
| 14 | Prescriptions | Complete | Multi-medication with reorder, templates, common-medicine chips, signature space, Bengali-safe print |
| 15 | Invoices | Complete | Snapshot items, statuses, void flow, print without signature block |
| 16 | Payments | Complete | Default-today filters, BD methods, partial payments as rows, void |
| 17 | Inventory | Complete | Movements incl. purchase costs, expiry, low stock, suppliers |
| 18 | Accounting | Complete | Income/expense distinct from revenue; full report list incl. salaries & purchases |
| 19 | Staff & Users | Complete | Staff incl. photo + salary, optional staff-linked accounts, roles UI |
| 20 | Notifications | Complete | 60s poll + manual refresh, unread badge, category filters |
| 21 | Global search | Complete | Permission-respecting kinds, loading/empty states, arrow/Enter/Escape keyboard nav |
| 22 | Attachments | Complete | Managed folder with path guard, open-in-viewer, missing-file error, included in backups |
| 23 | Referrals | Complete | Create/list/update, surfaced in timeline, profile entry point |
| 24 | Audit log | Complete | INSERT-only service; no UPDATE/DELETE paths exist |
| 25 | Backup/restore | Complete | SHA-256 manifest (DB + attachments), pre-restore copy, server-side confirm phrase, 0/7/15/30-day schedules |
| 26 | Printer profiles | Complete | Per-doc profiles, margins/orientation/scale/copies, unavailable-printer handling |
| 27 | Settings | Complete | Clinic (incl. document footers), security, notifications, backup, data (DB info + integrity), about; specialised centres linked |
| 28 | About | Complete | Product, version, `Shohan Khan` / `helloiamshohan@gmail.com` only |
| 29 | Data integrity | Complete | Transactions, idempotency-key UNIQUE columns, integer poisha, FK enforcement, startup integrity log |
| 30 | States & a11y | Complete | Loading/empty/error/denied patterns, error boundary, Escape-to-close modals, Ctrl+K, reduced motion |

## 4. CI evidence (Windows runner)

First full Windows CI run on commit `7ed3bcd` — **green** (workflow run 36785200107,
job "Windows · typecheck, lint, test, package", ~9 min):

1. `npm ci` ✓
2. `npm run typecheck` ✓
3. `npm run lint` ✓
4. `npm test` ✓ — 67/67 on Windows
5. `npm run build` (electron-vite) ✓
6. `npx electron-builder --win` — NSIS installer built ✓
7. `node scripts/validate-dist.mjs` ✓ (structure, required files, license scan,
   no TODO/FIXME markers)
8. Artifact uploaded: `dentiva-pro-windows-installer` (≈111 MB; `dist/*.exe` +
   `dist/SHA256SUMS.txt`, 30-day retention)

Subsequent run 36786940957 added a second green job — **Windows · Electron e2e
boot** (`tests/e2e/app-boot.spec.ts`): the built app is launched with an isolated
temp profile and, over the real preload → dispatcher stack, the suite asserts the
activation gate renders, the preload bridge exists, `app.status` reports
unactivated, and `patients.list`/`session.login` are refused with
`ACTIVATION_REQUIRED` (gate-before-schema proven end-to-end). No activation
material appears in the suite.

## 5. Honest limitations (not verifiable in this environment)

- **Clean-machine install** — the CI installer has not yet been installed,
  launched, upgraded, and uninstalled on a real Windows machine by a person.
  The manual checklist (activation → setup resume → login → idle auto-lock →
  backup → restore → restart → uninstall) remains open.
- **Physical printing** — no printer hardware here: paper-feed, margins on real
  stock, and "Microsoft Print to PDF" flow are untested. HTML/CSS print output and
  embedded Bengali fonts are verified by construction (base64 woff2) and build tests,
  not by a physical printout (A4 Bengali prescription + 80 mm thermal still pending).
- **E2E scope** — the boot/security-gate e2e suite runs green on the Windows CI
  runner; full user-journey e2e (setup → login → module CRUD) is not automated —
  it is covered by the manual Windows checklist below. Playwright browsers cannot
  be downloaded in this sandbox (binary CDNs blocked), which is why suites run in
  CI rather than locally.
- **Performance/stress** — exercised via SQL paging and integer maths review and
  synthetic unit tests; no multi-year, million-row database was used.
- **Single machine** — multi-user concurrency beyond SQLite WAL + transaction design
  review is untested.
- **Release workflow** — `release.yml` (tag → installer → checksums → GitHub Release
  with `release-artifacts` branch fallback) has not been exercised; it should run for
  the first time on the `v1.0.0` tag.

Do not claim production readiness until the clean-machine checklist, a physical print
test, and the tagged release workflow have been completed.
