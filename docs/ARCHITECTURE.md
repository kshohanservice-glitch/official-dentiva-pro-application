# Dentiva Pro — Technical Architecture

Version 1.0.0 · Production specification companion document.

## 1. Product summary

Dentiva Pro is a fully offline Windows desktop application for managing dental clinics in
Bangladesh. It ships as an Electron-built NSIS installer. After installation no internet
connection, cloud service, paid API, or subscription is required at any point.

- Product name: **Dentiva Pro**
- Version: **1.0.0** (final commercial build; no in-app update system)
- Developer: Shohan Khan · helloiamshohan@gmail.com
- Locale: professional English UI; full Bengali Unicode support in all user-generated
  content (names, addresses, notes, prescriptions, instructions) and in print/PDF output.
- Currency: Bangladeshi Taka (৳ / BDT) only.

## 2. Technology stack and rationale

| Layer | Choice | Why |
| --- | --- | --- |
| Desktop shell | Electron 44 | Mature, sandboxable, first-class Windows printing/PDF APIs, permissive MIT licence, deterministic packaging with electron-builder. |
| Build tooling | electron-vite 5 (Vite 6, esbuild) | Fast, official main/preload/renderer pipeline, no webpack weight. |
| UI | React 19 + TypeScript 5.9 (strict) | Component model fits the module-heavy product; strict TS eliminates entire defect classes. |
| Styling | Hand-written CSS design system (tokens + components) | Bespoke premium look; no framework lock-in; exact control over print CSS. |
| Client state | Zustand (session/UI) + TanStack Query (server data) | Query gives loading/error/retry/caching semantics for every IPC read for free. |
| Routing | react-router-dom 6, HashRouter | Works reliably with `file://` production loads; hash routes never break on disk paths. |
| Database | SQLite via better-sqlite3 (WAL) | Synchronous, transactional, embeddable, zero-config, ideal for single-seat desktop use. |
| Validation | Zod 3 | One schema vocabulary shared by IPC boundary, forms, and persistence. |
| Password hashing | Argon2id (OWASP parameters) | Memory-hard, modern, no native build dependency (audited `@noble/hashes` pure JS implementation). |
| Backup | `archiver` (zip) + SHA-256 manifest | Standard format, streaming, integrity-verifiable. |
| Icons | lucide-react (ISC) | Consistent open-source icon set, no emoji used as UI. |
| Packaging | electron-builder 26 → NSIS | Production-grade Windows installer: shortcuts, uninstaller, clean registry entries. |
| CI/CD | GitHub Actions (ubuntu + windows runners) | Typecheck/lint/test/e2e on Linux, installer build on Windows. |

### Explicit non-choices

- No cloud sync, analytics, telemetry, crash reporting, or CDN references — CSP forbids
  remote origins; the app is verified to work with the network disabled.
- No ORM: parameterised SQL through better-sqlite3 prepared statements keeps the query
  layer auditable and fast. String-concatenated SQL is prohibited by lint/test review.
- No `nodeIntegration`; renderer runs sandboxed with `contextIsolation: true`.

## 3. Process model

```
┌──────────────────────────── Electron main ────────────────────────────┐
│ app lifecycle · single-instance lock · auto-lock timer                │
│ IPC dispatcher (zod-validate → authz → service → audit)               │
│ services/ (patients, clinical, billing, inventory, accounting, …)     │
│ repositories (better-sqlite3, prepared statements, transactions)      │
│ security/ (activation, password hashing, session, RBAC)               │
│ print engine (hidden BrowserWindow → print / printToPDF)              │
│ backup engine (zip + manifest + checksums) · scheduler                │
│ structured logger (no PII/clinical content in technical logs)         │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ contextBridge (typed, allow-listed channels)
┌──────────────────────────────▼────────────────────────────────────────┐
│ sandboxed renderer · React UI · never touches fs, sql, or electron    │
└───────────────────────────────────────────────────────────────────────┘
```

### IPC contract

- Every channel is declared in `src/shared/ipc.ts` with a Zod request schema, a response
  type, and a required permission (or `session` for session-scoped calls).
- The main dispatcher performs, in order: schema validation → session check (not locked,
  not logged out) → RBAC permission check → service invocation → audit entry for
  sensitive actions. Failures return `{ ok: false, error: { code, message, details? } }`.
- The renderer can therefore never bypass authorisation by "manipulating routes" — the
  trusted layer is main. UI hiding is only a courtesy.
- Financial channels require fine-grained permissions (e.g. `financial.report.view`);
  having `invoice.create` does not grant report access.

## 4. Security model

### 4.1 Activation

- Raw fixed code exists **nowhere** in source, bundle, DB, config, installer, or git.
- Build-time derived material embedded in main bundle only:
  `ACTIVATION = { salt, params, verifier }` where
  `verifier = argon2id(code, salt, params)`. Only salt/params/verifier are shipped.
- The activation UI asks for the code; main derives and compares in constant time.
  On success main writes `activation.json` in `userData` containing activation timestamp
  plus `HMAC-SHA256(verifier, "activated|" + timestamp)` as tamper-evidence. Editing that
  file by hand without the derived verifier fails verification on next boot.
- Enforcement: main refuses to mount the application shell (and disables every data IPC
  channel) until activation state verifies. This is real enforcement, not UI theatre.
- Reset semantics (documented + tested): activation lives in `userData`, which survives
  app upgrades; uninstalling via NSIS keeps userData unless the user explicitly opts into
  "Delete application data"; deleting `userData` re-arms activation. No online component.

### 4.2 Authentication & sessions

- Argon2id (m=19456 KiB, t=2, p=1, 16-byte random salt, 32-byte tag) per user; stored as
  PHC-style string. Constant-time verification; login throttling (5 failures → 60 s
  cooldown, escalating). No default accounts — the setup wizard creates the first admin.
- Session lives in main memory only: `{ userId, username, permissions, issuedAt,
  lastActivityAt }`. Never persisted, never logged.
- Auto-lock: 5/10/15/30 minutes of inactivity (renderer pings activity on input; main
  owns the timer). On lock, main invalidates the session object, broadcasts `session:lock`,
  and rejects all data channels until re-authentication (password re-entry), so sensitive
  data is not reachable behind the lock screen. Manual lock and logout are always
  available from the header.

### 4.3 RBAC

- Permission codes are strings (`patient.view`, `invoice.create`, `payment.void`,
  `financial.report.view`, `backup.restore`, `settings.manage`, `destructive.actions`, …).
- Roles → permissions many-to-many; built-in roles seeded (Administrator, Dentist,
  Receptionist, Assistant/Nurse, Accountant, Inventory Manager) plus custom roles.
- Every sensitive IPC channel declares its permission; service layer re-checks. Login
  failure, password change, permission change, invoice/payment mutation, destructive
  actions, backup/restore, settings change, and export all write audit rows.

### 4.4 Filesystem, logging, network

- Renderer has zero filesystem access. All file operations happen in main with path
  validation (resolved path must stay inside the allowed root: userData, chosen backup
  folder, chosen export path).
- Technical logger writes to `userData/logs/` with size-based rotation; log events are
  metadata only (channel, code, duration, entity ids) — never passwords, activation
  material, clinical text, or monetary payloads. Audit log (DB) is separate, append-only,
  permission-gated, with no UI delete.
- CSP: `default-src 'self'; img-src 'self' data: file:; style-src 'self' 'unsafe-inline';
  font-src 'self'; connect-src 'none'` in production. Electron `will-navigate` denies all
  external navigation; `setWindowOpenHandler` denies popups.

## 5. Data architecture

### 5.1 Storage

- `userData/dentiva.db` (+ WAL files), `PRAGMA journal_mode=WAL`,
  `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.
- Migrations: numbered SQL migrations applied in a transaction, recorded in
  `schema_migrations`. Fresh install and test harnesses run the same path.
- **Money**: integer **poisha** (1 BDT = 100 poisha) everywhere — no floats for any
  monetary value; all totals computed with integer arithmetic in SQL/JS, formatted at the
  edge (`৳1,234.56`, en-BD grouping).
- **Time**: epoch milliseconds (UTC) for timestamps; date-only business fields (invoice
  date, appointment day, expiry dates) stored as `YYYY-MM-DD` in **Asia/Dhaka** local
  time. Day boundaries ("today") are computed against Dhaka, including midnight-edge
  tests. Display via `Intl` with `Asia/Dhaka`.
- **Human ids**: `DP-000123` (patients), `INV-260930-0001`, `RX-…`, `APT-…`, `PAY-…`
  generated from a `sequences` table inside the insert transaction (unique, no gaps on
  retry). Integer PKs remain internal only.

### 5.2 Entity map (normalised, FK + delete policy)

Core: `settings`, `clinic_config`, `users`, `roles`, `permissions`, `role_permissions`,
`user_roles`, `staff`, `dentists`, `dentist_designations`, `dentist_qualifications`.
Clinical: `patients`, `patient_alerts`, `visits`, `clinical_findings`,
`clinical_options`, `teeth`, `tooth_conditions`, `dental_chart_entries`, `treatments`,
`appointments`, `queue_entries`, `prescriptions`, `prescription_items`,
`medicine_catalog`, `referrals`.
Billing: `invoices`, `invoice_items`, `payments`.
Operations: `suppliers`, `inventory_items`, `inventory_batches`,
`inventory_transactions`, `expense_categories`, `expenses`, `other_income`.
Platform: `attachments`, `printer_profiles`, `backup_records`, `notifications`,
`audit_logs`, `sequences`.

Delete policy: clinical/financial history is never cascaded away. Patients archive
(`status='archived'`), they are not deleted by normal flows; `ON DELETE` for history
tables is RESTRICT. Catalog entities referenced by history use snapshot columns
(invoice item name/price, prescription medicine text, dentist name/credentials printed on
historical documents) so later catalog edits never rewrite history. Custom `destructive
actions` (reset business) require typed confirmation + password re-entry and always take
a pre-action backup.

### 5.3 Money & status semantics (dashboard/report definitions)

- **Today's revenue** = Σ active payments with `paid_at` in today (Dhaka), by method.
- **Outstanding** = Σ(`invoices.total` − Σ active payments allocated) for non-void
  invoices with due > 0.
- Invoice status: `unpaid` (paid = 0), `partial` (0 < paid < total), `paid`,
  `void`. Payments are immutable rows; corrections use void/reversal with audit — never
  silent edits. Partial payments create new `payments` rows linked to the invoice.
- **Billed vs collected vs expense** are reported as three distinct series; expense
  reports never mix into revenue charts.

### 5.4 Attachment storage

Managed folder `userData/attachments/<entityType>/<entityId>/<uuid>.<ext>`; DB stores
metadata only (original name, mime, size, sha-256, uploader). Uploads validated by
signature (not just extension), size-capped. Preview streams via privileged IPC with
path containment; missing/corrupt files degrade to an explicit state. Backup archive
includes the attachment tree.

## 6. Print & PDF architecture

- One React "document renderer" produces the print DOM (prescription, invoice) using the
  same component tree for on-screen preview and physical output.
- Print flow: renderer requests `print.run` → main opens a hidden BrowserWindow loading
  `print.html` with the document payload → waits for `fonts.ready` + `print:ready` →
  calls `webContents.print({ deviceName, margins, scaleFactor, copies, silent:false })`
  or `webContents.printToPDF({ pageSize })` → optional save dialog.
- Printer discovery: `webContents.getPrintersAsync()`; printer profiles persist
  (printer identity, paper, margins, orientation, scale, copies, doc type) in DB. A
  vanished printer produces a clear message + re-selection, never a crash.
- Paper: A4, A5, A6, thermal 58/80 mm (custom size in microns), Letter. Layout CSS uses
  physical units (`mm`, `pt`) with per-paper breakpoints: typography scales down on
  A5/thermal, long lists wrap instead of clipping, signature block reserves ≥25 mm of
  blank space above the signature line, page breaks use `break-inside: avoid` on rows.
- Fonts bundled locally: Inter (Latin UI) + **Noto Sans Bengali** (Bengali glyphs) via
  `@fontsource` — both OFL. Chromium's HarfBuzz shapes Bengali correctly; printToPDF
  embeds used font subsets, so Bengali text in PDFs is selectable and correctly shaped
  (no tofu). No system-font dependency.

## 7. Backup & restore

- Archive: `.zip` containing `manifest.json`, `dentiva.db` snapshot (taken with
  `VACUUM INTO` for transactional consistency while WAL is active), `attachments/**`.
- Manifest: format version, app version, schema version, created-at, per-file SHA-256,
  record counts (for post-restore sanity verification).
- Restore: user picks archive(s) → validate manifest + checksums + schema version
  compatibility + SQLite `integrity_check` on the extracted copy → take automatic
  **pre-restore backup** → close DB → replace → reopen → verify FK/count sanity → audit.
  Corrupted/incompatible archives are refused with a specific explanation. Multi-file
  restore is intentionally not offered for full snapshots (would be unsafe merging);
  UI explains single-snapshot semantics.
- Automatic backup: every 7/15/30 days (user setting + folder picker); scheduler in main
  tracks `next_backup_at`, shows last/next status and errors; failures surface as
  critical notifications.

## 8. UX architecture

- Shell: fixed premium header (brand, clinic name, date, global search `Ctrl+K`,
  notification centre, profile, lock, logout) + collapsible sidebar grouped exactly as
  specified: Practice / Clinical / Billing / Administration.
- Design system: CSS custom properties for colour (primary teal/navy "clinical tech"
  palette, semantic success/warn/danger/info, surfaces, borders, focus rings), 4-pt
  spacing scale, radius scale, 3-level elevation, type scale (Inter 400/500/600),
  icon sizes, control heights (32/36/40), table rows, modal sizes, breakpoints
  (1024/1280/1440/1920). Animations: 120–200 ms, `cubic-bezier(0.2,0,0,1)`, transform +
  opacity only, all disabled under `prefers-reduced-motion`.
- Deterministic grids: KPI grids use `repeat(auto-fit, minmax(220px, 1fr))` with even
  card counts per breakpoint so 6 cards never break into 5+1; widget layout documented
  per section.
- Every list has explicit loading (skeleton), empty (guided), error (retry), and
  permission-denied states; tables paginate (server-side LIMIT/OFFSET) — no unbounded
  rendering. Patient profile timeline virtualises/paginates for hundreds of visits.
- Keyboard: `Ctrl+K` search, `Ctrl+N` new patient, `Ctrl+Shift+N` new appointment,
  `Ctrl+P` print preview, `Ctrl+S` save (forms), `Ctrl+L` lock, `Esc` closes overlays,
  focus trap in modals, visible focus rings everywhere.
- Forms: inline Zod validation, precise messages ("Phone must be 11 digits, e.g.
  01XXXXXXXXX"), Bengali-safe text fields (no over-restrictive character filters).

## 9. Printing module notes (per document type)

- **Prescription**: clinic header (logo, name, address, phone), patient block, dentist
  block (name + all designations + all qualifications), C/C · O/E · R/E, medicine table
  with per-row sig, advice, footer, signature area with generous blank space.
- **Invoice**: clinic header only (logo, name, address, phone — no signature block by
  default), items table with qty/unit price/discount, subtotal/adjustment/total,
  paid/due/status, payment methods footer. Configurable footer exists but is opt-in.

## 10. Testing strategy

| Tier | Tool | Scope |
| --- | --- | --- |
| Unit | Vitest | money math, id generation, Dhaka date edges, activation verify, password hash, RBAC resolution, zod schemas, print HTML generation, formatters. |
| Integration | Vitest + real SQLite (temp dirs) | migrations, every service CRUD path, transactions, partial payments, invoice immutability, inventory deltas, appointment conflicts, queue ordering, audit writes, permission denial at service layer, backup→mutate→restore round-trip, corrupted-backup refusal. |
| Component | Vitest + jsdom + Testing Library | key form validation, table states, lock screen behaviour. |
| E2E | Playwright + Electron (CI, xvfb on Linux) | activation → wizard → login; patient → appointment → queue → visit → prescription → invoice → payment → backup; PDF smoke; lock enforcement. |

CI gates: `lint → typecheck → unit+integration → build → e2e` on every PR; Windows job
additionally packages the NSIS installer and validates the artifact (existence, size,
version stamp, checksum).

## 11. Repository layout

```
src/shared      contracts: ipc channel schemas, permissions, money/date utils, types
src/main        index · security · db (migrations, seed) · services · ipc · print · backup · scheduler · logging
src/preload     contextBridge API
src/renderer    src/{app, ui, layout, features, lib, styles}
tests           unit · integration · e2e
docs            ARCHITECTURE · SPECIFICATION · PROGRESS · THIRD_PARTY_LICENSES · QA
scripts         generate-icons (SVG → verified PNG/ICO set)
build           icon assets, NSIS extras
.github/workflows  ci.yml (PR gates) · release.yml (main → installer → release/dist)
```

## 12. Packaging & release

- `electron-builder` NSIS: one-click installer with proper display name, per-machine or
  per-user option, Start Menu + desktop shortcuts, correct icon set (16→512 px generated
  from a designed SVG, alignment/transparency verified programmatically), clean
  uninstall; `deleteAppDataOnUninstall=false` (activation/user data explicitly preserved
  unless chosen otherwise).
- Version stamped `1.0.0` in package.json, `app.setVersion` surfaced in About.
- CI: PR → ubuntu gates + windows package artifact. Merged to `main` (by the user) →
  release workflow builds installer, computes SHA-256, publishes GitHub Release with
  `DentivaPro-Setup-1.0.0.exe` + checksums; if publishing is impossible, the verified
  artifact is committed under `dist/` as the documented fallback.
- Pre-release source audit checklist lives in `docs/QA.md`.
