# Phase 06 — Authorized Persons

---

# Objective

Implement the Authorized Persons (signatory) library: person records with name, designation, company, country, email, phone and a signature image; Admin-only management including secure signature upload; active/inactive status; and selection on a quotation that automatically fills every display field so the user never retypes them.

**The repository contains no signature image files.** This phase builds the upload capability and ships the library **empty**. Under no circumstances is a signature fabricated, drawn, generated, or extracted from `reference/quotation-sample.pdf`.

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

- Phases 01–05 complete and green.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — §11 (authorized person architecture), §6.1 (`AuthorizedPersonSnapshot`), §6.3 (snapshot rule), §17.3 (`AuthorizedPersons` sheet), §2.3 D-4, §25 R-6.
- `PRD/quotation-prd.md` — **§24 (authorized person / signatory)**, **§25 (signature section layout)**, §33 item 14 (no arbitrary file uploads), §39 (admin configuration).
- `reference/quotation-sample.pdf` page 2 — the real signature block: details on the left at x 34 (name / designation / company in navy `#002060` / country / mobile / email in `#0563c1`), the seal at (373.7, 550.9)–(492.7, 659.7), and the signature image at (392.8, 676.1)–(463.0, 733.6) beside the `Signature:______________` line. **Read-only — do not extract the signature image into the repository.**
- `google-apps-script/src/auth/*` — reuse the role model. An *authorized person* is a signatory record; it is **not** a login account. Keep them separate.
- `src/components/quotation/*`, `src/components/common/*` — reuse.

---

# Implementation Scope

**In scope**

1. `AuthorizedPersons` sheet and repository.
2. `persons.list` (User), and the Admin-only `persons.create`, `persons.update`, `persons.deactivate`, `persons.uploadSignature`, `persons.getSignature`.
3. The Authorized Persons page (Admin-only route) with list, create, edit, activate/deactivate, and signature upload with preview.
4. Signature storage in a private Drive folder, referenced by file id — never by a public URL.
5. An authenticated signature-fetch endpoint returning base64, cached in memory only on the client.
6. Quotation-side selection: a dropdown of active persons that auto-fills name, designation, company, country, email, phone and the signature image, all read-only.
7. Snapshotting the selected person onto the quotation.
8. Validation on both sides.

**Out of scope** — later phases

The document model and preview layout (07) — this phase provides the data and the image, not the document geometry. PDF (08). DOCX (09). Drive quotation folders (10) — this phase only creates the private `_assets/signatures/` folder. Sheets tracking (11). Security review (12). Full test suite (13). Deployment and real signature upload (14).

---

# Required Changes

## Record

`AuthorizedPerson`: `id`, `name`, `designation`, `companyName`, `country`, `email`, `phone`, `signatureFileId`, `active`, `createdAt`, `updatedAt`.

The `country` field comes from the approved document's signature block ("Kingdom of Saudi Arabia"), which PRD §24 does not list. It is present in the real document, so it is part of the record.

## Signature images

- Format: **PNG with an alpha channel**, ink only, tightly cropped, ≥ 600 px wide, ≤ 1 MB.
- Stored in Drive at `Quotation Archive/_assets/signatures/`, private, referenced by file id.
- Never made public, never shared by link, never embedded in a public URL.
- Upload is Admin-only. The server verifies the **magic bytes** (`89 50 4E 47 0D 0A 1A 0A`), not the declared MIME type or the filename extension (PRD §33 item 14).
- Replacing a signature creates a **new** Drive file and updates `signatureFileId`. The old file is not overwritten, so historic quotations keep resolving to the image they were issued with.
- The upload UI shows a live preview, the detected dimensions, and a transparency check, and warns when the image has no alpha channel (a signature on an opaque white background will paint a white box over the letterhead).

## Selection on a quotation

- A dropdown of **active** persons only. Inactive persons stay resolvable for historic quotations but are not offered for new ones.
- On selection, every display field is filled automatically and rendered **read-only** — PRD §24 requires that the user never retypes them.
- The signature image is fetched through the authenticated endpoint and shown in the form.
- The selected person is **snapshotted** onto the quotation (`IMPLEMENTATION_PLAN.md` §6.3), so editing the person later never alters a quotation already issued.

## Signature-section data contract

This phase must expose exactly what Phase 07 needs, and nothing more: the six text lines, the signature image bytes, and the layout intent recorded from the reference — details on the left, seal and signature on the right. Do not implement the layout here.

---

# Expected Files / Components

```
src/pages/signatories/index.tsx                          (implemented, Admin-only route)
src/components/signatories/{PersonList,PersonForm,SignatureUpload,SignaturePreview,
                            PersonSelector,PersonDetailsCard,ActiveToggle}.tsx
src/services/signatories/signatory-service.ts
src/schemas/person-schema.ts
src/hooks/useAuthorizedPersons.ts

google-apps-script/src/persons/handlers.ts
google-apps-script/src/sheets/persons-sheet.ts
google-apps-script/src/drive/signature-storage.ts
google-apps-script/src/validation/person-validator.ts
google-apps-script/src/validation/image-validator.ts     (magic-byte verification)

*.test.ts alongside each new module
```

---

# Architecture Requirements

- An authorized person is **not** a user account. Do not merge the `Users` and `AuthorizedPersons` sheets, and do not let a person record grant login access.
- Signature binaries live in Drive; only the file id lives in the sheet. Never store base64 image data in a spreadsheet cell.
- Signature retrieval is authenticated. There is no public image URL anywhere in the system.
- The quotation stores a snapshot of the person, plus `signatureFileId` by reference.
- Reuse the Phase 02 role model and the Phase 01 UI primitives.
- Do not add Supabase, PostgreSQL, or any database.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*` — in particular, **do not extract the signature image embedded in `reference/quotation-sample.pdf`** (xref 39). It belongs to a real person and must not enter the codebase.
- `quotation-implementation-plan/*`
- `google-apps-script/src/quotation-number/*`
- `google-apps-script/src/auth/*` — consume the role model; do not modify it.
- `shared/{numbering,money,totals}.ts`

---

# Data Requirements

- **The Authorized Persons library ships empty.** No default person, no "Person 1"/"Person 2" from PRD §24's illustrative example, no sample signatory.
- **No fabricated signatures of any kind** — not drawn, not generated, not a font rendering of a name, not extracted from the reference PDF, not a placeholder image.
- Real signatures are uploaded by an Admin during the Phase 14 production setup, after the company supplies the files.
- Do not use the real person named in `reference/quotation-sample.pdf` as seed data. Their details are reference evidence, not fixtures.
- Test fixtures use obviously synthetic names (`TEST_ONLY_Signatory`) and a tiny generated 1×1 transparent PNG, live in `__fixtures__/`, and are importable only from test files.

---

# Security Requirements

- `persons.create`, `persons.update`, `persons.deactivate`, and `persons.uploadSignature` are **Admin-only**, enforced in the router's action table.
- `persons.list` returns text fields only — never image bytes and never internal Drive paths.
- Signature bytes are served only through an authenticated action, only for an active session, and are never cached to disk or to `localStorage` on the client.
- Upload validation before the file touches Drive: PNG magic bytes, ≤ 1 MB, decodable dimensions within sane bounds, and a filename sanitised to `^[A-Za-z0-9._-]+$`. Reject everything else (PRD §33 item 14).
- The `_assets/signatures/` folder is never shared, never made link-accessible, and never returned as a public URL.
- Audit every person create, update, deactivate, and signature upload with the actor and the `requestId`.
- Do not log email addresses or phone numbers beyond what the audit record requires.
- A quotation may only reference an authorized person that exists; a client-supplied arbitrary snapshot is re-validated server-side against the stored record.

---

# Validation Requirements

- Name: required, 2–100 characters.
- Designation: required, 2–100 characters.
- Company Name: required, 2–150 characters.
- Country: required, 2–100 characters.
- Email: required, valid format, ≤ 254 characters.
- Phone: required, 7–20 characters, digits and `+ - ( ) space` only.
- Signature: required before a person may be selected on a quotation; a person without one is listed but not selectable, with a clear reason shown.
- Finalizing a quotation requires a selected authorized person (PRD §36).
- Deactivating a person is blocked with a clear message if they are the selected signatory on an in-progress draft; historic quotations are unaffected.
- The same rules run client-side (Zod) and server-side, from `shared/validation-rules.ts`.

---

# Testing Requirements

- CRUD: create, update, deactivate, and reactivate a person; `updatedAt` moves; `createdAt` does not.
- Role enforcement: a `User` token is rejected with `FORBIDDEN` on every mutating action and on signature upload; `persons.list` succeeds for a `User`.
- Upload validation: a valid transparent PNG is accepted; a JPEG renamed `.png` is **rejected by magic bytes**; a 2 MB file is rejected; a non-image payload is rejected; a path-traversal filename is sanitised.
- A PNG without an alpha channel is accepted but flagged with a warning.
- Replacing a signature creates a new Drive file id and leaves the previous file intact.
- Selection auto-fills all six fields; every field is read-only, with no editable input in the DOM.
- Only active persons appear in the selector; an inactive person still resolves on a historic quotation.
- Snapshot: changing a person's designation after a quotation was issued does not change that quotation's rendered designation.
- The signature endpoint refuses an unauthenticated request.
- Validation: every rule above, client-side and server-side.
- No test writes a real signature file to Drive; Drive is faked.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- Distinguish `AuthorizedPerson` (the library record) from `AuthorizedPersonSnapshot` (what a quotation stores) as separate types, so a live record cannot be silently persisted where a snapshot belongs.
- Signature bytes are typed as `Uint8Array` / base64 `string` behind a branded type, never a bare `string` that could be confused with a URL.
- `npx tsc --noEmit` clean for both projects.

---

# Build Requirements

- `npm run build` and `npm run gas:build` succeed.
- No image-processing dependency is needed — dimension reading from a PNG header is a few lines, and no resizing happens in this phase.
- No signature binary is committed to the repository.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- `react/no-danger` still enforced.
- No `console.log` of image data or personal contact details.

---

# Error Handling

- An upload failure keeps the form state and offers retry; a partial upload never leaves a person record pointing at a non-existent file id.
- A signature fetch failure shows a clear placeholder in the **editor** and blocks document generation with an explicit message — it must never silently produce a document with a missing signature.
- A missing `signatureFileId` on an otherwise valid person yields a specific message, not a generic failure.
- Drive errors map to `DRIVE_UPLOAD_FAILED` / `DRIVE_AUTH_FAILED` with a retry action.
- Deactivating a person in use returns a clear `VALIDATION_FAILED` explaining which draft blocks it.

---

# Completion Criteria

- [ ] Admin can create, edit, deactivate, and reactivate authorized persons.
- [ ] Signature upload works, is Admin-only, and validates by magic bytes.
- [ ] Signatures are stored privately in Drive and served only through an authenticated endpoint.
- [ ] Selecting a person auto-fills all details read-only (PRD §24).
- [ ] Only active persons are selectable; historic quotations still resolve inactive ones.
- [ ] The person is snapshotted onto the quotation.
- [ ] The library ships **empty** with **zero** fabricated signatures.
- [ ] No signature image was extracted from `reference/quotation-sample.pdf`.
- [ ] `git status` shows `reference/` unmodified.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test` all clean.
- [ ] Committed to `claude/quotation-app-architecture-ycbwpa`.

---

# Stop Conditions

**Stop after authorized persons are green and committed.**

Do not implement the signature-block layout, the document model, or the preview (Phase 07). Do not implement PDF (08) or DOCX (09). Do not create quotation Drive folders (10). Do not build the tracking sheet (11). Do not upload real signatures — that happens in the Phase 14 production runbook once the company supplies them.

Stop and ask the user if:

- The company supplies signature files and asks for them to be committed to the repository — they must go to Drive through the upload flow, not into git.
- A signature is supplied only as an opaque JPEG or a scan with a white background — that needs a background-removal decision from the company before it can be used over the letterhead.
- Authorized persons are expected to log in — that would merge two deliberately separate concepts and is a scope change.
