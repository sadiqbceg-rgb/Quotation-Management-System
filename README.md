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
| `npm run fonts`     | Rebuild the bundled Carlito TTFs from the licensed source   |
| `npm run test:e2e`  | Playwright browser tests (PDF and DOCX in a real browser)   |

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

| Phase                    | Status            |
| ------------------------ | ----------------- |
| 00 Project Analysis      | planning complete |
| 01 Project Foundation    | complete          |
| 02 Authentication        | complete          |
| 03 Quotation Core        | complete          |
| 04 Item Categories       | complete          |
| 05 Terms & Conditions    | complete          |
| 06 Authorized Persons    | complete          |
| 07 Quotation Document    | complete          |
| 08 PDF Generation        | complete          |
| 09 DOCX Generation       | complete          |
| 10 Google Drive          | complete          |
| 11 Google Sheets         | complete          |
| **12 Security**          | **complete**      |
| 13 Testing               | not started       |
| 14 Production Deployment | not started       |

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

One measurement worth knowing: the letterhead's MediaBox is
`0 7.83 595.5 850.08`, while the quotation is `0 0 595.32 841.92`. Anything
embedding the letterhead has to normalise that 7.83 pt y offset. It is recorded
in the manifest and in `LETTERHEAD_SOURCE`.

---

## PDF generation

`Save as PDF` produces the document client-side with `pdf-lib`, drawing real
text onto pages backed by the company's own `reference/letterhead.pdf`, embedded
once as a vector page.

Three consequences of that choice are worth knowing:

- **The letterhead is exact.** Header, red rule, logo, Vision 2030 emblem,
  watermark, footer rule and all three footer columns come from the company's
  artwork rather than an approximation of it.
- **No Arabic is ever re-typeset.** `pdf-lib` does no bidirectional reordering
  and no Arabic shaping. The document's only Arabic lives in the letterhead and
  is already vectors. This removes the single largest fidelity risk in the
  project.
- **The output is real text** — selectable and searchable, not a screenshot. A
  test extracts the client name back out of the finished bytes to prove it.

Fonts are **Carlito** (SIL OFL), bundled in `src/assets/fonts/` with the licence.
Calibri, which the approved document uses, is not redistributable; Carlito is
metric-compatible with it, so line breaks and column fits match. `npm run fonts`
rebuilds the TTFs from `@fontsource/carlito`, so the committed binaries have a
recorded origin.

`pdf-lib`, the fonts and the letterhead are all dynamically imported: pressing
the button is what downloads them. The main bundle grew 601 → 604 kB when this
phase landed.

One measurement that is easy to get wrong: the letterhead's MediaBox is
`0 7.83 595.5 850.08`, not `0 0 595.28 841.89`. Drawing it at the origin scaled
to A4 puts the red header rule 8 pt too high. It is drawn at natural size with
its top edge on the page's top edge — see `pdf-layout-engine.ts`.

---

## Word generation

`Save as Word` produces a real `.docx` client-side with `docx` (v9), from the
**same** `DocumentModel` as the PDF — so the two files cannot disagree about
section order, conditional columns, term wording or the quotation number. A test
generates both from one model and compares what a client would read.

The two renderers differ in one structural way, and everything else follows from
it: **Word cannot embed a PDF page as a background.** So the top and bottom of
the letterhead are REBUILT — the logo image plus the transcribed strings in
`src/config/letterhead-content.ts` — declared once on the section as a header and
a footer, which is what gives Word the every-page guarantee the PDF gets from its
background. The watermark is a floating image inside the header, `behindDoc`,
because that is where Word's own watermark feature lives.

Consequences worth knowing:

- **This is the one place Arabic is re-typeset.** The company name and the C.R.
  line are emitted as `rightToLeft` runs and Word does the shaping. They are
  fixed strings from the company's own letterhead — no user content is ever
  emitted RTL, and a test asserts `<w:rtl>` appears in the header part and
  nowhere else.
- **Word paginates, not us.** `w:tblHeader` repeats table headers, `cantSplit`
  keeps rows and the signature block whole, and the terms use a real numbering
  definition — so the company can edit the file afterwards and Word renumbers.
  The shared paginator is still used, but only to count pages for the caller.
- **Fonts are requested, not embedded.** Calibri by name, Carlito as the
  documented metric-compatible fallback. The package carries no font.

`docx` and the letterhead images are dynamically imported: pressing the button is
what downloads them. The main bundle grew 604 → 606 kB when this phase landed;
the generator itself is a separate 379 kB chunk.

The bands (header and footer) sit OUTSIDE the text margins, at negative indents:
the logo starts at x 13.9 and the rules run to the page edge, while body text
starts at x 34.0. See `docx-band.ts` — the alternative is a header inset 20 pt
from where the artwork puts it.

---

## Google Drive

`Save to Google Drive` files both documents in the company's archive, in the
structure PRD §5 specifies:

```
Quotation Archive/2026/August/SFC-RUH-QTN-2026-004/
                              SFC-RUH-QTN-2026-004.pdf
                              SFC-RUH-QTN-2026-004.docx
```

The year and month come from the **quotation date**, not the clock — a quotation
dated in January and saved in August files under January (PRD §10) — and the
folder carries the exact number the application issued, never one re-derived.

Four things are worth knowing:

- **The browser never touches Drive.** No `googleapis`, no `gapi`, no Google
  credential in the SPA. Documents travel as base64 in the same `text/plain`
  POST as every other action, and Apps Script does the filing. A 500-line
  quotation — the validation ceiling — comes to 1.76 MB of base64.
- **Folder resolution runs under a script lock.** Drive permits two folders
  called `August` in the same parent, so "look it up, then create it" creates a
  second one when two people save in the same second, and nothing reports the
  split. The uploads run OUTSIDE that lock; a 2 MB upload holding a global lock
  would serialise every user of the deployment.
- **A retry replaces, never duplicates.** An existing file of the target name has
  its content replaced through the Advanced Drive Service, keeping the file id,
  the URL already shown to the user, and Drive's revision history. There is no
  path that produces `SFC-RUH-QTN-2026-004 (1).pdf`.
- **Nothing is ever made public.** Files inherit the archive's permissions; no
  sharing API is called anywhere, and a test asserts the Drive fake records zero
  sharing calls.

A partial upload — the PDF filed, the DOCX not — is a first-class outcome rather
than an error: the result type will not narrow without handling it, the panel
shows the link that does work, and the retry sends only what is missing.

Every test runs against an in-memory Drive fake. No test can create a folder or
a file in a real Drive, and development must use a separate root folder from
production.

---

## Google Sheets tracking

The `Quotations` sheet is the V1 quotation register (PRD §31). A row is written
automatically on every successful Drive save, and the quotations list in the app
reads it back — so a Status a colleague changed in the spreadsheet shows up here,
and a change made here shows up there.

Columns A–H are exactly what the PRD specifies, in its order; I–Q are system
columns (the Drive links, the server-computed money, and the `Draft ID` that
makes a re-save update the row instead of adding a second one).

- **Nothing monetary comes from the client.** Every figure is recomputed from
  the stored line items through the same `calculateTotals` the document uses, so
  the register and the PDF cannot disagree by a rounding step.
- **A re-save preserves the Status.** Staff approve and reject in the Sheet;
  re-issuing a document must not reverse that.
- **Formula injection is a type error.** `writeRow` accepts only `PreparedCell`,
  and the only way to get one is through the escaping module — so a client called
  `=IMPORTXML(…)` cannot reach a cell as a live formula. The one formula the
  system does write is the Drive Folder hyperlink, from a validated Drive URL.
- **Uniqueness has three layers**: the counter is the only issuer, a pre-append
  scan rejects a number already held by another quotation, and a conditional
  format highlights a duplicate someone pasted in by hand. The scan and the
  append share one script lock.

A failed register write after a successful upload is a warning, not a failed
save: the documents are in Drive, and **Retry Tracking** writes the row from the
archive without re-sending them.

---

## Security

`SECURITY.md` is the operating document: the threat model, the accepted risks,
what an operator must configure, and the key-rotation procedures.
`quotation-implementation-plan/SECURITY_REVIEW.md` records the Phase 12 audit —
a pass/fail with evidence for each of PRD §33's twenty requirements and each
control in IMPLEMENTATION_PLAN.md §19, plus the eight findings and what was done
about them.

The fact everything else follows from: **the Apps Script endpoint is publicly
reachable**, because a cross-origin `fetch` cannot complete Google's interactive
sign-in. The URL is not a secret and not a boundary. The boundary is the session
token plus the per-action check in the router — verified over the whole action
table, not sampled.

Four controls are worth knowing about:

- **Structural safety is at the parse boundary.** `__proto__`, `constructor` and
  `prototype` are refused at any depth, for every action, before a handler runs.
  So is a payload nested past 12 levels — the walk is iterative precisely so it
  cannot be overflowed by the input it exists to reject.
- **Formula injection is a compile error.** `writeRow` accepts only
  `PreparedCell`. The test states the invariant at its strongest: no cell in the
  spreadsheet begins with `=`, `+`, `-` or `@`, with exactly one documented
  exception — the Drive Folder hyperlink, built from a validated Drive URL.
- **Rate limiting fails closed.** Per-session limits on the expensive actions
  plus a global circuit breaker; if `CacheService` is unreachable the request is
  refused. A limiter that disables itself under load opens the gap exactly when
  it is needed.
- **The CSP is verified in a browser, not just written down.** `public/_headers`
  ships `script-src 'self'` with no `unsafe-inline` and no `unsafe-eval` — the
  mitigation the `sessionStorage` token trade-off was accepted against — and
  `e2e/csp.spec.ts` runs PDF and DOCX generation under that exact policy in
  Chromium, treating a console error as a failure.

```bash
npm run build && npm test          # includes the security suites
npx playwright test e2e/csp.spec.ts
npm audit                          # 0 vulnerabilities
```

---

## No dummy data

PRD §34 is a hard requirement: production starts with zero quotations, zero
clients, zero items, zero terms and zero authorized persons. Nothing in this
repository seeds demo records. Test fixtures live under `__fixtures__/`, carry a
`TEST_ONLY_` prefix, and a lint rule prevents application code importing them.
