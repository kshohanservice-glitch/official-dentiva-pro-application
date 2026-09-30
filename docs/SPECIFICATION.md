# Dentiva Pro — Final Product Specification

This document is the authoritative product specification for release 1.0.0. It mirrors
`docs/ARCHITECTURE.md` at the feature level and is used for requirement traceability
during the pre-release audit (`docs/QA.md`).

## 1. Identity & packaging

- Product: **Dentiva Pro**, version **1.0.0**, offline Windows desktop application.
- Developer line (About screen, exactly): `Shohan Khan` / `helloiamshohan@gmail.com`.
  No other personal data is invented anywhere.
- Icon: generated from a designed SVG specification (see `scripts/generate-icons.mjs`);
  PNG set 16–512 px with alpha, plus `.ico` for Windows. Alignment and transparency are
  verified programmatically after generation.

## 2. Functional scope (release gates)

| # | Module | Must include |
| --- | --- | --- |
| 1 | Activation | Derived-verifier offline activation, genuine main-process enforcement, restart survival, documented reset semantics. |
| 2 | Setup wizard | Clinic profile + logo, address/phone/hours, multiple dentists with multiple designations & qualifications, admin account creation (no defaults), auto-lock, backup folder, printer preference; resumable. |
| 3 | Auth | Argon2id passwords, session in main, logout, manual lock, auto-lock 5/10/15/30 min with data inaccessible behind lock. |
| 4 | RBAC | Granular permissions incl. financial separation; built-in + custom roles; enforced in main on every channel. |
| 5 | Shell | Premium header (brand, clinic name, date, global search, notification centre, profile, lock/logout), collapsible sidebar with exact IA: Practice (Dashboard, Patients, Appointments, Queue) · Clinical (Treatments, Prescriptions) · Billing (Invoice, Payments, Inventory, Accounting) · Administration (Staff & Users, Backup & Restore, Settings, About). |
| 6 | Dashboard | DB-computed KPIs (appointments, checked-in, queue, completed, outstanding, revenue, payment breakdown, low stock, upcoming, missed, trends), deterministic grid. |
| 7 | Patients | Unlimited records, unique code, clinical/demographic fields, date filters + search + indexes, deep profile with summary/alerts/actions/financials/history + advanced filterable timeline. |
| 8 | Dental chart | FDI adult + primary numbering, interactive multi-select chart, extensible condition catalog, legend, keyboard access, persisted per-tooth findings. |
| 9 | Visits | Independent longitudinal visits with full clinical structure (C/C, O/E, findings, diagnosis, treatment, plan, advice, follow-up, linkage). |
| 10 | Clinical options | Structured searchable C/C · O/E · R/E option sets (beyond listed examples) + custom notes. |
| 11 | Treatments | Catalog with category/code/price/duration/active; price changes never rewrite invoices (snapshots). |
| 12 | Appointments | Create/edit/reschedule/cancel/no-show/check-in, day + week views, dentist conflict detection, patient-context creation. |
| 13 | Queue | Real queue: position, dentist, waiting/serving/completed/skipped, elapsed time, walk-ins. |
| 14 | Prescriptions | Multi-medication, structured fields, templates + common medicines, reorder; flagship print/PDF (A4/A5/thermal, ≥25 mm signature space, Bengali-safe). |
| 15 | Invoices | Full billing document, status unpaid/partial/paid, immutable history, discounts/adjustments, print/PDF with paper adaptation. |
| 16 | Payments | Date filters (default today), BD methods (cash/bank/card/bKash/Nagad/Rocket/Upay/Other), partial payments as rows, void/reversal flow, permission-enforced. |
| 17 | Inventory | Items, suppliers, batches/expiry, movement ledger, low-stock + expiry alerts, audit-trailed adjustments. |
| 18 | Accounting | Expense categories (incl. required list + custom), other income, reports: daily revenue, method breakdown, income vs expense, receivables, category breakdown, treatment revenue, purchase costs, salaries, date ranges. |
| 19 | Staff & Users | Staff records (photo, salary, etc.), accounts referencing staff optionally, role assignment, no default credentials. |
| 20 | Notifications | Categorised, severity-filtered, permission-aware (appointments, missed, stock, expiry, overdue, backup, system); no intrusive spam. |
| 21 | Global search | Ctrl+K across authorized entities with type filter, keyboard nav, loading/empty states, permission-respecting. |
| 22 | Attachments | Managed storage, validated uploads, metadata, image/PDF preview, graceful missing/corrupt handling, included in backup. |
| 23 | Referrals | Outgoing/incoming referrals with status/follow-up, surfaced in timeline. |
| 24 | Audit log | Append-only, permission-gated, covers security/financial/destructive/settings actions. |
| 25 | Backup/restore | Folder picker, timestamped zips, SHA-256 manifest, integrity validation, auto pre-restore backup, 7/15/30-day schedule, status/error surfacing. |
| 26 | Printer profiles | Named profiles per doc type (paper, margins, orientation, scale, copies, printer identity); unavailable-printer handling. |
| 27 | Settings | Grouped centre: clinic, dentists, users/roles, prescription, invoice, printers, notifications, security, backup, data, database info, application info. |
| 28 | About | Product name, version, developer as specified. |
| 29 | Data integrity | Transactions for multi-entity writes, double-submit guards, human ids, integer money, authoritative balances, snapshot semantics. |
| 30 | States & a11y | Loading/empty/error/success/warning/disabled/denied states, error boundaries, keyboard shortcuts, focus management, reduced motion. |

## 3. Explicit exclusions

- No online activation, update system, feature flags, cloud sync, telemetry, or
  internet-dependent runtime behaviour.
- No artificial record limits; capacity bounded only by storage/SQLite limits.
- No placeholder/TODO/mock/dummy content in the shipped build or repository.
- No merging of cash-flow, billed revenue, and receivables into single figures.

## 4. Numerical policies

- Money: integer poisha; display `৳` + en-BD grouping; no floating-point money maths.
- Dates: business dates in Asia/Dhaka; timestamps stored UTC epoch ms.
- Prescriptions/invoices/visits/appointments/payments/patients use unique human ids.
- "Today" = Asia/Dhaka calendar day, computed in main for dashboard/report queries.
