# Phase 08 — PDF Generation

---

# Objective

Implement production-quality PDF generation that reproduces the approved company quotation. The renderer consumes the Phase 07 `DocumentModel` and draws it onto pages whose background is the company's own `reference/letterhead.pdf`, embedded as a vector page.

Output must be real, selectable, searchable text — never a rasterised screenshot — with correct multi-page flow, repeating table headers, and a signature block that never splits and whose seal never overlaps text.

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

- Phase 07 complete and green: `DocumentModel`, `document-layout.ts`, the asset pipeline, and the preview all exist and are tested.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — **§13 (PDF architecture)**, §12 (document architecture), §2.4 (geometry), §12.3 (pagination rules).
- `PRD/quotation-prd.md` — **§27 (PDF output)**, §25 (signature/seal), §26 (letterhead), §29 (preview and buttons).
- **`reference/quotation-sample.pdf`** — the visual acceptance target. Compare your output against it page by page.
- **`reference/letterhead.pdf`** — the background page you embed.
- `src/services/document/*` — consume `buildDocumentModel`; do **not** re-derive structure.
- `src/config/document-layout.ts` — the only source of geometry.
- `src/assets/generated/` — `letterhead.pdf` and `seal-transparent.png` from the Phase 07 pipeline.

---

# Implementation Scope

**In scope**

1. `pdf-lib` + `@pdf-lib/fontkit` integration.
2. Embedding `letterhead.pdf` once and drawing it as the background of every page.
3. Embedding the Carlito font (Regular + Bold) with its OFL licence file.
4. A layout engine: text measurement, word wrapping, table rendering, numbered-list rendering, image placement, and a pagination controller implementing the Phase 07 rules.
5. Rendering every `DocumentBlock` variant.
6. Wiring the `Save as PDF` button (PRD §29) to download `SFC-RUH-QTN-YYYY-NNN.pdf`.
7. Optional `Page X of Y` in the footer band, off by default.

**Out of scope** — later phases

DOCX (09). Drive upload (10). Sheets tracking (11). Security review (12). Full test suite (13). Deployment (14). Do not change the document model — if the model is missing something the PDF needs, that is a Phase 07 defect: fix it in `build-document-model.ts` and re-run Phase 07's tests, do not patch around it in the renderer.

---

# Required Changes

## Approach (do not substitute another)

```ts
const template = await PDFDocument.load(letterheadBytes);
const out      = await PDFDocument.create();
out.registerFontkit(fontkit);
const [bg]     = await out.embedPdf(template, [0]);   // embed once, reuse per page
// per page:
const page = out.addPage([595.28, 841.89]);
page.drawPage(bg, { x: 0, y: 0, width: 595.28, height: 841.89 });
// then draw the body content inside the body box
```

Reasons this approach is mandatory, and must be recorded in a module comment:

- **Pixel-exact letterhead** — the header, red rule, logo, Vision 2030 emblem, watermark, footer rule, and all three footer columns come from the company's own vector artwork.
- **It avoids Arabic entirely** — `pdf-lib` performs no bidirectional reordering and no Arabic glyph shaping. The document's only Arabic lives in the letterhead and is already rendered as vectors. **Never attempt to draw Arabic text with `drawText`.**
- **Real text** — selectable, searchable, printable at any resolution.
- **No server** — the architecture has no Node tier.

Explicitly rejected: `html2canvas` + `jsPDF` (raster, unacceptable for official documents), `@react-pdf/renderer` (cannot embed the letterhead page), Puppeteer (needs a server).

## Coordinate system

`pdf-lib`'s origin is bottom-left; every measurement in `document-layout.ts` is top-left. Provide **one** conversion helper (`toPdfY(topY, height)`) and use it everywhere. Do not scatter `841.89 - y` arithmetic through the renderer — that is where off-by-one page bugs live.

## Layout engine (`src/services/pdf/`)

- `measureText(text, font, size)` via `font.widthOfTextAtSize`.
- A greedy word wrapper with a hard-break fallback for unbroken strings longer than the column.
- Table renderer: column widths from the model's `ColumnSpec`, per-cell wrapping, right-alignment for numeric columns, 0.5 pt `#000` borders, bold header row, page-centred table, and **header repetition on continuation pages**.
- Numbered-list renderer for terms: number at x 52, hanging text at x 70, leading 18, space-after 7.7.
- Image placement preserving aspect ratio inside the seal and signature rects.
- A flow controller that walks blocks, measures each, honours `keepTogether`, and starts a new page when the body box is exhausted.

## Signature block

Details on the left from x 34 with 25.6 pt pitch; company name in `#002060`; email in `#0563c1` underlined; the seal at (373.7, 550.9)–(492.7, 659.7); the signature image at (392.8, 676.1)–(463.0, 733.6) beside the `Signature:______________` line. Atomic: it moves whole to the next page rather than splitting. The seal uses `seal-transparent.png`, never the raw `reference/company-seal.png`, which has no alpha and would paint a white box over the watermark.

---

# Expected Files / Components

```
src/services/pdf/{pdf-generator,pdf-layout-engine,pdf-text,pdf-table,pdf-list,
                  pdf-images,pdf-pagination,pdf-coordinates,pdf-fonts}.ts
src/templates/quotation-pdf/{index,blocks}.ts
src/assets/fonts/{Carlito-Regular.ttf,Carlito-Bold.ttf,OFL.txt}
src/hooks/useGeneratePdf.ts
src/components/quotation/preview/PreviewToolbar.tsx     (Save as PDF enabled)

*.test.ts alongside each new module
e2e/pdf-generation.spec.ts                              (Playwright)
```

---

# Architecture Requirements

- Consume the Phase 07 `DocumentModel`. Do not re-derive section order, conditional columns, or pagination policy.
- All geometry from `document-layout.ts`. No magic numbers in the renderer.
- One coordinate-conversion helper.
- Generation is client-side and pure with respect to its input: the same model produces a byte-comparable PDF except for the timestamp.
- The letterhead is embedded **once** per document and reused per page — never re-embedded per page, which would multiply the file size.
- Never re-typeset Arabic.
- Do not add Supabase, PostgreSQL, or any database. Do not add a server.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*` — including `letterhead.pdf`. Read it through the generated copy; never modify the original.
- `quotation-implementation-plan/*`
- `src/services/document/build-document-model.ts` — except to fix a genuine model defect, in which case re-run the Phase 07 tests.
- `google-apps-script/src/quotation-number/*`
- `shared/{numbering,money,totals}.ts`

---

# Data Requirements

- PDFs are generated from real quotation data only.
- A draft without a number cannot produce a savable PDF — the number is required first.
- **No sample PDFs are committed to the repository.** Test output goes to a temp directory or is asserted in memory.
- Test fixtures are `TEST_ONLY_`-prefixed and importable only from test files.
- Do not embed a fabricated signature; the signature comes from the Phase 06 authenticated fetch.

---

# Security Requirements

- Fonts are bundled locally; no external font, no CDN, no network fetch at render time (the CSP forbids it).
- The signature image is fetched authenticated, held in memory, embedded, and then released. It is never written to disk, `localStorage`, or a cache.
- PDF metadata carries the quotation number, the title, and the creation date only — never the user's email, the session token, or internal ids.
- No JavaScript actions, no embedded files, and no external links beyond the mailto/website already present in the letterhead artwork.
- Cap the input: refuse to generate above 500 line items or 200 pages, with a clear message, so a malformed model cannot hang the browser.
- Do not log document content.

---

# Validation Requirements

Before generating, assert:

- The model is well-formed and every block variant is handled — an unhandled variant is a compile error via the exhaustive switch, and a runtime guard as well.
- The quotation number is present and matches `^SFC\/RUH\/QTN\/(\d{4})\/(\d{3,})$`.
- The letterhead, seal, and signature assets all loaded.
- Every required section is present.

After generating, assert:

- The page count is ≥ 1 and within the cap.
- The output begins with the `%PDF-` magic bytes.
- The byte length is plausible (> 20 KB given the embedded letterhead, < 10 MB).

---

# Testing Requirements

Generate real PDFs and re-parse them — do not assert only on the generator's internal state.

**Structure**

- Single-page quotation renders on one page.
- Multi-page quotation paginates correctly.
- A large table (60+ rows) spans pages and **repeats its header** on every continuation page.
- A long Terms & Conditions list paginates without splitting an individual term.
- The signature block never splits and moves whole when it does not fit.
- Totals appear in `amount` mode and are absent in `rate-only` mode.
- The Remarks column appears only when a remark exists.

**Fidelity**

- Every page has the letterhead: assert the header text, the footer text, and the watermark are present on each page.
- The canonical quotation number appears in the body text of page 1, extracted from the generated PDF.
- Page geometry is A4; the body content stays within x 34 → 582.4 and y 111 → 760 on every page.
- The seal rect does not intersect any text rect — assert numerically on the parsed output.
- The seal image has transparency (the alpha-keyed derivative was used).
- Brand colours are correct where used.
- Text is extractable — assert a known client name round-trips out of the PDF, proving the output is not raster.

**Filename** — the download is `SFC-RUH-QTN-YYYY-NNN.pdf`, derived from the canonical number.

**Comparison** — a Playwright test generates a quotation equivalent to `reference/quotation-sample.pdf` and asserts matching page count, section order, and meta-block labels.

**Errors** — a missing asset, an invalid model, and an oversized input each fail with a specific message.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- An exhaustive `switch` over `DocumentBlock` with a `never` default, so a new block variant cannot be silently unrendered.
- Points are a branded type so a twip or a pixel cannot be passed where a point is expected.
- `npx tsc --noEmit` clean.

---

# Build Requirements

- `npm run build` succeeds.
- Add exactly `pdf-lib` and `@pdf-lib/fontkit`. No other PDF dependency.
- Font files and the embedded letterhead are **lazy-loaded** — dynamic-import the PDF module so the main bundle does not carry them. Verify the main chunk did not grow materially and report the before/after sizes.
- Carlito ships with its OFL licence file. Calibri must not be bundled — it is not redistributable.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- No magic numbers in the renderer.
- No `console.log` of document content.

---

# Error Handling

- A missing or corrupt letterhead fails with "The company letterhead could not be loaded" and blocks generation — it never produces a plain white document.
- A missing signature blocks generation with a specific message.
- A font-embedding failure is explicit; there is no silent fallback to a default font with different metrics, which would silently change pagination.
- An out-of-memory or oversized document fails with a clear message and a suggestion to split the quotation.
- Generation failure never leaves the UI in a permanently loading state.
- Every failure is typed with a code and surfaces the `requestId`.

---

# Completion Criteria

- [ ] The PDF reproduces the approved layout from `reference/quotation-sample.pdf`.
- [ ] The letterhead appears on every page as embedded vectors.
- [ ] Text is selectable and searchable; the output is not rasterised.
- [ ] Multi-page flow, repeating table headers, and the atomic signature block all work.
- [ ] The seal is transparent and never overlaps text.
- [ ] The canonical quotation number appears in the PDF body.
- [ ] The download filename is `SFC-RUH-QTN-YYYY-NNN.pdf`.
- [ ] No Arabic text is drawn by the renderer.
- [ ] No sample PDF is committed; `reference/` is unmodified.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`, and the Playwright suite all pass.
- [ ] Committed to `claude/quotation-app-architecture-ycbwpa`.

---

# Stop Conditions

**Stop after PDF generation is green and committed.**

Do not implement DOCX (Phase 09). Do not upload to Drive (10). Do not write to the tracking sheet (11). Do not restructure the document model.

Stop and ask the user if:

- `letterhead.pdf` cannot be embedded for a concrete technical reason — the fallback in `IMPLEMENTATION_PLAN.md` §13.5 (Apps Script Drive conversion) is a significant architecture change and needs approval.
- The company rejects the visual output — get specific feedback against `reference/quotation-sample.pdf` before iterating.
- The company wants page numbers enabled by default (UR-07).
