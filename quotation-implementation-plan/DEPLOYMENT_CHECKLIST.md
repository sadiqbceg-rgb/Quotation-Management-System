# Deployment checklist

Run this **after every deployment**, in order, and record the result.

- **Sections A–C** run against the **development** deployment, in full, before
  production is touched at all.
- **Section D** is what you check on production, and it is deliberately shorter:
  it contains nothing that creates a quotation.

> **Never work through this checklist on production.** Steps 5–27 create a real
> quotation, and a quotation number issued in production is issued for good —
> it cannot be returned, and reusing it would put two official documents into
> the world sharing an identifier. That is why validation happens on
> development, where the counter is a different counter.

Setup procedures are in `RUNBOOK.md`; the reasoning behind each decision is in
`DEPLOYMENT.md`.

|                     |                            |
| ------------------- | -------------------------- |
| Environment         | ☐ development ☐ production |
| Date                |                            |
| Apps Script version |                            |
| Frontend commit     |                            |
| Run by              |                            |

---

## A. Before touching anything

| #   | Check                              | How                                                                                                                                   | ✓   |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --- |
| A1  | The build is clean                 | `npm run typecheck && npm run lint && npm test`                                                                                       | ☐   |
| A2  | The artefact is safe to ship       | `npm run deploy:check` — build, then `verify:build`. Zero failures.                                                                   | ☐   |
| A3  | The right endpoint is baked in     | `verify:build` prints no endpoint failure. Confirm by eye that the URL in the host's environment is the one for **this** environment. | ☐   |
| A4  | Bundle sizes are as expected       | `verify:build`'s report. The PDF and DOCX generators are separate lazy chunks.                                                        | ☐   |
| A5  | The backend is pushed and deployed | `clasp deployments` shows the intended version against the intended deployment id.                                                    | ☐   |
| A6  | The health endpoint is configured  | `curl` per `RUNBOOK.md` §3.7. `"configured": true`, `"missing": []`.                                                                  | ☐   |

---

## B. PRD §45, end to end

Each numbered row is the correspondingly numbered success criterion from
PRD §45. **One quotation, followed the whole way** — the point is not that each
step works in isolation but that the same number arrives intact in all six
places it has to reach.

| §45 | Check                                                                                       | ✓   |
| --- | ------------------------------------------------------------------------------------------- | --- |
| 1   | **Login** succeeds with a correct password                                                  | ☐   |
| —   | **A wrong password fails** — and says only that the credentials are wrong, never which half | ☐   |
| 2   | **New Quotation** opens                                                                     | ☐   |
| 3   | A **client** can be entered                                                                 | ☐   |
| 4   | **"Quotation For"** can be entered                                                          | ☐   |
| 5   | A **quotation number is generated automatically** — and could not be typed                  | ☐   |
| 6   | **Manpower / equipment / materials** can be selected                                        | ☐   |
| 7   | **Items** can be added                                                                      | ☐   |
| 8   | **Quantity** can be entered                                                                 | ☐   |
| 9   | **Unit** can be selected — and finalizing without one is refused                            | ☐   |
| 10  | **Price** can be entered                                                                    | ☐   |
| 11  | **Remarks** can be added, and the column does not print when unused                         | ☐   |
| 12  | **Totals calculate automatically** and cannot be typed over                                 | ☐   |
| 13  | **Terms & conditions** can be selected and reordered                                        | ☐   |
| 14  | **A new term can be created** during the flow                                               | ☐   |
| 15  | The **closing paragraph** is prefilled and editable                                         | ☐   |
| 16  | An **authorized person** can be selected                                                    | ☐   |
| 17  | Their **details and signature appear automatically**                                        | ☐   |
| 18  | The **company seal is on the right** of the signature block                                 | ☐   |
| 19  | The **preview** matches what will be generated                                              | ☐   |
| 20  | The **PDF generates**, opens, and carries the letterhead                                    | ☐   |
| 21  | The **Word file generates** and opens in Word                                               | ☐   |
| 22  | **Both are saved to Google Drive**                                                          | ☐   |
| 23  | Drive shows **Year → Month → Quotation Number**, from the _quotation date_                  | ☐   |
| 24  | The quotation **appears in the tracking sheet**                                             | ☐   |
| 25  | The **Drive folder link in the sheet works**                                                | ☐   |
| 26  | **Status changes** to Approved and persists across a reload                                 | ☐   |
| 27  | **A second quotation increments** — `002` after `001`, no duplicate                         | ☐   |
| 28  | **Zero dummy quotations** — see section C                                                   | ☐   |

### The number, followed

Write the number issued in step 5 here: `SFC/RUH/QTN/________/______`

Then confirm it is _that_ number, unchanged, in each of these:

| Where                    | Form                        | ✓   |
| ------------------------ | --------------------------- | --- |
| The PDF body             | `SFC/RUH/QTN/YYYY/NNN`      | ☐   |
| The Word body            | `SFC/RUH/QTN/YYYY/NNN`      | ☐   |
| The `Quotation No.` cell | `SFC/RUH/QTN/YYYY/NNN`      | ☐   |
| The Drive folder name    | `SFC-RUH-QTN-YYYY-NNN`      | ☐   |
| The PDF filename         | `SFC-RUH-QTN-YYYY-NNN.pdf`  | ☐   |
| The DOCX filename        | `SFC-RUH-QTN-YYYY-NNN.docx` | ☐   |

The slash form is the business identifier; the hyphen form is the same number,
mechanically transformed because Drive cannot hold `/` in a name. **See
`DEPLOYMENT.md` §8: the component ORDER of the hyphen form (UR-01) must be
settled before the first production quotation** — after that, changing it
renames documents whose links have already been sent.

### Document fidelity

| Check                                                                             | ✓   |
| --------------------------------------------------------------------------------- | --- |
| The PDF letterhead matches `reference/`, and is not stretched or offset           | ☐   |
| The seal and the signature sit on the **right**; the person's details on the left | ☐   |
| Every printed figure carries `SAR` and two decimals                               | ☐   |
| The printed column sums to the printed total, exactly                             | ☐   |
| No `{{placeholder}}` survives anywhere in either document                         | ☐   |
| The DOCX opens in real Microsoft Word — not only in a viewer                      | ☐   |

---

## C. No dummy data — PRD §34

Do this **on production, before anyone uses it**, and again after any restore.

| Check                                                           | ✓   |
| --------------------------------------------------------------- | --- |
| `Quotations` has a header row and **no data rows**              | ☐   |
| `Counters` is empty, or holds only the current year at 0        | ☐   |
| `Idempotency` is empty                                          | ☐   |
| `Items` holds only real catalog entries                         | ☐   |
| `Terms` holds only the real imported terms                      | ☐   |
| `AuthorizedPersons` holds only real people with real signatures | ☐   |
| `Users` holds only real staff — no `test@`, no shared account   | ☐   |
| The Drive archive has no year/month folder from a test          | ☐   |
| Nothing anywhere carries the `TEST_ONLY` prefix                 | ☐   |

---

## D. Production, after deploying

Nothing here creates a quotation.

| #   | Check                                                                                                                                         | ✓   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| D1  | The site loads over **HTTPS**, and HTTP redirects to it                                                                                       | ☐   |
| D2  | **Security headers are live** — `curl -sI https://<site>` shows the CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` | ☐   |
| D3  | **The CSP breaks nothing** — sign in, open a quotation, open the preview, with the browser console open. Zero CSP violations.                 | ☐   |
| D4  | **A deep link reloads** — go to `/quotations`, press F5. The SPA fallback answers, not a 404.                                                 | ☐   |
| D5  | **`health` reports configured** against the production endpoint                                                                               | ☐   |
| D6  | **Login works** for a real account                                                                                                            | ☐   |
| D7  | **A wrong password is refused**                                                                                                               | ☐   |
| D8  | **The register loads** (it is empty on day one — that is correct)                                                                             | ☐   |
| D9  | **`index.html` is not cached** and `/assets/*` is — `curl -sI` both and read `Cache-Control`                                                  | ☐   |
| D10 | **The backup trigger exists** — Apps Script → Triggers → one `dailyBackup`, daily                                                             | ☐   |
| D11 | **The archive is not public** — Drive → Share → _Restricted_                                                                                  | ☐   |
| D12 | **`Users` and `AuditLog` are protected and hidden** (once they exist)                                                                         | ☐   |
| D13 | Section **C passes**                                                                                                                          | ☐   |

### The production smoke test — a decision, not a step

The only way to prove production end to end is to create a quotation, and that
consumes a real number permanently.

Choose one, and record which:

- ☐ **No production quotation.** Rely on development validation. Production's
  first quotation is a real one, done by a member of staff, watched.
- ☐ **One real quotation the company intends to keep.** Not a test — a genuine
  quotation for a genuine client, created by staff with someone watching. Its
  number is `001`, and it stays.

Never a third option. A "just checking" quotation in production is a dummy
quotation with a real number attached to it.

---

## E. Rehearsed, at least once, on development

These are not per-deployment. Do them before go-live, then annually.

| Check                                                                             | Procedure          | Date done |
| --------------------------------------------------------------------------------- | ------------------ | --------- |
| **Rollback** — version A, version B, back to A; no number lost or reused          | `RUNBOOK.md` §8    |           |
| **Backup restore** — restore a dated copy and reconcile the counter against Drive | `RUNBOOK.md` §7    |           |
| **The backup actually runs** — run `dailyBackup` by hand, open the copy           | `RUNBOOK.md` §4    |           |
| **Per-save runtime measured** — three quotations, cumulative runtime ÷ 3          | `DEPLOYMENT.md` §4 |           |
| **Password cost tuned** — `measurePasswordHashCost()`, login under ~1.5 s         | `RUNBOOK.md` §3.8  |           |

---

## Sign-off

|                                  |     |
| -------------------------------- | --- |
| Every applicable section passed  | ☐   |
| Failures found (list, or "none") |     |
| Recorded in `RUNBOOK.md` §10     | ☐   |
| Signed                           |     |

A checklist with an unexplained blank is a checklist that was not run. If a step
does not apply, write why.
