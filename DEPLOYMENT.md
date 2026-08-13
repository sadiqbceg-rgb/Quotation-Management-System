# Deployment

How this system is built, verified and deployed, and **why** each decision is
what it is.

- **Procedures you run once, on a new deployment** — `RUNBOOK.md`.
- **The list you tick after every deploy** — `quotation-implementation-plan/DEPLOYMENT_CHECKLIST.md`.
- **What staff need to know** — `docs/USER_GUIDE.md`.
- **Threat model, accepted risks, key rotation** — `SECURITY.md`.

**Nothing in this repository has been deployed.** No Google resource has been
created, no account exists, no secret has been generated, and the frontend
points at no production endpoint. Everything below is a procedure for an
operator to carry out deliberately.

---

## 0. The shape of the thing being deployed

```
   Static host (HTTPS)              Google Apps Script              Google
   ─────────────────────            ──────────────────              ──────
   React SPA  ──── POST ──────────▶  Web App /exec  ──────────────▶  Drive
   dist/, ~3.2 MB                    one endpoint    ──────────────▶  Sheets
```

Three moving parts, two of which are Google's. There is **no server tier and no
database** — that is the V1 architecture, not an interim step.

What this means for deployment:

- The frontend is static files. Deploying it is uploading a directory, and
  rolling it back is uploading the previous one.
- The backend is an Apps Script _deployment_, which is **immutable and
  versioned**. Rolling back is re-pointing a deployment id at an earlier
  version — not a re-push.
- The data lives in Drive and Sheets, which have their own revision history and
  trash. There is no database to migrate, and no migration step in any
  procedure here.

---

## 1. The frontend

### 1.1 Build

```bash
npm ci
npm run assets      # letterhead, keyed seal, logo — generated from reference/
npm run build       # tsc --noEmit, then vite build → dist/
npm run verify:build
```

`npm run deploy:check` runs the last two together.

`prebuild` runs the asset pipeline automatically, so a clean checkout builds
with `npm ci && npm run build`. `reference/` is read and never written.

### 1.2 What `verify:build` refuses to ship

`scripts/verify-build.ts` is pointed at the artefact — not at the source, not at
a rebuild — and exits non-zero on any of:

| Check                                                | Why it is a deploy blocker                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A Script Property name in the bundle                 | Frontend code is reaching for a backend secret. Nothing has leaked _yet_; that is why this fails here.                            |
| Anything credential-shaped                           | A long random value assigned to something named like a secret. The match is never printed — it is the thing being protected.      |
| A development marker                                 | `TEST_ONLY` is the project's prefix for synthetic data. It has no business in the artefact a client's quotation is produced from. |
| An endpoint that is not a real Apps Script HTTPS URL | The mistake that actually happens: a stale `.env.local` bakes a development or intercepted endpoint into a production build.      |
| A published source map                               | Hands out the whole frontend, including every action name and payload shape the backend accepts.                                  |
| An inline `<script>` in `index.html`                 | `script-src 'self'` refuses it. The app breaks in production and works in `vite dev` — and the usual "fix" is to weaken the CSP.  |
| A missing `_headers`                                 | The deployed site would have no CSP, and nothing about it would look wrong.                                                       |
| An unhashed asset                                    | The host caches `/assets/*` for a year. Without a content hash, a user keeps last month's bundle.                                 |
| The PDF or DOCX generator not split out              | Over a megabyte of `pdf-lib` and `docx` paid by every user on every page load, including the login screen.                        |

Run it before every deploy. `.github/workflows/deploy.yml` runs it on the
artefact it is about to publish.

### 1.3 Measured bundle sizes

From `npm run verify:build` on the current build:

```
total          3240.5 KB
javascript     2106.9 KB
entry bundle    602.6 KB
lazy            370.0 KB  docx-generator-*.js
lazy           1131.8 KB  pdf-generator-*.js
```

The entry bundle is what a user pays to reach the login screen. The two
generators are **1.5 MB of the 2.1 MB of JavaScript** and are fetched only when
somebody actually produces a document — which is why they are separate chunks
and why `verify:build` fails if they stop being separate.

The remaining ~1.1 MB is the embedded letterhead PDF, the Carlito fonts and the
keyed seal: hashed, immutable, and cached for a year after first load.

### 1.4 Hosting

Any static host with HTTPS, atomic deploys and instant rollback. Configuration
for the three that were prepared:

| Host             | SPA fallback                      | Headers           | Caching           |
| ---------------- | --------------------------------- | ----------------- | ----------------- |
| Cloudflare Pages | `public/_redirects`               | `public/_headers` | `public/_headers` |
| Netlify          | `netlify.toml` (and `_redirects`) | `public/_headers` | `netlify.toml`    |
| Vercel           | `vercel.json`                     | `vercel.json`     | `vercel.json`     |

`public/_headers` is copied verbatim into `dist/` by Vite and is the **source of
truth for the security policy**. Vercel cannot read it, so `vercel.json`
restates every header; `public/_headers` carries a warning about that, because
a value changed in one and not the other means a Vercel deployment quietly runs
a weaker policy than the one that was reviewed.

Requirements, whichever host is chosen:

- **HTTPS enforced**, HTTP redirected to it.
- **HSTS**: `max-age=31536000; includeSubDomains`. Note that this is a
  commitment — once a browser has seen it, that host is HTTPS-only for a year.
- **SPA fallback to `index.html` with status 200**, never 301. The browser must
  keep the requested path so React Router can read it; a redirect sends every
  deep link to `/`.
- **`/assets/*` immutable for a year**, everything else `must-revalidate`. The
  no-cache rule is the _default_ rather than a rule on `/index.html`, because
  the SPA fallback serves index.html's content at `/quotations/new` — the URL a
  user actually reloads.

### 1.5 Custom domain and certificates

Point a subdomain (`quotations.<company domain>`) at the host per its
instructions — usually a `CNAME`, or an apex `A`/`ALIAS`. All three hosts issue
and renew a certificate automatically once DNS resolves; expect the site to be
unreachable or to show a certificate warning for the few minutes between DNS
propagating and issuance completing.

Do not enable HSTS until the certificate is live and the site loads cleanly over
HTTPS. `includeSubDomains` applies to every subdomain of the domain it is served
from — check that no other subdomain of the company's domain is HTTP-only before
serving it from an apex.

Renewal is automatic. There is nothing to diarise, and nothing in the
application depends on the certificate's identity.

---

## 2. The backend

### 2.1 `clasp`

```bash
npm install -g @google/clasp
clasp login                             # as the COMPANY account, not a personal one
cd google-apps-script
cp .clasp.json.example .clasp.json      # paste the script id; .clasp.json is git-ignored
cd ..
npm run gas:push                        # gas:build, then clasp push
```

`npm run gas:build` bundles `google-apps-script/src/**` into a single
`dist-gas/Code.js` with esbuild, targeting **ES2019** — what the Apps Script V8
runtime supports. Do not raise that target. Never edit `dist-gas/` by hand.

`clasp push` uploads the source. It does **not** change what any existing
deployment serves.

### 2.2 Deploy, version, pin

```bash
clasp deploy --description "v1.0.0 — initial production"     # creates a NEW version + deployment
clasp deployments                                             # list ids and versions
clasp deploy --deploymentId <id> --description "v1.0.1"       # re-point an EXISTING id at a new version
```

The distinction is the whole of the rollback story:

- A **version** is an immutable snapshot of the code.
- A **deployment** is a stable `/exec` URL pointing at one version.

So the production URL never changes, and moving it between versions is a
metadata edit. Record the version number and the date of every production deploy
in the log at the end of `RUNBOOK.md` — `clasp deployments` shows the current
version but not what was intended, and the two diverge exactly when it matters.

### 2.3 Web App settings, and why anonymous access is required

| Setting        | Value                                                   |
| -------------- | ------------------------------------------------------- |
| Execute as     | **Me** — the company account that owns Drive and Sheets |
| Who has access | **Anyone**                                              |

**"Anyone" is required, not preferred.**

Any other setting makes Google intercept the request with its interactive
sign-in flow — an HTML page, a redirect chain, and a cookie exchange on
`accounts.google.com`. A cross-origin browser `fetch` cannot complete that: it
cannot render the consent screen, cannot follow the redirect with credentials,
and receives HTML where it expected JSON. The SPA would be unable to call the
backend at all, for every user, including legitimate ones.

**The consequence, stated plainly: the `/exec` URL is publicly reachable.**
Anyone who has the URL can send a request to it.

**Therefore the URL is not a secret and is not a security boundary.** The
boundary is:

1. Every action is declared in **one** table (`ACTIONS` in
   `google-apps-script/src/main.ts`) with an access level: `public`,
   `authenticated`, or `Admin`.
2. `handlePost` enforces that level **before any handler runs** and before any
   Drive or Sheets access. A handler never authorises itself.
3. Only two actions are `public`: `health`, and `auth.login`. Everything else
   requires a valid HMAC-signed session token, which is issued only against a
   correct password and expires after 8 hours.

That check is the security control. Treating the URL as a secret would be a
control that leaks the first time somebody forwards a link — which is why the
URL is published into the frontend bundle without concern, and why
`verify:build` checks that it is the _right_ endpoint rather than trying to hide
it.

`ALLOWED_ORIGINS` exists as defence in depth and nothing more. Apps Script
cannot enforce CORS, and an attacker's own client does not send an `Origin` it
does not choose.

### 2.4 Two deployments, fully isolated

|                        | Development                  | Production                 |
| ---------------------- | ---------------------------- | -------------------------- |
| Apps Script deployment | its own id and `/exec` URL   | its own id and `/exec` URL |
| Spreadsheet            | its own `Quotation Tracking` | the live one               |
| Drive root             | its own `Quotation Archive`  | the live Shared Drive      |
| `SESSION_HMAC_SECRET`  | its own                      | its own                    |
| `PASSWORD_PEPPER`      | its own                      | its own                    |
| Users                  | test accounts                | real staff                 |

The isolation that matters most is the **spreadsheet**, because the `Counters`
sheet is the sole authority for the next quotation number. A development
deployment pointed at the production spreadsheet issues real numbers and burns
them — and a burned number cannot be returned, because reusing one would produce
two official documents sharing an identifier.

The two deployments may live in the same Apps Script project (two deployment
ids, two versions) or in two projects. Two projects are safer — separate Script
Properties are then structurally impossible to confuse — and one project is less
to maintain. Either is acceptable; **what is not acceptable is one spreadsheet.**

### 2.5 Getting the endpoint into the frontend

Apps Script → **Deploy → Manage deployments** → the deployment → **Web app URL**.
It ends in `/exec`. A URL ending in `/dev` is the always-latest test URL, is
bound to the editor session, and must never be used by a deployed frontend.

Set it as `VITE_GAS_ENDPOINT` in the **host's** build environment (Netlify: Site
settings → Environment variables; Vercel: Project Settings → Environment
Variables; Cloudflare Pages: Settings → Environment variables), per deploy
context. Vite inlines it at build time, so changing it requires a rebuild, not
just a redeploy.

Never commit it. `.env.production.example` carries the empty placeholder;
`.env`, `.env.local` and `.env.production` are git-ignored, and
`src/security/deployment-security.test.ts` walks the full git history asserting
none was ever committed.

---

## 3. Backups

Implemented in `google-apps-script/src/backup/daily-backup.ts`, installed once
by running `installDailyBackupTrigger()` from the Apps Script editor
(`RUNBOOK.md` §4).

- Copies the tracking spreadsheet to `Quotation Archive/_backups/YYYY-MM-DD/`
  daily at 02:00 Asia/Riyadh.
- Prunes dated folders older than **90 days** — and only ever folders matching
  its own `YYYY-MM-DD` naming, so anything an operator puts there by hand is
  left alone.
- Prunes **only after a successful copy**. Pruning on a failed run would leave
  the company with fewer copies than it started with.
- Trashes rather than destroys, so a wrong prune is recoverable for 30 days.
- Idempotent within a day: running it twice by hand does not produce two copies.
- Never throws. A trigger that throws emails the owner and disables itself,
  which is the wrong response to a Drive hiccup at 02:00. The outcome is logged
  and read in the weekly review.

The generated PDFs and Word files need none of this. Drive keeps a revision
history for each and a 30-day trash, and the archive **replaces file content in
place** rather than creating new files, so every regeneration leaves the
previous revision recoverable.

**Objectives**: RPO 24 h for the spreadsheet (Drive files are effectively
continuous); RTO under 2 h. Restore procedure in `RUNBOOK.md` §7.

---

## 4. Monitoring

| What                  | Where                                                  | Normal                                                                   |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Executions and errors | Apps Script editor → **Executions**                    | Every `doPost` `Completed`. A `Failed` row is a real error with a stack. |
| Structured logs       | Apps Script → **Executions** → a row, or Cloud Logging | Every log line carries the `requestId` the user sees in an error toast.  |
| Quota                 | Apps Script → **Executions**, cumulative runtime       | See below.                                                               |
| Backup outcome        | The same Executions list, filtered to `dailyBackup`    | One `Completed` row per night, logging `copied`.                         |
| Audit trail           | The `AuditLog` sheet                                   | One row per state-changing action. Reads are not audited.                |

**Quota.** A consumer Google account allows 90 minutes of script runtime per
day; a Workspace account, 6 hours. The per-save cost on a real deployment
**has not been measured** — every test in this repository runs against
in-memory fakes, which say nothing about Drive and Sheets latency. Measure it on
the **development** deployment during validation (`DEPLOYMENT_CHECKLIST.md`
step 14): create three quotations, read the cumulative runtime from Executions,
and divide. Record the figure in `RUNBOOK.md`'s log. Until it is measured,
headroom is unknown — treat that as an open item, not as "fine".

The application also rate-limits itself, which bounds the worst case
(`google-apps-script/src/security/rate-limiter.ts`): `quotation.save` 20/min,
the two upload paths 10/min each, and 300/min globally across all sessions. For
a company of under ten people (PRD §6) these are invisible in normal use and
catch a client stuck in a loop within seconds.

**Frontend errors.** Every error toast shows a `requestId`. A user reporting a
problem should be asked for it: it is the key that finds the exact execution in
the Apps Script log, and it is why the toast shows something otherwise
meaningless to them.

**Weekly review** — `RUNBOOK.md` §6. Four things: the audit log, the error rate,
quota headroom, and whether the backup ran.

---

## 5. Secrets

Generate the two:

```bash
npm run secrets:generate          # 32 random bytes each, base64url
npm run secrets:generate -- --json
```

The script prints and stops. It writes no file, touches no `.env`, and talks to
no Google service — a secret exists in exactly two places, the terminal it was
printed to and the Script Properties field it was pasted into.

| Property                  | Secret?         | Set to                                   |
| ------------------------- | --------------- | ---------------------------------------- |
| `SESSION_HMAC_SECRET`     | **yes**         | generated                                |
| `PASSWORD_PEPPER`         | **yes**         | generated                                |
| `DRIVE_ROOT_FOLDER_ID`    | no, but private | the `Quotation Archive` folder id        |
| `TRACKING_SPREADSHEET_ID` | no, but private | the `Quotation Tracking` id              |
| `ALLOWED_ORIGINS`         | no              | the site's origin; defence in depth only |
| `COMPANY_CODE`            | no              | `SFC`                                    |
| `BRANCH_CODE`             | no              | `RUH`                                    |
| `DOC_TYPE_CODE`           | no              | `QTN`                                    |
| `COMPANY_VAT_NUMBER`      | no              | the company's registered number          |

The last five are **not secrets** — they are company identifiers printed on the
quotation itself, which is why they carry committed defaults.

Set them in Apps Script → **Project Settings → Script Properties**. Never in a
file, never in CI, never in a commit. Store the two generated values in the
company's password manager, under the company account and not an individual's.

**Rotation** — full procedure and consequences in `SECURITY.md` § _Key
rotation_. In one line each: rotating `SESSION_HMAC_SECRET` signs everyone out
and costs one round of re-authentication; rotating `PASSWORD_PEPPER` invalidates
**every** stored password and requires an Admin to reset every account, because
the plaintext needed to re-hash is not stored anywhere, by design.

---

## 6. Rollback

### Frontend — seconds

Redeploy the previous build through the host's UI. All three hosts keep previous
deploys and roll back atomically. Nothing else is affected: the frontend holds
no state beyond a session token in `sessionStorage`, and users may need to sign
in again if the bundle changed enough to clear it.

### Backend — a re-point, not a re-push

```bash
clasp deployments                                       # find the previous version
clasp deploy --deploymentId <production id> --versionNumber <previous>
```

The `/exec` URL is unchanged, so no frontend rebuild is needed. This is safe
precisely because versions are immutable — the previous version is still exactly
what was tested.

### Data

Drive file revisions and its 30-day trash; the spreadsheet's own version
history; and the daily backups (`RUNBOOK.md` §7).

### What a rollback never does

**It never deletes or reuses an issued quotation number.** Reusing one would
produce two official documents sharing an identifier — a document sent to a
client cannot be un-sent, and the company's own records would then disagree with
themselves.

So a rollback restores _code_, not the counter. If a bad deploy issued numbers
that correspond to no real quotation, those numbers stay burned. Record the gap
in the `Quotations` sheet rather than closing it: an explained gap in a sequence
is an audit finding with an answer; a reused number is one without.

---

## 7. Deployment blockers found in application code

None. No application source was modified in Phase 14 for deployment reasons.

The code added is deployment infrastructure — the backup module, the health and
diagnostics reporting, and the build-verification script — plus one action,
`admin.diagnostics`, registered in the router's `ACTIONS` table alongside the
existing entries.

---

## 8. Before the first production quotation

Three things are open, and two of them are the company's to answer. They do not
block _deploying_; they block the system producing a complete, correct
quotation.

1. **UR-01 — the filename ordering.** The canonical number is
   `SFC/RUH/QTN/YYYY/###`, read directly off the approved document and mandated
   by the brief. The file-safe slug used for Drive folder and file names is
   `SFC-RUH-QTN-YYYY-###`; PRD §5/§28 write the components in a different order,
   `SFC-QTN-RUH-…`. **This must be settled before the first production
   quotation**, because renaming issued documents afterwards means every link
   already sent to a client breaks.

2. **Content the company still owes.**
   - **The signature images.** None exist in this repository. An authorized
     person without one produces a quotation with no signature.
   - **The wording for four PRD §20 terms** — Mobilization, Manpower
     Replacement, Project Specific Terms, and Transportation as a standalone
     term. They have no counterpart in the reference document and are
     deliberately _not_ invented (`import-reference-terms.ts`). An Admin adds
     them through the normal create flow when the company supplies the text.
   - **The closing paragraph** is already seeded verbatim from page 2 of the
     approved quotation, so this one is not a blocker — but PRD §23 defers the
     final wording to the company, and it is editable per quotation and as a
     default.

3. **The password cost has not been tuned.** `DEFAULT_PBKDF2_ITERATIONS` is
   10,000, a starting point rather than a measurement. Run
   `measurePasswordHashCost()` on the development deployment and raise it to the
   highest value keeping a login under ~1.5 s (`SECURITY.md`, _Before go-live_).

### Two surfaces the built system does not have

Stated here so an operator does not go looking for them mid-deployment:

- **Company Settings** (`/settings`) is a placeholder page. Company details on
  the document come from the embedded letterhead itself, which is generated from
  `reference/` and needs no configuration; the VAT number comes from the
  `COMPANY_VAT_NUMBER` Script Property with a validated default; the closing
  paragraph and validity days come from `shared/company-defaults.ts`. So there
  is nothing an operator must fill in — but there is also no screen on which to
  change these without a redeploy.
- **The customer library** (`/customers`) is a placeholder page, and there is no
  `Clients` sheet. Client details are typed per quotation.

Both are gaps against `IMPLEMENTATION_PLAN.md` §17.3, not deployment blockers.
Adding them would be a new feature, which Phase 14 excludes.

---

## 9. What is deliberately not automated

- **The Apps Script deploy.** `clasp` needs an OAuth refresh token with write
  access to the company's Drive and Sheets. In a CI secret store, that token is
  held by every workflow run and by everyone who can edit a workflow file. It is
  deployed by an operator from a workstation.
- **Push-to-production.** `.github/workflows/deploy.yml` is
  **`workflow_dispatch` only**, requires typing `DEPLOY` to confirm, and uses a
  GitHub Environment so `production` can require a reviewer. A merge to `main`
  must never reach the live endpoint on its own: numbers are issued by the
  backend and are immutable, and no rollback gives a burned number back.
- **Creating Google resources, accounts or data.** Every one of those is a
  deliberate act in `RUNBOOK.md`, performed by a person who can see what they
  are about to change.
