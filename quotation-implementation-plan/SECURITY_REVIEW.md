# Security Review — Phase 12

A review of everything built in Phases 01–11, against **PRD §33** (twenty
requirements) and **IMPLEMENTATION_PLAN.md §19** (the security architecture).

Every row below is either evidence of a control that already existed, or a
finding and what was done about it. Nothing is marked "pass" on the strength of
having read the code: each one names the test that fails if the control
regresses.

- **Reviewed at:** commit following Phase 11 (`0452835`).
- **Method:** file-by-file read of `google-apps-script/src/`, `src/`, `shared/`,
  the ESLint and Vite configuration, `.gitignore`, `appsscript.json`, and the
  full git history; plus a written verification suite.
- **Outcome:** 8 findings. 7 fixed in this phase, 1 accepted with a rationale.

---

## Findings

| # | Severity | Finding | Resolution |
|---|---|---|---|
| **F-1** | High | **Prototype-pollution keys were rejected per validator, not at the parse boundary.** `validation/quotation-validator.ts` checked `__proto__` / `constructor` / `prototype` on the quotation and client objects only. `terms.create`, `items.create`, `persons.create`, `quotation.uploadToDrive` and every future action had no check. | Fixed. `security/sanitize.ts` refuses the keys at **any depth of any payload**, and `main.ts` calls it for every action before a handler runs. Verified in `security-review.test.ts` by looping over the whole action table. |
| **F-2** | High | **No per-token rate limiting on the expensive actions.** §19.8 requires 20/minute on `quotation.save`; only login was throttled. A signed-in client in a retry loop could spend the deployment's daily Apps Script quota, denying service to everyone. | Fixed. `security/rate-limiter.ts`: `quotation.save` 20/min, `quotation.uploadToDrive` and `persons.uploadSignature` 10/min, `quotation.recordTracking` 20/min, per session. |
| **F-3** | Medium | **No global circuit breaker.** Per-session limits do not stop several sessions, or one client rotating tokens, from exhausting the same shared quota. | Fixed. A 300/minute global window counts **every** action, including the cheap reads — hammering `quotation.list` exhausts the daily budget just as effectively as hammering `save`. |
| **F-4** | High | **No CSP or security headers shipped.** The session token lives in `sessionStorage` (§18.3, an accepted trade-off), which makes XSS the highest-value attack on this application — and there was nothing configured to raise the cost of it. | Fixed. `public/_headers` ships the full policy; Vite copies it into `dist/`. `script-src 'self'` with no `unsafe-inline` and no `unsafe-eval`. Verified in a real browser by `e2e/csp.spec.ts`, and as text by `deployment-security.test.ts`. |
| **F-5** | Medium | **ESLint did not enforce the `no-unsafe-*` family.** Nothing stopped a parsed response being used as the type it was hoped to be — the exact failure mode at an untrusted boundary. The Apps Script block also lacked `no-implied-eval`, `no-script-url` and the fixture-import restriction. | Fixed. All five `no-unsafe-*` rules are errors in both projects, plus `no-restricted-properties` for `document.write`. **Every rule passed on the existing code with no suppressions** — which is itself the finding's evidence. |
| **F-6** | Medium | **`Users` and `AuditLog` were not hidden.** §17.3 calls for them to be protected and hidden; nothing did either. Anyone the spreadsheet is shared with could read password hashes and the full audit trail. | Partly fixed. `sheet-access.ts` now hides both on creation. **Range protection is deliberately NOT applied programmatically** — `protect().removeEditors()` from a script can lock the company out of its own record system. `SECURITY.md` documents it as a manual step for the spreadsheet owner. |
| **F-7** | Low | **`allowedOrigins()` read like a control and was not one.** It was exported, tested for parsing, and called from nowhere — an origin allowlist that a future reader would reasonably assume was enforced. | Fixed by documentation, not code. An Apps Script Web App receives no request headers, so there is no `Origin` to check and no way to answer with `Access-Control-Allow-Origin`. The function now says so at its definition, and `SECURITY.md` §CORS states it plainly. |
| **F-8** | — | **No `SECURITY.md`.** The threat model, the accepted risks and the key-rotation procedures existed only inside the implementation plan. | Fixed. `SECURITY.md` added at the repository root. |

### Accepted, not fixed

| Risk | Rationale |
|---|---|
| **The Apps Script Web App is publicly reachable.** | Architectural, and inherent to the V1 stack the brief mandates: a cross-origin browser `fetch` cannot complete Google's interactive sign-in, so any access setting other than "Anyone" makes the SPA unable to call the backend at all. The boundary is the session token plus the per-action check in the router, which is verified by 33 tests. Changing this means a different backend and a different V1 architecture — see the Stop Conditions in the phase prompt. |

### Not a security issue — recorded, not fixed here

No functional bugs were found during the review that were not already recorded
against an earlier phase. The two open items are the UR-01 filename ordering and
the unverified Arabic rendering in real Microsoft Word, both already reported.

---

## PRD §33 — all twenty requirements

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Login required | **Pass** | Only `health` and `auth.login` are `public`; every other action is rejected without a token. `security-review.test.ts` → "declares only health and auth.login as public", "rejects every non-public action with no token". |
| 2 | No frontend passwords | **Pass** | No password is stored, cached or logged in the browser; `auth-service` sends and forgets. `deployment-security.test.ts` → bundle carries nothing credential-shaped. |
| 3 | No exposed Google credentials | **Pass** | The SPA has no Google SDK, no `gapi`, no `googleapis`, and no credential. All Drive and Sheets access is in Apps Script, running as the deploying account. |
| 4 | No API secrets in browser code | **Pass** | `deployment-security.test.ts` → "contains no Script Property name", checked over every text file in `dist/`. |
| 5 | Apps Script config server-side | **Pass** | Every secret is a Script Property read through `config/properties.ts`; a missing required one fails fast with `CONFIG_MISSING`. `properties.test.ts`. |
| 6 | All inputs validated | **Pass** | Server-side validators for every action; the frontend Zod schemas are convenience only. `security-review.test.ts` → "answers every action with a typed error, never an exception" over six hostile payload shapes × the whole action table. |
| 7 | Quantity validated | **Pass** | `> 0` and `<= QUANTITY_CEILING_MILLI`, server-side, per line. `quotation-validator.ts`. |
| 8 | Price validated | **Pass** | `>= 0` and `<= PRICE_CEILING_HALALAS`, server-side, per line. Integer halalas throughout — no floating-point money. |
| 9 | Client name validated | **Pass** | Required, length-capped, and formula-escaped on write. `security-review.test.ts` → "escapes an attack in every text field a quotation carries". |
| 10 | Quotation number validated | **Pass** | Canonical regex on every read and write; a client-supplied number is ignored on create and refused on update. `security-review.test.ts` → two tests. |
| 11 | Incomplete quotations rejected | **Pass** | `requireComplete` on finalize enforces PRD §36; the preview blocks export and lists the blockers. `export-validation.test.ts`. |
| 12 | Duplicate numbers prevented | **Pass** | Three layers (§17.4): the counter is the only issuer, a pre-append scan under a script lock, and a conditional-format rule. `quotations-sheet.test.ts` → "uniqueness". |
| 13 | Admin config protected | **Pass** | Role declared per action in one table, enforced in one place. `security-review.test.ts` → "rejects every Admin action for a User token", over every Admin action. |
| 14 | No arbitrary file uploads | **Pass** | Magic bytes (`%PDF-`, `PK\x03\x04`, PNG signature), size caps, and a combined request cap — all before anything reaches Drive. `security-review.test.ts` → "uploads". |
| 15 | No test quotations in production | **Pass** | No fixture is reachable from application code (lint rule, both projects). Development uses a separate spreadsheet and Drive root. Nothing in this phase touched a production resource. |
| 16 | No fake clients | **Pass** | Every client comes from a real save. Fixtures are `TEST_ONLY_`-prefixed and test-only. |
| 17 | No fake items | **Pass** | The `Items` sheet ships empty; nothing seeds it. |
| 18 | No fake history | **Pass** | The register ships empty; bootstrap writes headers and formatting only, never a row. `quotations-sheet.test.ts` → "never writes a sample row". |
| 19 | No placeholder customer data | **Pass** | No demo data anywhere in the repository. `deployment-security.test.ts` → git history carries no signature image and no generated document. |
| 20 | No silent quotation creation | **Pass** | A number is issued only on explicit finalize; the New Quotation page makes no `save` or `reserveNumber` request on mount. `new-quotation.test.tsx`. |

---

## IMPLEMENTATION_PLAN.md §19 — control by control

| § | Control | Verdict | Note |
|---|---|---|---|
| 19.1 | Threat model | **Reviewed** | Restated in `SECURITY.md` with the accepted risks. |
| 19.2 | AuthN / AuthZ | **Pass** | One table, one enforcement point; no handler self-authorises. Role read from the sheet, not the token — verified by promoting a user in the sheet only. |
| 19.3 | Input validation | **Pass, hardened** | F-1. Structural safety is now at the parse boundary for every action. |
| 19.4 | Output validation | **Pass** | Number regex, file-safe name, path segments, magic bytes — each with its own test. |
| 19.5 | Sheets injection | **Pass** | Every write site goes through `appendRow` / `setCell` / `writeRow`, all of which escape. The invariant is asserted at its strongest: **no cell in the spreadsheet begins with `=`, `+`, `-` or `@`**, with exactly one documented exception — the Drive Folder `HYPERLINK`, built from a validated Drive URL. |
| 19.6 | XSS | **Pass, hardened** | F-4, F-5. No `dangerouslySetInnerHTML`, no `eval`, no `new Function`, no `innerHTML`, no `document.write` — enforced by lint and asserted by a source scan. CSP now shipped. |
| 19.7 | Secrets | **Pass** | Bundle and full git history both clean. Rotation procedures documented in `SECURITY.md`. |
| 19.8 | Rate limiting | **Pass, hardened** | F-2, F-3. Login lockout was already correct; per-action and global limits added. Both fail **closed**. |
| 19.9 | Logging and audit | **Pass** | Every state-changing action is classified in `security/audit.ts`, and a test fails if a new action appears in neither list. No entry may contain a password, a token or a base64 payload — asserted by pattern. |

---

## Verification suite

| File | Covers |
|---|---|
| `google-apps-script/src/security/sanitize.test.ts` | Prototype pollution, nesting depth, array size, control and bidirectional characters |
| `google-apps-script/src/security/rate-limiter.test.ts` | Per-action limits, the global breaker, per-session isolation, failing closed |
| `google-apps-script/src/security/security-review.test.ts` | The whole action table: auth, forged tokens, roles, deactivation, revocation, fuzz, injection at every write site, uploads, audit completeness, response leakage, storage posture |
| `src/security/deployment-security.test.ts` | Bundle secrets, source maps, the CSP text, git history, banned DOM APIs, one-fetch-path |
| `e2e/csp.spec.ts` | The app running in Chromium under the production CSP, with console errors treated as failures |

`npm audit`: **0 vulnerabilities**, production and development trees.

---

## What this review did not do

- It did not penetration-test a live deployment. There is none yet; Phase 14
  deploys.
- It did not review the Google Workspace configuration (Drive sharing, Shared
  Drive membership, spreadsheet ACLs). Those are operational settings, and
  `SECURITY.md` lists what an operator must set.
- It did not add features, change the quotation number format, the document
  layout or the Drive structure — all of which were out of scope for a fix.
