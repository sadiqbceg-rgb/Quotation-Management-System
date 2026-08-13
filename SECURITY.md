# Security

How this system is protected, what it deliberately does not protect against,
and what an operator has to do.

The findings and the requirement-by-requirement verification live in
`quotation-implementation-plan/SECURITY_REVIEW.md`. This file is the operating
document.

---

## The one fact everything follows from

**The Google Apps Script Web App is deployed for anonymous access, so its URL is
publicly reachable.**

That is not an oversight. A cross-origin browser `fetch` cannot complete
Google's interactive sign-in, so any other access setting makes the SPA unable
to call the backend at all. The consequence is worth stating plainly:

> The endpoint URL is **not a secret** and is **not a security boundary**.
> Anyone who finds it can send it a request.

The boundary is:

1. A valid, unexpired, unrevoked **session token**, for an account that is still
   active, and
2. The **per-action authorization check** in `main.ts`, applied before any
   handler runs and before any Drive or Sheets access.

Both are verified on every request. Neither is optional, and no handler
authorises itself.

---

## Threat model

| Threat | Control |
|---|---|
| Unauthenticated invocation | Only `health` and `auth.login` are public. Every other action requires a token; a test asserts this over the entire action table. |
| Token forgery | HMAC-SHA256 with `SESSION_HMAC_SECRET`, compared in constant time. A tampered payload fails signature verification. |
| Privilege escalation | The role comes from the `Users` **sheet**, never from the token claim. A forged `role: Admin` changes nothing. |
| A revoked or stale session | Logout adds the `jti` to a revocation list; the account's `active` flag is re-read on every request. A deactivated user's existing token stops working immediately. |
| Credential stuffing | Five failures per email in fifteen minutes locks that email for fifteen minutes. Unknown accounts and wrong passwords are indistinguishable in wording **and in timing** — a dummy hash burns the same work. |
| Tampered payloads | Totals are recomputed server-side from the line items. A client-supplied quotation number is ignored on create and refused on update. |
| Sheets formula injection | Every written value is escaped. Enforced by the type system: `writeRow` accepts only `PreparedCell`, obtainable only from `cell-escaping`. |
| Arbitrary file upload | Magic bytes, per-file size caps and a combined request cap, all before anything reaches Drive. |
| Path traversal into Drive | Every folder segment is validated; the path is built from a validated quotation number and date, never from user text. |
| XSS stealing the token | CSP with `script-src 'self'` and no `unsafe-inline`/`unsafe-eval`; no `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML` or `document.write` anywhere, enforced by lint. |
| Quota exhaustion | Per-session limits on the expensive actions plus a global circuit breaker. Both fail closed. |
| Prototype pollution | `__proto__`, `constructor` and `prototype` are refused at the parse boundary, at any depth, for every action. |

---

## Accepted risks

### 1. The endpoint is public

Described above. Accepted because it is inherent to the mandated V1
architecture. Revisiting it means a different backend.

### 2. The session token is in `sessionStorage`

Apps Script cannot set an `HttpOnly` cookie for a cross-origin SPA, so the token
is held in a React context and mirrored to `sessionStorage` — otherwise a page
refresh signs the user out.

The mitigations are: an 8-hour TTL, revocation on logout, re-verification of the
account's state on every request, and — most importantly — **the CSP**. An
injected script on this origin could read the token, which is why `script-src`
is as tight as it is. That is the trade this control was accepted against.

### 3. CORS cannot be enforced

**`ALLOWED_ORIGINS` is not enforced, and cannot be.**

An Apps Script Web App does not receive request headers: `doPost` is handed
`postData` and `parameter`, and nothing else. There is no `Origin` to inspect,
and no way to set `Access-Control-Allow-Origin` on the response. This is also
why the whole transport is a CORS *simple request* (`text/plain`, token in the
body) — see IMPLEMENTATION_PLAN.md §15.2.

The property is kept as a record of intent for a future backend that can enforce
it. **Do not treat it as a control.** The real boundary is the token plus the
per-action check.

### 4. Hiding a sheet is not access control

`Users` and `AuditLog` are hidden automatically. Anyone with edit rights on the
spreadsheet can unhide them. The real controls are who the spreadsheet is shared
with, and the protected ranges an owner applies by hand — see below.

Protection is deliberately **not** applied by script: `protect().removeEditors()`
can lock the company out of its own record system, and a security measure that
risks losing the system of record is not one to take automatically.

---

## What an operator must do

### Before go-live

1. **Set every Script Property.** `SESSION_HMAC_SECRET` and `PASSWORD_PEPPER`
   must each be ≥ 32 random bytes, generated independently:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   `health` reports missing keys **by name only** — never a value.

2. **Tune the password cost.** Run `measurePasswordHashCost()` in the Apps
   Script editor and set `DEFAULT_PBKDF2_ITERATIONS` to the highest value that
   keeps a login under ~1.5 s. The committed 10,000 is a starting point, not a
   measurement.

3. **Protect the sensitive sheets by hand.** In the spreadsheet:
   Data → Protect sheets and ranges → `Users`, then `AuditLog` → restrict
   editing to the owner. Confirm both are hidden.

4. **Share the spreadsheet and the Drive archive with operations staff only.**
   The archive should be a Shared Drive, not a personal My Drive, so documents
   survive staff changes.

5. **Serve the security headers.** `public/_headers` is copied to `dist/` and is
   read by Netlify and Cloudflare Pages. For another host, see below.

6. **Use separate development resources.** A development deployment with its own
   spreadsheet and its own Drive root. Never point development at production.

### Security headers on other hosts

The policy is one line; only the delivery differs.

**Vercel** — `vercel.json`:
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "<the line from public/_headers>" },
        { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

**nginx**:
```nginx
add_header Content-Security-Policy "<the line from public/_headers>" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

**Apache** — the same set via `Header always set` in `.htaccess`.

Whatever the host, `public/_headers` stays the source of truth for the policy
text: `src/security/deployment-security.test.ts` asserts against it, and
`e2e/csp.spec.ts` runs the app under it in a real browser.

---

## Key rotation

### `SESSION_HMAC_SECRET`

**Effect: every signed-in user is logged out immediately.** Existing tokens fail
signature verification on their next request.

1. Generate a new value (32 random bytes).
2. Replace the Script Property.
3. Tell staff to sign in again. No data is affected.

Rotate on: a suspected token leak, a departing administrator, or on a schedule.
Safe to do at any time; the cost is one round of re-authentication.

### `PASSWORD_PEPPER`

**Effect: every stored password stops verifying. Every account needs a reset.**

The pepper is mixed into the hash, so changing it invalidates every hash in the
`Users` sheet. There is no migration — the plaintext needed to re-hash is not
stored anywhere, by design.

To rotate:

1. Generate a new value and replace the Script Property.
2. For each account, an administrator sets a new password through
   `admin.createUser` (or clears the row and re-provisions).
3. Deliver each password out of band.

Rotate only on a suspected disclosure of the pepper itself — a leaked
spreadsheet alone does **not** require it, because the pepper is what makes the
leaked hashes useless.

### The first Admin

If the only Admin password is lost: delete that row from the `Users` sheet and
repeat the provisioning procedure in `google-apps-script/README.md`.
`provisionFirstAdmin` refuses to run while any account exists, so it cannot be
used to quietly add a second Admin.

---

## Reporting a vulnerability

Report privately to the repository owner. Do not open a public issue.

Include what you did, what happened, and what you expected. If you have a
proof-of-concept payload, include it — every input path in this system is
validated server-side, and a payload that gets through is exactly what needs
seeing.

---

## Running the security suite

```bash
npm run build       # the bundle assertions need dist/
npm test            # includes the security suites
npx playwright test e2e/csp.spec.ts
npm audit
```

The suites fail on a regression, which is the point of them:

| File | Covers |
|---|---|
| `google-apps-script/src/security/sanitize.test.ts` | The parse boundary |
| `google-apps-script/src/security/rate-limiter.test.ts` | Throttling and the circuit breaker |
| `google-apps-script/src/security/security-review.test.ts` | Auth, injection, uploads, audit, response leakage — over the whole action table |
| `src/security/deployment-security.test.ts` | Bundle secrets, the CSP, git history, banned DOM APIs |
| `e2e/csp.spec.ts` | The app under the production CSP, in Chromium |

Adding an action without classifying it in `security/audit.ts`, or adding a
sheet write that skips escaping, breaks the build.
