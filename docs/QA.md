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

Run 36787742651 on `784e1c5` re-confirmed both jobs green (package + boot e2e).

### Run on `bc16e15` (expanded workflow e2e suite) — observed outcome: e2e FAILURE

Commit `bc16e15` (PR #1 head at time of writing) adds the workflow suites listed
in §5 and two production fixes (print-preview popup gate; backup restore running
against a closed DB). Local gates before push: `npm run typecheck` exit 0,
`npx eslint .` 0 errors, `npx vitest run` **67/67**, `npm run build` exit 0.

Workflow run **36793829011** (pull_request) — **both jobs' final status read
directly from the Actions API:**

| Job | Result | Evidence |
| --- | --- | --- |
| Windows · typecheck, lint, test, package | **success** | job conclusion `success` |
| Windows · Electron e2e (job 110152590913) | **failure** | steps: checkout/node/cache/install/build/rebuild all success; `Electron e2e` step **failure 2026-10-01T00:00:51Z → 00:32:09Z (31 min 18 s** — i.e. the full suite, including the real 5-minute idle test, ran to completion); artifact-upload step success. Sole step annotation: "Process completed with exit code 1" |

**Honest diagnosis limits:** job logs are unreachable from this environment
(logs endpoint EOF) and the `e2e-artifacts` download fails too (Azure blob
endpoint EOF), so per-test results could not be read. Diagnosis was therefore
done via the job-step API, annotations, and source review, which identified and
fixed (committed with this documentation):

1. `finance.spec.ts` clicked "New invoice" where the page renders two buttons
   with that accessible name (toolbar + empty state) → strict-mode locator
   failure. Fixed with `.first()` (toolbar).
2. `finance.spec.ts` filled the payment Amount field with `200` (taka → 20,000
   poisha) while asserting 200,000 poisha, cascading into paid/overpay/summary
   assertions. Fixed to `2000` (৳2,000 of ৳5,000).
3. `clinical-ops.spec.ts` had the same duplicate "Register patient" button
   problem, plus its Phone field filter also matched "Emergency phone"
   (strict-mode failure). Fixed with `.first()` and a `^Phone` anchor.
4. `clinical-ops.spec.ts` booked the queue-lifecycle appointment ~1 h ahead; on
   a UTC runner this can land on the *next* Dhaka date while QueuePage shows
   today only (checkIn files the queue row under the appointment's Dhaka date).
   The slot now stays on today's Dhaka date (epoch-based overlap checking is
   unaffected, so the conflict test still collides).
5. `src/main/index.ts` preview-popup gate now allows `window.open('')`'s
   empty URL as well as `about:blank` (both are how the real preview flow opens
   its window; anything else stays denied).

To make any future failure diagnosable without log access, CI now emits
Playwright results as JSON and a `if: always()` step converts failures into
check-run annotations (`scripts/e2e-annotations.mjs`). After the fixes above,
local gates were re-run green (typecheck/eslint/vitest 67/67/build) and a **new
run's outcome must be recorded here — nothing beyond 36793829011's two job
results is claimed as observed.**

## 5. E2E workflow suites (isolated profiles, SQLite assertions)

Every suite launches its own Electron instance against a throwaway
`APPDATA`/`XDG_CONFIG_HOME` temp profile (no production data), and each test
asserts the app's SQLite file (read-only connection) after `app.close()` — UI
text alone is never treated as proof. Activation is written through the app's
own `writeActivationState()` (HMAC over the embedded verifier): no code, no
secret, no bypass exists in the repository or CI.

| Suite | What it drives | Authoritative assertions |
| --- | --- | --- |
| `app-boot.spec.ts` | unactivated app (kept unactivated on purpose) | activation gate, preload bridge, `ACTIVATION_REQUIRED` before schema |
| `setup-auth.spec.ts` | full setup wizard UI (clinic → dentist chips → admin → backup → printers), interrupted-draft resume, wrong/correct login, logout, restart | users/dentists/designations/qualifications/clinic/settings/printer profiles/teeth seed in SQLite; argon2 hash ≠ plaintext; draft restored after restart; activation survives restart; `failed_attempts`/`last_login_at` persisted |
| `session-lock.spec.ts` | lock button → LockScreen UI, wrong/right unlock, **real-time 5-minute idle auto-lock** (polling creates no activity) | `LOCKED` refusal for data channels while locked; locked flag; live timer locks between 4:00 and 6:00 minutes; unlock restores access |
| `clinical-ops.spec.ts` | patient registration form UI, two dated visits, adult (16) + pediatric (55) chart entries, invalid FDI refusal, appointment double-booking, check-in → queue Start/Complete buttons | patients/visits/dental_chart_entries rows, `CONFLICT` on overlap, appointment status transitions to `completed`, `chart.set` audit rows, chart+visits surviving a restart |
| `finance.spec.ts` | invoice modal (patient search, treatment datalist, price autofill), payment modal partial cash, service-side full payment/overpay/idempotency/void | integer poisha totals, invoice `unpaid→partial→paid`, exactly one row per idempotency key, overpay `CONFLICT`, void excludes from summary, audit rows |
| `rbac-inventory.spec.ts` | dentist-role user created via `users.save`, real logout/login as that user, inventory purchase/usage/negative attempts | allowed clinical reads; `FORBIDDEN` for payments/backup/users/roles; dashboard money masked (`todayRevenuePoisha = 0`); no rows from refused writes; stock math (50−45=5), low-stock + expiry alerts, negative-stock `CONFLICT` with no transaction row |
| `backup-restore.spec.ts` | real backup archive, corrupt file, wrong confirm phrase, genuine restore | manifest v1 + SHA-256 of `dentiva.db` matches entry bytes, archived patient list read back from the zip, pre-restore safety zip contains the replaced state, rollback verified live, session survives the swap, `backup.restore` audit |
| `print-validate.spec.ts` | preview popups via real `window.open` (Bengali A4 Rx: 3 medicines, long advice, C/C·O/E·R/E·Advice, logo, 2 designations + 2 qualifications, signature block; invoice preview), `print.toPdf` for A4 and thermal80 | preview HTML contains Bengali content/qualifications/signature/embedded fonts/page-break CSS and no `http(s)://` refs; PDFs start with `%PDF-`; thermal MediaBox width = 80 mm ± tolerance; screenshots + PDFs uploaded as CI artifacts `e2e-artifacts` for human layout review |

## 6. Automatable vs human acceptance (explicit)

**Verified green on the Windows CI runner (observed run IDs):** the app-boot
e2e suite (runs 36786940957 and 36787742651) and the package job — typecheck,
eslint, 67/67 unit/integration tests, build, NSIS installer, validate-dist,
installer artifact upload (runs 36785200107 on `7ed3bcd`, 36787742651 on
`784e1c5`, and the package job of 36793829011 on `bc16e15`).

**Executed in CI but NOT yet green-verified — do not list as passed until a
post-fix run says so:** the §5 workflow suites (setup wizard completion + draft
resume; activation persistence; login/logout/wrong password; real 5-minute idle
auto-lock; patient registration; repeated visits; adult+pediatric chart
persistence across restart; appointment conflict + queue lifecycle; invoice
snapshot; partial/full/overpay/idempotent payments; RBAC refusals + dashboard
money masking; inventory stock math/alerts; backup manifest/SHA-256; restore
with pre-restore proof; Bengali print previews + A4/thermal PDF geometry). They
ran end-to-end in run 36793829011, whose e2e job **failed** (§4); logs and
artifacts for that run were unreachable, so no per-test result is recorded.
Root-cause fixes are committed and a new run must be observed before any of
these items is called CI-verified.

**Genuinely requires a human (not automatable here — do not mark as passed):**

1. **Clean-Windows lifecycle checklist** — run `dentiva-pro-windows-installer.exe`
   on a fresh Windows machine (no dev tools): clean install → first launch →
   activation entry → setup wizard completion → interrupt + resume the wizard →
   restart the app and confirm data persistence → manual lock/logout → auto-lock
   at 5/10/15/30 minutes as applicable (observed at least once on the real
   machine) → clean uninstall via Settings → Apps (confirm data-folder removal
   options behave). CI exercises the same flows with isolated profiles, but the
   clean-machine sequence itself is human acceptance.
2. **Native folder/file picker dialogs** — backup destination selection during
   the wizard and in Settings, logo pick, attachment upload, and **restore
   selection** (picking the archive to restore) — dialog interaction cannot be
   driven headlessly; the service paths behind them are covered by code review +
   bridge equivalents.
3. **Physical printing judgment** — A4 Bengali prescription (long text, multiple
   qualifications, multiple medicines, all clinical sections, logo, patient/date/
   doctor info, handwritten-signature space; short and long content): check
   clipping, overlap, page breaks, Bengali glyph shape, logo distortion, scaling,
   signature space on paper; a separate invoice printout; an 80 mm thermal
   document. Use the screenshots/PDFs in the `e2e-artifacts` CI upload as the
   first-pass review, then print for the final acceptance.
4. **Physical printer selection & profile behaviour** — choose a real printer,
   exercise per-document profiles (margins/orientation/scale/copies) and confirm
   the selected profile is honoured on paper.
5. **Display hardware judgement** — high-DPI scaling, multi-monitor window
   behaviour, and the final visual UX inspection on real Windows displays.
6. **Release workflow** — tag `v1.0.0` → Actions release build → artifact
   validation → GitHub Release (or validated `dist/` fallback); blocked until the
   user tags.

## 7. Honest limitations (not verifiable in this environment)

- **Clean-machine install** — the CI installer has not yet been installed,
  launched, upgraded, and uninstalled on a real Windows machine by a person.
  §6 item 1 is the human checklist (setup resume, idle auto-lock, backup,
  restore, restart are now covered by CI suites instead).
- **Physical printing** — no printer hardware here: paper-feed, margins on real
  stock, and "Microsoft Print to PDF" flow are untested. Preview HTML, embedded
  Bengali fonts, PDF bytes and thermal geometry are CI-checked (§5), but a
  human must sign off the physical A4 Bengali prescription, invoice and 80 mm
  thermal printout (§6 item 3).
- **E2E scope** — workflow suites (§5) run on the Windows CI runner; Playwright
  browsers cannot be downloaded in this sandbox (binary CDNs blocked), which is
  why suites run in CI rather than locally.
- **Performance/stress** — exercised via SQL paging and integer maths review and
  synthetic unit tests; no multi-year, million-row database was used.
- **Single machine** — multi-user concurrency beyond SQLite WAL + transaction design
  review is untested.
- **Release workflow** — `release.yml` (tag → installer → checksums → GitHub Release
  with `release-artifacts` branch fallback) has not been exercised; it should run for
  the first time on the `v1.0.0` tag.

Do not claim production readiness until the clean-machine checklist, a physical print
test, and the tagged release workflow have been completed.
