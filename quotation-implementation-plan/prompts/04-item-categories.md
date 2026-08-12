# Phase 04 — Item Categories

---

# Objective

Implement the quotation item system: the three categories (Manpower, Equipment, Materials), their dynamic tables, quantity and unit handling, rates, automatic line amounts, per-category subtotals, the overall subtotal, discount, VAT, grand total, the conditional Remarks column, and the reusable item library.

All arithmetic runs through the shared integer-money module. No floating-point currency anywhere.

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

- Phases 01–03 complete and green. The quotation form shell exists with a placeholder for the items section; `shared/money.ts` and `shared/totals.ts` exist and are tested.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — §8 (pricing and calculation), §9 (item categories), §6.1 (`LineItem`, `CategoryBlock`, `Totals`), §26 UR-04 and UR-12.
- `PRD/quotation-prd.md` — §13 (categories), §14 (manpower), §15 (equipment), §16 (materials), **§17 (conditional Remarks column)**, §18 (item management), §19 (totals), §36 (validation), §40 (item library).
- `reference/quotation-sample.pdf` — page 1. Note the real table: three columns (Manpower Category | Quantity | Rate), page-centred, spanning x 70.7 → 524.6 with rules at 70.7 / 261.9 / 361.1 / 524.1, 0.5 pt black borders, bold header row, and the `Total Manpower: 41 Persons` summary line. Note that the approved document prints **no** Amount column and **no** totals block.
- `shared/money.ts`, `shared/totals.ts`, `shared/validation-rules.ts` — reuse; do not reimplement.
- `src/components/quotation/*`, `src/hooks/useQuotationForm.ts`, `src/schemas/quotation-schema.ts` — extend.
- `google-apps-script/src/validation/quotation-validator.ts` — extend the server-side item validation and recomputation.

---

# Implementation Scope

**In scope**

1. Category selection and multi-category quotations — one table per category actually used.
2. The three table structures with their PRD-defined columns.
3. Line-item CRUD: add, edit, delete, reorder, with a stable `id` per row.
4. Quantity, unit (configurable list plus custom), and unit price inputs.
5. Automatic line amount, category subtotals, overall subtotal, optional discount, VAT (default 15%), grand total, all recomputed live.
6. The conditional Remarks column per PRD §17.
7. `pricingMode`: `amount` (default) and `rate-only` (reproduces the approved sample).
8. The per-category summary line (`Total Manpower: 41 Persons`).
9. The reusable item library (`Items` sheet + Items / Services page) — select an existing item to prefill description and unit; quantity and price are always per quotation.
10. Server-side item validation and totals recomputation.

**Out of scope** — later phases

Terms (05). Authorized persons (06). Document model and preview (07). PDF (08). DOCX (09). Drive (10). Sheets tracking row (11). Security review (12). Full test suite (13). Deployment (14).

---

# Required Changes

## Columns (PRD §14–§16)

| Category | Columns |
|---|---|
| Manpower | Sl. No. \| Designation \| Qty \| Unit \| Unit Price \| Amount \| Remarks |
| Equipment | Sl. No. \| Equipment Description \| Qty \| Unit \| Rate \| Amount \| Remarks |
| Materials | Sl. No. \| Material Description \| Qty \| Unit \| Unit Price \| Amount \| Remarks |

- **Sl. No.** always present, restarting at 1 per category table, recalculated on reorder and delete.
- **Amount** is derived and read-only. It must never be an editable input.
- **Remarks** renders only when at least one item in the whole quotation carries a non-empty remark (PRD §17). Compute this once into `showRemarksColumn` and apply it identically in the editor, the preview, the PDF, and the DOCX — a column that appears in one output and not another is a defect.
- In `rate-only` mode the table collapses to Description | Quantity | Rate, the Amount column disappears, and no totals block is produced.

## Units (configurable, PRD §16)

Seed lists, stored as configuration rather than hard-coded enums:

- Manpower: Hour, Day, Week, Month, + Custom
- Equipment: Hour, Day, Week, Month, Trip, Unit, LS, + Custom
- Materials: Nos., Unit, Set, Box, Kg, Ton, m, m², m³, LS, + Custom

A custom unit is a validated free string (1–20 characters, no control characters). It applies to the quotation immediately and may be *offered* for the master list afterwards, but is never silently promoted.

## Calculations (`IMPLEMENTATION_PLAN.md` §8)

```
amount            = roundHalfUp(quantityMilli × unitPriceHalalas / 1000)
categorySubtotal  = Σ amount within the category
subtotal          = Σ categorySubtotal
discountAmount    = roundHalfUp(subtotal × discountRateBp / 10000)      // 0 when disabled
taxableBase       = subtotal − discountAmount
vatAmount         = roundHalfUp(taxableBase × vatRateBp / 10000)        // default 1500 = 15%
grandTotal        = taxableBase + vatAmount
```

Rounding is half-up **at the line level**, then summed exactly, so the printed Amount column always adds up to the printed subtotal. Rates are basis points. Display format is `SAR 12,500.00`.

## UI

- `CategorySelector` — add a category; a category already present cannot be added twice.
- `ItemTable` — a table per category; keyboard-friendly; add-row at the bottom; delete per row with confirmation; reorder by drag or up/down buttons; live amount per row; a sticky subtotal footer.
- `ItemRow` — description (with catalog autocomplete), quantity, unit select with a Custom option, unit price, amount (read-only), remarks, delete.
- `TotalsPanel` — category subtotals, subtotal, optional discount, VAT with its rate, grand total. Hidden entirely in `rate-only` mode.
- `src/pages/items/index.tsx` — the item library CRUD, starting **empty**.

---

# Expected Files / Components

```
src/components/items/{CategorySelector,ItemTable,ItemRow,UnitSelect,QuantityInput,
                      PriceInput,AmountCell,RemarksCell,CategorySubtotal,
                      CategorySummaryLine,TotalsPanel,ItemLibraryPicker}.tsx
src/pages/items/index.tsx                               (implemented)
src/hooks/{useLineItems,useQuotationTotals}.ts
src/schemas/item-schema.ts
src/services/items/item-service.ts
src/config/units.ts

shared/totals.ts                                         (extend if needed; keep pure)
google-apps-script/src/items/handlers.ts
google-apps-script/src/sheets/items-sheet.ts
google-apps-script/src/validation/item-validator.ts
google-apps-script/src/validation/quotation-validator.ts (extended)

*.test.ts alongside each new module
```

---

# Architecture Requirements

- **All money is integer halalas; all quantities are integer thousandths.** No `parseFloat` arithmetic on currency, ever.
- Totals are computed by `shared/totals.ts` only — the same module the server uses to recompute and verify.
- The line amount is derived state. Never store a user-supplied amount and never let the two diverge.
- `showRemarksColumn` is derived once and consumed everywhere; it is not recomputed per renderer.
- Units come from configuration, not from a hard-coded union type (PRD §16 requires them to remain configurable).
- Reuse the Phase 01 UI primitives and the Phase 03 form architecture. Do not fork the form.
- Item rows carry a stable client-generated `id` so reordering does not remount inputs and lose focus.
- Do not add Supabase, PostgreSQL, or any database.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*`
- `quotation-implementation-plan/*`
- `google-apps-script/src/quotation-number/*` — numbering is finished; this phase must not touch it.
- `google-apps-script/src/auth/*`
- `shared/numbering.ts`

---

# Data Requirements

- The item library ships **empty**. The example names in PRD §40 (Carpenter, Excavator, Cement, …) illustrate the shape and must **not** be inserted as seed data — doing so would violate PRD §34.
- No sample line items, no default prices, no default quantities, no pre-filled rows. A new quotation starts with zero items.
- Unit lists are configuration, not data.
- The default VAT rate (15%) comes from Company Settings, seeded from the reference terms; it is a configuration value, not fabricated business data.
- Test fixtures are `TEST_ONLY_`-prefixed and importable only from test files.

---

# Security Requirements

- Server-side re-validation of every item and server-side recomputation of every total; reject `TOTALS_MISMATCH` on divergence.
- Enforce upper bounds server-side: quantity ≤ 1,000,000; unit price ≤ 1,000,000 SAR; ≤ 500 line items per quotation.
- Cap description, unit, and remarks lengths before any write.
- Escape leading `=`, `+`, `-`, `@` in item text written to a sheet.
- Custom units are sanitised — no control characters, no formula-leading characters.
- Item-library writes require a valid session; no anonymous mutation.

---

# Validation Requirements

Per PRD §36, reject:

- Empty designation, empty equipment description, empty material description.
- Negative quantity; zero quantity; more than 3 decimal places on a quantity.
- Negative price; more than 2 decimal places on a price.
- A missing unit, or a custom unit failing the character rules.
- Non-numeric, `NaN`, or `Infinity` input in a numeric field.
- A quotation with zero items when finalizing.
- Quantity or price above the bounds above.

Show clear, inline, per-field messages. Block document generation while any item is invalid. The same rules run client-side (Zod) and server-side, both sourced from `shared/validation-rules.ts`.

---

# Testing Requirements

**Calculations**

- `40 × SAR 20.00` → `SAR 800.00`; `5 × SAR 2,500.00` → `SAR 12,500.00`.
- Fractional quantities: `1.5 × SAR 33.33` rounds half-up correctly.
- Rounding boundaries at exactly `0.005`.
- The printed Amount column sums exactly to the printed subtotal for a 200-line quotation.
- Category subtotals across a mixed three-category quotation.
- Discount enabled and disabled; VAT enabled and disabled; VAT at 15% and at a non-default rate.
- Grand total = taxable base + VAT.
- No floating-point drift over 1,000 lines.

**Behaviour**

- Adding a category creates its table; a duplicate category cannot be added.
- Add / edit / delete / reorder keep Sl. No. contiguous and correct.
- The amount cell updates live and has no editable input.
- The Remarks column is hidden with no remarks, appears when one item has a remark, and hides again when the last remark is cleared.
- `rate-only` mode hides the Amount column and the totals panel; `amount` mode shows both.
- The category summary line reports the correct headcount.
- The unit select offers the correct list per category and accepts a custom unit.
- Selecting a library item prefills description and unit but not quantity or price.

**Validation** — every rejection rule above, client-side and server-side.

**Server** — a tampered amount triggers `TOTALS_MISMATCH`; over-bound values are rejected; formula-leading text is escaped before writing.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- Branded types for `Halalas` and `Milli` so a raw `number` cannot be passed where a minor-unit value is required.
- `ItemCategory` is a union; table column definitions are typed per category so a Materials column cannot be rendered in a Manpower table.
- `npx tsc --noEmit` clean for both projects.

---

# Build Requirements

- `npm run build` and `npm run gas:build` succeed.
- No new dependency for money, tables, or drag-and-drop unless genuinely necessary; prefer the existing primitives and native HTML5 drag or simple up/down buttons.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- No `any` in table or calculation code.
- No `parseFloat` on currency values — add a `no-restricted-syntax` rule if that helps enforce it.

---

# Error Handling

- Per-field inline messages, plus a summary at the section header showing the count of invalid rows.
- Deleting a row asks for confirmation and is undoable within the session where practical.
- A calculation error never renders `NaN` or `undefined` in the UI — it renders a clear invalid-input state.
- `TOTALS_MISMATCH` from the server surfaces as "The quotation totals could not be verified. Please reload and try again." with the `requestId`.
- An item-library fetch failure degrades gracefully: manual entry still works.

---

# Completion Criteria

- [ ] A user can add all three categories, each with its own table and correct columns.
- [ ] Add / edit / delete / reorder work; Sl. No. stays correct.
- [ ] Quantity × Unit Price = Amount, computed automatically and live.
- [ ] Category subtotals, subtotal, discount, VAT, and grand total are correct.
- [ ] All money arithmetic uses integers; no floating-point currency anywhere.
- [ ] The Remarks column appears only when a remark exists (PRD §17).
- [ ] `rate-only` mode reproduces the approved sample's table shape.
- [ ] The item library works and starts empty.
- [ ] Validation blocks every invalid case in PRD §36, client-side and server-side.
- [ ] No dummy items, prices, or quantities exist anywhere.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test` all clean.
- [ ] Committed to `claude/quotation-app-architecture-ycbwpa`.

---

# Stop Conditions

**Stop after item categories are green and committed.**

Do not implement Terms & Conditions (05), authorized persons (06), the document model or preview (07), PDF (08), DOCX (09), Drive (10), or the tracking sheet (11). Do not modify the quotation-numbering code.

Stop and ask the user if:

- The company confirms whether quotations print a totals block or quote rates only (`IMPLEMENTATION_PLAN.md` §26, UR-04) — the default is `amount` mode until they say otherwise.
- Discount turns out to be required rather than optional (UR-12).
- A category needs a Duration column separate from Quantity — neither the PRD nor the reference shows one, so do not add it speculatively.
