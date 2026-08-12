# Phase 10 — Google Drive

---

# Objective

Implement Google Drive as the V1 document store: automatic `Year → Month → Quotation Number` folder creation from the quotation date, upload of the generated PDF and DOCX, correct file and folder naming derived from the quotation number, folder URLs returned to the user, and retry behaviour that replaces files rather than duplicating them.

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

- Phases 08 and 09 complete and green: real PDFs and DOCXs can be produced client-side.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — **§16 (Drive architecture)**, §7.2 (file-safe naming), §15.2 (transport constraints), §15.6 (quotas), §23.2 (partial-failure semantics), §26 UR-01 and UR-15.
- `PRD/quotation-prd.md` — **§5 (folder structure)**, §10 (date drives the folders), **§30 (the save process, all 15 steps)**, §37 (error handling), §33 (security).
- `google-apps-script/src/drive/signature-storage.ts` — the private `_assets/signatures/` folder from Phase 06; reuse its Drive helpers rather than writing new ones.
- `google-apps-script/src/quotation/handlers.ts` and `src/quotation-number/*` — the save flow and the `draftId` idempotency this phase must reuse.
- `src/services/pdf/*`, `src/services/docx/*` — the generators whose output is uploaded.

---

# Implementation Scope

**In scope**

1. Get-or-create folder resolution: root → year → month → quotation number.
2. Base64 upload of the PDF and DOCX from the client to Apps Script, and blob reconstitution there.
3. File and folder naming from the file-safe quotation number.
4. Replace-in-place on retry so no duplicate file is ever created.
5. Returning `webViewLink` for the folder, the PDF, and the DOCX.
6. Frontend `Save to Google Drive` flow with progress, success, the folder link, and retry.
7. Typed Drive error handling per PRD §37.

**Out of scope** — later phases

The Google Sheets tracking row (11) — this phase returns the URLs the next phase records. Security review (12). Full test suite (13). Deployment and production Drive setup (14). Do not change the numbering, the document model, or the generators.

---

# Required Changes

## Folder structure (PRD §5, exactly)

```
Quotation Archive/
├── 2026/
│   ├── January/
│   │   └── SFC-RUH-QTN-2026-001/
│   │       ├── SFC-RUH-QTN-2026-001.pdf
│   │       └── SFC-RUH-QTN-2026-001.docx
│   └── August/
│       └── SFC-RUH-QTN-2026-004/
│           ├── SFC-RUH-QTN-2026-004.pdf
│           └── SFC-RUH-QTN-2026-004.docx
├── _assets/signatures/        (Phase 06, unchanged)
└── _backups/                  (Phase 14)
```

- Year and month come from the **quotation date**, never from a typed value and never from the system clock (PRD §10).
- Month names are the full English names shown in the PRD.
- The quotation folder and both filenames use the file-safe number from `shared/numbering.ts` `toFileSafe()`. The folder must use **the exact number the application generated** — never a recomputed or re-derived one (PRD §5).

## Folder resolution

`getOrCreateFolder(parent, name)` looks up an exact-name child before creating one. Drive permits duplicate folder names, so wrap the whole root→year→month→number resolution in a script lock keyed to the path; otherwise two concurrent saves in the same month can create two `August` folders. Keep the lock's critical section to folder resolution only — never hold it across an upload.

## Upload and idempotent retry (PRD §37)

- If a file with the target name already exists in the quotation folder, **replace its content** via the Advanced Drive Service (`Drive.Files.update` with media). This keeps the file id, the URL, and Drive's revision history — an audit trail for free.
- Only create a new file when none exists.
- A retry must never produce `SFC-RUH-QTN-2026-004 (1).pdf`.
- Reconstitute blobs with `Utilities.newBlob(Utilities.base64Decode(b64), mimeType, filename)`; MIME types are `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

## Save flow (PRD §30)

Implement the fifteen steps in order: validate; confirm a quotation number exists; generate the PDF; generate the DOCX; determine the year; determine the month; find or create the year folder; find or create the month folder; create the quotation-number folder; upload the PDF; upload the DOCX; get the folder URL; hand the metadata to the Sheets step (Phase 11 — leave a clearly-marked integration point); show success; provide a link to open the folder.

## Frontend

- `Save to Google Drive` enabled in the preview toolbar.
- A progress indicator naming the current step.
- Success shows the folder link and both file links.
- Failure shows the PRD §37 message — "Quotation was generated, but saving to Google Drive failed." — with a **Retry Upload** action reusing the same `draftId`, the same quotation number, and the same folder.
- The quotation is **not** marked saved when the upload fails.

---

# Expected Files / Components

```
google-apps-script/src/drive/{folder-resolver,quotation-storage,file-upload,
                              drive-errors,drive-urls}.ts
google-apps-script/src/quotation/handlers.ts             (extended: quotation.save uploads)
google-apps-script/src/config/properties.ts              (DRIVE_ROOT_FOLDER_ID required)

src/services/google-drive/drive-service.ts
src/hooks/useSaveToDrive.ts
src/components/quotation/{SaveToDriveButton,SaveProgress,SaveResult,RetryUpload}.tsx

*.test.ts alongside each new module
```

---

# Architecture Requirements

- Drive access happens **only** in Apps Script. The frontend never calls the Drive API and never holds a Google credential.
- Files travel as base64 in the JSON body of the existing `text/plain` POST — do not introduce multipart, a custom header, or a second transport, which would trigger a CORS preflight Apps Script cannot answer.
- Folder naming and file naming come from `shared/numbering.ts`. Do not build a name by string concatenation at a call site.
- Reuse the Phase 06 Drive helpers; do not write a second folder utility.
- The upload must not run inside the numbering lock.
- Do not add Supabase, PostgreSQL, or any database.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*`
- `quotation-implementation-plan/*`
- `google-apps-script/src/quotation-number/*` — numbering is finished.
- `google-apps-script/src/auth/*`
- `src/services/{pdf,docx,document}/*` — generation is finished; consume its output.
- `shared/{numbering,money,totals}.ts`

---

# Data Requirements

- **No test folders, files, or uploads in the production Drive.** All development and testing use a separate development root folder configured through a development deployment.
- No fake Drive URLs anywhere — not in fixtures that reach the UI, not in the Sheet, not in an error message.
- The root folder id comes from Script Properties; never hard-code a Drive id in source.
- Files are named strictly from the real quotation number.
- Test fixtures fake `DriveApp` and the Advanced Drive Service entirely; no test touches a real Drive.

---

# Security Requirements

- Every Drive action requires a valid session token verified before any Drive call.
- Validate before uploading: the quotation number matches the canonical regex; the file-safe name matches `^[A-Z0-9-]+$`; each path segment matches `^[A-Za-z0-9 _-]+$` — this closes path traversal through a crafted client name.
- Verify magic bytes on the decoded blobs: `%PDF-` for the PDF and `PK\x03\x04` for the DOCX. Reject anything else — the endpoint must not become an arbitrary file-upload service (PRD §33 item 14).
- Enforce a per-file size cap (5 MB) and a combined request cap.
- Files inherit the archive's sharing. **Never** call a sharing API, never set `ANYONE_WITH_LINK`, and never make anything public.
- Return `webViewLink` only; never a download token or an internal id beyond the file id.
- Audit every upload with the actor, the quotation number, the file ids, and the `requestId`.
- Do not log file content or base64 payloads.

---

# Validation Requirements

Before uploading:

- A quotation number exists and is valid (PRD §30 step 2).
- The quotation passes full validation (PRD §30 step 1, §36).
- Both documents were generated and are non-empty.
- The quotation date is valid, giving a real year and month.
- `DRIVE_ROOT_FOLDER_ID` is configured — otherwise fail with `CONFIG_MISSING`.

After uploading:

- Both files exist in the expected folder with the expected names.
- Both `webViewLink`s are well-formed `https://drive.google.com/` URLs.
- The folder path is exactly `root/YYYY/MonthName/FILE-SAFE-NUMBER`.

---

# Testing Requirements

With a faked Drive:

**Folders**

- Year, month, and quotation folders are created when absent.
- Existing folders are reused, never duplicated.
- The month name is the full English name derived from the quotation date.
- A quotation dated 2026-01-15 files under `2026/January`, and one dated 2026-08-11 under `2026/August`.
- Backdating files under the quotation date's folders, not today's.
- Concurrent saves in the same month produce exactly one month folder.

**Naming**

- The folder is `SFC-RUH-QTN-2026-004` for the number `SFC/RUH/QTN/2026/004`.
- Files are `SFC-RUH-QTN-2026-004.pdf` and `.docx`.
- The folder name equals the application-generated number, with no re-derivation.

**Upload and retry**

- Both files upload with the correct MIME types.
- Re-saving the same quotation **replaces** the files and keeps the same file ids — no `(1)` suffix, no second copy.
- A retry after a failed upload reuses the same folder and the same number.
- A partial failure (PDF up, DOCX failed) returns `DRIVE_PARTIAL`, and the retry uploads only what is missing.

**Security**

- A non-PDF payload claiming to be a PDF is rejected by magic bytes.
- A path-traversal attempt in a client-derived name is rejected.
- An oversized file is rejected.
- An unauthenticated request is rejected before any Drive call.
- No sharing API is ever invoked — assert the fake records zero sharing calls.

**Errors** — Drive auth failure, quota exceeded, folder-create failure, and upload failure each map to their specific code; the quotation is not marked saved on failure.

**Frontend** — progress renders; success shows the links; failure shows the PRD §37 message and a working retry.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- Drive file ids and URLs are branded types so an id cannot be used where a URL is expected.
- The upload result is a discriminated union (`success` | `partial` | `failed`) so the caller must handle the partial case.
- `npx tsc --noEmit` clean for both projects.

---

# Build Requirements

- `npm run build` and `npm run gas:build` succeed.
- Enable the Advanced Drive Service in `appsscript.json` and document it in `google-apps-script/README.md`.
- Add no frontend Drive dependency — no `googleapis`, no `gapi`.
- Verify the base64 payload stays within the Apps Script POST limits for a realistic quotation, and record the measured sizes.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- No hard-coded Drive ids or URLs.
- No `console.log` of base64 payloads.

---

# Error Handling

Per PRD §37:

- Drive upload failure → the quotation is **not** marked saved; show "Quotation was generated, but saving to Google Drive failed."; offer **Retry Upload**.
- The retry must not create duplicate files — replace-in-place guarantees this; test it.
- Codes: `DRIVE_AUTH_FAILED`, `DRIVE_QUOTA_EXCEEDED`, `DRIVE_FOLDER_CREATE_FAILED`, `DRIVE_UPLOAD_FAILED`, `DRIVE_PARTIAL`, `CONFIG_MISSING`.
- Each code maps to a specific, non-technical user message plus the `requestId`.
- A folder-lock timeout is retryable with backoff.
- A failure mid-flow never leaves a quotation record claiming URLs that do not exist.

---

# Completion Criteria

- [ ] Saving to Drive creates `Year → Month → Quotation Number` folders automatically from the quotation date.
- [ ] Both files upload with names derived from the exact application-generated quotation number.
- [ ] Existing folders are reused; no duplicates are created, including under concurrency.
- [ ] A retry replaces files instead of duplicating them.
- [ ] The folder URL and both file URLs are returned and shown.
- [ ] A failed upload does not mark the quotation saved, and retry works.
- [ ] Nothing is ever made public; no sharing API is called.
- [ ] Magic-byte, size, and path validation are enforced.
- [ ] No test data exists in the production Drive.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test` all clean.
- [ ] Committed to `claude/quotation-app-architecture-ycbwpa`.

---

# Stop Conditions

**Stop after Google Drive is green and committed.**

Do not implement the Google Sheets tracking row (Phase 11) — leave the clearly-marked integration point. Do not modify numbering, the document model, or the generators. Do not create production folders or upload real quotations.

Stop and ask the user if:

- The company confirms a different filename ordering, for example `SFC-QTN-RUH-YYYY-NNN` as written in PRD §5/§28 rather than the slug of the canonical number (`IMPLEMENTATION_PLAN.md` §26, UR-01). **Raise this before the first production save** — renaming files afterwards is disruptive.
- The archive must live in a Shared Drive rather than a personal My Drive (UR-15 and §25 R-15) — this is a deployment decision with real consequences for document ownership.
- Base64 payloads exceed the Apps Script limits for realistic quotations — report the measurements rather than silently compressing or downscaling an official document.
