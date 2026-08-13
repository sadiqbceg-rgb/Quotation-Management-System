# Test Report — Phase 13

What is tested, where, and what testing it found.

The per-phase suites from 01–12 all stay. This phase added the cross-cutting
ones — the suites that span two layers, which is where the defects listed below
were hiding — plus the coverage gates and CI.

New in this phase:

| File | Covers |
|---|---|
| `google-apps-script/__tests__/numbering-concurrency.test.ts` | Genuine interleaving, the year boundary, the mocked clock |
| `google-apps-script/__tests__/validation-matrix.test.ts` | PRD §36 as a table, server side |
| `google-apps-script/__tests__/error-codes.test.ts` | Every §23.1 code, from a real path |
| `google-apps-script/__tests__/drive-integration.test.ts` | The archive after a year of use |
| `google-apps-script/__tests__/sheets-integration.test.ts` | The register at 1,000 rows |
| `src/__tests__/integration/quotation-flow.test.ts` | **Propagation** into all six sinks |
| `src/__tests__/integration/save-flow.test.ts` | Browser → real backend, over a faked network |
| `src/__tests__/integration/error-recovery.test.tsx` | PRD §37 and §23.2, end to end |
| `src/__tests__/integration/auth-flow.test.tsx` | Timing parity, guards, redirect, expiry |
| `src/__tests__/integration/library-services.test.ts` | Items, terms, persons — the action contract |
| `src/__tests__/test-data-policy.test.ts` | §20.4, enforced against the source tree |
| `src/schemas/quotation-validation.test.ts` | PRD §36 as a table, client side |
| `src/services/document/printed-totals.test.ts` | The arithmetic a client can do with the page |
| `src/services/document/asset-loading.test.ts` | The refusals when artwork will not load |
| `shared/signature.test.ts`, `shared/malformed-input.test.ts` | The branded type, and every parser's refusals |
| `e2e/{auth,quotation-creation,document-generation,drive-save,sheets-tracking,full-journey}.spec.ts` | PRD §45, in Chromium |
| `test/{fakes,helpers}/` | The interleaving scheduler, the fake backend, the clock |

---

## The short version

| | |
|---|---|
| Unit, component and integration tests | **1,502** across **74** files |
| End-to-end tests (Chromium) | **58** across 9 spec files |
| Defects found and fixed | **5** — listed below |
| PRD §45 success criteria covered | 28 of 28 |
| §23.1 error codes reachable by a real path | 18 of 18 |
| PRD §36 validation rules, client and server | every one, passing and failing |

---

## Defects this phase found

Every one was found by a test being written, not by reading the code. Each is
fixed at the source, and each fix has the test that would catch it again.

### D-1 — `Unit` was not required when finalizing a quotation

**Severity: high.** PRD §36 lists Unit among the required fields, and the printed
table has a Unit column on every row. The server validated its LENGTH but never
its presence, and `validateForExport` did not carry `unit` at all. A quotation
could therefore be finalized — number issued, documents generated, files in
Drive — with a blank Unit on a line the client reads.

- **Found by:** `google-apps-script/__tests__/validation-matrix.test.ts`,
  "Required: Unit — refuses a quotation missing it".
- **Fixed in:** `google-apps-script/src/validation/quotation-validator.ts`
  (a `requireComplete` check on `unit`), and
  `src/services/document/export-validation.ts` (the client-side mirror, which
  now takes `unit` on each line and blocks on a blank one).

### D-2 — an impossible date was accepted, and misfiled the quotation

**Severity: high.** `2026-02-31` matched the ISO pattern, and
`new Date('2026-02-31T00:00:00Z')` does not fail — it rolls over to 3 March and
returns a perfectly good timestamp. So a typo was accepted, printed on the
document as `31-02-2026`, and filed in the **March** folder, because the archive
path is derived from the date.

- **Found by:** `google-apps-script/__tests__/validation-matrix.test.ts`,
  "Reject: an impossible date".
- **Fixed in:** `google-apps-script/src/validation/quotation-validator.ts` —
  the parsed value is round-tripped back to `YYYY-MM-DD` and must equal the
  input, which is the only way to see the rollover.

### D-3 — signing in never returned the user to where they were going

**Severity: medium.** `RequireAuth` recorded the intended destination in
`location.state.from`, and `LoginPage` read it — but only *after* an
`isAuthenticated` guard that navigated to `/`. Signing in updates the auth
state, which re-renders the page, which hit that guard and went to the
dashboard, beating the `navigate(redirectTo)` in the submit handler. The
recorded destination was never used.

- **Found by:** `src/__tests__/integration/auth-flow.test.tsx`, "returns them to
  where they were going once they sign in"; also `e2e/auth.spec.ts`.
- **Fixed in:** `src/pages/login/index.tsx` — the destination is computed before
  the guard and used by it. The value is shape-checked (`^/` and not `//`)
  because it reaches `navigate`.

### D-4 — a remark could never be entered

**Severity: medium.** PRD §45.11 is "Add optional remarks". The editor's Remarks
column was shown only when some item already had a remark (PRD §17's rule for
the printed document), and the only way to give an item a remark was to type in
that column. A closed loop: the first remark could not be entered at all.

- **Found by:** `e2e/full-journey.spec.ts` — the step for §45.11 could not be
  performed.
- **Fixed in:** `src/hooks/useLineItems.ts` and
  `src/components/items/QuotationItemsSection.tsx` — a "Remarks column" toggle,
  on by default whenever a remark already exists. **The printed rule is
  unchanged:** the document model still derives `showRemarksColumn` from the
  data, so a quotation with no remarks still prints no Remarks column.

### D-5 — a finalized quotation could not be reached again

**Severity: medium.** Creating a quotation navigated to `/quotations`, the
register. The register is populated from the tracking sheet, which is written
only once the documents are **in Drive** — so a quotation that had just been
created was not on the screen the user was sent to, and nothing anywhere linked
to it. Preview, PDF, Word and Save to Drive (PRD §45.19–§45.22) were reachable
only by typing the URL.

- **Found by:** `e2e/document-generation.spec.ts` and `e2e/drive-save.spec.ts` —
  no route from §45.5 to §45.19.
- **Fixed in:** `src/pages/quotations/new.tsx` — finalizing navigates to the new
  quotation's own preview, which is where PRD §45 goes next.

### Also corrected, not a product defect

`google-apps-script/src/__fixtures__/gas-fakes.ts` had no `getRange().getValue()`,
so `counters-sheet.listYears()` could not have been exercised at all. Added,
along with a read hook and a `getRange` counter — see "Concurrency" below.

---

## 1. Quotation numbering — the mandatory matrix (§20.2)

Every row is a test that exists and passes.

| Requirement | Where |
|---|---|
| `…/2026/001`, `/002`, `/003` for the first three of a year | `shared/numbering.test.ts`, `reserve.test.ts` "starts a year at 001 and increments" |
| Canonical form matches `^SFC\/RUH\/QTN\/(\d{4})\/(\d{3,})$` | `numbering.test.ts` "matches the documented pattern" |
| `SFC`/`RUH`/`QTN` come from configuration — proved by changing it | `reserve.test.ts` "uses the codes from Script Properties rather than inlined literals" |
| First of a year → `001` | `reserve.test.ts` "starts a year at 001" |
| `009 → 010` | `reserve.test.ts` "pads to a minimum of three digits and then grows" |
| `099 → 100` | `reserve.test.ts` "crosses 099 to 100 without losing a digit" |
| `999 → 1000`, width grows and never truncates | `reserve.test.ts` "grows past three digits at 1000" |
| Year reset: last of 2026 is `…/2026/125`, first of 2027 is `…/2027/001` | `__tests__/numbering-concurrency.test.ts` "reaches …/2026/125 and then starts 2027 at 001" |
| Year from the quotation date, not the clock | `numbering-concurrency.test.ts` "follows the quotation date when the two disagree" |
| Never hard-coded: mocked clock in 2031 → `…/2031/001` | `numbering-concurrency.test.ts` "is not consulted: a 2031 quotation…" (and 2041) |
| N concurrent reservations → N distinct numbers, no gaps | `numbering-concurrency.test.ts` "gives eight interleaved requests eight distinct numbers" |
| Same `draftId` twice → same number, counter unmoved | `reserve.test.ts` "does not advance the counter on a repeat" |
| A duplicate reaching the Sheets write is rejected | `sheets/quotations-sheet.test.ts` "rejects a number already held by a different quotation" |
| Lock failure → `NUMBERING_LOCKED` | `reserve.test.ts`, `__tests__/error-codes.test.ts` |
| Editing and re-saving preserves the number | `quotation/handlers.test.ts` "keeps the number when an issued quotation is edited" |
| A client-supplied different number is rejected | `handlers.test.ts`, `save-flow.test.ts` (`QUOTATION_NUMBER_IMMUTABLE`) |
| No new number on edit | `handlers.test.ts` "keeps the original number when the date is changed after issue" |
| **Propagation into all six sinks** | `src/__tests__/integration/quotation-flow.test.ts` |

### Propagation, specifically

`src/__tests__/integration/quotation-flow.test.ts` reserves ONE number through
the real reserver and then follows it into:

1. the **PDF body** — extracted with pdfjs from the generated file,
2. the **DOCX body** — read out of `word/document.xml` after unzipping,
3. the **Sheets `Quotation No.` cell** — written by the real tracking handler,
4. the **Drive folder name**, in its file-safe form,
5. the **PDF filename**,
6. the **DOCX filename**.

The last assertion collects the number from each sink and requires the set to
have exactly one member — so a renderer that quietly formatted its own would
fail, not merely differ.

### Concurrency, specifically

A `for` loop calling `reserveQuotationNumber()` N times proves nothing about
mutual exclusion: each call finishes before the next begins, so a version with
the lock deleted passes it. `test/fakes/interleaving.ts` therefore **suspends a
request inside its own critical section** — at the moment it reads the counter,
via a hook on the fake spreadsheet — and starts every other pending request from
inside it, on the suspended one's stack. That is real re-entrancy.

The suite includes a **negative control**: the same harness with a lock that
grants every caller. It behaves differently — the intruders reach the counter,
read the value the suspended request is still holding, and are caught by the
ledger with `DUPLICATE_QUOTATION_NUMBER`. That is what proves the interleaving
is genuine rather than decorative.

The fake announces a read *after* the values are copied, not before, because the
dangerous window is the one between a read completing and the matching write.

---

## 2. Pricing and calculations

| Requirement | Where |
|---|---|
| Line amounts | `shared/money.test.ts` "matches the figures on the approved quotation" |
| Half-up rounding at exactly `0.005` | `money.test.ts` "rounds exactly one half up" |
| Fractional quantities | `money.test.ts` "rounds a fractional quantity half-up" |
| Category subtotals | `shared/totals.test.ts` "keeps a subtotal per category" |
| Subtotal, discount on and off | `totals.test.ts` "applies a discount before VAT", "treats an absent discount as zero" |
| VAT at 15% and at other rates, and off | `totals.test.ts` × 3 |
| Grand total | `totals.test.ts` "computes subtotal, VAT and grand total" |
| Printed column sums exactly across 200 lines | `totals.test.ts`, and **through the rendered model** in `src/services/document/printed-totals.test.ts` |
| No float drift across 1,000 lines | `money.test.ts` "does not drift over a thousand lines"; `printed-totals.test.ts` at 1,000 printed rows |
| Currency and quantity formatting | `money.test.ts` `formatSar` / `formatQuantity` |

`printed-totals.test.ts` is the one that matters most to a client: it parses the
**formatted strings** back out of the document model and adds them up the way a
reader with a calculator would. Correct integer arithmetic that is then printed
wrongly is still a wrong quotation.

---

## 3. Validation — every PRD §36 rule, both sides

Both tables are data, not prose, so "every rule has a passing and a failing
test" is checkable rather than claimed. Each row produces two tests, plus a
third asserting the refusal names the field the user must fix.

- **Server:** `google-apps-script/__tests__/validation-matrix.test.ts` — 9
  required-field rules and 13 rejected-value rules, driven through the real
  router at `quotation.save` with `finalize: true`.
- **Client:** `src/schemas/quotation-validation.test.ts` — the same rules through
  `quotationFormSchema` (while typing) and `validateForExport` (the §36 gate).

It also asserts what a refusal must *not* cost: no quotation number consumed,
no register row written, and every problem reported at once rather than one per
round trip.

---

## 4. Authentication and authorization

| Requirement | Where |
|---|---|
| Login success and failure | `auth-flow.test.ts`, `main.test.ts`, `e2e/auth.spec.ts` |
| Generic error messaging | `auth-flow.test.ts` "the same code AND the same words" |
| **Timing parity** | `auth-flow.test.ts` "indistinguishable in timing" — a ratio over 8 rounds; a missing dummy hash is orders of magnitude, not noise |
| Lockout, and its isolation to one email | `auth-flow.test.ts` × 2 |
| Token issue / verify / expire / revoke / renew | `auth/token.test.ts` (15 tests) |
| Inactive-user rejection | `main.test.ts` "stops a deactivated user immediately" |
| Every action's role requirement | `security/security-review.test.ts`, over the whole action table |
| Route guards | `components/common/guards.test.tsx`, `e2e/auth.spec.ts` |
| Redirect to the intended destination | `auth-flow.test.ts`, `e2e/auth.spec.ts` — **found D-3** |
| `AUTH_EXPIRED` | `auth-flow.test.ts`, `__tests__/error-codes.test.ts` |

The role is read from the `Users` sheet on every request, never from the token
claim: `auth-flow.test.ts` promotes somebody by editing the sheet and shows the
change takes effect without a new sign-in.

---

## 5. Document generation

Covered by the Phase 08/09 suites, which generate real files and re-parse them,
plus this phase's browser checks.

| Requirement | Where |
|---|---|
| Single page; multi-page | `pdf-generator.test.ts`, `pagination-rules.test.ts` |
| 60-row table across pages with a repeating header | `pdf-generator.test.ts` "spans pages for a 60-row quotation and repeats the table header"; `docx-generator.test.ts` "repeats its header row across page breaks" |
| Terms paginate without splitting an item | `pagination-rules.test.ts` "splits between items, never within one" |
| Atomic signature block | `pagination-rules.test.ts` "is atomic"; `docx-generator.test.ts` "an unsplittable two-cell table" |
| **Seal never overlaps text, asserted numerically** | `pagination-rules.test.ts` "the seal never overlaps text" (5 tests, including a positive control that detects a real intersection); `pdf-generator.test.ts` "does not let the seal overlap the details text"; `e2e/document-generation.spec.ts` measures the rendered boxes |
| Transparent seal | `pdf-generator.test.ts` "uses the alpha-keyed seal, never the opaque original" |
| Letterhead on every page | `pdf-generator.test.ts` "carries the header and footer text of the company artwork" |
| Selectable text | `pdf-generator.test.ts` "the text is real, not a picture of text" |
| Correct filenames | `quotation-flow.test.ts`; `e2e/document-generation.spec.ts` asserts the actual download name |
| PDF/DOCX parity | `docx-generator.test.ts` "parity with the PDF" (4 tests) |

---

## 6. Integrations

**Drive** — `google-apps-script/__tests__/drive-integration.test.ts` plus
`drive/quotation-storage.test.ts`:
folder creation; reuse across a simulated year of quotations (one folder per
year, one per month, no duplicates at any level); **all twelve month names**;
backdated filing under the dated month with a mocked clock in a later year;
naming from the issued number only; replace-not-duplicate on retry with the file
ids preserved; partial failure and completion of a half-filed archive; and **no
sharing call ever made**.

**Sheets** — `google-apps-script/__tests__/sheets-integration.test.ts` plus
`sheets/quotations-sheet.test.ts`:
append on first save; update in place at any register size; status preserved on
re-save; uniqueness enforced however deep the sheet; escaping of all four
formula-leading characters across every text column of every row; the Drive
hyperlink built only from a validated Drive URL; reading a register somebody has
edited by hand; and the cost of one save proved **flat** at 100, 500 and 1,000
existing rows.

---

## 7. Error handling

`google-apps-script/__tests__/error-codes.test.ts` produces every code in
IMPLEMENTATION_PLAN.md §23.1 **by driving the system into the state that causes
it** — never by constructing an `ApiError` in the test — and then fails if any
declared code has no such path.

`DRIVE_PARTIAL` is the one code the backend does not raise, deliberately: a
half-filed quotation is not a failed request, so the backend answers `ok` with
`outcome: 'partial'` and the links it does have, and `useSaveToDrive` turns that
into the client-side error. The census records this explicitly rather than
leaving a silent gap, and the browser half is proved in
`src/__tests__/integration/error-recovery.test.tsx`.

The §23.2 partial-failure semantics are covered end to end in
`error-recovery.test.tsx`, against the real backend over a faked network:

- a Drive failure never reads as a successful save, and writes no register row;
- **the quotation number stays reserved** — the counter does not move and the
  retry gets the same number back, so none is burned;
- a retry files into the same folder with no duplicate files or folders;
- a Sheets failure after a Drive success keeps the documents, reports tracking as
  failed, and is fixed by a retry that re-uploads nothing;
- a dropped connection is `NETWORK_ERROR` and burns no number; a response lost
  after the server succeeded reuses the number rather than issuing a second.

---

## 8. End-to-end — PRD §45, all 28 criteria

Playwright drives the real application in Chromium. The backend is the **real
Apps Script router** running in the test process behind an intercepted `fetch`
(`e2e/support/backend.ts`), so a response the backend cannot produce cannot
appear in a spec. **No production credential exists in the suite or is read from
the environment**, and no Google service is reachable from it.

| # | Criterion | Covered by |
|---|---|---|
| 1 | Login | `auth.spec.ts`, `full-journey.spec.ts` |
| 2 | Click New Quotation | `quotation-creation.spec.ts`, `full-journey.spec.ts` |
| 3 | Enter a client | `quotation-creation.spec.ts`, `full-journey.spec.ts` |
| 4 | Enter "Quotation For" | `quotation-creation.spec.ts`, `full-journey.spec.ts` |
| 5 | Automatic quotation number | `quotation-creation.spec.ts` "issues a quotation number only when Create quotation is pressed" |
| 6 | Select manpower / equipment / materials | `quotation-creation.spec.ts` "items in all three categories" |
| 7 | Add items | as above |
| 8 | Enter quantity | `quotation-creation.spec.ts`, `full-journey.spec.ts` |
| 9 | Select unit | `journey.ts` `addItem`, used by every spec |
| 10 | Enter price | as above |
| 11 | Add optional remarks | `full-journey.spec.ts` — **found D-4** |
| 12 | Automatic totals | `quotation-creation.spec.ts` "computes the line amount as the user types", "adds VAT at 15%" |
| 13 | Select Terms & Conditions | `quotation-creation.spec.ts`, `full-journey.spec.ts` |
| 14 | Create a new term | `quotation-creation.spec.ts` "creates a new term without leaving the quotation" |
| 15 | Closing paragraph | `journey.ts` `setClosingParagraph`, `full-journey.spec.ts` |
| 16 | Select an authorized person | `quotation-creation.spec.ts`, `full-journey.spec.ts` |
| 17 | Details and signature auto-fill | `quotation-creation.spec.ts` "fills in the signatory details as soon as one is selected" |
| 18 | Seal on the right | `document-generation.spec.ts` and `full-journey.spec.ts` — measured bounding boxes |
| 19 | Preview | `document-generation.spec.ts` × 2 — **found D-5** |
| 20 | Generate PDF | `document-generation.spec.ts` "generates a real PDF … and offers it for download" |
| 21 | Generate Word | `document-generation.spec.ts` "generates a real Word document" |
| 22 | Save both to Drive | `drive-save.spec.ts` "saves both documents and reports where they went" |
| 23 | Year → Month → Quotation Number | `drive-save.spec.ts` "creates the Year, Month and Quotation Number folders" |
| 24 | Added to Google Sheets | `sheets-tracking.spec.ts` "adds the quotation to the register when it is saved" |
| 25 | Drive folder link in Sheets | `sheets-tracking.spec.ts` × 2 (the cell, and the link on screen) |
| 26 | Change status Pending/Approved/Rejected | `sheets-tracking.spec.ts` "changes a status from the register and keeps it" |
| 27 | A second quotation with no duplicate numbering | `quotation-creation.spec.ts`, `full-journey.spec.ts` |
| 28 | Zero dummy quotations in production | `sheets-tracking.spec.ts` "starts with an empty register"; `full-journey.spec.ts` final assertions; `src/__tests__/test-data-policy.test.ts` |

`full-journey.spec.ts` walks all 28 in one uninterrupted session, because a user
does not get to restart the browser between step 11 and step 12 — state carried
wrongly from one step to the next is invisible to any suite that sets up freshly
each time.

---

## 9. Coverage and CI

Thresholds are in `vitest.config.ts` and are **enforced** — `thresholds` fails
the run — not merely reported. They are tiered so that the modules where a
mistake is most expensive are held highest, and applied **per file glob** rather
than as a project average, because a high average hides a module with none.

| Scope | Statements / Lines / Functions | Branches | Measured |
|---|---|---|---|
| `shared/**` | 95% | 92% | 96.2% / 92.8% |
| `google-apps-script/src/quotation-number/**` | 95% | 95% | 100% / 96.6% |
| Apps Script handlers (quotation, drive, sheets, auth, security, validation) | 90% | 84% | 91.7% / 84.3% |
| `src/services/**` | 90% | 85% | 91.4% / 86.1% |
| Everything else | 80% | 80% | 89.4% / 86.6% |

Whole project: **89.38%** statements and lines, **88.03%** functions, **86.59%**
branches.

### Why the branch floors are lower than the other three

This is a deliberate choice, and worth stating rather than burying.

The codebase compiles under `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, which makes `row[index] ?? ''` the idiomatic way
to read an element. Every one of those `??` is a branch **the type system has
already proved cannot be taken** — the array was measured on the line above, the
key was checked, the value came from a validator that would have thrown. Getting
a coverage tool to enter one means constructing a state the compiler says is
impossible.

The phase brief anticipates this: *"Coverage thresholds cannot be met without
testing implementation detail rather than behaviour — report the gap instead of
writing hollow tests."* So the branch floors sit at the measured level, where a
genuinely untested decision still fails the build, and statements, lines and
functions carry the required gate at 95 / 90 / 80.

Every branch that was a real decision **was** tested rather than written off —
that is what `shared/malformed-input.test.ts` (32 tests), `shared/signature.test.ts`
(17), `src/services/document/asset-loading.test.ts` (14) and
`src/__tests__/integration/library-services.test.ts` (20) are: the refusal paths
of the parsers, the PNG reader, the asset loaders and the master-data services,
none of which had been exercised at all.

`.github/workflows/ci.yml` runs typecheck → lint → build → `gas:build` →
`test:coverage` → `npm audit` on every push to `main` and `claude/**`, and E2E as
a second job. **CI uses no secret**: the E2E backend runs in-process, so there is
nothing to point at production and nothing to leak.

---

## 10. Test-data policy

`src/__tests__/test-data-policy.test.ts` reads the source tree and fails the
build if:

- any application file imports from `__fixtures__/` or `test/fakes|helpers/`
  (the ESLint `no-restricted-imports` rule is the first line; this is the one
  that cannot be silenced with an inline comment);
- any application file imports `vitest`, `@playwright/test` or
  `@testing-library/*`;
- fixture DATA — a `TEST_ONLY` string literal — appears outside `__fixtures__/`,
  `test/`, `e2e/` or a test file (a `TEST_ONLY_`-prefixed exported reset hook is
  allowed, and named so precisely to announce itself);
- a fixture that carries domain data lacks the `TEST_ONLY` marker;
- any test reads a password, secret, token or key from `process.env`;
- any test names an Apps Script endpoint that is not the intercepted one;
- test output has ever been committed.

The walk asserts it found more than 100 application files before checking
anything, so a broken traversal fails loudly instead of passing vacuously.

Generated documents go to `.test-output/`, which `.gitignore` excludes.

---

## Speed

The suite has to be fast enough that people run it, so this phase measured it
and cut what was slow without weakening a single assertion:

| | Before | After |
|---|---|---|
| `npm test`, wall clock | 127 s | **52–65 s** |
| `pdf-generator.test.ts` alone | 43.6 s | **8.7 s** |
| jsdom environment setup, all files | 42 s | **20 s** |
| `npm run test:e2e`, 58 tests | — | **~1.7 min** |
| `npm run test:coverage` (instrumented) | — | ~2 min |

**On the 60-second target, honestly:** it is met on an unloaded 4-core machine
(52 s measured) and marginally missed when the box is busy (65 s). Three
consecutive full runs before the last optimisation came in at 87 / 80 / 68
seconds — all green, none flaky. The suite grew by 96 tests in the final round
of coverage work, so the figure is a range rather than a single number, and the
range is stated rather than the best run cited.

Four changes, all of them removing waste rather than coverage:

1. **One test was 36 of those 43 seconds.** "Refuses a document that cannot be
   laid out" built a term of 120,000 characters and spent half a minute in the
   line measurer. 12,000 characters is already several pages — past the same
   threshold, through the same code path, with the same assertion.
2. **The 60-row document was generated three times** by three pagination tests
   that all wanted the same document. It is generated once in `beforeAll` now;
   a test that needs a different length still builds its own.
3. **The password material is derived once per file** rather than per test. The
   iteration count is unchanged and is imported as `MIN_PBKDF2_ITERATIONS` — an
   attempt to lower it below the floor was correctly refused by `hashPassword`,
   which is a control doing its job, and the tests take the floor rather than a
   convenient literal.
4. **A DOM only where a DOM is needed.** Two thirds of the files — every Apps
   Script suite, everything in `shared/`, the fake package — never touch one,
   and building a jsdom window costs a few hundred milliseconds per file.

The letterhead and the two font files are also read from disk once rather than
per generated document.

---

## Flakiness

Three consecutive full runs of the unit suite: **green, green, green**. Two
consecutive full runs of the E2E suite: **58 passed, 58 passed**. Nothing was
retried away — `retries: 0` in `playwright.config.ts`, and there is no retry
setting in the Vitest config either, so an intermittent failure would show as a
failure.

Two sources of intermittency were found and removed rather than tolerated:

- the E2E specs took the quotation date from the form's default, which is
  **today** — so they asserted `2026/August` in August and would have started
  failing in September. The date is pinned in `e2e/support/journey.ts` now, and
  the archive path and register date are derived from that one constant;
- one spec read a `<select>`'s options before the register had finished loading
  its rows, and got an empty list. It waits for the control now.

---

## Running it

```bash
npm run typecheck     # tsc over src, shared, test, e2e, and the Apps Script project
npm run lint          # zero warnings, including the no-.only/.skip rule
npm run build         # dist/ — the security suite reads it
npm run gas:build     # dist-gas/Code.js
npm test              # unit, component and integration
npm run test:coverage # the same, with the gates enforced
npm run test:e2e      # Playwright, Chromium
```

---

## What this phase did not do

- It did not change the quotation number format, the document layout, the Drive
  structure or the Sheets schema. Where a test disagreed with the specification,
  the test was wrong — three of my own assertions were corrected rather than the
  code (a revoked token answers `AUTH_REQUIRED` not `AUTH_INVALID`; the router
  deliberately keeps Script Property names out of ordinary error messages and
  names them only in `health`; every printed figure carries `SAR`, including the
  lines above the Grand Total).
- It did not test against a real Google account, spreadsheet or Drive folder.
  Nothing in the suite can reach one.
- It did not verify the DOCX in Microsoft Word, which remains a manual check —
  and the Arabic rendering in real Word is still unverified (an open item from
  Phase 09).

## Still open, and not a testing matter

Unchanged from earlier phases, and none of them is something a test can settle:

- **UR-01**, the filename segment ordering (`SFC-RUH-QTN-…`, the slug of the
  approved number, versus PRD §5's `SFC-QTN-RUH-…`). Must be confirmed with the
  company **before the first production save**.
- Arabic in real Microsoft Word, never visually verified.
- Shared Drive versus My Drive for the archive.
- UR-06 to UR-09, and the four PRD §20 term labels that are absent from the
  reference document.
- Real signature files. Every test uses a flat PNG; no signature has been
  fabricated (PRD §34).
