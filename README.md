# Quotation Management & Generation System

Internal quotation generation system for **Speed Falcon Company** (SPEED-X FALCON),
Kingdom of Saudi Arabia. It replaces manually prepared Word quotations: staff enter
only the variable information, and the system supplies the quotation number, the
date, all arithmetic, the letterhead, the signature, the company seal, the PDF, the
DOCX, the Google Drive filing and the Google Sheets tracking row.

---

## Architecture

```
React + TypeScript SPA  (static hosting, HTTPS)
            │
            │  HTTPS POST, JSON-as-text/plain (no CORS preflight)
            ▼
  Google Apps Script Web App     ← the only trusted boundary
            │
    ┌───────┴────────┐
    ▼                ▼
Google Drive    Google Sheets
(PDF + DOCX)    (tracking, counters, users, master data)
```

There is **no database**. No Supabase, no PostgreSQL, no server tier. See
`quotation-implementation-plan/IMPLEMENTATION_PLAN.md` for the full design.

---

## Getting started

```bash
npm install
cp .env.example .env.local     # then set VITE_GAS_ENDPOINT
npm run dev
```

The backend is a separate deployment — see `google-apps-script/README.md`.

## Scripts

| Command             | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | Vite dev server                                             |
| `npm run build`     | Prepare assets, typecheck, then production build to `dist/` |
| `npm run assets`    | Regenerate `src/assets/generated/` from `reference/`        |
| `npm run typecheck` | `tsc --noEmit` for the app, Apps Script **and** scripts     |
| `npm run lint`      | ESLint, zero warnings tolerated                             |
| `npm run format`    | Prettier                                                    |
| `npm test`          | Vitest                                                      |
| `npm run gas:build` | Bundle the Apps Script backend to `dist-gas/Code.js`        |
| `npm run gas:push`  | Build, then `clasp push`                                    |

---

## Layout

```
src/            React application (structure follows PRD §41)
shared/         Pure logic imported by BOTH the app and Apps Script:
                numbering, money, totals, validation rules, domain types
google-apps-script/
                The backend: TypeScript, bundled with esbuild, deployed with clasp
PRD/            The product requirements document — read-only
reference/      The company's real letterhead, quotation, logo, seal and terms
                — read-only inputs, never modified
quotation-implementation-plan/
                Architecture plan and the sequential phase prompts
```

`shared/` is the reason the frontend and backend cannot drift apart on the
quotation number format or on arithmetic. The server recomputes every total
using the same module the browser used, and rejects a mismatch.

---

## Quotation numbers

```
SFC/RUH/QTN/YYYY/###          e.g. SFC/RUH/QTN/2026/004
```

`SFC` Speed Falcon Company · `RUH` Riyadh branch · `QTN` Quotation ·
`YYYY` the year of the quotation date · `###` an auto-incremented sequence,
minimum three digits.

Numbers are issued **only** by the Apps Script backend, under a script lock,
keyed by draft id so a retry cannot burn a number. The sequence is tracked per
year and resets to `001` in January. A number is assigned once and never
changes — editing a quotation never issues a new one. Nothing in the browser
may invent an official number.

---

## Implementation phases

Work proceeds one phase at a time; each is a standalone prompt in
`quotation-implementation-plan/prompts/`, and each ends with typecheck, lint,
build and tests green.

| Phase                     | Status            |
| ------------------------- | ----------------- |
| 00 Project Analysis       | planning complete |
| 01 Project Foundation     | complete          |
| 02 Authentication         | complete          |
| 03 Quotation Core         | complete          |
| 04 Item Categories        | complete          |
| 05 Terms & Conditions     | complete          |
| 06 Authorized Persons     | complete          |
| **07 Quotation Document** | **complete**      |
| 08 PDF Generation         | not started       |
| 09 DOCX Generation        | not started       |
| 10 Google Drive           | not started       |
| 11 Google Sheets          | not started       |
| 12 Security               | not started       |
| 13 Testing                | not started       |
| 14 Production Deployment  | not started       |

---

## Document assets

The quotation document is drawn from the company's own files. Nothing is
redrawn or approximated:

```
reference/                       ← read-only, the authority for every measurement
  letterhead.pdf                 single A4 page, reused as the background of every page
  quotation-sample.pdf           the approved quotation; §2.4's geometry was measured from it
  company-logo.png               a JPEG, despite the extension
  company-seal.png               a PNG with NO alpha channel
        │
        ▼  npm run assets  (also runs in `prebuild`)
src/assets/generated/            ← git-ignored, reproducible, never committed
```

`scripts/prepare-assets.ts` detects each source by **magic bytes**, not by
extension, and fails loudly naming the file if one is missing or has an
unexpected format. It alpha-keys the seal — the source is opaque, and overlaid
as-is it would paint a white box across the letterhead — and records a SHA-256
fingerprint of every source in `manifest.json`. A test compares those
fingerprints against the files on disk, so a pipeline that ever wrote back into
`reference/` would fail the suite.

One measurement worth knowing before Phase 08: the letterhead's MediaBox is
`0 7.83 595.5 850.08`, while the quotation is `0 0 595.32 841.92`. Anything
embedding the letterhead has to normalise that 7.83 pt y offset. It is recorded
in the manifest and in `LETTERHEAD_SOURCE`.

---

## No dummy data

PRD §34 is a hard requirement: production starts with zero quotations, zero
clients, zero items, zero terms and zero authorized persons. Nothing in this
repository seeds demo records. Test fixtures live under `__fixtures__/`, carry a
`TEST_ONLY_` prefix, and a lint rule prevents application code importing them.
