# Google Apps Script backend

The V1 backend. It is the only component that touches Google Drive and Google
Sheets, and the only place secrets exist.

```
React SPA  ──HTTPS POST──▶  Apps Script Web App  ──▶  Google Drive
                                                 └──▶  Google Sheets
```

See `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` §15 for the full
architecture.

---

## Build

```bash
npm run gas:build      # TypeScript → dist-gas/Code.js (+ appsscript.json)
npm run gas:push       # build, then `clasp push`
```

`src/` is TypeScript with real ES modules. esbuild bundles it into a single
`Code.js` and re-exports `doPost` / `doGet` as top-level globals, which is what
Apps Script requires. Never edit `dist-gas/` by hand — it is generated.

The bundle targets **ES2019**, which is what the Apps Script V8 runtime
supports. Do not raise that target.

---

## First-time setup

1. `npm install -g @google/clasp && clasp login`
2. Create the Apps Script project, bound to the **Quotation Tracking**
   spreadsheet.
3. `cp .clasp.json.example .clasp.json` and paste the script id.
   `.clasp.json` is git-ignored — it identifies a live deployment.
4. `npm run gas:push`
5. Deploy as a Web App with the settings below.
6. Set the Script Properties below.

---

## Web App deployment settings

| Setting        | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Execute as     | **Me** (the company account that owns Drive and Sheets) |
| Who has access | **Anyone**                                              |

"Anyone" is required, not preferred: a cross-origin browser `fetch` cannot
complete Google's interactive sign-in, so any other setting makes the SPA
unable to call the backend at all.

**This means the endpoint URL is publicly reachable.** The URL is not a secret
and is not a security boundary. Every non-public action must verify the session
token and the caller's role in `main.ts` _before_ any Drive or Sheets access.
That check is the boundary. See IMPLEMENTATION_PLAN.md §15.1 and §19.

---

## Transport

Requests are CORS **simple requests** — Apps Script cannot answer a preflight:

```
POST <web app /exec URL>
Content-Type: text/plain;charset=utf-8

{"action":"health","requestId":"<uuid>","token":"<session token>","payload":{}}
```

- `application/json` would trigger a preflight. Do not use it.
- An `Authorization` header would trigger a preflight. The token goes in the body.
- Responses are JSON via `ContentService`; HTTP status codes are not
  controllable, so the outcome is carried in the envelope.

Responses:

```jsonc
{ "ok": true,  "requestId": "…", "data": { } }
{ "ok": false, "requestId": "…", "error": { "code": "VALIDATION_FAILED", "message": "…" } }
```

---

## Script Properties

Set these in the Apps Script editor under **Project Settings → Script
Properties**. Never commit a required property, and never expose one to the
frontend.

### Required

| Property                  | Purpose                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `SESSION_HMAC_SECRET`     | Signs session tokens. ≥ 32 random bytes.                                                        |
| `PASSWORD_PEPPER`         | Mixed into every password hash, so a leaked spreadsheet alone does not permit offline cracking. |
| `DRIVE_ROOT_FOLDER_ID`    | The `Quotation Archive` folder id.                                                              |
| `TRACKING_SPREADSHEET_ID` | The `Quotation Tracking` spreadsheet id.                                                        |

### Optional (defaults shown)

| Property             | Default           | Purpose                                                    |
| -------------------- | ----------------- | ---------------------------------------------------------- |
| `COMPANY_CODE`       | `SFC`             | Speed Falcon Company                                       |
| `BRANCH_CODE`        | `RUH`             | Riyadh branch                                              |
| `DOC_TYPE_CODE`      | `QTN`             | Quotation                                                  |
| `COMPANY_VAT_NUMBER` | the company's own | Printed on the quotation; resolves `{{company.vatNumber}}` |
| `ALLOWED_ORIGINS`    | _(empty)_         | Defence in depth only — Apps Script cannot enforce CORS.   |

The optional properties are **not secrets.** They are company identifiers that
appear on the quotation itself, which is why they carry committed defaults.
Only the four required properties above are confidential.

`COMPANY_VAT_NUMBER` must be 15 digits, first and last both `3`. A malformed
override is refused and the known-good default is used instead, with a warning
that names the property and never its value — a wrong VAT number on a client's
quotation is a tax-compliance problem, so a typo must not reach a document.

The frontend carries the same number as `VITE_COMPANY_VAT_NUMBER` (see
`.env.example`) so the term preview can resolve the token without a round trip.
**This Script Property is authoritative for generated documents.** A test
asserts the two configurations cannot drift apart.

Together the three codes produce the quotation number `SFC/RUH/QTN/YYYY/###`.
They are configuration rather than literals so a second branch can be added
without a rewrite.

`missingProperties()` reports which required keys are absent, by **name only**.
The `health` action surfaces that so an operator can diagnose a deployment
without any value being disclosed.

---

## Two environments

Maintain **two** deployments, each with its own Script Properties, its own
spreadsheet and its own Drive root:

- **Development** — for all testing. Never points at production data.
- **Production** — the live endpoint.

Deployments are immutable and versioned, so a rollback is re-pointing the
deployment at a previous version rather than re-pushing code.

---

## Creating the first Admin

There is no default account and no self-registration, so the first Admin is
created out of band. It never goes over HTTP: the endpoint is public, and an
unauthenticated "create the first admin" action would be a takeover primitive
for whoever called it first.

Prerequisites: `TRACKING_SPREADSHEET_ID`, `PASSWORD_PEPPER` and
`SESSION_HMAC_SECRET` must already be set. Drive is not needed yet.

1. Generate a strong password (do not reuse one):

   ```bash
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```

2. In the Apps Script editor, open **Project Settings → Script Properties** and
   add two temporary properties:

   | Property                   | Value                     |
   | -------------------------- | ------------------------- |
   | `BOOTSTRAP_ADMIN_EMAIL`    | the administrator's email |
   | `BOOTSTRAP_ADMIN_PASSWORD` | the password from step 1  |

3. Open the **Editor**, select `runProvisioning` in the function dropdown, and
   press **Run**. Authorise the script if prompted.

4. Read the execution log. Expect:

   ```
   Admin account created for someone@yourcompany.com.
   The bootstrap properties have been deleted. …
   ```

5. Confirm both bootstrap properties are gone from Script Properties. They are
   deleted automatically — _before_ the account is created, so a failure cannot
   leave the password behind — but check anyway.

6. Deliver the password to the person out of band. Never send it in the same
   message as the application URL.

7. Sign in through the web app and confirm the role shows as **Admin**.

`provisionFirstAdmin` refuses to run once any account exists, so it cannot be
used to quietly add a second Admin later. Further accounts go through the
`admin.createUser` action, which requires an existing Admin session.

If you lose the only Admin password: delete that row from the `Users` sheet and
repeat this procedure.

---

## Importing the company's Terms & Conditions

The `Terms` sheet is created empty. It is never seeded automatically — PRD §21
is emphatic that existing terms must not be modified behind the user's back, and
silently populating a library on first load is the same class of surprise.

An Admin loads the company's real terms once, from the application:

1. Sign in as an Admin and open **Terms & Conditions**.
2. Press **Import company terms**.

That runs `admin.importReferenceTerms`, which inserts the 11 terms transcribed
verbatim from `reference/existing-terms.docx`
(`src/terms/import-reference-terms.ts`). It is:

- **Admin only** — enforced by the action table in `main.ts`, not by the button.
- **Idempotent** — a second run imports nothing.
- **Non-destructive** — it inserts only titles that are absent and never edits
  an existing row, so a term someone has since reworded stays reworded.

Two placeholders in the source document were converted to the canonical token
syntax and nothing else was changed:

| In the document | Stored as          | Resolves?             |
| --------------- | ------------------ | --------------------- |
| `{company}`     | `{{company.name}}` | yes                   |
| `{SAR  }`       | `{{rate}}`         | **no — deliberately** |

`{{rate}}` is outside the token whitelist on purpose. A quotation has no single
rate; the approved sample replaced that placeholder by hand with two different
per-category rates. Leaving it unresolvable means the UI flags it and a person
has to supply the real figure, rather than a document going to a client with a
blank where a price belongs.

Four PRD §20 checkbox labels have no counterpart in the reference document —
Mobilization, Manpower Replacement, Project Specific Terms, and Transportation
as a standalone term. Their wording is **not** invented here. The company adds
them through the ordinary "Add term" flow.

---

## Password hashing — measure before go-live

`hashPassword` uses PBKDF2-HMAC-SHA256 with a per-user salt, a per-record
iteration count, and a server-side pepper.

`Utilities.computeHmacSha256Signature` is a host bridge call, so it is far
slower than a native PBKDF2. **`DEFAULT_PBKDF2_ITERATIONS` (currently 10,000) is
a starting point, not a measured value.** Before go-live:

1. Open the Apps Script editor on the real deployment.
2. Run `measurePasswordHashCost()` and read the log.
3. Set the highest count that keeps a login under ~1.5 s.
4. Record the measurement here.

The count is stored per user record, so raising it later is safe: an existing
hash verifies at its own count and is transparently re-hashed at the new one on
that user's next sign-in.

The pepper is the strongest of the three defences: an attacker who exfiltrates
the `Users` sheet cannot mount an offline attack without also compromising the
Apps Script project, where the pepper lives.

Credential material is stored as **lowercase hex, not base64**. Every sheet
write passes through `escapeForSheet`, which prefixes an apostrophe to a value
starting with `=`, `+`, `-` or `@`; base64 can start with `+` or `/`, so a hash
could be stored altered and then fail to verify — intermittently, depending on
the random salt.

---

## Phase status

| Phase       | Adds                                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| 01 _(done)_ | Router, envelope, role table, Script Property accessors, `health`                     |
| 02 _(done)_ | Sessions, password hashing, `resolveCaller`, rate limiting, audit log                 |
| 03 _(done)_ | Quotation numbering (`LockService` + `Counters` + idempotency), quotation persistence |
| 04 _(done)_ | `Items` sheet and the item catalogue actions                                          |
| 05 _(done)_ | `Terms` sheet, the T&C actions, and `admin.importReferenceTerms`                      |
| 06          | Authorized persons and signature storage                                              |
| 10          | Drive folders and uploads                                                             |
| 11          | Sheets tracking                                                                       |
| 12          | Security hardening                                                                    |
| 14          | Backups, monitoring, deployment                                                       |
