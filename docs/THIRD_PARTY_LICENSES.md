# Third-Party Licenses — Dentiva Pro v1.0.0

Dentiva Pro ships as a closed-source commercial application (`UNLICENSED`).
Every third-party component it uses is open source under a **permissive license**
or a **weak, file-level copyleft license that imposes no obligations on our
unmodified binary distribution**. This file is the license audit of record.

Generated from `package-lock.json` (575 resolved packages total: 11 direct
dependencies, ~80 in the shipped production closure, remainder dev/CI tooling
that is **not** included in the Windows installer).

## Summary of licenses used

| License | Packages | Notes |
| --- | ---: | --- |
| MIT | 448 | Permissive — used everywhere |
| Apache-2.0 | 35 | Permissive — patent grant included |
| ISC | 34 | Permissive |
| BSD-2-Clause | 14 | Permissive |
| BSD-3-Clause | 13 | Permissive |
| MPL-2.0 | 13 | Weak file-level copyleft — **dev-only (`@resvg/resvg-js`), not shipped** |
| BlueOak-1.0.0 | 8 | Permissive (npm ecosystem) |
| OFL-1.1 | 2 | Font license (Inter, Noto Sans Bengali) — redistribution permitted |
| CC-BY-4.0 | 1 | Attribution license (documentation asset) |
| Python-2.0 | 1 | Permissive |
| MIT-0 / 0BSD / WTFPL / dual MIT/GPL variants | 5 | Permissive |
| **No license field** | **0** | — |

No GPL, AGPL, LGPL, SSPL, BUSL, or any other reciprocal/limited license appears
anywhere in the dependency tree. No paid services, telemetry, or license-key
validators are used at runtime.

## Shipped production closure (goes inside the installer)

Direct runtime dependencies:

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| @fontsource-variable/inter | 5.3.0 | OFL-1.1 | Latin UI font (bundled, offline) |
| @fontsource-variable/noto-sans-bengali | 5.3.0 | OFL-1.1 | Bengali text/print font (bundled, offline) |
| adm-zip | 0.6.1 | MIT | Reading backup ZIP manifests |
| archiver | 7.0.1 | MIT | Creating timestamped backup archives |
| better-sqlite3 | 13.0.3 | MIT | SQLite database engine (native) |
| lucide-react | 0.468.0 | ISC | UI icons |
| react | 19.3.0 | MIT | UI runtime |
| react-dom | 19.3.0 | MIT | UI runtime |
| react-router-dom | 6.30.6 | MIT | Client-side routing |
| zod | 3.25.76 | MIT | IPC request validation (schema parsing) |
| zustand | 5.0.15 | MIT | Small client state store |

Transitive production packages (70) are all MIT / ISC / Apache-2.0 /
BSD / BlueOak — see `package-lock.json` for the full resolved list.
OFL-1.1 font files are redistributed under the terms of the SIL Open Font
License 1.1 (license text: `node_modules/@fontsource-variable/*/LICENSE`).

## Electron platform components

| Component | Version | License |
| --- | --- | --- |
| electron | 44.x | MIT (Chromium + Node.js; their respective licenses apply — BSD-style) |

Chromium, Node.js, and V8 license texts ship inside the packaged application's
`LICENSE` files as required by their licenses.

## Dev / CI only (NOT shipped in the installer)

electron-builder (MIT), electron-vite (MIT), Vite (MIT), TypeScript (Apache-2.0),
ESLint (MIT), Prettier (MIT), Vitest (MIT), Playwright (Apache-2.0),
@playwright/test (Apache-2.0), jsdom (MIT), @testing-library/* (MIT),
@resvg/resvg-js (**MPL-2.0**, icon-rendering helper — invoked only by
`scripts/generate-icons.mjs`; MPL applies to the library itself and is fully
satisfied by not modifying it), @electron/rebuild (MIT), and their
dependencies.

## Verification

- Source hygiene: no vendored third-party code is copied into `src/`.
- `scripts/validate-dist.mjs` fails the build if any future dependency lacks a
  license field or introduces a non-permissive license family (scan re-runs in CI).
- Runtime offline guarantee: ESLint rule `no-restricted-syntax` forbids `fetch`
  in application code; CSP in `src/renderer/index.html` blocks all remote
  script/style/img/font/connect origins (`default-src 'self'`).
