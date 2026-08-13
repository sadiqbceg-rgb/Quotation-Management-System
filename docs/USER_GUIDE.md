# Quotation System — user guide

For everyone at Speed Falcon who creates or manages quotations.

This is the whole system in one document. It assumes nothing technical, and it
tells you plainly which things cannot be undone — there are only a few, but they
matter.

---

## Contents

1. [Signing in](#1-signing-in)
2. [What is on screen](#2-what-is-on-screen)
3. [Creating a quotation](#3-creating-a-quotation)
4. [The quotation number](#4-the-quotation-number)
5. [The PDF and the Word file](#5-the-pdf-and-the-word-file)
6. [Where the documents are kept](#6-where-the-documents-are-kept)
7. [The register, and marking a quotation approved](#7-the-register-and-marking-a-quotation-approved)
8. [The libraries: items, terms, signatories](#8-the-libraries)
9. [When something goes wrong](#9-when-something-goes-wrong)
10. [For administrators](#10-for-administrators)

---

## 1. Signing in

Your account is created for you by an administrator, and your first password is
given to you directly. There is no "sign up" and no "forgot password" link —
if you cannot get in, an administrator sets a new password for you.

- **Use your own account.** Never share one. The system records who created each
  quotation and who approved it, and a shared account makes that record
  worthless.
- **You are signed out after 8 hours**, and when you close the browser. Signing
  in again is all that is needed; nothing is lost.
- **Several wrong passwords in a row** will pause your attempts for a minute.
  Wait, then try once, carefully.

---

## 2. What is on screen

| Page              | What it is for                                                         |
| ----------------- | ---------------------------------------------------------------------- |
| **Dashboard**     | The starting point.                                                    |
| **Quotations**    | Every quotation, newest first. Search it, open one, change its status. |
| **New Quotation** | The form. Most of your time is here.                                   |
| **Items**         | The catalog of services and roles you can add to a quotation.          |
| **Terms**         | The library of terms and conditions.                                   |
| **Signatories**   | The authorized people who can sign a quotation, and their signatures.  |

Two pages are visible but not yet built: **Customers** and **Company Settings**.
Client details are typed on each quotation for now.

---

## 3. Creating a quotation

Work down the form. Nothing is sent anywhere until you finalize it at the end.

**Client details.** Client name, company, address, the person it is addressed to,
and what the quotation is for. These print at the top of the document, under the
letterhead.

**The date.** This is the quotation's own date — and it decides two things you
cannot change later: the **year in the quotation number**, and the **folder the
documents are filed in**. Check it before you finalize. It is not today's date
unless you make it so.

**Items.** Add a line for each service or role. Pick from the Items list or type
your own. Each line needs a **description, a quantity, a unit and a rate** — all
four. The amount is calculated for you and cannot be typed over: this is the one
place where the total on a document a client receives is guaranteed to match its
lines.

Turn on the **Remarks column** if you need a note against individual lines. Leave
it off and it does not print at all.

**Terms and conditions.** Pick from the Terms library and reorder them. Some
terms contain placeholders like `{{rate}}` — replace those with the real figure
for this quotation. **A placeholder left unresolved will be flagged and must be
fixed before you can finalize**, because a blank where a price belongs is worse
than no document at all.

**Closing paragraph.** Prefilled with the company's standard wording. Edit it for
this quotation if you need to.

**Signatory.** Choose the authorized person who is signing. Their name,
designation and signature image go on the document. If somebody is missing from
this list, an administrator adds them.

**Then finalize.** The system checks everything first. If something is missing it
tells you exactly what and where — fix it and finalize again. Nothing has been
issued at this point.

---

## 4. The quotation number

It looks like this:

```
SFC/RUH/QTN/2026/004
```

`SFC` Speed Falcon Company · `RUH` Riyadh branch · `QTN` quotation · the year
from the quotation date · then the sequence, counting up from 001 each year.

**Three things to understand about it:**

1. **You never type it.** The system issues it, and it is the same number in the
   PDF, in the Word file, in the folder name, in the filenames and in the
   register. There is no way for those to disagree.

2. **It is issued once and never changes.** Editing a finalized quotation — even
   changing every line on it — keeps its number. This is deliberate: the client
   already has a document with that number on it.

3. **A number is never reused.** If two people finalize at the same moment they
   get different numbers; the system will not give the same one out twice. If a
   quotation is abandoned after being finalized, its number stays used and there
   will be a gap in the sequence. **That gap is correct.** Do not try to fill it.

---

## 5. The PDF and the Word file

Every finalized quotation produces both, automatically:

- **The PDF** is what you send to the client. It is the official document: the
  company letterhead, the seal and the signature, laid out exactly as the
  approved quotation.
- **The Word file** is the same content, for when somebody needs to work with the
  text.

Both may take a few seconds — the PDF is built page by page with the real
letterhead and fonts embedded, so it looks the same on any computer and prints
correctly.

**If you need a change:** edit the quotation and regenerate. The new documents
replace the old ones in the same folder, under the same number. The previous
version is still recoverable through Google Drive's own version history — nothing
is lost, and no second number is created.

---

## 6. Where the documents are kept

Google Drive, filed automatically:

```
Quotation Archive/
└── 2026/
    └── August/
        └── SFC-RUH-QTN-2026-004/
            ├── SFC-RUH-QTN-2026-004.pdf
            └── SFC-RUH-QTN-2026-004.docx
```

The year and month come from the **quotation date**, not from when you created
it. The folder name uses hyphens because Drive cannot have `/` in a name — it is
the same number.

Every row in the register links straight to its folder. If a link tells you that
you do not have access, ask an administrator for access to the Drive — it is a
Drive permission, and nothing the application can change for you.

---

## 7. The register, and marking a quotation approved

The **Quotations** page is the register: number, date, client, company, what it
is for, the total, the status and a link to the documents.

Every quotation starts as **Pending**. When you hear back, set it to **Approved**
or **Rejected**. The change is recorded with your name and the time.

This is the company's record of what was quoted and what came of it. It is worth
keeping current — it is the only place that knows.

---

## 8. The libraries

**Items** — the services and roles that appear on quotations, with their usual
unit. Adding one here saves retyping it. Deactivating one hides it from new
quotations without touching any existing quotation that used it.

**Terms** — the terms and conditions library, grouped by category and ordered.
Editing a term here changes what future quotations _start_ with; it does **not**
alter any quotation already issued. That is deliberate — a document a client
holds must not change because somebody edited a library afterwards.

**Signatories** — the authorized people who can sign, each with their real
signature image and designation. Only an administrator can add one or upload a
signature.

---

## 9. When something goes wrong

**"Quotation was generated, but saving to Google Drive failed."**
The documents were produced and the number is yours — it is held for this
quotation and nobody else can get it. Press **Retry Upload**. It uses the same
number and the same folder.
**Do not start a new quotation to get around this.** That consumes a second
number for the same job.

**"System busy, please try again."**
Two people finalized at the same instant. Wait a moment and try again — this is
the system making sure you each get your own number.

**Anything else, or the same error twice.**
Every error message shows a **request ID** — a short code like
`a1b2c3d4-…`. Send it with your report. It is how whoever looks into it finds
exactly your request in the log, and without it they are searching blind.

**If nothing works at all,** tell an administrator and wait. Do not retype the
quotation somewhere else: your draft is safe, and a quotation typed twice
becomes two numbers and two documents.

---

## 10. For administrators

**Accounts.** Create one per person, with a generated password given to them
directly — not in the same message as the site address. Deactivate an account
the day somebody leaves; their quotations and their history stay intact.

**Signatures.** Upload the real signature image for each authorized person. A
signatory without one produces a quotation with no signature on it.

**Terms.** The library is imported once from the company's own terms document.
Four terms have no agreed wording yet — Mobilization, Manpower Replacement,
Project Specific Terms, and Transportation. Add them when the company decides
the text. **Do not invent wording**: these are terms the company is bound by.

**The tracking spreadsheet.** Staff may read it. Two rules:

- **Never edit the `Counters` sheet.** It holds the next quotation number. A
  well-meant correction there either burns a number or causes two quotations to
  share one.
- **Never delete a row from `Quotations`.** If a quotation was wrong, mark it
  Rejected with a note. The number stays used, and that is correct.

Operational procedures — backups, restores, incidents — are in `RUNBOOK.md`.
