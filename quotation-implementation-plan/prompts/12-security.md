# Phase 12 — Security

---

# Objective

Conduct a full security review and hardening pass across everything built in Phases 01–11, and close every gap found. This is an audit-and-fix phase, not a feature phase.

The central fact driving it: the Google Apps Script Web App is deployed for anonymous access, so **its URL is publicly reachable**. The session token and the per-action authorization check are the only real boundary between the internet and the company's Drive and Sheets.

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

- Phases 01–11 complete and green. The application is functionally complete end to end.

---

# Files to Inspect

Review **all** of it — that is the point of this phase:

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — **§19 (security architecture, every subsection)**, §18 (authentication), §15.1–15.2 (public endpoint, transport), §23 (errors), §25 (risks R-8 through R-11).
- `PRD/quotation-prd.md` — **§33 (all 20 security requirements)**, §34 (no dummy data), §35 (no accidental creation), §36 (validation), §37 (error handling).
- Every file under `google-apps-script/src/` — auth, router, handlers, validators, Drive, Sheets, config.
- Every file under `src/services/`, `src/contexts/`, `src/hooks/`, `src/schemas/`.
- `shared/*`.
- `eslint.config.js`, `vite.config.ts`, `.env.example`, `.gitignore`, `google-apps-script/appsscript.json`.
- The full git history for accidentally committed secrets.

---

# Implementation Scope

**In scope**

1. A written security review of every area in PRD §33 and `IMPLEMENTATION_PLAN.md` §19.
2. Fixing every gap found.
3. Adding the security controls not yet implemented: the CSP and security headers, complete rate limiting, a centralised sanitisation layer, and audit-log completeness.
4. A verification test suite for each control.
5. A `SECURITY.md` documenting the model, the controls, the accepted risks, and the operational procedures.

**Out of scope**

New features of any kind. UI redesign. Performance work unrelated to a security control. Full test-suite expansion (13). Deployment (14). If the review finds a functional bug that is not a security issue, record it and report it — do not fix it here.

---

# Required Changes

## 1. Authentication and authorization

- Confirm **every** action verifies the token before touching Drive or Sheets. Enumerate the action table and assert there is no unprotected path other than `auth.login` and `health`.
- Confirm role checks are centralised in the router and that no handler self-authorises.
- Confirm an inactive user's existing token stops working immediately.
- Confirm token expiry, revocation, and renewal all behave correctly.
- Verify the password hash parameters (salt, pepper, iteration count) and constant-time comparison.
- Verify login-timing parity between an unknown email and a wrong password.

## 2. Input validation

- Confirm every action re-validates server-side; frontend validation is never the only check.
- Confirm the server recomputes all totals and rejects `TOTALS_MISMATCH`.
- Confirm the quotation number is ignored on update and cannot be client-supplied.
- Confirm every string field has a length cap and every numeric field has bounds.
- Add a fuzz pass: oversized strings, deeply nested objects, unexpected types, null and undefined, unicode control characters, and prototype-pollution keys (`__proto__`, `constructor`, `prototype`) against every action.

## 3. Output validation and injection

- Confirm formula-injection escaping is applied to **every** value written to any sheet — audit every write site, not just the quotation row.
- Confirm hyperlink construction validates the URL.
- Confirm path segments are validated before any Drive folder creation.
- Confirm uploaded blobs are magic-byte verified.
- Confirm no response leaks internal ids, sheet ranges, row indices, or stack traces.

## 4. XSS and frontend hardening

- Confirm zero occurrences of `dangerouslySetInnerHTML`, `eval`, `new Function`, and `document.write`, and that the lint rules enforce it.
- Add the CSP and security headers as static-host configuration (`_headers` / `netlify.toml` / `vercel.json`, matching the chosen host) and document them:

```
Content-Security-Policy: default-src 'self';
  script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  connect-src 'self' https://script.google.com https://script.googleusercontent.com;
  object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

- Verify the app still functions under the CSP — a CSP that breaks the app gets disabled in production, which is worse than none.

## 5. Secrets

- Confirm no secret is in the frontend bundle: build, then grep `dist/` for every Script Property name and any credential-shaped string.
- Confirm `.env*` (except `.env.example`) and `.clasp.json` are git-ignored and have never been committed — check the whole history, not just the working tree.
- Confirm all backend secrets come from Script Properties, and that a missing one fails fast.
- Document the rotation procedure for `SESSION_HMAC_SECRET` and `PASSWORD_PEPPER`, including the effect of each (rotating the session secret logs everyone out; rotating the pepper invalidates all passwords and requires a reset).

## 6. Rate limiting

- Confirm login throttling works.
- Add per-token throttling for `quotation.save` (20/minute) and `persons.uploadSignature` (10/minute).
- Add a global circuit breaker so a runaway client cannot exhaust the daily Apps Script quota.

## 7. Logging and audit

- Confirm every state-changing action writes an audit entry with the actor, the action, the target, the outcome, and the `requestId`.
- Confirm no log contains a password, a token, a full payload, or base64 file content.
- Confirm client-facing errors are generic while the detail stays in Cloud Logging.

## 8. Drive and Sheets access

- Confirm nothing is ever made public and no sharing API is called anywhere.
- Confirm the signature folder is private and served only through the authenticated endpoint.
- Confirm the `Users` and `AuditLog` sheets are protected and hidden.

## 9. CORS reality

Document plainly in `SECURITY.md` that Apps Script cannot enforce an origin allowlist through CORS headers, that `ALLOWED_ORIGINS` is defence in depth only, and that the actual boundary is the token plus per-action authorization.

---

# Expected Files / Components

```
SECURITY.md                                              (new)
quotation-implementation-plan/SECURITY_REVIEW.md         (new — findings and resolutions)
public/_headers  or  netlify.toml  or  vercel.json       (host-appropriate CSP config)
google-apps-script/src/security/{rate-limiter,sanitize,audit}.ts   (consolidated)
google-apps-script/src/main.ts                           (hardened)
eslint.config.js                                          (additional security rules)
src/services/api/client.ts                                (hardened)

*.test.ts security suites alongside each control
```

---

# Architecture Requirements

- Security controls are **centralised**: one sanitiser, one rate limiter, one audit writer, one authorization table. A control implemented per handler is a control that will be forgotten in the next handler.
- No new attack surface: this phase adds no endpoint, no upload path, no public URL.
- Fixes must not weaken functionality — every fix keeps its feature's tests green.
- Do not add Supabase, PostgreSQL, or any database.
- Do not add a security dependency that pulls in a large transitive tree; prefer explicit code for the small checks involved.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*`
- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` and `prompts/*`

Everything else is in scope for hardening, but functional behaviour must be preserved — a security fix that changes the quotation number format, the document layout, or the Drive structure is out of scope and must be raised instead.

---

# Data Requirements

- **No dummy production data** — verify PRD §34 holds: confirm the production spreadsheet has zero quotation rows, the production Drive has no test folders, and no fixture is reachable from an application code path.
- Verify the fixture-import lint rule is active and passing.
- Security tests use synthetic payloads only; no test touches production Drive or Sheets.
- Do not create a test user, quotation, or upload in any production resource while testing.

---

# Security Requirements

This phase's requirements are its scope. Every item in PRD §33 must be verified and the verification recorded:

1. Login required — verified. 2. No frontend passwords — verified. 3. No exposed Google credentials — verified. 4. No API secrets in browser code — verified. 5. Apps Script config server-side — verified. 6. All inputs validated — verified. 7. Quantity validated. 8. Price validated. 9. Client name validated. 10. Quotation number validated. 11. Incomplete quotations rejected. 12. Duplicate numbers prevented. 13. Admin config protected. 14. No arbitrary file uploads. 15. No test quotations in production. 16. No fake clients. 17. No fake items. 18. No fake history. 19. No placeholder customer data. 20. No silent quotation creation.

Each gets an explicit pass/fail with evidence in `SECURITY_REVIEW.md`.

---

# Validation Requirements

- Every action rejects malformed input with `VALIDATION_FAILED` and never with an unhandled exception.
- Prototype-pollution keys are stripped or rejected at the parse boundary.
- Numeric bounds and string caps are enforced server-side on every field.
- No validation exists only on the client.
- Confirm the CSP does not break: login, quotation creation, preview, PDF generation, DOCX generation, Drive save, and the Sheets list.

---

# Testing Requirements

Write a security test suite that fails if a control regresses:

- **Auth** — every action without a token is rejected; with an expired token; with a forged signature; with a revoked `jti`; with an inactive user. A `User` token on every Admin action returns `FORBIDDEN`.
- **Injection** — formula-injection payloads in the client name, company name, quotation-for, item description, remarks, and term body are all escaped at every write site.
- **Path traversal** — `../`, absolute paths, and unicode-normalised traversal in any name-derived Drive path are rejected.
- **Upload** — a JPEG renamed `.png`; a PDF header on a non-PDF body; a 10 MB file; a zip bomb — all rejected.
- **Tampering** — a modified total triggers `TOTALS_MISMATCH`; a modified quotation number on update triggers `QUOTATION_NUMBER_IMMUTABLE`; a modified role claim in a token fails signature verification.
- **Rate limiting** — login lockout; save throttling; the circuit breaker.
- **Prototype pollution** — `__proto__`, `constructor`, and `prototype` keys in every payload shape.
- **Secrets** — a built `dist/` contains no Script Property name and no credential-shaped string; git history contains no `.env` or `.clasp.json`.
- **Headers** — the CSP and security headers are present in the built configuration, and the app functions under them (Playwright, with console errors treated as failures).
- **Audit** — every state-changing action writes exactly one audit entry, and no audit entry contains a secret.

---

# TypeScript Requirements

- Strict mode; no `any` — the review must eliminate any remaining `any`, especially at the parse boundary.
- Untrusted input is typed `unknown` and narrowed by an explicit parser, never cast.
- Branded types are used for validated values so an unvalidated string cannot reach a write site.
- `npx tsc --noEmit` clean for both projects.

---

# Build Requirements

- `npm run build` and `npm run gas:build` succeed.
- Run `npm audit` and resolve high and critical advisories; document anything deliberately accepted.
- Verify the production build contains no source maps exposing backend logic, and no development-only code.
- Verify the built bundle contains no secret.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- Add and enforce: `no-eval`, `no-implied-eval`, `no-new-func`, `no-script-url`, `react/no-danger`, `@typescript-eslint/no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, and the existing fixture-import restriction.
- Every new rule must pass, not be suppressed.

---

# Error Handling

- No error response leaks a stack trace, an internal path, a sheet name, a row index, a Drive id the caller should not have, or another user's data.
- Every error is typed and mapped to a generic user message plus the `requestId`.
- Unhandled exceptions in Apps Script are caught by the router and returned as `INTERNAL_ERROR` — never as an HTML error page, which would also break the client's JSON parsing.
- A failure in a security control fails **closed** — a rate limiter that cannot reach `CacheService` denies rather than allows.

---

# Completion Criteria

- [ ] `SECURITY_REVIEW.md` records a pass/fail with evidence for all 20 PRD §33 requirements and every `IMPLEMENTATION_PLAN.md` §19 control.
- [ ] Every gap found is fixed, or explicitly accepted with a documented rationale.
- [ ] The CSP and security headers are configured and verified not to break the app.
- [ ] Rate limiting is complete across login, save, and upload.
- [ ] Formula-injection escaping is applied at every sheet write site.
- [ ] No secret is in the bundle or in git history.
- [ ] Audit logging is complete and leaks nothing.
- [ ] The security test suite passes and fails on a regression.
- [ ] `SECURITY.md` documents the model, the accepted risks (including the public endpoint), and the rotation procedures.
- [ ] No dummy production data exists.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test` all clean.
- [ ] Committed to `claude/quotation-app-implementation`.

---

# Stop Conditions

**Stop after the security review and its fixes are green and committed.**

Do not add features. Do not redesign the UI. Do not expand the test suite beyond security verification — that is Phase 13. Do not deploy.

Stop and ask the user if:

- A finding cannot be fixed without an architecture change — for example, if the public Apps Script endpoint is judged unacceptable, which would require a different backend and a different V1 architecture.
- A finding requires a company decision, such as enforcing Google Workspace SSO (`IMPLEMENTATION_PLAN.md` §26, UR-10) or restricting Drive access further.
- A critical vulnerability is found in a dependency with no available fix.
