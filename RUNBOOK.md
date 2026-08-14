# Runbook

Operational procedures for the Speed Falcon quotation system.

`DEPLOYMENT.md` explains _why_ the system is shaped the way it is. This file is
what you do, in order, with your hands.

> **Nothing here has been executed.** No Google resource exists, no account has
> been created, no secret has been generated. Sections 1–5 are a one-time setup
> somebody performs deliberately.

**Read before starting §1:** `DEPLOYMENT.md` §8 lists what is still open.
UR-01 — the filename ordering — is **settled**: `SFC-RUH-QTN-YYYY-NNN`, which is
what the code already produces. What remains open is the review of the four
draft terms (§5.3) and the real signature images (§5.4).

---

## Contents

|                |                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Setup**      | §1 Drive · §2 Sheets · §3 Secrets and deployment · §4 Backups · §5 First accounts and content                                                                            |
| **Operations** | §6 Weekly review · §7 Restore · §8 Rollback and its rehearsal                                                                                                            |
| **Incidents**  | §9.1 Endpoint down · §9.2 Drive quota · §9.3 Script quota · §9.4 Corrupted spreadsheet · §9.5 Duplicate number · §9.6 Locked-out user · §9.7 Suspected secret compromise |
| **Record**     | §10 The deployment log · §11 Development setup checklist                                                                                                                 |

Do §1 and §2 **twice** — once for development, once for production — with
different resources each time. The isolation is the point (`DEPLOYMENT.md` §2.4).

**Start with development.** §11 is the same steps reduced to the shortest path
to a working development deployment, and it is where to begin: every procedure
here should have been performed once against development before it is performed
against the company's live data.

---

## 1. Google Drive

**Who:** somebody signed in as the **company** Google account. Not a personal
one: an archive owned by an individual leaves with that individual.

1. **Create a Shared Drive.** Google Drive → _Shared drives_ → _New_. Name it
   something unambiguous, e.g. `Speed Falcon — Quotations`.

   A Shared Drive, not My Drive, because files in a Shared Drive belong to the
   organisation. A personal My Drive folder is deleted when that account is
   closed, and the company's quotation archive goes with it.

2. **Create the root folder** inside it: `Quotation Archive`.

3. **Create two children** by hand:
   - `_assets/signatures/` — the authorized-person signature PNGs.
   - `_backups/` — the daily spreadsheet copies (§4 creates the dated folders).

   The year and month folders are created by the application as quotations are
   saved. Do not pre-create them: the application looks up each level by exact
   name and would find yours, but an empty `2027/` folder in the archive is a
   thing somebody will later wonder about.

4. **Record the root folder id.** Open `Quotation Archive` and take the id from
   the URL: `https://drive.google.com/drive/folders/<THIS>`. It becomes
   `DRIVE_ROOT_FOLDER_ID`.

5. **Members.**
   - The Google account the Apps Script project runs as (**Execute as: Me**)
     needs **Content manager** or better. It creates folders, uploads files and
     replaces content.
   - Operations staff need **Viewer** at minimum, or they cannot open the links
     the app puts in the tracking sheet. The application **never widens Drive
     permissions** — a user who cannot open a link needs Drive access, not an
     application change.

6. **Confirm nothing is public.** Right-click `Quotation Archive` → _Share_.
   General access must read _Restricted_. Anyone with the link must **not** be
   able to view. A client's pricing is in these files.

---

## 2. Google Sheets

1. **Create a spreadsheet** named `Quotation Tracking`, inside the same Shared
   Drive.

2. **Record its id** from the URL:
   `https://docs.google.com/spreadsheets/d/<THIS>/edit`. It becomes
   `TRACKING_SPREADSHEET_ID`.

3. **Leave it empty.** Do not create sheets, headers or formatting by hand.

   The backend creates each sheet on first use, writes its header row, and
   applies the formatting — money columns, text-formatted dates, the `Status`
   data validation, and the conditional format that highlights a duplicate
   quotation number. It is idempotent and **never destructive**: it will not
   rewrite headers on a populated sheet, reorder columns, or touch a data row.
   Staff widen columns and add filters, and a bootstrap that "restored" the
   sheet on every save would undo that work several times an hour.

   The sheets that appear, as they are first needed:

   | Sheet               | What it holds                                            |
   | ------------------- | -------------------------------------------------------- |
   | `Quotations`        | the register — PRD §31 columns A–H, system columns I–Q   |
   | `QuotationRecords`  | the full quotation payload, for edit-in-place            |
   | `Counters`          | **the numbering authority.** Year → last sequence        |
   | `Idempotency`       | draft id → issued number; stops a retry issuing a second |
   | `Users`             | email, password hash, salt, iterations, role             |
   | `Terms`             | the T&C library                                          |
   | `AuthorizedPersons` | signatories and their signature file ids                 |
   | `Items`             | the item catalog                                         |
   | `AuditLog`          | one row per state-changing action                        |

   There is no `Settings` sheet and no `Clients` sheet — see `DEPLOYMENT.md` §8.

4. **After the first quotation has been created** (i.e. once the sheets exist),
   protect and hide the sensitive ones. This cannot be done before they exist,
   and it is not done by the application, because a script that can protect a
   range can also unprotect it.

   - _Data → Protect sheets and ranges_ → `Users` → restrict editing to the
     owner. Repeat for `AuditLog`.

     `Users` holds password material. `AuditLog` is the record of who did what,
     and a tamper-evident log that operators can edit is neither.

   - Right-click each of `Counters`, `Idempotency`, `Users`, `AuditLog`,
     `QuotationRecords` → _Hide sheet_.

     Hiding is tidiness, not security — an editor can unhide. The point is that
     `Counters` is the sole authority for the next quotation number, and a
     helpful person who "fixes" a number in it burns or duplicates one.

5. **Confirm zero quotation rows** — PRD §34. The `Quotations` sheet must have
   its header row and nothing else. **Do not add a sample row**, not even to see
   the formatting.

---

## 3. Secrets and the Apps Script deployment

1. **Create the Apps Script project**, owned by the **company** account.

2. **Push the code:**

   ```bash
   npm ci && npm run gas:build
   cd google-apps-script && cp .clasp.json.example .clasp.json   # paste the script id
   cd .. && npm run gas:push
   ```

3. **Generate the two secrets:**

   ```bash
   npm run secrets:generate
   ```

   It prints and stops — no file is written. Copy both into the company password
   manager now; they cannot be recovered from the deployment later.

4. **Set the Script Properties.** Apps Script → _Project Settings → Script
   Properties_:

   | Property                  | Value                                                  |
   | ------------------------- | ------------------------------------------------------ |
   | `SESSION_HMAC_SECRET`     | generated in step 3                                    |
   | `PASSWORD_PEPPER`         | generated in step 3                                    |
   | `DRIVE_ROOT_FOLDER_ID`    | from §1.4                                              |
   | `TRACKING_SPREADSHEET_ID` | from §2.2                                              |
   | `ALLOWED_ORIGINS`         | the site origin, e.g. `https://quotations.example.com` |
   | `COMPANY_CODE`            | `SFC`                                                  |
   | `BRANCH_CODE`             | `RUH`                                                  |
   | `DOC_TYPE_CODE`           | `QTN`                                                  |
   | `COMPANY_VAT_NUMBER`      | the company's registered number                        |

   **Use different values for development and production** — different secrets,
   a different spreadsheet id, a different Drive root. A development deployment
   pointed at the production spreadsheet issues real numbers and burns them.

5. **Deploy as a Web App:** _Deploy → New deployment → Web app_.

   | Setting        | Value      |
   | -------------- | ---------- |
   | Execute as     | **Me**     |
   | Who has access | **Anyone** |

   "Anyone" is required, not preferred — `DEPLOYMENT.md` §2.3 explains why, and
   why the endpoint URL is therefore not a security boundary. Authorize the
   scopes when prompted; the first run asks for Drive and Sheets access.

6. **Copy the Web app URL** (it ends in `/exec`, not `/dev`).

7. **Check the health endpoint** before going further:

   ```bash
   curl -s -X POST '<the /exec URL>' \
     -H 'Content-Type: text/plain;charset=utf-8' \
     --data '{"action":"health","requestId":"setup-check","payload":{}}'
   ```

   Expect `"configured": true` and `"missing": []`. If `missing` names
   properties, fix them all in one pass — it lists every one, so there is no
   need to go round again per error. The response reports **names only, never
   values**.

8. **Tune the password cost.** In the Apps Script editor, run
   `measurePasswordHashCost()` and raise `DEFAULT_PBKDF2_ITERATIONS`
   (`google-apps-script/src/auth/password.ts`) to the highest value that keeps a
   login under ~1.5 s on this deployment, then push and redeploy. The committed
   10,000 is a starting point, not a measurement.

9. **Set `VITE_GAS_ENDPOINT`** to the `/exec` URL in the static host's
   environment variables, then build and deploy the frontend
   (`DEPLOYMENT.md` §1). It is inlined at build time, so it needs a **rebuild**,
   not just a redeploy.

---

## 4. The daily backup

In the Apps Script editor, select `installDailyBackupTrigger` and **Run** it
once. It returns `{ installed: true }` the first time and `{ installed: false }`
after that — it is idempotent, because Apps Script will happily install the same
trigger five times and then run the backup five times a night.

Verify: _Triggers_ (the clock icon) shows one time-driven trigger for
`dailyBackup`, daily, around 02:00.

Then prove it works rather than assuming it does — run `dailyBackup` manually
once and confirm `Quotation Archive/_backups/YYYY-MM-DD/Quotation Tracking
YYYY-MM-DD` exists and opens. A backup nobody has ever restored is not a backup.

`removeDailyBackupTrigger()` removes it, for decommissioning.

---

## 5. First accounts and real content

1. **The first Admin.** There is no self-registration and no default account.

   Add two temporary Script Properties, `BOOTSTRAP_ADMIN_EMAIL` and
   `BOOTSTRAP_ADMIN_PASSWORD` (at least 12 characters, generated, not chosen),
   then run `runProvisioning` once from the editor and read the log. **Both
   bootstrap properties are deleted automatically.**

   Deliver the password **out of band** — not in the same message as the
   application URL. `provisionFirstAdmin` refuses to run once any account
   exists, so it cannot be used later to quietly add a second Admin.

2. **The remaining staff accounts**, created by that Admin in the app. Passwords
   generated, delivered out of band, one account per person. Shared accounts
   make the audit log useless.

3. **Import the terms.** As an Admin, run the terms import once. It inserts
   **15 terms** and only those whose title is not already present, and never
   modifies an existing row, so running it twice is safe.

   Two different kinds of content arrive in that one import, and the difference
   matters:

   |           | Count | Provenance                                                                                                                                                                   |
   | --------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Approved  | 11    | Transcribed verbatim from `reference/existing-terms.docx`, the company's own approved General Terms & Conditions.                                                            |
   | **DRAFT** | 4     | Mobilization, Manpower Replacement, Project Specific Terms, Transportation. Supplied by the company as **drafts**. Nobody has confirmed they have been through legal review. |

   **Required operator action — before any quotation uses one of the four.**
   Open the Terms library, read those four, and have whoever owns the company's
   terms approve or amend the wording. They are editable in place; amend them
   there rather than in the code, so the record of what was agreed lives with
   the term.

   The system does not distinguish them on screen — to the app a term is a term.
   The distinction exists in `google-apps-script/src/terms/import-reference-terms.ts`
   (`REFERENCE_TERMS` versus `COMPANY_DRAFT_TERMS`) and here. That is why this
   step is a step and not a note.

   `{{rate}}` in the _Manpower Rate_ term is deliberately unresolvable: a
   quotation has no single rate, so validation flags it and a person must supply
   the real figure for that quotation rather than a document going out with a
   blank where a price belongs.

4. **Authorized persons and their signatures.** Create each real signatory and
   upload their real signature image. A person without one is listed but **not
   selectable** (PRD §24), so a quotation cannot silently go out unsigned.

   **No signature image exists in this repository, and none may be added to
   it.** Each file comes from the company and is uploaded through the app by an
   Admin, which stores it in `Quotation Archive/_assets/signatures/`. What each
   file must be:

   | Requirement        | Value              | Enforced                                                           |
   | ------------------ | ------------------ | ------------------------------------------------------------------ |
   | Format             | **PNG**            | Magic bytes are checked — a JPEG renamed `.png` is refused         |
   | Background         | **Transparent**    | Not enforced; an opaque one paints a white box over the letterhead |
   | Maximum size       | 1024 KB            | Refused above                                                      |
   | Minimum dimensions | 100 × 30 px        | Refused below                                                      |
   | Recommended width  | ≥ 600 px           | Warned below — narrower looks soft at document scale               |
   | Maximum dimensions | 10,000 × 10,000 px | Refused above, to stop a decompression bomb                        |

   One file per authorized person, being that person's real signature. Do not
   substitute a typed name, a scan of somebody else's, or a placeholder: this
   image is what makes the document a signed one.

5. **Do not create a test quotation in production.** Validation runs on the
   **development** deployment (`DEPLOYMENT_CHECKLIST.md`). If the company wants
   one end-to-end check against production, it must be a **real quotation they
   intend to keep** — because the number it consumes is real and cannot be
   returned. That is the operator's call; record which was chosen in §10.

---

## 6. The weekly review

Fifteen minutes. Four things.

1. **Backups ran.** Apps Script → _Executions_, filter to `dailyBackup`. Seven
   `Completed` rows, each logging `copied`. A `failed` outcome is logged rather
   than thrown, so it will not have emailed anyone — this is where it is seen.

2. **Error rate.** _Executions_, filter to `Failed`. A handful of
   `VALIDATION_FAILED` is users being users. Repeated `DRIVE_*`, `SHEETS_*` or
   `INTERNAL_ERROR` is a fault. Open one and read the `requestId` and the stack.

3. **Quota headroom.** Cumulative runtime for the day against the account's
   limit — 90 minutes for a consumer account, 6 hours for Workspace. Compare
   against the per-save cost recorded in §10. If usage is above roughly half the
   limit on a normal day, act before it becomes §9.3.

4. **The audit log.** Skim `AuditLog` for the week: user creation, role changes,
   status changes, deactivations. You are looking for something nobody remembers
   doing.

Note anything unusual in §10, even if it resolved itself. The second occurrence
is much easier to diagnose when the first one was written down.

---

## 7. Restoring the spreadsheet

**RPO 24 h. RTO under 2 h.** Work through these in order — the first is
non-destructive and fixes most cases.

**Wrong edit, recent.** Spreadsheet → _File → Version history → See version
history_ → restore. Sheets keeps this for a long time and it is the least
invasive option.

**Sheet deleted or badly corrupted.**

1. Open `Quotation Archive/_backups/` and take the most recent dated folder.
2. Open the copy inside it and confirm it looks right — `Counters` has a row for
   the current year, `Quotations` has the rows you expect.
3. _File → Make a copy_ into the Shared Drive, named `Quotation Tracking`.
4. Take the **new** spreadsheet id from its URL and set `TRACKING_SPREADSHEET_ID`
   to it. **This is the step that actually performs the restore** — everything
   before it is preparation.
5. Re-check `health` (§3.7). Sign in and open the register.
6. Re-apply the protections and hiding from §2.4 — a copy does not carry them.

**Then reconcile the numbers, before anyone creates a quotation.** Up to 24
hours of quotations may exist in Drive but not in the restored sheet.

1. List the quotation folders in `Quotation Archive/<year>/<month>/` and find any
   whose number is absent from the restored `Quotations` sheet.
2. Set `Counters` for the current year to the **highest sequence that exists in
   Drive**, not the highest in the restored sheet. Getting this wrong reissues a
   number that is already on a document a client has.
3. Add the missing rows by hand from the documents in Drive.

**Files.** Drive keeps revisions (_File → Version history_) and a 30-day trash.
The archive replaces file content in place rather than creating new files, so
every regeneration of a document left its predecessor recoverable.

---

## 8. Rollback

**Frontend** — redeploy the previous build in the host's UI. Seconds.

**Backend** — re-point, do not re-push:

```bash
clasp deployments
clasp deploy --deploymentId <production id> --versionNumber <previous>
```

The `/exec` URL does not change, so the frontend needs nothing.

**Never roll back a quotation number.** A rollback restores code, not the
counter. If a bad deploy issued numbers that correspond to no real quotation,
those numbers stay burned — record the gap in `Quotations` with a note. An
explained gap in a sequence is an audit finding with an answer; a reused number
is one without.

### Rehearsing it — do this on **development**, before go-live

1. Deploy the current code as version A. Note the version number.
2. Make a visible, harmless change (a label). Push and deploy as version B.
3. Create a quotation. Note its number — say `…/2026/007`.
4. Roll back to version A with the command above.
5. Confirm: the app works; the change from B is gone; `…/2026/007` still exists
   in the register and in Drive; and the next quotation is `…/2026/008` —
   **not** `007` again.
6. Record the result and the date in §10. A rollback procedure nobody has
   executed is a paragraph, not a procedure.

---

## 9. Incidents

Each starts with what the user sees, because that is what you will be told.

### 9.1 The endpoint is down

_Symptom: every action fails; "Cannot reach the server", or a network error._

1. `curl` the health endpoint (§3.7).
   - **No response / HTML instead of JSON** → the deployment is gone, was
     replaced, or its access setting changed. Apps Script → _Manage
     deployments_: confirm the production deployment still exists and that
     access is still **Anyone**. This is the most common cause: someone
     redeployed with the default settings.
   - **`configured: false`** → a Script Property was cleared. §3.4.
   - **A clean `ok` response** → the backend is fine; the problem is the
     frontend or the network. Check the host's status page and that the site
     loads at all. If the site loads but every call fails, open the browser
     console: a CSP violation on `connect-src` means the endpoint host changed.
2. Check Google Workspace Status Dashboard for an Apps Script incident. If it is
   Google's, there is nothing to do but say so.
3. Tell staff plainly: **do not retype a quotation elsewhere.** Nothing is lost;
   drafts survive, and a quotation created twice by hand is two numbers.

### 9.2 Drive quota exhausted

_Symptom: `DRIVE_QUOTA_EXCEEDED`. The quotation generates but does not save._

The quotation is **not** marked saved and its number **is** still reserved
against the draft id. Nothing is lost and nothing is duplicated.

1. Free space, or buy more, on the account that owns the Shared Drive.
2. Have the user press **Retry Upload**. It reuses the same draft id, the same
   number and the same folder.
3. Do not create a new quotation to work around it — that burns a second number.

### 9.3 The daily Apps Script quota is exhausted

_Symptom: everything fails late in the day, usually near month-end; the
Executions list shows exceeded-quota errors._

Runtime resets on a rolling 24-hour basis; there is no way to raise it on the
day.

1. Immediate: stop non-essential work. Document generation is the expensive
   path; reading the register is cheap.
2. Confirm it is real volume and not a loop — the rate limiter caps
   `quotation.save` at 20/min and 300/min globally, so a runaway client shows as
   `RATE_LIMITED` first.
3. Structural fixes, in order of effort: move the project to a **Google
   Workspace** account (90 minutes → 6 hours), lower
   `DEFAULT_PBKDF2_ITERATIONS` if login is a meaningful share of the runtime
   (weigh against §9.7), or split development onto a different Google account so
   testing stops competing with production.

### 9.4 The spreadsheet is corrupted

_Symptom: the register shows nonsense; saves fail with `SHEETS_WRITE_FAILED`; a
column has shifted._

1. **Stop.** Tell staff to create nothing until it is resolved. Every save
   written into a corrupt sheet is another row to reconcile.
2. Version history first (§7) — it is non-destructive and usually enough.
3. If not, restore from a backup and **reconcile the counter against Drive**
   (§7). The counter is the part that causes lasting damage if it is wrong.
4. Note in §10 what corrupted it. A shifted column is almost always a person
   inserting one, and the fix is telling people rather than restoring again.

### 9.5 A duplicate quotation number appears

_The one that produces two official documents sharing an identifier. Treat it as
serious._

The `Quotations` sheet highlights duplicates with a conditional format, so this
usually surfaces visually.

1. **Establish which is real.** For each, find the Drive folder, the created-at
   timestamp, and the `AuditLog` row. The earlier one, and any document already
   sent to a client, is the real one.
2. **Do not delete a row and do not renumber the real one.** The number is
   immutable once issued; renumbering breaks links already sent.
3. The later duplicate gets a **new** number: recreate that quotation as a new
   one, regenerate its documents, and mark the duplicate row `Rejected` with a
   note pointing at the replacement. If a client has the duplicate, they must be
   sent the replacement.
4. **Then find out how.** Check `Counters` for a hand edit; check whether a
   development deployment was pointed at the production spreadsheet (the usual
   cause); check `Idempotency` for two rows with the same number under different
   draft ids. Record the cause in §10 — the concurrency controls are tested, so
   a genuine duplicate means one of them was bypassed, and knowing which matters
   more than the cleanup.

### 9.6 A user is locked out

_Symptom: "I can't sign in."_

1. **Wrong password** — an Admin sets a new one and delivers it out of band.
   There is no self-service reset and no reset email, by design: the endpoint is
   public, so an unauthenticated "reset my password" action would be a takeover
   primitive.
2. **`RATE_LIMITED` after several attempts** — the window is one minute. Wait,
   then try once, carefully.
3. **Account deactivated** — an Admin reactivates it. Check `AuditLog` for who
   deactivated it and why before doing so.
4. **The only Admin's password is lost** — delete that row from the `Users`
   sheet and repeat §5.1. `provisionFirstAdmin` refuses to run while any account
   exists, which is why the row must go first. **Create a second Admin now**, so
   this is never the situation again.
5. **Everyone at once, suddenly** — `SESSION_HMAC_SECRET` changed. If nobody
   changed it deliberately, go to §9.7.

### 9.7 Secrets suspected compromised

_A laptop lost, a password manager breached, a screenshot in a chat, a departing
administrator._

**First, decide which secret.** They have very different costs.

**`SESSION_HMAC_SECRET`** — cost: everyone signs in again.

1. `npm run secrets:generate`, replace the Script Property.
2. Every existing token fails signature verification on its next request. This
   is the fastest way to revoke every session, and it is safe to do at any time.
3. Tell staff to sign in again.

**`PASSWORD_PEPPER`** — cost: **every account needs a new password.**

1. Rotate **only** on suspected disclosure of the pepper itself. A leaked
   _spreadsheet_ does not require it — the pepper is exactly what makes those
   hashes useless to whoever has them.
2. If you must: generate, replace, then have an Admin set a new password for
   every account, delivered out of band. There is no migration; the plaintext
   needed to re-hash is not stored anywhere, by design.

**Taking the endpoint offline** — when you need it stopped, now:

Apps Script → _Deploy → Manage deployments_ → the production deployment →
_Archive_. The `/exec` URL stops answering immediately. Un-archiving restores
it. Nothing in Drive or Sheets is touched, and no quotation number is affected.

Do this before rotating anything if you believe an attacker has an active
session and is using it — rotation logs them out, archiving stops them reaching
the endpoint at all.

**Then, in every case:** review `AuditLog` for the exposure window, disable any
account that should not exist, rotate the Google account password and check its
2-step verification, and write down in §10 what happened and what was rotated.

---

## 10. The deployment log

Fill this in as you go. It is the answer to "what changed?" when something
breaks three weeks later — `clasp deployments` shows the current version, but
not what was intended, and the two diverge exactly when it matters.

| Date | Env | Apps Script version | Frontend build / commit | By  | Notes |
| ---- | --- | ------------------- | ----------------------- | --- | ----- |
|      |     |                     |                         |     |       |

**Measured once, referenced often:**

|                                                | Value                             | Measured on |
| ---------------------------------------------- | --------------------------------- | ----------- |
| Per-save script runtime                        | _not yet measured_                |             |
| Daily quota (this account type)                | _90 min consumer / 6 h Workspace_ |             |
| `DEFAULT_PBKDF2_ITERATIONS` after tuning       | _not yet tuned_                   |             |
| Rollback rehearsed (§8)                        | _not yet rehearsed_               |             |
| Backup restore rehearsed (§7)                  | _not yet rehearsed_               |             |
| Production smoke test: real quotation or none? | _not yet decided_                 |             |

---

## 11. Development setup checklist

**Everything you must configure by hand to get a working development
deployment.** Nothing in this repository has been deployed and no Google
resource has been created — all of it is below.

Development is a **complete second copy**: its own Drive root, its own
spreadsheet, its own secrets, its own Apps Script deployment. The one thing it
must never share with production is the spreadsheet, because the `Counters`
sheet is the sole authority for the next quotation number, and a development
save against the production sheet issues a real number and burns it.

### Google Drive

- [ ] A folder to act as the development archive root, named so it cannot be
      mistaken for the live one — e.g. `Quotation Archive (DEV)`. A Shared Drive
      is right for production (§1); development may sit in My Drive.
- [ ] `_assets/signatures/` and `_backups/` inside it.
- [ ] Its folder id, from the URL → `DRIVE_ROOT_FOLDER_ID`.
- [ ] Sharing set to **Restricted**.

### Google Sheets

- [ ] An **empty** spreadsheet, e.g. `Quotation Tracking (DEV)`. Create no
      sheets, headers or formatting — the backend does all of that on first use
      (§2.3).
- [ ] Its id, from the URL → `TRACKING_SPREADSHEET_ID`.

### Apps Script project

- [ ] A project owned by the account that owns the development Drive folder.
      For development a personal account is acceptable; **production must be the
      company account** (`DEPLOYMENT.md` §2.1).
- [ ] `clasp login`, then `cp .clasp.json.example .clasp.json` in
      `google-apps-script/` with the script id pasted in. `.clasp.json` is
      git-ignored — it identifies a live deployment.
- [ ] `npm run gas:push`.

### Advanced Drive Service

- [ ] Nothing to switch on by hand. `google-apps-script/appsscript.json` already
      declares it and `clasp push` uploads the manifest:

      "enabledAdvancedServices": [{ "userSymbol": "Drive", "serviceId": "drive", "version": "v3" }]

          It is not optional. `Drive.Files.update` is what replaces a document's
          content in place on a re-save, preserving the file id, the URL and Drive's
          revision history. Without it a regenerated quotation would create a second
          file and the link already sent to a client would point at the old one.

- [ ] If the editor shows the advanced service as off after a push, open
      _Services_ and confirm `Drive v3` is listed, then re-run the deployment.
- [ ] On first run, **authorize the scopes** when prompted — Drive and Sheets.
      Until that is done every call fails with a Drive authorization error.

### Web App deployment

- [ ] _Deploy → New deployment → Web app_.
- [ ] **Execute as: Me** — the account that owns the Drive folder and the
      spreadsheet. The script acts as that identity; there is no service account.
- [ ] **Who has access: Anyone.** Required, not preferred — a cross-origin
      browser `fetch` cannot complete Google's interactive sign-in, so anything
      else makes the app unable to call the backend at all. The URL is therefore
      public and is **not** a security boundary; the boundary is the session
      token plus the per-action check (`DEPLOYMENT.md` §2.3).
- [ ] Copy the **Web app URL** — it must end in `/exec`. A `/dev` URL is bound
      to your editor session and must never be used by a running frontend.

### Script Properties

Set in _Project Settings → Script Properties_. **Names only below — never
commit, print, screenshot or paste a value into an issue or a chat.**

| Property                   | Required  | Where it comes from                                                  |
| -------------------------- | --------- | -------------------------------------------------------------------- |
| `SESSION_HMAC_SECRET`      | yes       | `npm run secrets:generate`                                           |
| `PASSWORD_PEPPER`          | yes       | `npm run secrets:generate`                                           |
| `TRACKING_SPREADSHEET_ID`  | yes       | the development spreadsheet URL                                      |
| `DRIVE_ROOT_FOLDER_ID`     | yes       | the development folder URL                                           |
| `COMPANY_VAT_NUMBER`       | no        | the company's registered number — 15 digits, first and last both `3` |
| `ALLOWED_ORIGINS`          | no        | the dev site origin; defence in depth only                           |
| `COMPANY_CODE`             | no        | `SFC` (default)                                                      |
| `BRANCH_CODE`              | no        | `RUH` (default)                                                      |
| `DOC_TYPE_CODE`            | no        | `QTN` (default)                                                      |
| `BOOTSTRAP_ADMIN_EMAIL`    | temporary | §5.1 — deleted automatically                                         |
| `BOOTSTRAP_ADMIN_PASSWORD` | temporary | §5.1 — deleted automatically                                         |
| `REVOKED_TOKEN_IDS`        | no        | set only when revoking specific sessions                             |

**Generate the development secrets separately from production.** Reusing the
production `SESSION_HMAC_SECRET` would let a token minted by the development
deployment authenticate against production.

The last five have committed defaults and are **not secrets** — they are company
identifiers printed on the quotation itself. Only the first two are confidential;
`DRIVE_ROOT_FOLDER_ID` and `TRACKING_SPREADSHEET_ID` are not secret but are
private, and naming them publicly tells somebody exactly what to try to open.

### Frontend

- [ ] `cp .env.example .env.local`, set `VITE_GAS_ENDPOINT` to the development
      `/exec` URL and `VITE_APP_ENV=development`.
- [ ] `.env.local` is git-ignored. Never commit it, and never point it at
      production — a development build talking to the production endpoint issues
      real numbers.
- [ ] `npm run dev`.

### Confirm it works

- [ ] `health` responds with `"configured": true` and `"missing": []` (§3.7).
      It reports **names only**, never values.
- [ ] Sign in as the bootstrap Admin (§5.1).
- [ ] Work through `quotation-implementation-plan/DEPLOYMENT_CHECKLIST.md`
      sections A and B **against development**. That is what the checklist is
      for, and doing it here is what makes it safe never to do it on production.
- [ ] Install the backup trigger (§4) and run `dailyBackup` once by hand.
- [ ] Rehearse the rollback (§8) and a restore (§7), and record both in §10.
