# Phase 05 — Terms & Conditions

---

# Objective

Implement the Terms & Conditions system: a reusable master library, checkbox selection on the quotation, ordering, in-quotation creation via a modal, quotation-only edits that never touch the master library, template-token resolution, and the configurable closing paragraph.

The 11 real terms in `reference/existing-terms.docx` are the company's actual content. They are imported by an explicit Admin action — never auto-seeded, never modified in place.

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

- Phases 01–04 complete and green.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — §10 (T&C architecture), §2.6 (the 11 extracted terms), §6.1 (`QuotationTerm`), §17.3 (`Terms` sheet), §26 UR-09 and UR-11.
- `PRD/quotation-prd.md` — **§20 (library and checkboxes)**, **§21 (create new term during quotation)**, **§22 (quotation-specific terms)**, §23 (closing paragraph), §39 (default T&C in settings).
- `reference/existing-terms.docx` — read it directly. Extract all 11 terms verbatim, including the literal placeholders `{SAR  }` and `{company}`. **Read-only.**
- `reference/quotation-sample.pdf` — pages 1 and 2. Observe the rendered form: a `2. General Terms & Conditions` heading, a numbered list, each item `**Title:** body`, hanging indent with the number at x ≈ 52 and the text at x ≈ 70, and 13 client-specific terms derived from the 11 templates.
- `src/components/quotation/*`, `src/hooks/useQuotationForm.ts` — extend.
- `google-apps-script/src/main.ts`, `src/sheets/*` — extend.

---

# Implementation Scope

**In scope**

1. `Terms` sheet and the `TermTemplate` repository.
2. `terms.list`, `terms.create`, `terms.update`, `terms.deactivate`, and the Admin-only `admin.importReferenceTerms`.
3. The Terms & Conditions library page: list, create, edit, deactivate, reorder.
4. In-quotation multi-select with checkboxes (PRD §20).
5. The "+ Create New Term" modal (PRD §21) with an explicit, unchecked-by-default "Save to Library" option.
6. Quotation-only editing that marks a term as overridden and leaves the master row untouched (PRD §22).
7. User-controlled ordering, persisted on the quotation, rendered as positional numbering.
8. Template-token resolution with a closed whitelist.
9. The configurable closing paragraph, defaulting from Company Settings and editable per quotation.

**Out of scope** — later phases

Authorized persons (06). Document model and preview (07). PDF (08). DOCX (09). Drive (10). Sheets tracking (11). Security review (12). Full test suite (13). Deployment (14).

---

# Required Changes

## Library

`TermTemplate`: `id`, `title`, `bodyTemplate`, `category` (`Manpower` | `Equipment` | `Materials` | `General`), `sortOrder`, `active`, `updatedAt`, `updatedBy`.

Deletion is a **soft delete** (`active = false`) so historic quotations referencing a term remain explicable.

## Reference import (Admin only)

`admin.importReferenceTerms` inserts the 11 terms extracted from `reference/existing-terms.docx` as `TermTemplate` rows. It must be:

- explicitly invoked by an Admin, never run automatically on first load;
- idempotent — re-running it never duplicates rows;
- non-destructive — it never overwrites or modifies an existing row;
- faithful — the wording is copied verbatim, with `{SAR  }` and `{company}` converted to the canonical token syntax and nothing else reworded.

This is real company content, not dummy data. Do not paraphrase it, do not "improve" it, and do not invent additional terms.

## PRD §20 checkbox labels

The ten labels in PRD §20 (Payment Terms, Working Hours, Accommodation, Transportation, Mobilization, VAT, Quotation Validity, Manpower Replacement, Overtime, Project Specific Terms) are the selection UI and map onto library records by title. Labels with no counterpart in `existing-terms.docx` (Mobilization, Manpower Replacement, Project Specific Terms, and Transportation as a standalone) are created by the company through the normal create flow. **Do not invent their wording.**

## Tokens

Closed whitelist, resolved at document-build time by a plain map lookup:

```
{{company.name}}  {{company.vatNumber}}  {{client.companyName}}  {{client.clientName}}
{{quotation.number}}  {{quotation.date}}  {{quotation.validityDays}}  {{totals.vatRate}}
```

No expression evaluation, no `eval`, no `new Function`, no template engine that can execute code, and no dynamic property access driven by user input. An unknown token is left verbatim and reported as a validation warning — never silently blanked.

## Selection and quotation-local behaviour

- Selecting a term adds it to the quotation with the current `sortOrder`; deselecting removes it.
- Editing the title or body **inside the quotation** changes only that quotation. The record's `source` becomes `library-overridden`, the master row is untouched, and the UI shows a clear "modified for this quotation" marker with a "revert to library version" action.
- A term created in the modal is `quotation-local`. It reaches the master library **only** when the user explicitly ticks "Save to Library".
- Reordering by drag or up/down; the document numbers positionally (1, 2, 3, …).
- The quotation stores the resolved title and body text it was issued with (the snapshot rule), so later library edits cannot alter a historic document.

## Closing paragraph

Editable rich-plain-text (no HTML). Defaults from Company Settings, which is itself seeded with the two paragraphs from `reference/quotation-sample.pdf` page 2. Editable per quotation without changing the default. PRD §23 notes the final wording will be supplied later by the company, so the value must be configuration, never a hard-coded string in a component.

---

# Expected Files / Components

```
src/components/terms/{TermsSelector,TermCheckbox,TermList,TermOrderControls,
                      CreateTermModal,EditTermInline,TermOverrideBadge,
                      ClosingParagraphEditor}.tsx
src/pages/terms/index.tsx                                (implemented)
src/services/terms/terms-service.ts
src/schemas/term-schema.ts
src/hooks/useQuotationTerms.ts

shared/term-tokens.ts                                     (pure whitelist resolver)

google-apps-script/src/terms/{handlers,import-reference-terms}.ts
google-apps-script/src/sheets/terms-sheet.ts
google-apps-script/src/validation/term-validator.ts

*.test.ts alongside each new module
```

---

# Architecture Requirements

- The token resolver lives in `shared/` and is pure, so the same resolution runs in the preview, the PDF, and the DOCX. Never resolve tokens three different ways.
- Terms are **plain text**, never HTML. This keeps the XSS surface closed and keeps the PDF and DOCX renderers simple.
- Quotation-local overrides live on the quotation record, never in the master library.
- The library is soft-deleted, never hard-deleted.
- Reuse the Phase 01 Modal, Checkbox, and Textarea primitives. Do not introduce a second modal implementation.
- Do not add Supabase, PostgreSQL, or any database.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/existing-terms.docx` — **read-only.** Do not edit, rewrite, re-save, convert, or normalise it. Extract from it; leave it exactly as it is.
- `reference/*` — every other file.
- `quotation-implementation-plan/*`
- `google-apps-script/src/quotation-number/*`
- `google-apps-script/src/auth/*`
- `shared/{numbering,money,totals}.ts`

---

# Data Requirements

- The `Terms` sheet is created **empty**. The 11 reference terms arrive only through the explicit Admin import.
- Do not invent terms. Do not write filler wording for the four PRD §20 labels that have no reference text.
- Do not fabricate a closing paragraph beyond the two real paragraphs in the approved quotation, which are configuration defaults, not invented content.
- Do not create demo terms, demo term names, or demo bodies.
- Test fixtures are `TEST_ONLY_`-prefixed and importable only from test files.

---

# Security Requirements

- Terms are plain text. Never render a term through `dangerouslySetInnerHTML`; the lint rule stays enforced.
- Token resolution is a whitelist map lookup. No `eval`, no `new Function`, no dynamic indexing by a user-supplied key.
- Cap title (≤ 120 characters) and body (≤ 4,000 characters) server-side.
- Escape leading `=`, `+`, `-`, `@` before writing any term text to a sheet.
- Library mutations require a valid session; `admin.importReferenceTerms` requires the `Admin` role, enforced in the router's action table.
- Audit every library create, update, deactivate, and import with the actor and the `requestId`.
- Strip control characters from term text on input.

---

# Validation Requirements

- Title: required, 2–120 characters, unique among active library terms (case-insensitive) — a duplicate title returns a clear message.
- Body: required, 2–4,000 characters.
- `sortOrder`: an integer ≥ 0; reordering never produces a duplicate order within a quotation.
- Unknown tokens produce a warning listing them, not a silent blank.
- Selecting a term that has been deactivated since the form loaded produces a clear message rather than a silent drop.
- The same rules run client-side (Zod) and server-side, from `shared/validation-rules.ts`.

---

# Testing Requirements

- Token resolver: every whitelisted token resolves; an unknown token is preserved verbatim and reported; `{{constructor.prototype}}` and similar prototype-walking attempts resolve to nothing and are reported as unknown; no code path evaluates a string as code.
- Import: inserts exactly 11 terms; running it twice inserts nothing further; it never modifies an existing row; a `User` role is rejected with `FORBIDDEN`.
- Selection: checking adds the term, unchecking removes it, and the preview list reflects the current selection.
- Ordering: reorder persists; document numbering is positional after a reorder; removing a middle term renumbers correctly.
- Quotation-local edit: editing in the quotation does **not** change the master row — assert the master row's `updatedAt` is unchanged; the override badge appears; revert restores the library text.
- Create modal: a new term is usable immediately; without "Save to Library" the master library gains nothing; with it ticked, exactly one row is added.
- Soft delete: a deactivated term disappears from the selector but a historic quotation still renders its snapshot text.
- Closing paragraph: defaults from settings, is editable per quotation, and editing it does not change the default.
- Validation: every rule above, client-side and server-side.
- Injection: a term body of `=IMPORTXML("http://x")` is escaped before being written to a sheet.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- `QuotationTerm['source']` is a union (`'library' | 'library-overridden' | 'quotation-local'`) so override state cannot be represented ambiguously.
- The token map is a `const` object with a derived key union, so an unknown token name is a compile error at every call site that hard-codes one.
- `npx tsc --noEmit` clean for both projects.

---

# Build Requirements

- `npm run build` and `npm run gas:build` succeed.
- Do not add a templating library, a markdown renderer, or an HTML sanitiser — terms are plain text and the resolver is a map lookup.
- If a DOCX parser is used to extract the reference terms during the import implementation, run it as a one-off development script outside the shipped bundle; do not add a DOCX parsing dependency to the application.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- `react/no-danger` still enforced.
- No `eval` and no `new Function` anywhere — enforce with `no-eval` and `no-new-func` as errors.

---

# Error Handling

- A failed library load leaves the quotation usable: the user can still create quotation-local terms; show a clear non-blocking warning.
- A duplicate title returns `VALIDATION_FAILED` with a field-level message.
- A failed save inside the modal keeps the modal open with the content intact — never lose the user's typing.
- Unknown tokens produce a pre-export warning listing each one and where it appears.
- A concurrent library edit surfaces as a clear conflict message rather than a silent overwrite.

---

# Completion Criteria

- [ ] The T&C library page supports list, create, edit, deactivate, and reorder.
- [ ] The Admin import inserts the 11 real reference terms, is idempotent, and modifies nothing existing.
- [ ] `reference/existing-terms.docx` is byte-identical — verify with `git status`.
- [ ] Checkbox selection adds terms to the quotation and reflects in the live list.
- [ ] "+ Create New Term" works inline and only reaches the library when explicitly saved to it.
- [ ] Editing a term in a quotation does not modify the master library (PRD §22).
- [ ] Ordering is user-controlled and persisted.
- [ ] Tokens resolve through a closed whitelist with no code execution.
- [ ] The closing paragraph is configurable and editable per quotation.
- [ ] No invented terms and no dummy data exist anywhere.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test` all clean.
- [ ] Committed to `claude/quotation-app-implementation`.

---

# Stop Conditions

**Stop after Terms & Conditions are green and committed.**

Do not implement authorized persons (06), the document model or preview (07), PDF (08), DOCX (09), Drive (10), or the tracking sheet (11). Do not modify the quotation-numbering code.

Stop and ask the user if:

- The company supplies the final closing-paragraph wording (`IMPLEMENTATION_PLAN.md` §26, UR-09) — until then the approved document's wording is the default.
- The four PRD §20 labels with no reference text need wording — that must come from the company, not from you.
- Full term versioning is required beyond the snapshot rule; that is a scope change.
