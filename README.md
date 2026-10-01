# Dentiva Pro

**Professional dental clinic management for practices in Bangladesh — 100% offline, on Windows.**

Dentiva Pro runs your clinic's front desk and back office: patients, dental chart,
appointments and queue, prescriptions, invoicing with bKash/Nagad/Rocket collections,
inventory, accounting, RBAC-secured users, audit trail, backups and print/PDF —
all on one computer, with no internet connection and no third-party services.

- **Version:** 1.0.0
- **Platform:** Windows 10/11 x64 (NSIS installer)
- **Currency:** BDT (৳) — all money stored as integer *poisha* (1 ৳ = 100 poisha), never floats
- **Language:** English UI with full Bengali (বাংলা) Unicode support, including print & PDF
- **License:** Proprietary, commercial, offline activation

## Feature modules

| Area | What you get |
| --- | --- |
| Dashboard | Today's appointments, queue, revenue, outstanding dues, alerts |
| Patients | Registry with search/filters, full profile, clinical timeline, attachments |
| Dental Chart | FDI adult **and** pediatric notation, extensible conditions, persistent per patient |
| Appointments | Day/week calendar, dentist conflict detection, status workflow |
| Queue | Walk-ins, check-in, start/complete/skip/recall |
| Visits & Clinical | CC / O/E / R/E structured documentation, treatment plans, follow-ups |
| Treatment Catalog | Price list with historical snapshots — old invoices never change |
| Prescriptions | Structured C/C · O/E · R/E, multi-medicine, premium print with signature space |
| Invoices & Payments | Partial payments as separate transactions; cash, bank, card, bKash, Nagad, Rocket, Upay, Others |
| Inventory | Stock movements, expiry, low-stock alerts, suppliers, CSV export |
| Accounting | Expenses by category + other income — kept distinct from patient revenue |
| Reports | Billed vs collected vs outstanding, method breakdown, treatment revenue, net position |
| Staff & Users | Staff records, dentists with designations/qualifications, login accounts |
| RBAC | Granular permissions enforced in the main process on every request |
| Notifications | Appointment / inventory / financial / backup alerts |
| Global Search | Permission-respecting search across the whole practice |
| Referrals | Outgoing specialist referrals with follow-up tracking |
| Audit Log | Append-only record of sensitive actions — no edit, no delete |
| Backup & Restore | Timestamped ZIPs with SHA-256 checksums, auto 7/15/30-day schedules, pre-restore safety backup |
| Printer Profiles | A4 / A5 / thermal 80 mm profiles, dynamic paper adaptation, PDF via Windows print workflow |
| Security | Argon2id passwords, auto-lock 5/10/15/30 min, manual lock, logout/user switching |
| First-run Setup | Guided wizard: clinic info, dentists, admin account, backup folder, printers |

## Security & privacy model

- The renderer is **sandboxed** with `contextIsolation`; all privileged work
  (filesystem, database, printers, backups) happens in the Electron main process
  behind explicit, zod-validated IPC channels with per-channel permission checks.
- Activation runs fully offline. The activation code is **never** stored, logged,
  or displayed in plaintext — only a salted, memory-hard derived proof is persisted.
- No network access at runtime: CSP `default-src 'self'`, no telemetry, no analytics,
  no updater phoning home.
- Patient data never leaves the machine. Backups are local ZIP files you control.

## Development

```bash
npm ci            # install exact lockfile versions
npm run dev       # electron-vite dev server
npm run typecheck # main + renderer TypeScript projects
npm run lint      # ESLint (incl. offline-only enforcement)
npm test          # vitest: unit + integration + renderer smoke tests
npm run build     # electron-vite production build -> out/
npm run package:win  # NSIS installer -> dist/  (requires Windows or Wine)
npm run check     # lint + typecheck + test + build
```

## Release

Tag `vX.Y.Z` pushes build on the Windows GitHub Actions runner: typecheck → lint →
test → build → NSIS installer → `SHA256SUMS.txt` → published to the GitHub Release.
If publishing fails, artifacts fall back to the repository's `release-artifacts`
branch under `dist/`. Installer and checksums are always available as workflow
artifacts.

## Documentation

- `docs/SPECIFICATION.md` — full functional specification
- `docs/ARCHITECTURE.md` — system design and IPC contract
- `docs/PROGRESS.md` — build progress ledger
- `docs/THIRD_PARTY_LICENSES.md` — license audit of every dependency

## Support

Developer: **Shohan Khan** — helloiamshohan@gmail.com
