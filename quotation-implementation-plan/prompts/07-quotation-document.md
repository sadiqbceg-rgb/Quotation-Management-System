# Phase 07 — Quotation Document

---

# Objective

Build the shared quotation **document model** and the **HTML preview** that renders it at A4 fidelity — the single source of truth that Phase 08 (PDF) and Phase 09 (DOCX) both consume.

The document structure is taken from the actual approved quotation, `reference/quotation-sample.pdf`, not from an invented layout: letterhead, quotation meta block, Scope of Work, category tables, conditional totals, Terms & Conditions, closing paragraph, signature block with the seal on the right, footer, and correct multi-page behaviour.

This phase produces **no PDF and no DOCX**. It produces the model, the layout constants, the asset pipeline, and the on-screen preview.

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

- Phases 01–06 complete and green. A quotation can carry client details, items, totals, terms, a closing paragraph, and an authorized person.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — **§12 (document architecture)**, §2.4 (all measured geometry), §2.5 (section order), §9.1 (conditional columns), §26 UR-04 / UR-05 / UR-06 / UR-07 / UR-08.
- `PRD/quotation-prd.md` — §25 (signature section), §26 (letterhead), §27 (PDF requirements), §29 (preview), §17 (conditional Remarks), §19 (totals).
- **`reference/quotation-sample.pdf`** — both pages. This is the visual acceptance target. Study the section order, the meta-block labels and their order, the numbered section headings, the table geometry, the terms list indentation, the closing paragraphs, and the signature block.
- **`reference/letterhead.pdf`** — the blank letterhead. Confirm it is a complete vector A4 page reusable as a background.
- `reference/company-logo.png` — verify it is a **JPEG** despite the extension.
- `reference/company-seal.png` — verify it has **no alpha channel**.
- `src/config/document-layout.ts` — the constants created in Phase 01; extend them.
- All Phase 03–06 components and services — the model consumes their data.

---

# Implementation Scope

**In scope**

1. `DocumentModel` — an ordered, layout-agnostic block list.
2. `buildDocumentModel(quotation, companySettings, assets)` — pure, synchronous, deterministic, fully unit-testable.
3. The asset pipeline producing the derivatives the renderers need.
4. Shared layout constants covering all measured geometry.
5. Pagination rules, expressed declaratively on the model (keep-together, allow-split, repeat-header) so Phases 08 and 09 apply the same policy.
6. The HTML preview component rendering the model at A4 with the letterhead behind it.
7. The Preview page with `Back to Edit` and `Print` (PRD §29). The `Save as PDF`, `Save as Word`, and `Save to Google Drive` buttons are rendered **disabled**, wired in Phases 08, 09, and 10.
8. Pre-export validation that blocks generation when the quotation is incomplete (PRD §36).

**Out of scope** — later phases

PDF generation (08). DOCX generation (09). Drive upload (10). Sheets tracking (11). Security review (12). Full test suite (13). Deployment (14).

---

# Required Changes

## Document model

```ts
type DocumentBlock =
  | { kind: 'meta';        rows: Array<{ label: string; value: string }> }
  | { kind: 'heading';     number: number; text: string }
  | { kind: 'paragraph';   text: string; bold?: boolean }
  | { kind: 'table';       category: ItemCategory; columns: ColumnSpec[];
                           rows: CellValue[][]; repeatHeader: true }
  | { kind: 'summaryLine'; label: string; value: string }
  | { kind: 'totals';      lines: Array<{ label: string; value: string; emphasis?: boolean }> }
  | { kind: 'termsList';   items: Array<{ title: string; body: string }> }
  | { kind: 'closing';     paragraphs: string[] }
  | { kind: 'signature';   left: string[]; sealImage: ImageRef; signatureImage: ImageRef;
                           keepTogether: true };

interface DocumentModel {
  pageSize: 'A4';
  quotationNumber: string;      // canonical SFC/RUH/QTN/YYYY/###
  fileSafeNumber: string;       // SFC-RUH-QTN-YYYY-###
  blocks: DocumentBlock[];
  showRemarksColumn: boolean;
  pricingMode: PricingMode;
}
```

`buildDocumentModel` must be pure: same input, same output, no `Date.now()`, no randomness, no I/O. That is what makes it testable and what keeps the three renderers identical.

## Section order (from the approved document)

1. Letterhead header — every page
2. Meta block — `Quotation For:` / `Quotation No.:` / `Date:` / `Attention:` / `Client:` / `Address:` (see UR-06)
3. `1. Scope of Work` — heading, intro paragraph, one table per category used, category summary lines
4. Totals — only when `pricingMode === 'amount'`
5. `2. General Terms & Conditions` — heading, numbered term list
6. Closing paragraphs
7. Signature block — details left, seal above signature on the right
8. Letterhead footer — every page

Section numbers are positional, so removing an optional section renumbers the rest correctly.

## Layout constants (`src/config/document-layout.ts`)

All values measured from the reference; each carries a comment citing its source:

```
A4 595.28 × 841.89 pt
body box: x 34 → 582.4, y 111 → 760   (left 34, right 12.9, top 111, bottom 82 pt)
twips: left 680, right 258, top 2220, bottom 1640
table: page-centred, default width 453.9, borders 0.5 pt #000, header bold, row height ≈ 33.9
terms list: number at x 52, text at x 70, leading 18, space-after 7.7
signature: details from x 34 at y 578.8 with 25.6 pt pitch
seal rect  (373.7, 550.9)–(492.7, 659.7)   119.0 × 108.8
sign rect  (392.8, 676.1)–(463.0, 733.6)    70.2 ×  57.5
watermark  (148.1, 333.5)–(466.2, 508.4)   318.1 × 174.9, page-centred
type: body 14 pt, leading 18, space-after 7.7; header 20 pt; C.R. 12 pt; footer 11/10 pt
colour: red #d4292e, navy #002060, link #0563c1, footer rule #ffbd59
```

## Asset pipeline (`scripts/prepare-assets.ts`)

Reads `reference/` **read-only** and writes to `src/assets/generated/` (git-ignored, reproducible, wired into `prebuild`):

| Output | From | Notes |
|---|---|---|
| `letterhead.pdf` | `reference/letterhead.pdf` | copied for Phase 08 embedding |
| `letterhead-preview@150dpi.png` | `reference/letterhead.pdf` | preview background |
| `logo.jpg` | `reference/company-logo.png` | **decode by magic bytes** — it is a JPEG |
| `logo-watermark.png` | same | for the Phase 09 DOCX watermark |
| `seal-transparent.png` | `reference/company-seal.png` | **alpha-key the near-white background**; the source has no alpha and would otherwise paint a white box |

The script must fail loudly if a source file is missing or has an unexpected format, and must never write into `reference/`.

## HTML preview

- Renders each page as a 595.28 × 841.89 pt box scaled to fit, with `letterhead-preview@150dpi.png` as the background and content positioned inside the measured body box.
- Applies the same pagination rules as the renderers so the page count matches the PDF.
- Uses Carlito (bundled in Phase 01/08) or a metric-compatible fallback so on-screen line breaks approximate the PDF.
- Print stylesheet: `@page { size: A4; margin: 0 }`, no UI chrome, correct page breaks (PRD §29 `Print`).
- Shows the canonical quotation number, or a clear "Will be assigned on save" for a draft.

## Pagination rules

- Never split: a table header from its first row; the signature block; a single term item.
- May split: table body rows (header repeats), long paragraphs, the terms list between items.
- The signature block is atomic and moves whole to the next page if it does not fit.
- **The seal must never overlap text** (PRD §25) — reserve its rect and flow text around or above it.
- Page numbers off by default (the approved document has none); a settings toggle enables `Page X of Y` (UR-07).

---

# Expected Files / Components

```
src/services/document/{build-document-model,document-model.types,pagination-rules,
                       asset-loader,section-builders}.ts
src/components/quotation/preview/{QuotationPreview,PreviewPage,PreviewMetaBlock,
                                  PreviewTable,PreviewTotals,PreviewTerms,
                                  PreviewClosing,PreviewSignature,PreviewToolbar}.tsx
src/pages/quotations/[id]/preview.tsx
src/config/document-layout.ts                            (extended)
src/styles/print.css
scripts/prepare-assets.ts
src/assets/generated/.gitkeep

*.test.ts alongside each new module
```

---

# Architecture Requirements

- **One model, three renderers.** `buildDocumentModel` is the only place document structure is decided. Phases 08 and 09 must consume it and must not re-derive structure, ordering, or conditional-column logic.
- The model is layout-agnostic: it describes blocks and constraints, not coordinates. Coordinates come from the shared constants at render time.
- Geometry constants are declared once. No renderer may hard-code a margin, a column width, or a colour.
- `showRemarksColumn` and `pricingMode` are resolved in the model, never re-evaluated per renderer.
- Terms are plain text throughout; the preview never uses `dangerouslySetInnerHTML`.
- Reference files are inputs to a build step, never modified.
- Do not add Supabase, PostgreSQL, or any database.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*` — read-only inputs to `scripts/prepare-assets.ts`. Do not modify, re-encode, optimise, rename, or move them.
- `quotation-implementation-plan/*`
- `google-apps-script/src/quotation-number/*`
- `google-apps-script/src/auth/*`
- `shared/{numbering,money,totals}.ts`

---

# Data Requirements

- The model is built from real quotation data only. No placeholder client, no sample items, no fabricated number.
- A draft without a number renders "Will be assigned on save" — never a fake number and never `SFC/RUH/QTN/2026/001` as a stand-in.
- The company details rendered in the document come from Company Settings, seeded from the real letterhead content, not typed into a component.
- Test fixtures are `TEST_ONLY_`-prefixed, obviously synthetic, and importable only from test files.

---

# Security Requirements

- The preview renders escaped text only; `react/no-danger` remains enforced.
- The signature image is fetched through the authenticated Phase 06 endpoint and held in memory only — never written to `localStorage` and never given a shareable URL.
- Generated assets under `src/assets/generated/` contain only company branding; no signature and no personal data is written there.
- The preview must not expose data the user is not authorized to see; it renders the open quotation only.
- Pre-export validation runs before any generation is enabled, so an incomplete quotation cannot become an official document (PRD §36).

---

# Validation Requirements

Block preview export and show a clear, actionable list when any of these is true:

- Client Name, Company Name, or Address is missing.
- Quotation For is missing.
- There are zero line items.
- Any item is invalid (Phase 04 rules).
- No authorized person is selected, or the selected person has no signature.
- The closing paragraph is empty.
- An unresolved template token remains in any term (Phase 05 warning escalates to a block before export).
- The company seal asset failed to load.

Assert structurally that the model is well-formed: block ordering matches the specification; every table has a header; the signature block is present exactly once.

---

# Testing Requirements

- `buildDocumentModel` is pure: identical input yields a deeply equal model across runs.
- Section order matches the approved document; positional numbering renumbers correctly when an optional section is omitted.
- The meta block renders the exact labels and order seen in the reference.
- Conditional behaviour: the Remarks column appears only when a remark exists; the Amount column and the totals block are absent in `rate-only` mode and present in `amount` mode.
- The canonical quotation number appears in the model and in the preview; the file-safe form is derived correctly.
- Pagination: a 3-item quotation is one page; a 60-item quotation paginates; a table crossing a boundary repeats its header; a signature block that does not fit moves whole to the next page; a term item is never split.
- Geometry: the seal rect does not intersect any text rect — assert this numerically.
- Asset pipeline: `company-logo.png` is decoded as a JPEG by magic bytes; `seal-transparent.png` has an alpha channel and transparent corners; a missing source file fails the script loudly; `reference/` is unmodified after the script runs.
- Preview: renders without crashing for one-page and multi-page quotations; the print stylesheet applies A4 with no margins; the export buttons are disabled with an explanatory tooltip in this phase.
- Validation: every blocking rule above.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- `DocumentBlock` is a discriminated union; renderers must handle every variant, enforced by an exhaustive `switch` with a `never` default.
- Layout constants are `as const` with derived literal types so a typo in a constant name is a compile error.
- `npx tsc --noEmit` clean for both projects.

---

# Build Requirements

- `npm run build` succeeds with the asset pipeline running in `prebuild`.
- `scripts/prepare-assets.ts` runs on a clean checkout and is idempotent.
- `src/assets/generated/` is git-ignored; generated binaries are never committed.
- Any image or PDF library used by the asset script is a **devDependency** — it must not ship in the browser bundle.
- Check the bundle size; the preview must not pull the whole letterhead PDF into the main chunk. Lazy-load preview assets.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- `react/no-danger` still enforced.
- No magic numbers in preview components — every measurement comes from `document-layout.ts`.

---

# Error Handling

- A missing or unreadable generated asset produces a clear build-time error naming the file, never a silently blank document region.
- A failed signature fetch blocks export with an explicit message.
- A model-build error is caught and shown as "The quotation could not be prepared for preview" plus the specific reason and the `requestId`.
- A preview render error is caught by an error boundary and never loses the form state.
- If content cannot be paginated (for example a single unbreakable block taller than a page), fail with a specific message identifying the block rather than producing a clipped document.

---

# Completion Criteria

- [ ] `buildDocumentModel` is pure, tested, and produces the approved document's section order.
- [ ] The HTML preview reproduces `reference/quotation-sample.pdf`'s layout for equivalent input.
- [ ] All geometry comes from `document-layout.ts` and is traceable to a measurement.
- [ ] The asset pipeline produces the JPEG-aware logo and the alpha-keyed seal, and leaves `reference/` untouched.
- [ ] Multi-page behaviour, repeating table headers, and the atomic signature block all work.
- [ ] The seal never overlaps text — asserted numerically.
- [ ] Conditional Remarks, Amount, and totals behave correctly.
- [ ] `Back to Edit` and `Print` work; the export buttons are present but disabled.
- [ ] Pre-export validation blocks incomplete quotations.
- [ ] `git status` shows `reference/` unmodified.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test` all clean.
- [ ] Committed to `claude/quotation-app-implementation`.

---

# Stop Conditions

**Stop after the document model and preview are green and committed.**

Do not generate a PDF (Phase 08). Do not generate a DOCX (Phase 09). Do not upload anything to Drive (10). Do not write to the tracking sheet (11). Do not install `pdf-lib` or `docx` in this phase.

Stop and ask the user if:

- The approved layout and PRD §25 disagree in a way not already resolved by `IMPLEMENTATION_PLAN.md` §26 (UR-05).
- The company wants page numbers (UR-07) or wants the client address hidden (UR-06).
- The company requires the "Scope of Work" section removed (UR-08).
- The letterhead PDF turns out to be unusable as a background — that changes the Phase 08 approach and must be raised before Phase 08 starts.
