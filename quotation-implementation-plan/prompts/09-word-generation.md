# Phase 09 — Word / DOCX Generation

---

# Objective

Implement DOCX generation that carries the same content and the same visual identity as the PDF: the letterhead reproduced as a Word header and footer with the watermark behind the text, the same tables with repeating headers, the same Terms & Conditions, the same closing paragraph, and the same signature block with the company seal on the right.

The renderer consumes the same Phase 07 `DocumentModel` as the PDF, so the two documents cannot drift apart.

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

- Phases 07 and 08 complete and green. The `DocumentModel` and the PDF renderer both exist; the PDF is the fidelity benchmark.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — **§14 (DOCX architecture)**, §12 (document architecture), §2.4 (geometry, including the twips column).
- `PRD/quotation-prd.md` — **§28 (Word output)**, §25 (signature/seal), §26 (letterhead), §29 (buttons).
- **`reference/quotation-sample.pdf`** — the visual target; note that it was produced by Microsoft Word 2021, so a faithful DOCX is achievable.
- **`reference/letterhead.pdf`** — the geometry being reproduced as a Word header and footer.
- `src/assets/generated/` — `logo.jpg`, `logo-watermark.png`, `seal-transparent.png` from the Phase 07 pipeline.
- `src/services/document/*` and `src/config/document-layout.ts` — consume; do not re-derive.
- `src/services/pdf/*` — for parity reference; do not duplicate its logic.

---

# Implementation Scope

**In scope**

1. `docx` (v9) integration, producing a `Blob` client-side.
2. A single section with A4 page setup and the measured margins in twips.
3. A header reproducing the letterhead top: logo, Arabic company name, `SPEED FALCON COMPANY` in `#d4292e`, the red rule, and the C.R. line.
4. A footer reproducing the letterhead bottom: the rule and the three-column contact block.
5. A page-centred floating watermark behind the text.
6. Rendering every `DocumentBlock` variant to Word constructs.
7. Real Word numbering for the terms list.
8. `w:tblHeader` on table header rows so Word repeats them across page breaks.
9. An unsplittable signature block with the seal and the signature image on the right.
10. Wiring the `Save as Word` button (PRD §29) to download `SFC-RUH-QTN-YYYY-NNN.docx`.

**Out of scope** — later phases

Drive upload (10). Sheets tracking (11). Security review (12). Full test suite (13). Deployment (14). Do not change the document model; a gap there is a Phase 07 defect to fix at the source.

---

# Required Changes

## Section setup

```
page size : A4 (11906 × 16838 twips)
margins   : top 2220, bottom 1640, left 680, right 258 twips     (from §2.4)
header    : default header applied to every page
footer    : default footer applied to every page
watermark : floating image, behindDocument: true, page-centred,
            318.1 × 174.9 pt, anchored to the page not the paragraph
```

Declaring the header and footer on the section is what gives Word the same every-page guarantee the PDF gets from its embedded background. Do not repeat them per page manually.

## Arabic

The header's Arabic company name is emitted as a run with `rightToLeft: true` and an Arabic-capable font (Tajawal if available, otherwise a system Arabic font); Word performs the shaping. This is the **only** place the system re-typesets Arabic, it is a fixed non-user-supplied string, and it must be visually verified once in real Word during this phase. No user content is ever emitted as RTL.

## Fonts

Calibri by name — present on the company's Word installations and metric-compatible with the Carlito used in the PDF, so both documents paginate the same way. Fonts are **not** embedded in the DOCX. Document Carlito as the fallback.

## Tables

Column widths converted from the shared point constants to twips through one helper. Borders 0.5 pt (`size: 4` eighths-of-a-point) solid black. Bold header row with `tableHeader: true`. Numeric columns right-aligned. Table centred on the page. Conditional Remarks and Amount columns exactly as the model specifies.

## Terms

A real Word numbered list via a `numbering` configuration with the reference's hanging indent (number at 52 pt, text at 70 pt → twips), so the company can edit the file afterwards and Word renumbers correctly. Do not emit literal `"1."` text.

## Signature block

A two-column borderless table with `cantSplit: true`:

- Left cell: name (bold), designation (bold), company (bold `#002060`), country, `Mobile :` + number (bold), `Email:` + address (bold `#0563c1`, underlined).
- Right cell: the seal above (119.0 × 108.8 pt), then the `Signature:______________` line with the signature image (70.2 × 57.5 pt) positioned over it.

The seal uses `seal-transparent.png`, never the raw `reference/company-seal.png`.

---

# Expected Files / Components

```
src/services/docx/{docx-generator,docx-header,docx-footer,docx-watermark,docx-table,
                   docx-terms,docx-signature,docx-styles,docx-units}.ts
src/templates/quotation-docx/{index,blocks}.ts
src/hooks/useGenerateDocx.ts
src/components/quotation/preview/PreviewToolbar.tsx      (Save as Word enabled)

*.test.ts alongside each new module
e2e/docx-generation.spec.ts                              (Playwright)
```

---

# Architecture Requirements

- Consume the Phase 07 `DocumentModel`. Do not re-derive section order, conditional columns, or content.
- All geometry from `document-layout.ts`, converted through one point→twip helper. No magic numbers.
- Header, footer, and watermark are declared once on the section.
- Generation is client-side; no server, no Google Docs conversion round-trip.
- **PDF/DOCX parity is a hard requirement**: same section order, same table columns, same term wording and order, same closing paragraph, same signature details, same quotation number. Test the parity explicitly.
- Do not add Supabase, PostgreSQL, or any database.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*` — including `existing-terms.docx`; do not use it as a template and do not modify it.
- `quotation-implementation-plan/*`
- `src/services/document/build-document-model.ts` — except to fix a genuine model defect, re-running the Phase 07 tests.
- `src/services/pdf/*` — the PDF renderer is finished; do not modify it to accommodate DOCX.
- `google-apps-script/src/quotation-number/*`
- `shared/{numbering,money,totals}.ts`

---

# Data Requirements

- DOCX files are generated from real quotation data only.
- A draft without a number cannot produce a savable DOCX.
- **No sample DOCX is committed.** Test output goes to a temp directory or is asserted in memory.
- Test fixtures are `TEST_ONLY_`-prefixed and importable only from test files.
- Do not embed a fabricated signature.

---

# Security Requirements

- No macros, no VBA, no OLE objects, no external references, no linked images — every image is embedded as bytes.
- No field codes that fetch remote content.
- Document properties carry the title and the quotation number only — never the user's email, the session token, or internal ids.
- The signature image is fetched authenticated, embedded, and released; it is never written to disk or `localStorage`.
- Cap the input at 500 line items with a clear message.
- Do not log document content.

---

# Validation Requirements

Before generating, assert the same preconditions as Phase 08: a well-formed model, a valid quotation number matching the canonical regex, all assets loaded, and every required section present.

After generating, assert:

- The output begins with the ZIP magic bytes `PK\x03\x04`.
- The package contains `word/document.xml`, a header part, and a footer part.
- The byte length is plausible (> 10 KB, < 10 MB).
- The section's page size and margins match the configured twip values.

---

# Testing Requirements

Generate real DOCX files, unzip them, and assert against the XML — do not test only the generator's internal state.

**Structure**

- `word/document.xml`, `word/header*.xml`, and `word/footer*.xml` exist and are well-formed XML.
- The section has A4 dimensions and the exact configured margins.
- The header contains the logo relationship, the company name, and the red rule.
- The footer contains all three contact columns.
- The watermark image is present with `behindDoc` set.

**Content**

- The canonical quotation number appears in the document body text.
- Client details, all category tables, terms, the closing paragraph, and the signature details are all present.
- Table header rows carry `w:tblHeader`.
- The terms list uses a real numbering definition, not literal text.
- The signature table has `cantSplit` and two cells.
- The seal and the signature images are embedded as relationships with the correct dimensions.
- Conditional Remarks and Amount columns behave as in the model.

**Parity with the PDF** — for one input, assert that the DOCX and the PDF contain the same quotation number, the same client name, the same number of table rows per category, the same term titles in the same order, and the same closing text.

**Filename** — the download is `SFC-RUH-QTN-YYYY-NNN.docx`.

**Manual verification (record the outcome in the phase report)** — open a generated file in Microsoft Word and confirm: the header and footer repeat on every page, the watermark sits behind the text, the Arabic renders correctly, table headers repeat across a page break, and the signature block does not split. Also open it in LibreOffice and note any divergence.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- An exhaustive `switch` over `DocumentBlock` with a `never` default.
- Twips are a branded type distinct from points; conversion happens in exactly one helper.
- `npx tsc --noEmit` clean.

---

# Build Requirements

- `npm run build` succeeds.
- Add exactly `docx`. No other Word-related dependency, and no `docxtemplater` — there is no `.docx` quotation template to fill.
- Dynamic-import the DOCX module so the main bundle does not carry it; report the bundle sizes before and after.
- No font is embedded in the DOCX.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- No magic numbers — all measurements from the shared constants.
- No `console.log` of document content.

---

# Error Handling

- A missing image asset fails with a specific message and blocks generation.
- A missing signature blocks generation.
- A DOCX-packaging failure surfaces a typed error, never a corrupt download.
- The UI never remains in a permanently loading state after a failure.
- If a Word feature cannot be expressed (for example an unsupported watermark configuration), fail loudly with a clear explanation rather than silently omitting it — a missing watermark is a branding defect, not a cosmetic one.

---

# Completion Criteria

- [ ] The DOCX opens cleanly in Microsoft Word and in LibreOffice.
- [ ] The letterhead header and footer repeat on every page.
- [ ] The watermark sits behind the text.
- [ ] Tables render with repeating headers.
- [ ] Terms use real Word numbering.
- [ ] The signature block does not split; the seal is on the right and is transparent.
- [ ] The canonical quotation number appears in the document.
- [ ] The download filename is `SFC-RUH-QTN-YYYY-NNN.docx`.
- [ ] PDF/DOCX parity is asserted by tests.
- [ ] No sample DOCX is committed; `reference/` is unmodified.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`, and the Playwright suite all pass.
- [ ] Manual Word verification performed and its outcome reported.
- [ ] Committed to `claude/quotation-app-implementation`.

---

# Stop Conditions

**Stop after DOCX generation is green and committed.**

Do not upload to Drive (Phase 10). Do not write to the tracking sheet (11). Do not modify the document model or the PDF renderer to suit the DOCX.

Stop and ask the user if:

- Word fidelity cannot reach an acceptable standard with `docx` — propose supplying a real `.docx` template plus `docxtemplater` before changing approach.
- The company requires the DOCX to be visually identical to the PDF down to the point, which the two formats cannot guarantee; agree the tolerance first.
- Arabic renders incorrectly in real Word — that needs a font decision from the company.
