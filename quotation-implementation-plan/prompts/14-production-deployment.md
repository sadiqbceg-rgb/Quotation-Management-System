# Phase 14 — Production Deployment

---

# Objective

Prepare the system for production and document every step required to run it: the frontend build and hosting configuration, the Google Apps Script deployment, the Drive and Sheets setup, environment variables and secrets, HTTPS and access control, backups, monitoring and logging, the deployment validation checklist, and the rollback strategy.

**Do not deploy anything unless the user explicitly instructs you to.** This phase produces deployment-ready artefacts and a runbook. Executing the runbook is the user's decision.

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

- Phases 01–13 complete and green. The application is functionally complete, hardened, and fully tested.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — **§21 (deployment)**, §22 (environment), §24 (backup), §16.2 (Shared Drive), §17 (spreadsheet structure), §19.7 (secrets), §26 (unresolved requirements that must be settled before go-live).
- `PRD/quotation-prd.md` — §33 (security), **§34 (no dummy data in production)**, §43 (V1 scope), §45 (success criteria), §46 (phase discipline).
- `SECURITY.md` and `quotation-implementation-plan/SECURITY_REVIEW.md`.
- `quotation-implementation-plan/TEST_REPORT.md`.
- `google-apps-script/appsscript.json`, `README.md`, `.clasp.json.example`.
- `.env.example`, `vite.config.ts`, the CSP/header configuration from Phase 12.
- `.github/workflows/ci.yml`.

---

# Implementation Scope

**In scope**

1. A production build configuration and verification.
2. Static-host configuration with HTTPS, security headers, SPA fallback, and caching.
3. Apps Script deployment tooling and a documented two-environment (development / production) setup.
4. A one-time production setup runbook for Drive and Sheets.
5. Secrets and environment configuration procedures.
6. Backup automation: a daily time-driven spreadsheet backup with pruning.
7. Monitoring and logging setup and an operational review procedure.
8. A deployment validation checklist mapped to PRD §45.
9. A rollback strategy for the frontend, the backend, and the data.
10. Operational documentation: `DEPLOYMENT.md`, `RUNBOOK.md`, and a user guide.

**Out of scope**

New features. Actually executing the deployment (unless explicitly instructed). Creating production accounts, uploading real signatures, or importing terms into a live spreadsheet — those are runbook steps the operator performs.

---

# Required Changes

## 1. Frontend build and hosting

- Verify the production build: minified, tree-shaken, hashed filenames, no source maps exposing backend logic, no development code, and no secret in the bundle.
- Report the bundle sizes and confirm the PDF and DOCX modules are lazily loaded.
- Host configuration for the chosen static host (Cloudflare Pages, Netlify, or Vercel static): HTTPS enforced, HSTS, the Phase 12 security headers, SPA fallback to `index.html`, long-lived caching for hashed assets, and `no-cache` for `index.html`.
- Document custom-domain setup and the certificate expectation.

## 2. Apps Script deployment

- Document the `clasp` workflow: `login`, `push`, `deploy`, and version pinning.
- **Two deployments**, each with its own Script Properties, its own spreadsheet, and its own Drive root:
  - *Development* — for testing, never touching production data.
  - *Production* — the live endpoint.
- Web App settings: **Execute as: Me**, **Who has access: Anyone**. Document explicitly in `DEPLOYMENT.md` **why** anonymous access is required (a cross-origin browser `fetch` cannot complete Google's interactive sign-in) and that the security boundary is therefore the session token and per-action authorization, not the URL.
- Document how to obtain the `/exec` URL and set it as `VITE_GAS_ENDPOINT` in the host's build environment.
- Document version pinning and how to roll a deployment back to a previous version.

## 3. Drive setup runbook

- Create a **Google Shared Drive** — not a personal My Drive — so documents survive staff changes and are not owned by one individual.
- Create the `Quotation Archive` root with `_assets/signatures/` and `_backups/`.
- Record the root folder id for `DRIVE_ROOT_FOLDER_ID`.
- Grant the Apps Script service identity write access; grant staff read access.
- Confirm nothing is publicly shared.

## 4. Sheets setup runbook

- Create the `Quotation Tracking` spreadsheet.
- Create every sheet from `IMPLEMENTATION_PLAN.md` §17: `Quotations`, `Counters`, `Idempotency`, `Users`, `Terms`, `AuthorizedPersons`, `Items`, `Clients`, `Settings`, `AuditLog`.
- Apply headers, column formats, the Status data validation, the duplicate-number conditional format, protected ranges on `Users` and `AuditLog`, and hide the system sheets.
- Record the spreadsheet id for `TRACKING_SPREADSHEET_ID`.
- **Create zero quotation rows** (PRD §34).

## 5. Secrets

- Generate `SESSION_HMAC_SECRET` and `PASSWORD_PEPPER` as ≥ 32 random bytes each, using a documented command.
- Set all Script Properties: the two secrets, `DRIVE_ROOT_FOLDER_ID`, `TRACKING_SPREADSHEET_ID`, `ALLOWED_ORIGINS`, `COMPANY_CODE=SFC`, `BRANCH_CODE=RUH`, `DOC_TYPE_CODE=QTN`.
- Document rotation for each, including the consequences: rotating the session secret logs everyone out; rotating the pepper invalidates every password and requires a reset for all users.
- Document where the company stores these secrets outside the application.

## 6. First-run provisioning (runbook steps, not executed here)

Create the first Admin with a strong generated password delivered out of band; complete Company Settings from the real letterhead details; run the Admin reference-terms import; upload the real signature images the company supplies; and create the authorized-person records.

## 7. Backups

- A daily time-driven Apps Script trigger copying the tracking spreadsheet into `Quotation Archive/_backups/YYYY-MM-DD/`, pruning copies older than 90 days.
- Document that Drive provides file revisions and a 30-day trash for the generated documents.
- Document the restore procedure and the RPO/RTO targets (RPO 24 h for the sheet, RTO under 2 h).

## 8. Monitoring and logging

- Apps Script executions and error rates via the Apps Script dashboard / Cloud Logging; document where to look and what normal looks like.
- Quota monitoring against the daily runtime limit, with the measured per-save cost from Phases 10, 11, and 13.
- Frontend error visibility and how a user reports a `requestId`.
- A weekly operational review: audit log, error rate, quota headroom, and backup success.

## 9. Deployment validation

A checklist executed after every deployment, mapped to PRD §45:

health check responds; login succeeds; a wrong password fails; a real quotation is created end to end; the number is `SFC/RUH/QTN/YYYY/###` and sequential; the PDF opens correctly with the letterhead; the DOCX opens correctly in Word; the Drive tree is `Year / Month / Number` with both files; the Sheets row is correct with a working folder link; a status change persists; a second quotation increments without duplication; the CSP does not break anything; and **zero dummy rows exist in production**.

## 10. Rollback

Frontend: redeploy the previous build through the host (seconds). Backend: re-point the production deployment id at the previous Apps Script version — safe because deployments are immutable. Data: Drive revisions and trash, spreadsheet version history, and the daily backups. Document explicitly that a rollback **never deletes an issued quotation number**, because reusing one would produce two official documents sharing an identifier.

---

# Expected Files / Components

```
DEPLOYMENT.md                                            (procedures + rationale)
RUNBOOK.md                                               (one-time setup + operations)
docs/USER_GUIDE.md                                       (for company staff)
quotation-implementation-plan/DEPLOYMENT_CHECKLIST.md
public/_headers  /  netlify.toml  /  vercel.json         (finalised)
google-apps-script/src/backup/daily-backup.ts
google-apps-script/src/monitoring/health.ts              (extended)
scripts/{verify-build,generate-secrets}.ts
.github/workflows/deploy.yml                             (manual-dispatch only)
.env.production.example
```

---

# Architecture Requirements

- The deployed architecture is exactly the V1 architecture: a static React SPA → Apps Script → Drive + Sheets. **No Supabase, no PostgreSQL, no database, no server tier.**
- Development and production are fully isolated: separate deployments, separate spreadsheets, separate Drive roots, separate secrets.
- Backend deployments are immutable and versioned so rollback is a re-point, not a re-push.
- The deploy workflow is **manual-dispatch only** — no automatic push-to-production.
- Configuration is externalised; no environment value is baked into source.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*`
- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` and `prompts/*`
- Application source — this phase adds deployment artefacts, backup and health code, and documentation. If a genuine deployment blocker is found in application code, fix it minimally and record it in `DEPLOYMENT.md`.

---

# Data Requirements

- **Production starts with zero quotations, zero clients, zero items, and zero fabricated anything** (PRD §34). The validation checklist verifies this and the phase is not complete until it does.
- The only production data created at setup is legitimate configuration: the first Admin account, Company Settings from the real letterhead, the real imported terms, and the real authorized persons with real signatures the company supplies.
- Do not create a test quotation in production. Validation uses the **development** deployment; the single production smoke test creates a real quotation the company intends to keep, or none at all — document that choice and let the operator decide.
- No example `.env.production` values that look real; the example file carries empty placeholders only.

---

# Security Requirements

- HTTPS enforced everywhere; HSTS enabled; the Phase 12 headers verified live.
- No secret in the repository, the bundle, CI logs, or the deploy configuration.
- Secrets are set through the Apps Script Script Properties UI or `clasp`, never committed.
- The production Apps Script project is owned by a company account, not a personal one.
- The Shared Drive and spreadsheet are shared only with the intended staff; nothing is public.
- Deployment credentials are stored in the host's and GitHub's secret stores.
- The security review from Phase 12 is re-verified against the production configuration.
- Document the incident procedure: how to revoke all sessions (rotate `SESSION_HMAC_SECRET`), how to disable a user, and how to take the endpoint offline.

---

# Validation Requirements

- `scripts/verify-build.ts` fails the build if `dist/` contains any Script Property name, a credential-shaped string, or a development-only marker.
- Every required Script Property is present before the production deployment is considered live — the health endpoint reports configuration completeness without revealing values.
- The deployment checklist passes end to end on the development deployment before production is touched.
- The backup trigger is verified to run and to produce a restorable copy.
- The rollback procedure is rehearsed on the development deployment and the result recorded.

---

# Testing Requirements

- The full suite from Phase 13 passes against the production build.
- A smoke suite runs against the **development** deployment: health, login, quotation creation, number generation, PDF, DOCX, Drive save, Sheets row.
- The production build is served locally and verified under the real CSP with no console errors.
- The backup function is tested with a faked `DriveApp` and `SpreadsheetApp`: it creates a dated copy and prunes copies older than 90 days.
- The health endpoint is tested for both a configured and a misconfigured state.
- Rollback is rehearsed: deploy version A, deploy version B, roll back to A, and confirm the system works and no quotation number was lost or reused.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- Deployment scripts are TypeScript, not untyped shell where a script is doing real logic.
- Configuration shapes are typed and validated at startup.
- `npx tsc --noEmit` clean for both projects and for the scripts.

---

# Build Requirements

- `npm run build` produces a clean, verified production bundle; record the sizes.
- `npm run gas:build` produces the deployable `Code.js`.
- The build is reproducible from a clean checkout with the asset pipeline running in `prebuild`.
- No development dependency ships in the production bundle.
- CI runs typecheck, lint, build, and tests; the deploy workflow is manual-dispatch only.

---

# Lint Requirements

- `npm run lint` clean across source, tests, and scripts, zero warnings.
- No hard-coded URLs, ids, or secrets in any deployment artefact.
- Markdown documentation is consistent and complete.

---

# Error Handling

- The health endpoint reports configuration completeness and reachability **without revealing secret values**.
- A missing Script Property fails fast with `CONFIG_MISSING`, naming the property, so a misconfigured deployment is obvious immediately rather than at the first save.
- Deployment scripts fail loudly with actionable messages and never leave a half-applied state.
- `RUNBOOK.md` documents the response to each of: the endpoint is down; Drive quota is exhausted; the daily Apps Script quota is exhausted; the spreadsheet is corrupted; a duplicate quotation number appears; a user is locked out; and secrets are suspected compromised.

---

# Completion Criteria

- [ ] The production build is verified, contains no secret, and is correctly sized with lazy-loaded document modules.
- [ ] Host configuration with HTTPS, HSTS, the security headers, SPA fallback, and caching is complete.
- [ ] `DEPLOYMENT.md` documents the full frontend and Apps Script deployment, including why anonymous access is required and what the real boundary is.
- [ ] `RUNBOOK.md` documents the one-time Drive and Sheets setup, provisioning, operations, and incident response.
- [ ] The backup trigger is implemented and tested.
- [ ] Monitoring, logging, and the weekly review procedure are documented.
- [ ] `DEPLOYMENT_CHECKLIST.md` maps to PRD §45 and passes on the development deployment.
- [ ] The rollback strategy is documented and rehearsed.
- [ ] `docs/USER_GUIDE.md` exists for company staff.
- [ ] Development and production are fully isolated.
- [ ] **Nothing was deployed to production** unless the user explicitly instructed it.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test`, `npm run test:e2e` all pass.
- [ ] Committed to `claude/quotation-app-implementation`.

---

# Stop Conditions

**Stop after the deployment artefacts and documentation are complete, green, and committed.**

**Do not deploy to production. Do not create production Google resources. Do not create real user accounts. Do not upload real signatures. Do not import terms into a live spreadsheet. Do not point the frontend at a production endpoint.** All of these are runbook steps for the operator.

This is the final phase. When it is complete, the V1 implementation is complete.

Stop and ask the user if:

- They want the deployment executed — get explicit confirmation, and confirm which host, which Google account owns the Apps Script project, and whether the Shared Drive exists.
- Any `IMPLEMENTATION_PLAN.md` §26 unresolved requirement is still open — particularly **UR-01 (the file-safe number format)**, which must be settled **before the first production quotation**, because renaming issued documents afterwards is disruptive.
- The company has not yet supplied the real signature images, the final closing paragraph, or the wording for the four PRD §20 terms with no reference text — the system can deploy without them, but it cannot produce a complete quotation until they exist.
