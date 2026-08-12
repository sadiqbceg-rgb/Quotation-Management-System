# Phase 02 — Authentication

---

# Objective

Implement the complete V1 authentication and authorization layer: a Google Apps Script credential store and session issuer, a login page, session persistence and renewal, logout, protected routes, and the `Admin` / `User` role model — with authorization enforced server-side on every action, because the Apps Script endpoint is publicly reachable by design.

No Supabase. No PostgreSQL. No database. Credentials live in a protected `Users` sheet and are verified only inside Apps Script.

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

- Phase 01 complete and green: the app shell, router, API client, `shared/`, and the Apps Script skeleton with its role-declaration table all exist.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — §17.3 (`Users` sheet), §18 (authentication), §19.2, §19.7, §19.8, §19.9 (authorization, secrets, rate limiting, audit), §23 (error codes).
- `PRD/quotation-prd.md` — §6 (authentication), §33 items 1–5 and 13 (security), §7 (navigation), §39 (admin-only settings).
- `google-apps-script/src/main.ts` — the router and the existing role-declaration table; extend it, do not replace it.
- `google-apps-script/src/config/properties.ts` — add the new secrets here.
- `src/services/api/{client,envelope,errors,actions}.ts` — reuse; do not write a second fetch path.
- `src/components/common/*` — reuse the existing Input, Button, Field, Toast, Spinner primitives.
- `src/router.tsx`, `src/pages/login/index.tsx` — extend the existing shells.

---

# Implementation Scope

**In scope**

1. `Users` sheet repository in Apps Script: read by email, update `lastLoginAt`, never expose the hash.
2. Password hashing: PBKDF2-HMAC-SHA256 over `Utilities.computeHmacSha256Signature`, a per-user 32-byte salt, a server-side pepper from Script Properties, and a per-record iteration count.
3. An Admin-only user-provisioning action plus a documented one-off script the operator runs to create the first Admin. No self-registration.
4. Session tokens: HMAC-SHA256-signed, JWT-shaped, carrying `sub`, `role`, `jti`, `iat`, `exp`; 8-hour TTL; silent renewal under 1 hour remaining; a `jti` revocation list in `CacheService`/Script Properties for logout.
5. `auth.login`, `auth.logout`, `auth.me` actions.
6. Central authorization: every action declares its required role in one table; the router enforces it before any handler runs.
7. Per-email login rate limiting: 5 failures in 15 minutes → 15-minute lock.
8. Frontend: login page, `AuthProvider` context, `useAuth`, session storage and rehydration, token attachment in the API client, `<RequireAuth>` and `<RequireRole>` route guards, logout in the top bar, redirect-to-intended-destination after login, and an `AUTH_EXPIRED` interceptor that clears the session and redirects.
9. Audit-log entries for login success, login failure, lockout, and logout.

**Out of scope** — later phases

Quotations and number reservation (03). Item tables (04). Terms (05). Authorized persons (06) — note that an *authorized person* is a signatory record and is **not** a login user; keep the two concepts strictly separate. Documents (07–09). Drive (10). Sheets tracking (11). The broader security review (12). Full test suite (13). Deployment and first-user provisioning in production (14).

---

# Required Changes

## Apps Script

- `src/auth/password.ts` — `hashPassword(plain, salt, iterations, pepper)`, `verifyPassword(plain, record)`, `generateSalt()`. Constant-time comparison for the digest. Tune `iterations` to the highest value keeping login under ~1.5 s in Apps Script; record the measured number and the chosen value in the module docblock and in `google-apps-script/README.md`.
- `src/auth/token.ts` — `issueToken(user)`, `verifyToken(raw)` checking signature, `exp`, revocation, and the user's `active` flag. Base64url encoding without padding.
- `src/auth/session.ts` — revocation list with TTL, and renewal.
- `src/auth/rate-limit.ts` — per-email failure counter in `CacheService`.
- `src/sheets/users-repository.ts` — typed access to the `Users` sheet.
- `src/auth/handlers.ts` — `auth.login`, `auth.logout`, `auth.me`, `admin.createUser`.
- `src/main.ts` — resolve the token once per request, attach the caller to the handler context, and enforce the declared role. A missing or invalid token on a non-public action returns `AUTH_REQUIRED` / `AUTH_INVALID` **before** any Sheets or Drive access.
- `src/config/properties.ts` — add `SESSION_HMAC_SECRET` and `PASSWORD_PEPPER` to the required set.

## Frontend

- `src/services/auth/auth-service.ts` — wraps the three auth actions through the existing API client.
- `src/contexts/AuthContext.tsx` + `src/hooks/useAuth.ts` — `user`, `role`, `isAuthenticated`, `isLoading`, `login`, `logout`; rehydrate from `sessionStorage` on mount and validate with `auth.me` before trusting it.
- `src/pages/login/index.tsx` — email + password, React Hook Form + Zod, inline errors, a disabled-while-submitting button, a generic failure message, and a distinct lockout message. Company logo and a clean corporate layout per PRD §38.
- `src/components/common/{RequireAuth,RequireRole}.tsx` — route guards that render a spinner while loading, redirect to `/login` with the intended path preserved, and render a "Not authorized" page for an insufficient role.
- `src/router.tsx` — `/login` public; everything else behind `RequireAuth`; Company Settings and Authorized Persons additionally behind `RequireRole role="Admin"`.
- `src/services/api/client.ts` — attach the token **in the JSON body**, not in an `Authorization` header. A custom header would trigger a CORS preflight that Apps Script cannot answer. Add a comment saying so.

---

# Expected Files / Components

```
google-apps-script/src/auth/{password,token,session,rate-limit,handlers}.ts
google-apps-script/src/sheets/users-repository.ts
google-apps-script/src/audit/audit-log.ts
google-apps-script/src/main.ts                         (extended)
google-apps-script/src/config/properties.ts            (extended)

src/services/auth/auth-service.ts
src/contexts/AuthContext.tsx
src/hooks/useAuth.ts
src/pages/login/index.tsx                              (implemented)
src/components/common/{RequireAuth,RequireRole,NotAuthorized}.tsx
src/router.tsx                                          (extended)
src/services/api/client.ts                              (extended)

*.test.ts alongside each new module
```

---

# Architecture Requirements

- Authentication is entirely Apps Script + the `Users` sheet. **No Supabase, no PostgreSQL, no external identity provider, no third-party auth SDK.**
- The Apps Script Web App is deployed for anonymous access, so its URL is public. **Frontend guards are UX only; the server-side check is the security boundary.** Every action must verify the token server-side.
- Role enforcement lives in exactly one place — the router's action table. Never re-check roles ad hoc inside handlers, where one omission becomes a privilege escalation.
- Reuse the Phase 01 API client, error types, and UI primitives. Do not introduce a second HTTP path or a second error taxonomy.
- Keep the "authorized person" (signatory, Phase 06) and the "user" (login account) as separate concepts with separate storage.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*`
- `quotation-implementation-plan/*`
- `shared/numbering.ts`, `shared/money.ts`, `shared/totals.ts` — unrelated to this phase.

---

# Data Requirements

- **Create no user accounts in code.** No default admin, no `admin@example.com`, no seeded password, no test login rendered on the login page.
- The first Admin is created by an operator running a documented provisioning routine with a password supplied at runtime (Phase 14 runbook). Document it; do not execute it.
- The `Users` sheet stores: email, passwordHash, salt, iterations, role, active, createdAt, lastLoginAt. Nothing else. Never a plaintext or recoverable password.
- Test users exist only as in-memory fixtures inside `*.test.ts`, prefixed `TEST_ONLY_`, and are never written to any sheet.

---

# Security Requirements

- Passwords are never stored in plaintext, never logged, never returned in any response, never placed in frontend source, and never included in an error message (PRD §33 items 2 and 6).
- Per-user random salt plus a server-side pepper from `PASSWORD_PEPPER`, so a leaked spreadsheet alone does not enable offline cracking.
- Constant-time digest comparison.
- Login failures return one generic message with no account-existence disclosure. Timing between "no such user" and "wrong password" must not leak — perform a dummy hash when the user is absent.
- Rate limit: 5 failures per email in 15 minutes → 15-minute lock, returning `RATE_LIMITED`.
- Tokens are signed with `SESSION_HMAC_SECRET`, expire in 8 hours, and are revocable by `jti`.
- The token is held in React state and mirrored to `sessionStorage` (not `localStorage`). Document the trade-off in the module: Apps Script cannot set an `HttpOnly` cookie for a cross-origin SPA, so the mitigations are the short TTL, revocation, the strict CSP, and the lint-enforced absence of `dangerouslySetInnerHTML`.
- Every state-changing auth event is written to `AuditLog` with the actor, action, outcome, and `requestId` — and never with the password or the token.
- An inactive user's existing token stops working immediately, because `active` is re-checked on every verification.

---

# Validation Requirements

- Email: required, valid format, trimmed, lower-cased, ≤ 254 characters.
- Password: required, 12–128 characters for new accounts; the login form only checks non-empty so it never hints at the policy.
- The same rules run in the Zod schema and in the Apps Script validator, sourced from `shared/validation-rules.ts`.
- `verifyToken` rejects: a bad signature, an expired token, a malformed structure, a revoked `jti`, an unknown subject, and an inactive user — each with a distinct internal reason and a single generic external message.
- The router rejects any non-public action that arrives without a token, before touching Sheets or Drive.

---

# Testing Requirements

- `hashPassword` / `verifyPassword` round-trip; wrong password fails; the same password with different salts produces different hashes; iteration count is honoured.
- `issueToken` / `verifyToken` round-trip; tampered payload rejected; tampered signature rejected; expired token rejected; revoked `jti` rejected; inactive user rejected.
- Renewal issues a new token when under 1 hour remains and does not otherwise.
- Rate limiting locks after 5 failures and releases after the window.
- Role enforcement: a `User` token calling an `Admin` action gets `FORBIDDEN`; an `Admin` token succeeds; no token on a protected action gets `AUTH_REQUIRED`; a public action works without a token.
- Login timing does not distinguish an unknown email from a wrong password.
- Component: the login form validates, submits, shows a generic error on failure, shows the lockout message on `RATE_LIMITED`, and disables the button while submitting.
- Guards: unauthenticated access to a protected route redirects to `/login` and preserves the destination; a `User` hitting an Admin route sees "Not authorized"; a valid session renders the page.
- `AUTH_EXPIRED` from any call clears the session and redirects.
- No test writes to a real sheet.

---

# TypeScript Requirements

- Strict mode; no `any`; explicit return types on exported functions.
- A discriminated union for the auth state (`loading` | `anonymous` | `authenticated`) so no component can read `user` while it is still unknown.
- The token payload is parsed into a typed shape with runtime narrowing — never cast from `unknown`.
- `npx tsc --noEmit` clean for both projects.

---

# Build Requirements

- `npm run build` succeeds.
- `npm run gas:build` produces a valid bundle; verify `doPost` still resolves the new auth actions.
- No new frontend dependency for crypto — hashing happens server-side only. Do not add `bcryptjs`, `jsonwebtoken`, or any browser crypto library.

---

# Lint Requirements

- `npm run lint` clean, zero warnings.
- No `console.log` of credentials, tokens, or payloads anywhere.
- `react/no-danger` still enforced.

---

# Error Handling

- Codes used: `AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_EXPIRED`, `FORBIDDEN`, `RATE_LIMITED`, `VALIDATION_FAILED`, `CONFIG_MISSING`, `INTERNAL_ERROR`.
- The frontend maps each to a specific, non-technical message; unknown codes fall back to a generic message plus the `requestId`.
- A missing `SESSION_HMAC_SECRET` or `PASSWORD_PEPPER` fails fast with `CONFIG_MISSING` at request time — never a silent hash with an empty pepper.
- Network failure during login shows a retryable error and never leaves the button permanently disabled.
- An internal error never leaks a stack trace, an email address, or a sheet name to the client.

---

# Completion Criteria

- [ ] A user with a real account created by the provisioning routine can log in, stay logged in across a refresh, and log out.
- [ ] Every protected route is guarded; Admin routes reject a `User`.
- [ ] Every non-public Apps Script action rejects requests without a valid token, before any Sheets or Drive access.
- [ ] Passwords are hashed with a salt and a pepper; no plaintext anywhere.
- [ ] Rate limiting works.
- [ ] Audit entries are written for login success, failure, lockout, and logout.
- [ ] No user accounts, passwords, or credentials are committed.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run gas:build`, `npm test` all clean.
- [ ] Committed to `claude/quotation-app-architecture-ycbwpa`.

---

# Stop Conditions

**Stop after authentication is green and committed.**

Do not implement quotation creation or number reservation (Phase 03). Do not build the authorized-persons library (Phase 06) — it is a different concept. Do not implement Drive or Sheets features beyond the `Users` and `AuditLog` sheets this phase needs. Do not create production accounts. Do not deploy.

Stop and ask the user if:

- PBKDF2 in Apps Script cannot reach an acceptable iteration count inside the login time budget — report the measurements and propose options rather than silently weakening the parameters.
- The company requires Google Workspace SSO instead of email + password (`IMPLEMENTATION_PLAN.md` §26, UR-10) — that changes this phase's design.
