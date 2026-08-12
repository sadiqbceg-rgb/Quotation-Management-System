# Phase 13 — Testing

---

# Objective

Bring the whole system to comprehensive, trustworthy test coverage: the quotation-numbering matrix in full (format, padding, year reset, concurrency, idempotency, immutability, propagation), pricing and calculations, validation, authentication and authorization, document generation, the Drive and Sheets integrations, error handling, and end-to-end user journeys.

Existing per-phase tests stay. This phase fills the gaps, adds the cross-cutting suites, and establishes the coverage gates.

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

- Phases 01–12 complete and green.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — **§20 (testing strategy)**, §20.2 (the mandatory numbering matrix), §20.4 (test-data policy), §7 (numbering), §8 (pricing), §23 (errors).
- `PRD/quotation-prd.md` — §36 (validation), §37 (error handling), **§45 (success criteria — the 28 items are the acceptance checklist)**, §34 (no dummy data).
- Every existing `*.test.ts` — extend rather than duplicate.
- Every module under `shared/`, `src/services/`, and `google-apps-script/src/`.
- `quotation-implementation-plan/SECURITY_REVIEW.md` — the security suites from Phase 12 stay and must keep passing.

---

# Implementation Scope

**In scope**

1. Completing the numbering test matrix in full.
2. Pricing and calculation coverage including edge cases.
3. Validation coverage for every PRD §36 rule.
4. Authentication and authorization coverage.
5. Document-generation coverage against real generated files.
6. Integration coverage for Drive and Sheets with faked Google services.
7. Error-handling and partial-failure coverage.
8. End-to-end journeys with Playwright.
9. Coverage thresholds and CI wiring.
10. A test-data policy check that fails the build if a fixture is reachable from application code.

**Out of scope**

New features. Refactoring beyond what a test genuinely requires. Deployment (14). If a test reveals a bug, fix the bug — that is in scope — but do not add capability that no phase specified.

---

# Required Changes

## 1. Quotation numbering — the mandatory matrix

Every one of these must exist and pass:

**Format**
- `SFC/RUH/QTN/2026/001`, `SFC/RUH/QTN/2026/002`, `SFC/RUH/QTN/2026/003` are produced for the first three quotations of 2026.
- The canonical form matches `^SFC\/RUH\/QTN\/(\d{4})\/(\d{3,})$`.
- `SFC` = Speed Falcon Company, `RUH` = Riyadh, `QTN` = Quotation — all sourced from configuration, asserted by changing the config in a test and seeing the output change.

**Sequence and padding**
- First quotation of a year → `001`.
- Sequential increment → `001 → 002 → 003`.
- `009 → 010`.
- `099 → 100`.
- `999 → 1000` — the width grows and never truncates.

**Year**
- New-year reset: the last of 2026 is `…/2026/125`, and the first of 2027 is `…/2027/001`.
- The year comes from the quotation date, not the system clock.
- The year is never hard-coded: with a mocked clock in 2031, a 2031-dated quotation yields `…/2031/001`.

**Concurrency and duplicates**
- N concurrent reservations yield N distinct numbers, no gaps, no duplicates.
- Reserving twice with the same `draftId` returns the same number and does not advance the counter.
- A duplicate number reaching the Sheets write is rejected.
- Lock-acquisition failure returns `NUMBERING_LOCKED`.

**Immutability**
- Editing and re-saving a quotation preserves its number.
- A client-supplied different number on update is rejected.
- No new number is issued on edit.

**Propagation** — for one quotation, the same canonical number appears in:
- the PDF body (extracted from the generated PDF),
- the DOCX body (extracted from the generated `word/document.xml`),
- the Google Sheets `Quotation No.` cell,
- and the file-safe form in the Drive folder name, the PDF filename, and the DOCX filename.

## 2. Pricing and calculations

Line amounts, half-up rounding at exactly `0.005`, fractional quantities, category subtotals, subtotal, discount on and off, VAT at 15% and at other rates, grand total, the printed column summing exactly to the printed total across 200 lines, no floating-point drift across 1,000 lines, currency formatting, and quantity formatting.

## 3. Validation

Every PRD §36 rule, asserted client-side **and** server-side: required client name, company name, address, quotation-for, at least one item, quantity, unit, price, authorized person; and rejection of negative quantity, negative price, zero quantity, empty designation, empty material description, empty equipment description, out-of-bounds values, and bad date formats.

## 4. Authentication and authorization

Login success and failure, generic error messaging, timing parity, lockout, token issue/verify/expire/revoke/renew, inactive-user rejection, every action's role requirement, route guards, redirect-to-intended-destination, and `AUTH_EXPIRED` handling.

## 5. Document generation

Single page; multi-page; a 60-row table spanning pages with a repeating header; a long terms list paginating without splitting an item; the atomic signature block; the seal never overlapping text (asserted numerically); the transparent seal; the letterhead on every page; selectable text; correct filenames; and PDF/DOCX parity of number, client, row counts, term order, and closing text.

## 6. Integrations

Drive: folder creation, folder reuse, month naming from the quotation date, backdated filing, correct naming, replace-not-duplicate on retry, partial failure, and no sharing call ever made. Sheets: append on first save, update on re-save, status preserved on re-save, uniqueness, injection escaping, hyperlink construction, and read/filter behaviour.

## 7. Error handling

Every code in `IMPLEMENTATION_PLAN.md` §23.1 is produced by a real path and handled by the client. Specifically: Drive failure does not mark the quotation saved and retry works without duplicating; Sheets failure after a Drive success warns and retries by updating; a reservation followed by a failed save keeps the number reserved so the retry reuses it.

## 8. End-to-end (Playwright)

Walk PRD §45's 28 success criteria as journeys against a development deployment or fully mocked backend: log in → new quotation → client → quotation-for → automatic number → items across all three categories → quantities, units, prices, remarks → live totals → select terms → create a term → closing paragraph → select an authorized person → details and signature auto-fill → seal on the right → preview → PDF → DOCX → save to Drive → year/month/number folders → Sheets row → Drive link → status change → a second quotation with no duplicate numbering → zero dummy data.

## 9. Coverage and CI

Thresholds: 95% for `shared/` and the numbering, money, and totals modules; 90% for services and Apps Script handlers; 80% overall. A GitHub Actions workflow running typecheck, lint, build, unit tests, and Playwright on every push to the branch.

---

# Expected Files / Components

```
src/**/*.test.ts(x)                                      (extended)
google-apps-script/src/**/*.test.ts                      (extended)
shared/*.test.ts                                          (extended)

src/__tests__/integration/{quotation-flow,save-flow,error-recovery}.test.ts
google-apps-script/__tests__/{numbering-concurrency,drive-integration,
                              sheets-integration}.test.ts
e2e/{auth,quotation-creation,document-generation,drive-save,
     sheets-tracking,full-journey}.spec.ts
test/{fakes,helpers,setup}/…                              (Google service fakes)
vitest.config.ts                                          (coverage thresholds)
playwright.config.ts
.github/workflows/ci.yml
quotation-implementation-plan/TEST_REPORT.md
```

---

# Architecture Requirements

- Tests must exercise **real** behaviour: generate real PDFs and DOCXs and re-parse them; do not assert only on internal state.
- Google services are faked at the API boundary (`SpreadsheetApp`, `DriveApp`, `LockService`, `CacheService`, `Utilities`) in one shared fake package, not re-mocked ad hoc per file.
- Tests are deterministic: mock the clock, mock UUID generation, no network, no real Google call, no reliance on test ordering.
- Concurrency tests must genuinely interleave against the fake lock — a sequential loop does not prove mutual exclusion.
- No test may touch a production Drive folder or spreadsheet.
- Do not add Supabase, PostgreSQL, or any database.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*`
- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` and `prompts/*`

Application source may be changed only to fix a bug a test reveals. Every such fix must be listed in `TEST_REPORT.md`. Do not change the quotation number format, the document layout, the Drive structure, or the Sheets columns to make a test pass — if a test disagrees with the specification, the test is wrong or the specification needs a decision.

---

# Data Requirements

- **All test data is synthetic, `TEST_ONLY_`-prefixed, and confined to `__fixtures__/` and `test/`.**
- A lint rule and a CI check must fail the build if a fixture is imported from application code.
- No fixture may be written to a production Drive folder or spreadsheet.
- Integration and E2E tests run against a **separate development deployment**, a development spreadsheet, and a development Drive root.
- Assert explicitly that the production spreadsheet has zero quotation rows and the production Drive has no test folders (PRD §34).
- Never use the real client, person, or quotation number from `reference/quotation-sample.pdf` as fixture data — those are reference evidence.

---

# Security Requirements

- The Phase 12 security suites stay and must keep passing; do not weaken an assertion to make a new test convenient.
- No test credential, token, or key is committed. E2E credentials come from CI secrets.
- Test output — generated PDFs, DOCXs, logs — goes to a git-ignored temp directory and is never committed.
- CI must not print secrets, and must not run E2E against production.
- Fakes must not accidentally permit something the real service forbids; keep them faithful about failure modes.

---

# Validation Requirements

- Every PRD §36 rule has at least one passing and one failing test, on both the client and the server.
- Every error code in §23.1 is produced by a real path in at least one test.
- Coverage thresholds are met and enforced, not merely reported.
- All 28 PRD §45 success criteria map to at least one test; `TEST_REPORT.md` carries the mapping table.

---

# Testing Requirements

This phase's scope is its testing requirement. In addition:

- The suite must be **fast enough to run**: unit tests under 60 seconds, E2E under 10 minutes. A suite nobody runs protects nothing.
- No flaky test. Run the whole suite three times; any intermittent failure must be fixed or removed, never retried away.
- Every test has a descriptive name stating the behaviour, not the implementation.
- Test failures must be diagnosable from the message alone.

---

# TypeScript Requirements

- Test files are strictly typed too — no `any`, no unchecked casts to force a shape.
- Fakes implement typed interfaces matching the real Google service signatures, so a real-API change surfaces as a compile error.
- Fixture factories are typed and return valid domain objects.
- `npx tsc --noEmit` covers test files as well.

---

# Build Requirements

- `npm run build` and `npm run gas:build` succeed.
- `npm test` runs the unit and integration suites; `npm run test:e2e` runs Playwright.
- CI runs typecheck, lint, build, unit tests, and E2E, and fails on any error.
- Playwright uses the pre-installed Chromium at `/opt/pw-browsers`; do not run `playwright install`.
- Test dependencies are devDependencies and never reach the production bundle.

---

# Lint Requirements

- `npm run lint` clean across source **and** test files, zero warnings.
- The fixture-import restriction is active and passing.
- No `.only` and no `.skip` left in the suite — enforce with a lint rule.

---

# Error Handling

- Test helpers fail loudly with clear messages; a fake that receives an unexpected call throws rather than returning `undefined`.
- Assert error **types and codes**, not error message strings, which change.
- Every retry path is tested for both eventual success and permanent failure.
- Tests assert that a failure leaves the system consistent: no orphaned Drive file, no half-written sheet row, no burned quotation number.

---

# Completion Criteria

- [ ] The full numbering matrix passes, including concurrency, idempotency, immutability, and propagation into the PDF, DOCX, Sheets, and Drive names.
- [ ] Pricing, validation, auth, document, and integration suites all pass.
- [ ] Every error code is exercised.
- [ ] E2E journeys cover all 28 PRD §45 success criteria, mapped in `TEST_REPORT.md`.
- [ ] Coverage thresholds are met and enforced in CI.
- [ ] No flaky tests across three consecutive full runs.
- [ ] No fixture is reachable from application code; the check is automated.
- [ ] No test touches production Drive or Sheets.
- [ ] Every bug found is fixed and listed in `TEST_REPORT.md`.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test`, `npm run test:e2e` all pass.
- [ ] Committed to `claude/quotation-app-implementation`.

---

# Stop Conditions

**Stop after the test suite is complete, green, and committed.**

Do not deploy anything (Phase 14). Do not add features. Do not change the quotation number format, the document layout, the Drive structure, or the Sheets schema.

Stop and ask the user if:

- A test reveals a specification contradiction that needs a company decision rather than a code fix.
- Coverage thresholds cannot be met without testing implementation detail rather than behaviour — report the gap instead of writing hollow tests.
- E2E requires production credentials — it must not; report it rather than pointing tests at production.
