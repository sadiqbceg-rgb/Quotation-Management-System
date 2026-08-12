# Quotation Management & Generation System — V1 Implementation Plan

**Company:** Speed Falcon Company (SPEED-X FALCON), Kingdom of Saudi Arabia
**Repository:** `sadiqbceg-rgb/Quotation-Management-System`
**Planning branch:** `claude/quotation-app-architecture-ycbwpa`
**Document status:** Planning only — no application code has been written.
**Sources of truth:** `PRD/quotation-prd.md`, `reference/quotation-sample.pdf`, `reference/letterhead.pdf`, `reference/existing-terms.docx`, `reference/company-logo.png`, `reference/company-seal.png`

---

## 1. Executive Summary

### 1.1 What this system is

A single-purpose, internal web application that replaces the manual preparation of Word quotations at Speed Falcon Company. An authenticated staff member enters only the variable parts of a quotation (client, subject, line items, terms selection, signatory). The system supplies everything else automatically: the quotation number, the date, all arithmetic, the table structure, the letterhead, the signature, the company seal, the PDF, the DOCX, the Google Drive filing, and the Google Sheets tracking row.

It is explicitly **not** an ERP, CRM, invoicing system, or approval-workflow engine (PRD §1, §44).

### 1.2 Repository state

The repository is **greenfield**. It contains exactly six files across two folders:

```
PRD/quotation-prd.md              (26,583 bytes, 1,376 lines — complete V1 PRD)
reference/quotation-sample.pdf    (2 pages, A4, real approved quotation)
reference/letterhead.pdf          (1 page, A4, blank company letterhead)
reference/company-logo.png        (1100×606 — actually a JPEG, see §2.4)
reference/company-seal.png        (1312×1199 PNG, RGB, no alpha)
reference/existing-terms.docx     (11 master Terms & Conditions)
```

There is **no** `package.json`, `tsconfig.json`, `vite.config.*`, `src/`, `public/`, lockfile, CI configuration, `.gitignore`, `.env*`, `README`, or any other source artefact. Git history is a single commit (`ca658d9 Add files via upload`).

**Consequence:** there is no existing framework, React version, router, state manager, UI kit, component library, service layer, auth implementation, document generator, or integration to preserve. Every technology decision in this plan is an original decision, constrained by the PRD, not a migration.

### 1.3 The V1 architecture (mandatory)

```
React + TypeScript SPA (static hosting, HTTPS)
                │
                │  HTTPS POST, JSON-as-text/plain (no CORS preflight)
                ▼
      Google Apps Script Web App  ← the only trusted boundary
                │
        ┌───────┴────────┐
        ▼                ▼
  Google Drive     Google Sheets
  (PDF + DOCX)     (tracking, counters, users, master data)
```

No Supabase. No PostgreSQL. No traditional database. No Node/Express server. (PRD §4, §47.)

### 1.4 The three findings that shape everything

1. **The real quotation number format is `SFC/RUH/QTN/2026/004`.** This is read directly off page 1 of `reference/quotation-sample.pdf`. It matches the mandated format in the task brief and **contradicts** the `SFC-QTN-RUH-2026-001` form written in PRD §5/§9/§28. The slash form wins as the canonical business identifier; the hyphen form is a derived filesystem-safe slug. See §7 and §26 (UR-01).

2. **`reference/letterhead.pdf` is a complete, vector, A4 letterhead page** with embedded fonts (Tajawal-Bold for Arabic, Aptos for Latin), the SPEED-X FALCON logo, the Vision 2030 emblem, the red header rule, the centred watermark, and the three-column footer. It can be embedded page-for-page as the background of every generated PDF page. This removes the hardest problem in the project — Arabic text shaping — because the Arabic is already rendered as vectors and never has to be re-typeset. See §13.

3. **The approved quotation carries no monetary totals block.** The sample quotes hourly rates (`SAR 20.00 / Hour`) with a headcount summary (`Total Manpower: 41 Persons`) and handles VAT as a *term* ("15% VAT will be charged additionally"), not as a line in a totals table. PRD §19 nevertheless mandates subtotal / discount / VAT / grand total. Both must be supported; the totals block is conditional. See §8 and §26 (UR-04).

### 1.5 Delivery shape

Fifteen sequential phases (00–14), each a standalone Claude Code prompt in `quotation-implementation-plan/prompts/`. Each phase ends with typecheck + lint + build + tests green, and a commit. No phase implements another phase's scope.

---

## 2. Current Repository Analysis

### 2.1 Inventory (verified, not assumed)

| Path | Type | Verified facts |
|---|---|---|
| `PRD/quotation-prd.md` | Markdown | 1,376 lines, 47 numbered sections, read in full |
| `reference/quotation-sample.pdf` | PDF 1.7 | 2 pages, 595.32×841.92 pt (A4), produced by Microsoft Word 2021, title "Speed Falcon Company Letterhead", created 2026-08-11 |
| `reference/letterhead.pdf` | PDF 1.4 | 1 page, 595.5×842.25 pt (A4), produced by Canva, title "Speed Falcon Company LH" |
| `reference/company-logo.png` | **JPEG** | 1100×606, RGB, white background, **no alpha**, `.png` extension is wrong |
| `reference/company-seal.png` | PNG | 1312×1199, RGB, **no alpha channel**, near-white background (252–254) |
| `reference/existing-terms.docx` | OOXML | 1 heading + 11 numbered terms, author "Gautham N Holla" |

### 2.2 What does *not* exist

No build tooling, no dependency manifest, no source tree, no tests, no CI, no environment files, no Google Apps Script project, no deployment configuration, no documentation beyond the PRD.

### 2.3 Technical debt and incomplete features

There is no code, therefore no code-level technical debt. The debt that exists is **specification debt**, carried in the reference material itself:

- **D-1 — Numbering format contradiction.** PRD text vs. the actual approved document (§1.4 finding 1).
- **D-2 — `company-logo.png` is a JPEG.** Any loader that trusts the file extension will mis-decode it. Assets must be sniffed by magic bytes (`FF D8 FF` = JPEG, `89 50 4E 47` = PNG).
- **D-3 — `company-seal.png` has no alpha channel.** Placed over any non-white background it paints an opaque white rectangle. The sample PDF gets away with this because the seal sits at (373.7, 550.9)–(492.7, 659.7) and the watermark occupies (148.1, 333.5)–(466.2, 508.4) — they do not overlap. Any layout change can break this. A transparency-keyed derivative asset is required.
- **D-4 — No signature assets exist.** PRD §24 requires a signature image per authorized person. `reference/` contains none. The only signature in the repository is embedded inside `reference/quotation-sample.pdf` (xref 39, 215×176 PNG **with** an alpha soft-mask) and belongs to one specific person. Real signature files must be supplied by the company before Phase 06 can be completed with production data.
- **D-5 — The master T&C file contains unfilled placeholders.** `existing-terms.docx` contains the literal strings `{SAR  }` and `{company}`. These are template slots, not content. This proves the T&C library needs a token-substitution mechanism (§10).
- **D-6 — Letterhead geometry differs slightly between the two PDFs.** The Canva letterhead places the logo at (13.9, 14.8)–(139.2, 83.8) with the red rule at y≈67; the Word-produced sample places it at (34.0, 13.8)–(183.8, 96.2) with the red rule at y≈83.5 and an amber footer rule at y≈776. They are two renderings of the same brand. `letterhead.pdf` is the authoritative blank.
- **D-7 — Address is required by PRD §12 but absent from the approved layout.** The sample's client block is: Quotation For / Quotation No. / Date / Attention / Client. No address line.

### 2.4 Reference assets — measured specifications

Everything below is measured, not estimated.

**Page (both PDFs):** A4, 595.28 × 841.89 pt nominal.

**Letterhead furniture (`reference/letterhead.pdf`):**

| Element | Rect (pt, top-left origin) | Size |
|---|---|---|
| SPEED-X FALCON logo | (13.9, 14.8) – (139.2, 83.8) | 125.3 × 69.0 |
| Arabic company name (Tajawal-Bold) | (215.3, 16.4) – (398.7, 38.4) | — |
| `SPEED FALCON COMPANY` (Aptos-Bold, `#d4292e`) | (191.1, 43.3) – (422.9, 64.3) | 20 pt |
| Vision 2030 emblem | (498.3, 2.9) – (580.9, 65.9) | 82.6 × 63.0 |
| Red header rule `#d4292e` | (185.0, 66.5) – (595.3, 68.0) | 1.5 pt tall |
| `C.R. 7050577670` / `٠٧٦٧٧٥٠٥٠٧ :.س.ت` | (187.2, 73.5) – (426.4, 85.5) | 12 pt bold |
| Watermark (logo, light grey) | (148.1, 333.5) – (466.2, 508.4) | 318.1 × 174.9, page-centred |
| Footer rule | (0, 779.4) – (595.3, 782.4) | full width |
| Footer col 1 — Head Office, Makkah Street, Al Jubail | x from 13.9, y 792.9–833.8 | 11 pt bold label / 10 pt body |
| Footer col 2 — Branch Office, Al Murabba District, Riyadh | x from 185.1 | — |
| Footer col 3 — Mob. +966 57 853 2985 / info@speedxksa.com / www.speedxksa.com | x from 425.4 | — |

**Body text box (measured from `reference/quotation-sample.pdf`):**

| Property | Points | Millimetres | Twips (DOCX) |
|---|---|---|---|
| Left margin | 34.0 | 12.0 | 680 |
| Right margin | 12.9 | 4.6 | 258 |
| Top margin (body start) | 111.0 | 39.2 | 2220 |
| Bottom margin (body end 760) | 82.0 | 28.9 | 1640 |
| Usable text width | 548.4 | 193.4 | — |
| Usable text height | 649.0 | 228.9 | — |

**Typography (sample):** body Calibri 14 pt; bold labels Calibri-Bold 14 pt; intra-paragraph leading ≈ 18.0 pt; paragraph space-after ≈ 7.7 pt; numbered-list item pitch 25.7 pt. Header company name 20 pt bold; C.R. line 12 pt bold; footer labels 11 pt bold, footer body 10 pt.

**Brand colours:** red `#d4292e`; navy `#002060` (company name in the signature block); hyperlink blue `#0563c1`; footer rule amber `#ffbd59`.

**Items table (sample, page 1):** page-centred, spanning x 70.7 → 524.6 (width 453.9 pt, centre 297.65 = exact page centre). Three columns with vertical rules at x = 70.7 / 261.9 / 361.1 / 524.1 → widths 191.2 / 99.2 / 163.0 pt. Row bands at y = 358.7 / 392.6 / 426.3 / 461.2 → header 33.9 pt, body rows ≈ 33.9 pt. Borders 0.5 pt solid black. Header row bold, no fill.

**Signature block (sample, page 2):**

| Element | Position |
|---|---|
| Name (bold, 14 pt) | x 34.0, y 578.8 |
| Designation (bold) | x 34.0, y 604.4 |
| Company (bold, `#002060`) | x 34.0, y 630.0 |
| Country | x 34.0, y 655.7 |
| `Mobile :` + number (bold) | x 34.0, y 681.2 |
| `Email:` + address (bold, `#0563c1`, underlined) | x 34.0, y 706.9 |
| **Company seal** | (373.7, 550.9) – (492.7, 659.7) = 119.0 × 108.8 pt |
| `Signature:______________` label | baseline ≈ y 716, starting x ≈ 495 |
| **Signature image** | (392.8, 676.1) – (463.0, 733.6) = 70.2 × 57.5 pt |

Note the actual arrangement: the **person's text details are on the left**, and **both the seal (upper) and the signature image (lower) are on the right**. PRD §25 describes "signature left, seal right". The approved document is authoritative; PRD §25's hard requirement — "The company seal must appear on the right side of the page" — is satisfied by the reference layout. See §26 (UR-05).

### 2.5 Reference quotation — document structure

Reconstructed section order from `reference/quotation-sample.pdf`:

1. Letterhead header (repeats on every page)
2. Quotation meta block, left-aligned, bold labels: `Quotation For:` / `Quotation No.:` / `Date:` (format `11-08-2026`, i.e. `DD-MM-YYYY`) / `Attention:` / `Client:`
3. `1. Scope of Work` — numbered heading + intro paragraph + items table + a category summary line (`Total Manpower: 41 Persons`)
4. `2. General Terms & Conditions` — numbered heading + a numbered list of terms, each `**Title:** body`
5. Closing paragraph (two paragraphs in the sample: a thank-you, then the PO request)
6. Signature block (left details, right seal + signature)
7. Letterhead footer (repeats on every page)

There are no page numbers in the approved document. The document flows across pages purely by content.

### 2.6 Reference Terms & Conditions — full extraction

`reference/existing-terms.docx`, heading "General Terms & Conditions", 11 numbered items. Extracted verbatim:

| # | Title | Body |
|---|---|---|
| 1 | Working Hours | Minimum 10 hours per day, 6 days per week. |
| 2 | Manpower Rate | The agreed manpower rate is `{SAR  }`per hour per person for Carpenters and Steel Fixers. |
| 3 | Overtime | Overtime, if required, shall be calculated on a pro-rata basis against the agreed hourly rate. |
| 4 | Timesheet & Attendance | Daily attendance and timesheets shall be maintained and approved by the Client's authorized representative. Approved timesheets shall be submitted before the 5th day of the following month for invoicing purposes. |
| 5 | Food, Accommodation & Transportation | Food, accommodation, transportation, and emergency medical support shall be provided by `{company}` |
| 6 | Site Requirements | The Client shall provide all necessary site access, permits, work areas, tools/equipment where applicable, and other site requirements necessary for the manpower to perform their assigned duties. |
| 7 | Payment Terms | Payment shall be made within 30 days against approved timesheets and submitted invoices. |
| 8 | Additional Requirements | Any additional manpower, scope of work, working hours, or requirements outside the agreed scope shall be mutually agreed and priced separately. |
| 9 | VAT | 15% VAT shall be added to the quoted rates as applicable. |
| 10 | Payment Method | Payment shall be made through bank transfer to the company's designated bank account. |
| 11 | Quotation Validity | This quotation shall remain valid for 7 days from the date of issue. |

The sample quotation used a client-specific instantiation of 13 terms derived from these. This is direct evidence for the template-token design in §10 and the quotation-local override rule in PRD §22.

---

## 3. Existing Technology Stack

**Existing:** none. Node v22.22.2 and npm 10.9.7 are available in the environment. Nothing is installed or configured in the repository.

### 3.1 Selected stack for V1

| Concern | Choice | Reason |
|---|---|---|
| Build tool | **Vite 7** | PRD §3 offers "Vite or Next.js". Vite wins: the app is a fully authenticated SPA with zero SEO need; the backend is Google Apps Script, so there is no Node runtime to host Next.js server features; the output is static files deployable to any HTTPS host; document generation is client-side and needs browser APIs. Next.js would add a server tier the architecture forbids. |
| UI | **React 19 + TypeScript 5.9 (`strict`)** | PRD §3. |
| Routing | **React Router 7** (declarative/data router, `createBrowserRouter`) | Standard for Vite SPAs; supports nested layouts and route-level guards for PRD §7's eight navigation destinations. |
| Styling | **Tailwind CSS 4** | PRD §3, plus PRD §38's "clean / corporate / no decoration" brief maps well to a constrained utility system. |
| Component primitives | Hand-built on **Radix UI** primitives (dialog, select, checkbox, dropdown) | Accessibility for the modal in PRD §21 and the selects in §13/§24 without importing a heavy visual kit that fights the corporate brief. |
| Server state | **TanStack Query 5** | Every read/write is a remote call to Apps Script. Query gives caching, retry-with-backoff (needed for PRD §37 retries), and mutation state for free. |
| Form state | **React Hook Form 7 + Zod 4** | The quotation form is large, deeply nested (categories → line items) and array-heavy (`useFieldArray`). Zod schemas are shared with the backend validator so the same rules run in both places (§19). |
| PDF | **pdf-lib 1.17 + @pdf-lib/fontkit** | §13. |
| DOCX | **docx 9** | §14. |
| Money | Hand-written integer-minor-unit module, no dependency | §8. |
| Testing | **Vitest 3 + @testing-library/react + jsdom**; **Playwright** for the document-generation smoke tests | §20. |
| Lint/format | **ESLint 9 flat config** (`typescript-eslint`, `react-hooks`, `jsx-a11y`) + **Prettier 3** | §20. |
| Backend | **Google Apps Script (V8)**, authored in TypeScript, bundled with **esbuild**, deployed with **clasp** | §15. |

### 3.2 Rejected options and why

- **Supabase / PostgreSQL / any database** — explicitly forbidden (PRD §4, §47; task brief §4).
- **Next.js** — needs a Node server for anything beyond static export; the architecture has no server tier.
- **Redux / Zustand for server data** — the app has almost no client-only global state beyond the auth session and the in-progress quotation draft. React Context + TanStack Query covers it.
- **html2canvas + jsPDF** — rasterises the page. Produces non-selectable, non-searchable, blurry-at-print output and cannot reproduce the vector letterhead. Unacceptable for official company documents.
- **@react-pdf/renderer** — cannot embed an existing PDF page as a background, so the letterhead would have to be rebuilt from scratch, including Arabic shaping.
- **Puppeteer / headless Chrome HTML→PDF** — requires a Node server. Not available.
- **docxtemplater** (DOCX from a .docx template) — attractive, but the company supplied no `.docx` quotation template, only a PDF. Building the DOCX programmatically with `docx` gives full control over headers, footers, floating images, and repeating table headers.

---

## 4. Existing Code That Can Be Reused

**None.** The repository contains no source code. This section exists to record that finding explicitly so that no later phase assumes a component, hook, service, or utility already exists.

What *is* reusable — as inputs, never to be modified:

| Asset | Reused as |
|---|---|
| `reference/letterhead.pdf` | Vector background page for every generated PDF page; the geometric spec for the DOCX header/footer |
| `reference/company-logo.png` | DOCX header logo and DOCX watermark (after JPEG-aware decoding) |
| `reference/company-seal.png` | Seal in PDF and DOCX (after producing an alpha-keyed derivative) |
| `reference/existing-terms.docx` | The 11 seed terms for the T&C library, imported by an explicit admin action |
| `reference/quotation-sample.pdf` | The layout specification and the visual acceptance target |

Reuse discipline within the project itself is enforced per phase: each prompt requires inspecting what earlier phases produced and forbids duplicating it.

---

## 5. Business Workflow

### 5.1 Lifecycle (PRD §42, reconciled with §35)

```
Login
  └─ session token issued by Apps Script

Dashboard
  └─ no quotation exists yet; nothing is created by opening the app  (PRD §35)

New Quotation                       ← user action; a client-side draftId (UUID v4) is minted
  ├─ Quotation Information          (Quotation For, date, currency, VAT/discount toggles)
  ├─ Client Information             (name, company, address required; contact/email/phone/project optional)
  ├─ Quotation Items                (Manpower / Equipment / Materials — one table per category used)
  │     └─ per line: description, qty, unit, rate → amount (auto)
  ├─ Terms & Conditions             (select from library, edit locally, or create new)
  ├─ Closing Message                (configurable paragraph)
  └─ Authorized Person              (select → name/designation/company/email/phone/signature auto-filled)

Preview                             ← renders the shared document model at A4
  └─ Validate (PRD §36); blocks export while invalid

Finalize & Save                     ← the ONLY point a quotation number is issued
  ├─ POST /reserveQuotationNumber { draftId, quotationDate }
  │     └─ Apps Script: LockService → Counters sheet → SFC/RUH/QTN/YYYY/NNN  (idempotent on draftId)
  ├─ Generate PDF (client)
  ├─ Generate DOCX (client)
  ├─ POST /saveQuotation { number, payload, pdfBase64, docxBase64 }
  │     ├─ server re-validates and re-computes all totals
  │     ├─ Drive: Quotation Archive / YYYY / MonthName / SFC-RUH-QTN-YYYY-NNN /
  │     │           SFC-RUH-QTN-YYYY-NNN.pdf
  │     │           SFC-RUH-QTN-YYYY-NNN.docx
  │     └─ Sheets: append/update the Quotations row (status = Pending)
  └─ Success: show the Drive folder link

Edit an existing quotation
  └─ the quotation number is loaded from the record and is immutable; re-saving
     replaces the files in the same folder — it never issues a new number
```

### 5.2 Divergences from the PRD's stated workflow

- PRD §42 places the number generation implicitly early; PRD §35 forbids creating one on app open. The workflow above resolves this: a **client-side draft id** carries the quotation until finalize, and the **official number is reserved once, server-side, at finalize** — and is then permanent.
- PRD §42 shows "Generate PDF → Generate DOCX → Save to Google Drive" as separate steps. Preview/Print/Save-as-PDF/Save-as-Word (PRD §29) remain available as local downloads without a number only for *drafts*; any document that is saved to Drive must carry an official number (PRD §30 step 2).

### 5.3 Status lifecycle

`Pending` (default on save) → `Approved` | `Rejected`. Status is owned by the Google Sheet (PRD §31) and is editable there by staff; the app reads it for display and may write it back from the Quotations list. No approval workflow, no notifications (PRD §44).

---

## 6. Quotation Data Model

All types live in `src/types/` and are re-exported to the Apps Script build through the shared module (§15.3) so the frontend and backend cannot drift.

### 6.1 Core entities

```ts
type QuotationStatus = 'Pending' | 'Approved' | 'Rejected';
type ItemCategory    = 'Manpower' | 'Equipment' | 'Materials';
type PricingMode     = 'amount' | 'rate-only';   // see §26 UR-04

/** Money is always an integer count of halalas (1 SAR = 100 halalas). */
type Halalas = number;
/** Quantity is always an integer count of thousandths (1.5 → 1500). */
type Milli = number;

interface QuotationNumber {
  readonly canonical: string;   // "SFC/RUH/QTN/2026/004"
  readonly fileSafe: string;    // "SFC-RUH-QTN-2026-004"
  readonly year: number;        // 2026
  readonly sequence: number;    // 4
}

interface ClientInfo {
  clientName: string;           // required (PRD §12)
  companyName: string;          // required
  address: string;              // required
  contactPerson?: string;       // rendered as "Attention:" (reference layout)
  email?: string;
  phone?: string;
  projectName?: string;
  projectLocation?: string;
  clientReference?: string;
}

interface LineItem {
  id: string;                   // client-generated UUID, stable for reordering
  category: ItemCategory;
  description: string;          // Designation | Equipment Description | Material Description
  quantity: Milli;              // > 0
  unit: string;                 // from the category unit list, or a custom string
  unitPrice: Halalas;           // >= 0
  amount: Halalas;              // derived; never user-entered
  remarks?: string;
  sortOrder: number;
}

interface CategoryBlock {
  category: ItemCategory;
  items: LineItem[];
  subtotal: Halalas;            // derived
  summaryLine?: string;         // e.g. "Total Manpower: 41 Persons" (reference)
}

interface QuotationTerm {
  id: string;                   // library id, or "local:<uuid>" for quotation-only terms
  title: string;
  body: string;                 // already token-resolved at document build time
  sortOrder: number;
  source: 'library' | 'library-overridden' | 'quotation-local';
}

interface AuthorizedPersonSnapshot {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  signatureFileId: string;      // Drive file id of the signature PNG
}

interface Totals {
  categorySubtotals: Record<ItemCategory, Halalas>;
  subtotal: Halalas;
  discountRate?: number;        // basis points, 0–10000
  discountAmount: Halalas;
  taxableBase: Halalas;
  vatRate: number;              // basis points; default 1500 = 15%
  vatAmount: Halalas;
  grandTotal: Halalas;
}

interface Quotation {
  draftId: string;                       // UUID v4, client-minted at "New Quotation"
  quotationNumber: QuotationNumber | null; // null until finalize
  quotationDate: string;                 // ISO "YYYY-MM-DD"
  quotationFor: string;                  // required (PRD §11)
  currency: 'SAR';
  pricingMode: PricingMode;
  showRemarksColumn: boolean;            // derived (PRD §17)
  client: ClientInfo;
  scopeOfWork?: string;                  // reference §1 "Scope of Work" paragraph
  categories: CategoryBlock[];
  totals: Totals;
  terms: QuotationTerm[];
  closingParagraph: string;
  authorizedPerson: AuthorizedPersonSnapshot;
  status: QuotationStatus;
  driveFolderUrl?: string;
  pdfUrl?: string;
  docxUrl?: string;
  createdBy: string;                     // user email
  createdAt?: string;                    // ISO 8601, server-assigned
  updatedAt?: string;                    // ISO 8601, server-assigned
}
```

### 6.2 Master data entities

```ts
interface User            { email; passwordHash; salt; role: 'Admin'|'User'; active: boolean; createdAt }
interface TermTemplate    { id; title; bodyTemplate; category?: ItemCategory|'General'; sortOrder; active }
interface AuthorizedPerson{ id; name; designation; companyName; country; email; phone;
                            signatureFileId; active: boolean }
interface CatalogItem     { id; category: ItemCategory; name; defaultUnit; active }
interface ClientRecord    { id; clientName; companyName; address; contactPerson?; email?; phone? }
interface CompanySettings { name; address; phone; email; website; vatNumber; crNumber;
                            defaultVatRate; defaultClosingParagraph; quotationPrefix; branchCode;
                            documentTypeCode; letterheadFileId; logoFileId; sealFileId }
```

### 6.3 Snapshot rule (important)

A saved quotation stores **snapshots**, not references, of the authorized person, the terms, and the company settings that were in force when it was issued. Editing an authorized person's designation next year must not retroactively alter a quotation issued last year. Only `signatureFileId` is stored by reference (the image binary lives in Drive), and signature files are never overwritten in place — a changed signature creates a new file id.

---

## 7. Quotation Numbering Architecture

### 7.1 Canonical format

```
SFC/RUH/QTN/YYYY/###
```

| Segment | Value | Meaning | Source |
|---|---|---|---|
| `SFC` | fixed | **Speed Falcon Company** — company code | Task brief §6; confirmed on the approved quotation |
| `RUH` | fixed | **Riyadh branch** — branch code for V1 | Task brief §6; matches PRD §26 footer "Branch Office — Riyadh" |
| `QTN` | fixed | **Quotation** — document type code | Task brief §6 |
| `YYYY` | computed | The **year of the quotation date**. Never hard-coded. `2026 → .../2026/001`, `2027 → .../2027/001` | Task brief §6; PRD §10 ties folders to the quotation date |
| `###` | computed | Automatically incremented sequence, **minimum 3 digits, zero-padded**, never entered by the user | Task brief §6 |

Padding is a *minimum width*, not a truncation: `1 → 001`, `9 → 009`, `10 → 010`, `99 → 099`, `100 → 100`, `1000 → 1000`.

Validation regex: `/^SFC\/RUH\/QTN\/(\d{4})\/(\d{3,})$/`

The four codes are configuration constants (`COMPANY_CODE`, `BRANCH_CODE`, `DOC_TYPE_CODE`) held in Apps Script Script Properties, not literals scattered through the code, so a second branch can be added without a rewrite.

### 7.2 File-safe derivation

Slashes are illegal in filenames and awkward in folder names. One pure function derives the slug:

```ts
const toFileSafe = (canonical: string): string => canonical.replaceAll('/', '-');
// "SFC/RUH/QTN/2026/004" → "SFC-RUH-QTN-2026-004"
```

This is a lossless, mechanical transform used for Drive folder names, PDF filenames, and DOCX filenames. See §26 (UR-01) for the conflict with PRD §5/§28's `SFC-QTN-RUH-…` ordering, and the recommendation.

### 7.3 Where the number is generated

**The Google Apps Script backend is the sole authority.** The React app never computes an official number. It may display "Not yet assigned" for a draft. It must never read a number from `localStorage`, `sessionStorage`, or a "last row + 1" query.

### 7.4 The counter

A dedicated `Counters` sheet in the tracking spreadsheet is the authority — *not* the last row of `Quotations`, because a deleted, filtered, or manually re-sorted row would corrupt a last-row scan.

| year | lastSequence | updatedAt |
|---|---|---|
| 2026 | 4 | 2026-08-11T06:40:06Z |

### 7.5 Concurrency protection

Two independent mechanisms, both required:

**(a) Script-level mutual exclusion.**

```js
function reserveQuotationNumber(draftId, quotationDate) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new AppError('BUSY', 'Numbering service busy, please retry.');
  try {
    // 1. idempotency check (see (b))
    // 2. read Counters row for year
    // 3. next = last + 1
    // 4. write Counters row
    // 5. write the Idempotency row (draftId → number)
    SpreadsheetApp.flush();          // force the write before the lock is released
    return format(year, next);
  } finally {
    lock.releaseLock();
  }
}
```

`getScriptLock()` (not `getUserLock()`) serialises across *all* users of the deployment — that is exactly what a global counter needs. `SpreadsheetApp.flush()` inside the critical section guarantees the increment is durable before another caller can acquire the lock. Apps Script executions are capped at 6 minutes and locks are released on timeout, so a hung execution cannot deadlock the counter permanently.

**(b) Idempotency by draft id.** Every quotation carries a client-minted `draftId` (UUID v4) from the moment "New Quotation" is clicked. An `Idempotency` sheet maps `draftId → quotationNumber`. If a reserve call arrives for a `draftId` that already has a number, the **existing number is returned** rather than a new one being issued.

This is what makes the system correct under the failure modes that actually occur: a double-clicked Save button, a fetch that timed out client-side but succeeded server-side, a user hitting retry after a Drive failure, or a flaky mobile connection. Without it, locking alone still burns numbers.

**(c) Post-write uniqueness assertion.** Before appending to `Quotations`, the backend checks that the number is not already present. A duplicate is a hard error (`DUPLICATE_QUOTATION_NUMBER`) that is logged and surfaced — never silently resolved.

### 7.6 Year handling

The sequence is tracked **per year**, keyed by the year of the quotation date. The first quotation of a new year starts at `001` regardless of how high the previous year reached:

```
… SFC/RUH/QTN/2026/124
   SFC/RUH/QTN/2026/125
   SFC/RUH/QTN/2027/001      ← reset
   SFC/RUH/QTN/2027/002
```

Backdating edge case: if a quotation dated 2026-12-30 is finalized on 2027-01-02, it draws from the **2026** counter and files under Drive `2026/December/`. This follows PRD §10 ("the Drive year/month folder must be based on the quotation date"). Backdating into a closed year is an Admin-only capability (§18.4) and is written to the audit log.

### 7.7 Immutability during editing

- `quotationNumber` is written **once**, by the reserve step.
- The update endpoint **ignores** any `quotationNumber` in the client payload and re-reads it from the stored row keyed by `draftId`.
- If a stored row already has a number and a client submits a different one, the request is rejected with `QUOTATION_NUMBER_IMMUTABLE`.
- Editing and re-saving replaces the PDF and DOCX **inside the existing folder** (§16.4). It never creates `…/005` because `…/004` was edited.
- A number, once committed, is never reused even if the quotation is later voided (PRD §35).

### 7.8 Where the number must appear

Canonical slash form: the quotation form header, the preview, the quotation detail view, the PDF body (`Quotation No.:` line), the DOCX body, and the `Quotation No.` column in Google Sheets.

File-safe hyphen form: the Drive quotation folder name, the PDF filename, the DOCX filename.

---

## 8. Pricing and Calculation Model

### 8.1 Representation — no floating point

Currency is **SAR** (PRD §19). All monetary values are stored and computed as **integer halalas** (1 SAR = 100 halalas). All quantities are stored as **integer thousandths**. `0.1 + 0.2 !== 0.3` never enters the arithmetic path. Values are converted to decimal strings only at the display and document-render boundary.

`Number.MAX_SAFE_INTEGER` is 9,007,199,254,740,991 halalas ≈ 90 trillion SAR — far beyond any credible quotation, so `number` is safe and `bigint` is unnecessary.

### 8.2 Line amount

```
amount_halalas = roundHalfUp( quantity_milli × unitPrice_halalas / 1000 )
```

Rounding is **half-up at the line level**, then lines are summed exactly. Rounding once per line (rather than once at the end) is the convention that matches how the amounts printed in the table add up to the printed subtotal — a document where the visible column does not sum to the visible total is not acceptable on an official quotation.

### 8.3 Aggregation

```
categorySubtotal[c] = Σ amount over lines in category c
subtotal            = Σ categorySubtotal
discountAmount      = roundHalfUp(subtotal × discountRateBp / 10000)      // 0 when disabled
taxableBase         = subtotal − discountAmount
vatAmount           = roundHalfUp(taxableBase × vatRateBp / 10000)        // 0 when disabled
grandTotal          = taxableBase + vatAmount
```

Rates are stored in **basis points** (integers): 15% = `1500`. Default VAT rate is **15%**, taken from `reference/existing-terms.docx` term 9 and the sample's term 11, and configurable in Company Settings (PRD §39).

### 8.4 Presentation

- Format: `SAR 12,500.00` — currency code prefix, thousands separator, exactly 2 decimals, `en-US` grouping. This matches `SAR 20.00 / Hour` in the approved quotation.
- Quantities print with the minimum decimals needed (`40`, not `40.000`; `1.5` stays `1.5`), max 3 decimals.
- The rate-only presentation renders `SAR 20.00 / Hour` (rate + `/` + unit) and prints no Amount column and no totals block.

### 8.5 Validation

Negative quantity, negative price, zero quantity, non-finite input, and more than 3 quantity decimals or 2 price decimals are rejected (PRD §36). Upper bounds: quantity ≤ 1,000,000; unit price ≤ 100,000,000 halalas (1,000,000 SAR). Bounds prevent both typos and integer-overflow-adjacent nonsense.

### 8.6 Server re-computation (security control)

Because PDFs and DOCXs are generated in the browser, the client is not trusted with arithmetic. On save, the backend **recomputes every line amount, every subtotal, VAT, and the grand total** from the submitted quantities and unit prices, and rejects the request with `TOTALS_MISMATCH` if the client's figures differ. Google Sheets stores only server-computed totals.

---

## 9. Item Categories

Three categories (PRD §13), multiple categories permitted in one quotation, each rendered as its own table with its own subtotal.

### 9.1 Columns

Base column set, per PRD §14–§16:

| Category | Columns |
|---|---|
| Manpower | Sl. No. \| Designation \| Qty \| Unit \| Unit Price \| Amount \| Remarks |
| Equipment | Sl. No. \| Equipment Description \| Qty \| Unit \| Rate \| Amount \| Remarks |
| Materials | Sl. No. \| Material Description \| Qty \| Unit \| Unit Price \| Amount \| Remarks |

Conditional columns:

- **Remarks** is rendered only if at least one item in the whole quotation has a non-empty remark (PRD §17). This is computed once into `showRemarksColumn` and applied consistently to the preview, the PDF, and the DOCX.
- **Amount** is rendered only when `pricingMode === 'amount'`. In `rate-only` mode (the approved sample's style) the table collapses to Description \| Quantity \| Rate and no totals block is printed.
- **Sl. No.** is always rendered, restarting at 1 per category table.

### 9.2 Units

Units are configurable data, not hard-coded enums (PRD §16: "The exact units must remain configurable"). Seed lists per PRD:

- Manpower: Hour, Day, Week, Month, + custom
- Equipment: Hour, Day, Week, Month, Trip, Unit, LS, + custom
- Materials: Nos., Unit, Set, Box, Kg, Ton, m, m², m³, LS, + custom

Storage is a free string constrained by a Zod schema (1–20 chars, no control characters). The UI offers the seeded list plus a "Custom…" entry. A custom unit used in a quotation is offered as a suggestion afterwards but is not silently promoted into the master list.

### 9.3 Item library

`CatalogItem` (PRD §40) provides reusable Manpower / Equipment / Materials names with a default unit. Selecting a catalog item prefills description and unit; quantity and price are always entered per quotation. The catalog ships **empty** — the example names in PRD §40 (Carpenter, Excavator, Cement…) are illustrations of the shape, not seed data, and creating them automatically would violate PRD §34.

### 9.4 Category summary line

The approved quotation prints `Total Manpower: 41 Persons` under the manpower table. This is auto-computed for the Manpower category as the sum of quantities (rendered as an integer when whole), with the noun taken from Company Settings (default "Persons"), and can be switched off per quotation.

---

## 10. Terms & Conditions Architecture

### 10.1 Library

`TermTemplate` records live in a `Terms` sheet. The library is seeded **once** by an explicit Admin "Import reference terms" action that reads the 11 terms extracted from `reference/existing-terms.docx` (§2.6). This is real company content, not dummy data. It is never auto-created on first run and never overwrites existing rows.

The 10 checkbox labels in PRD §20 (Payment Terms, Working Hours, Accommodation, Transportation, Mobilization, VAT, Quotation Validity, Manpower Replacement, Overtime, Project Specific Terms) are the *selection UI*; they map onto library records by title. Titles absent from `existing-terms.docx` (Mobilization, Manpower Replacement, Project Specific Terms, Transportation as a standalone) are created by the company through the normal "create term" flow — the system does not invent their wording.

### 10.2 Template tokens

`existing-terms.docx` contains `{SAR  }` and `{company}`, proving the terms are templates. The library stores `bodyTemplate` with a **closed, whitelisted** token set resolved at document-build time:

```
{{company.name}}  {{company.vatNumber}}  {{client.companyName}}  {{client.clientName}}
{{quotation.number}}  {{quotation.date}}  {{quotation.validityDays}}  {{totals.vatRate}}
```

Resolution is a plain lookup in a fixed map. There is no expression evaluation, no `eval`, no template engine that can execute code, and no dynamic property access from user input. Unknown tokens are left verbatim and reported as a validation warning rather than silently blanked.

### 10.3 Selection, ordering, and quotation-local edits

- Checkbox multi-select from the library (PRD §20). Selected terms appear immediately in the preview.
- Order is user-controlled by drag or up/down controls; `sortOrder` is persisted on the quotation. Numbering in the document is positional (1, 2, 3 …), matching the reference.
- **Editing a term inside the quotation form edits only that quotation** (PRD §22). The record's `source` becomes `library-overridden`, the master row is untouched, and the UI shows a clear "modified for this quotation" marker.
- **"Create New Term"** opens the modal from PRD §21 (Term Name, Term Content, Save). The new term is available immediately for the current quotation as `quotation-local`. A separate, explicit **"Save to Library"** checkbox promotes it to a `TermTemplate`. Without that checkbox it never touches the master library.
- Deleting a library term performs a soft delete (`active = false`) so historic quotations that reference it remain explicable.

### 10.4 Versioning

Full version history is out of scope for V1. The snapshot rule (§6.3) provides the necessary guarantee: the quotation stores the resolved title and body text it was issued with, so later library edits cannot alter a historic document. `TermTemplate` carries `updatedAt` and `updatedBy` for traceability.

---

## 11. Authorized Person Architecture

### 11.1 Record

Per PRD §24: name, designation, company, email, phone, signature. The reference signature block adds a **country** line ("Kingdom of Saudi Arabia"), so the record is: `name`, `designation`, `companyName`, `country`, `email`, `phone`, `signatureFileId`, `active`.

### 11.2 Signature images

- Stored as PNG **with an alpha channel** in a private Drive folder (`Quotation Archive / _assets / signatures /`), referenced by Drive file id.
- Recommended source spec: transparent PNG, ≥ 600 px wide, ink only, tightly cropped. Rendered at 70.2 × 57.5 pt (the reference size), scaled to preserve aspect ratio inside that box.
- Upload is Admin-only, restricted to `image/png`, ≤ 1 MB, with magic-byte verification server-side (not just the declared MIME type) to satisfy PRD §33 item 14.
- Signature files are **never** exposed by a public URL. The frontend fetches them through an authenticated Apps Script endpoint that returns base64, and caches them in memory only.
- **No signature file exists in `reference/`** (§2.3 D-4). Phase 06 must build the upload flow and leave the library empty until the company supplies real signatures. Under no circumstances is a placeholder or drawn signature created.

### 11.3 Selection and rendering

Selecting a person in the quotation form auto-fills all display fields read-only (PRD §24: "The user must not have to manually type these details"). Inactive persons are hidden from the selector but remain resolvable for historic quotations. The selected person is snapshotted onto the quotation (§6.3).

### 11.4 Permissions

Admin creates, edits, deactivates, and uploads signatures. User selects only. A User cannot read the raw signature binary for a person they are not using on the open quotation. Email and phone of authorized persons are business contact details already printed on the quotation, so they are not additionally restricted.

---

## 12. Document Architecture

### 12.1 One model, three renderers

The single most important structural decision: **PDF, DOCX, and the HTML preview all render from one pure, deterministic document model.** Divergence between the three outputs is otherwise inevitable.

```
Quotation + CompanySettings + Assets
                │
                ▼
      buildDocumentModel()        ← pure, synchronous, fully unit-testable
                │
        DocumentModel  (ordered blocks: MetaBlock | Heading | Paragraph |
                        Table | SummaryLine | TermsList | TotalsBlock |
                        ClosingParagraph | SignatureBlock)
                │
    ┌───────────┼────────────┐
    ▼           ▼            ▼
renderPdf   renderDocx   <QuotationPreview/>
(pdf-lib)   (docx)       (React + Tailwind, A4-scaled)
```

`DocumentModel` is layout-agnostic and pagination-agnostic. Each renderer applies the shared geometry constants from §2.4 (`src/config/document-layout.ts`) so measurements are declared once.

### 12.2 Document section order (from the approved quotation)

1. Letterhead header — repeats on every page
2. Meta block — `Quotation For:` / `Quotation No.:` / `Date:` / `Attention:` / `Client:` (+ `Address:` per PRD §12, see UR-06)
3. `1. Scope of Work` — heading, intro paragraph, category tables, category summary lines
4. Totals block — only when `pricingMode === 'amount'`
5. `2. General Terms & Conditions` — heading, numbered term list
6. Closing paragraph(s)
7. Signature block — details left, seal + signature right
8. Letterhead footer — repeats on every page

### 12.3 Pagination rules

- Content flows top-to-bottom within the body box (y 111 → 760).
- **Never split:** a table header from its first row; the signature block; a single term item.
- **May split:** a table's body rows (the header row repeats on the continuation page), a long paragraph, the terms list between items.
- The signature block is atomic (≈ 200 pt tall including the seal). If it does not fit, the whole block moves to the next page — it must never straddle a page boundary or land under the footer.
- **The seal must not overlap text** (PRD §25). The layout engine reserves the seal's rect and lays text around it, and asserts non-overlap in tests.
- Page numbers: the approved document has none. V1 matches the approved document by default; a Company Settings toggle can enable a discreet `Page X of Y` in the footer band. See §26 (UR-07).

### 12.4 Asset pipeline

A build-time step (`scripts/prepare-assets.ts`) reads `reference/` **read-only** and writes derivatives into `src/assets/generated/` (git-ignored, reproducible):

| Output | Derived from | Purpose |
|---|---|---|
| `letterhead.pdf` (copy) | `reference/letterhead.pdf` | Embedded as the background page of every PDF page |
| `letterhead-preview@150dpi.png` | `reference/letterhead.pdf` | HTML preview background |
| `logo.jpg` | `reference/company-logo.png` (a JPEG — decoded by magic bytes, not extension) | DOCX header logo |
| `logo-watermark.png` | same | DOCX floating watermark, alpha-reduced |
| `seal-transparent.png` | `reference/company-seal.png` | Alpha-keyed seal (white → transparent) for safe overlay |

The originals in `reference/` are never modified, moved, or renamed.

---

## 13. PDF Architecture

### 13.1 Approach

**Client-side generation with `pdf-lib`, using `reference/letterhead.pdf` as an embedded background page.**

```ts
const template = await PDFDocument.load(letterheadBytes);
const out      = await PDFDocument.create();
out.registerFontkit(fontkit);
const [bg]     = await out.embedPdf(template, [0]);       // vector, once
// per page:
const page = out.addPage([595.28, 841.89]);
page.drawPage(bg, { x: 0, y: 0, width: 595.28, height: 841.89 });
// then draw body content inside the body box
```

### 13.2 Why this approach

- **Pixel-exact letterhead.** The header, red rule, logo, Vision 2030 emblem, watermark, footer rule, and all three footer columns come from the company's own artwork as vectors, not as an approximation.
- **It sidesteps Arabic entirely.** `pdf-lib` performs no bidirectional reordering and no Arabic glyph shaping. The only Arabic in the document (`شركة سبيد فالكون` and the C.R. line) lives in the letterhead, which is already rendered. The system never re-typesets Arabic. This eliminates the single largest fidelity risk in the project.
- **Real text output.** Selectable, searchable, printable at any resolution, small files — unlike any raster approach.
- **No server.** The architecture has no Node tier; a browser-side generator is the only option that keeps the mandated topology intact.

### 13.3 Fonts

Calibri is not redistributable. **Carlito** (SIL Open Font License, metric-compatible with Calibri) is bundled as `.ttf` in `src/assets/fonts/` and embedded with `@pdf-lib/fontkit` in Regular and Bold. Metric compatibility means line breaks and column fits match what Word produces, so the PDF and the DOCX (which uses Calibri by name) paginate the same way. The licence file ships alongside the font.

### 13.4 What the PDF renderer must implement

`pdf-lib` provides drawing primitives, not layout. A small, well-tested layout engine is required in `src/services/pdf/`:

- `measureText(text, font, size)` and a greedy word-wrapper with hard-break fallback for long unbroken strings
- Table renderer: column widths, per-cell wrapping, right-alignment for numeric columns, 0.5 pt `#000` borders, bold header row, header repetition on continuation pages
- Numbered-list renderer for terms: hanging indent matching the reference (number at x 52, text at x 70)
- Flow/pagination controller implementing §12.3
- Image placement with aspect-ratio preservation for the seal and the signature
- Colour constants from §2.4

### 13.5 Fallback (documented, not built in V1)

If letterhead embedding is ever rejected by the company, the fallback is Apps Script-side conversion: upload the DOCX to Drive, convert it to a Google Doc, and export as PDF via the Advanced Drive Service. This is recorded as a contingency only; it adds Drive churn, a second fidelity surface, and a network round-trip, so it is not the V1 path.

### 13.6 PDF acceptance criteria

Visual and structural parity with `reference/quotation-sample.pdf` for an equivalent input: A4; letterhead on every page; correct margins (§2.4); `Quotation No.: SFC/RUH/QTN/YYYY/NNN` in the meta block; centred, bordered tables with repeating headers; conditional Remarks and Amount columns; conditional totals; numbered terms; closing paragraph; details-left / seal-and-signature-right signature block; no seal/text overlap; correct multi-page flow; correct filename `SFC-RUH-QTN-YYYY-NNN.pdf`.

---

## 14. DOCX Architecture

### 14.1 Approach

Programmatic generation with the **`docx`** library (v9), client-side, producing a `Blob`. One `Document` with a single `Section` whose page setup and header/footer reproduce the letterhead.

### 14.2 Section setup

```
page size: A4 (11906 × 16838 twips)
margins  : top 2220, bottom 1640, left 680, right 258 twips   (from §2.4)
header   : logo image + Arabic name + "SPEED FALCON COMPANY" + red rule + C.R. line
footer   : amber rule + 3-column borderless table (Head Office | Branch Office | Contact)
watermark: floating logo image, behindDocument: true, page-centred, 318.1 × 174.9 pt
```

The header and footer are declared once on the section, so Word repeats them on every page automatically — the same guarantee the PDF gets from the embedded background.

### 14.3 Fidelity details

- **Fonts:** Calibri by name (present on every Word installation the company uses), with Carlito as the documented fallback. Fonts are not embedded in the DOCX.
- **Arabic:** the header's Arabic string is emitted as a run with `rightToLeft: true` and an Arabic-capable font. Word performs the shaping. This is the one place Arabic is re-typeset, and it is a fixed, non-user-supplied string that can be visually verified once.
- **Tables:** `w:tblHeader` (`tableHeader: true`) on the header row so Word repeats it across page breaks — PRD §27's "Repeat table headers where required".
- **Terms:** a real numbered list (`numbering` reference) rather than literal "1." text, so Word renumbers correctly if the company edits the file afterwards.
- **Signature block:** a two-column borderless table — left cell the person's details, right cell the seal above and the signature image beside the `Signature:______________` line — with `cantSplit: true` so Word never breaks it across pages.
- **Seal:** uses the alpha-keyed derivative (§12.4) so it does not paint a white box over the watermark.

### 14.4 DOCX acceptance criteria

Opens cleanly in Microsoft Word and LibreOffice; same content and same section order as the PDF; letterhead header and footer on every page; watermark behind text; repeating table headers; unsplit signature block; correct quotation number in the body; filename `SFC-RUH-QTN-YYYY-NNN.docx`.

---

## 15. Google Apps Script Architecture

### 15.1 Deployment shape

A single Apps Script project bound to the **Quotation Tracking** spreadsheet, published as a **Web App**:

- **Execute as:** Me (the company service account/owner) — required so the script can write to Drive and Sheets on the company's behalf.
- **Who has access:** Anyone — required because a browser `fetch` from a different origin cannot complete Google's interactive sign-in.

**This makes the endpoint URL publicly reachable.** That is an accepted, understood consequence of the mandated architecture, and it means **every single request must be authenticated and authorised inside `doPost` before any Drive or Sheets access occurs**. The URL is obscurity, not security. §19 treats this as the primary threat.

### 15.2 Transport — the CORS constraint

Apps Script Web Apps do not answer CORS preflight (`OPTIONS`) requests and cannot set custom `Access-Control-Allow-*` headers. Therefore every call from the SPA must be a **CORS "simple request"**:

```ts
await fetch(GAS_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // NOT application/json
  body: JSON.stringify({ action, token, payload }),
  redirect: 'follow',                                        // GAS 302s to googleusercontent.com
});
```

Consequences that must be designed around, not discovered later:

- The bearer token travels **in the JSON body**, not in an `Authorization` header (a custom header would trigger preflight).
- A single POST endpoint with an `action` discriminator replaces REST verbs and paths.
- `doGet` exists only for a health check.
- Responses use `ContentService.createTextOutput(JSON.stringify(...)).setMimeType(ContentService.MimeType.JSON)`.
- HTTP status codes are not controllable; the envelope carries the outcome.

### 15.3 Source layout and build

Following PRD §41, with a shared module so the frontend and backend cannot drift:

```
google-apps-script/
├── src/
│   ├── main.ts                 # doPost / doGet, routing, envelope
│   ├── auth/                   # login, token issue/verify, password hashing, roles
│   ├── quotation-number/       # LockService reservation, Counters, idempotency
│   ├── drive/                  # folder resolution, upload, replace-in-place
│   ├── sheets/                 # repositories for every sheet
│   ├── validation/             # server-side Zod-equivalent guards + totals recomputation
│   └── config/                 # Script Properties accessors
├── appsscript.json
├── tsconfig.json
└── esbuild.config.mjs          # bundles to dist-gas/Code.js (IIFE, ES2019)

shared/                          # imported by BOTH src/ (via @shared/*) and google-apps-script/
├── numbering.ts                 # format, parse, pad, toFileSafe  — one implementation
├── money.ts                     # halalas arithmetic, rounding, formatting
├── totals.ts                    # the calculation model of §8 — used client-side AND server-side
├── validation-rules.ts          # field constraints shared by the Zod schema and the GAS validator
└── types.ts
```

`shared/totals.ts` being the same code on both sides is what makes the §8.6 re-computation check meaningful rather than a source of false mismatches.

Build: `esbuild` bundles TypeScript to a single ES2019 IIFE (`dist-gas/Code.js`) with `doPost`/`doGet` re-exported to global scope; `clasp push` deploys; `clasp deploy` creates an immutable, versioned deployment.

### 15.4 Request envelope

```jsonc
// request
{ "action": "quotation.save", "token": "<session jwt>", "requestId": "<uuid>", "payload": { } }

// response
{ "ok": true,  "requestId": "…", "data": { } }
{ "ok": false, "requestId": "…", "error": { "code": "VALIDATION_FAILED", "message": "…",
                                            "fields": { "client.clientName": "Required" } } }
```

### 15.5 Action catalogue

| Action | Role | Purpose |
|---|---|---|
| `auth.login` | public | email + password → session token |
| `auth.logout` | any | revoke the token id |
| `auth.me` | any | current user + role |
| `quotation.reserveNumber` | User | idempotent number reservation (§7.5) |
| `quotation.save` | User | validate, recompute totals, upload to Drive, write to Sheets |
| `quotation.list` / `quotation.get` | User | read the tracking sheet |
| `quotation.updateStatus` | User | Pending / Approved / Rejected |
| `terms.list` / `terms.create` / `terms.update` / `terms.deactivate` | User / Admin | T&C library |
| `persons.list` | User | active authorized persons |
| `persons.create` / `persons.update` / `persons.uploadSignature` | Admin | authorized-person management |
| `items.*`, `clients.*` | User | catalog and client libraries |
| `settings.get` | User | company settings |
| `settings.update` | Admin | company settings |
| `admin.importReferenceTerms` | Admin | one-time seed from `existing-terms.docx` content |
| `health` (GET) | public | deployment liveness |

### 15.6 Quotas and limits to design within

Apps Script imposes: 6 min per execution, 30 s `LockService` wait, 90 min/day total runtime (consumer) or 6 h (Workspace), 20 MB Blob and ~50 MB POST body in practice. A quotation PDF is well under 2 MB and a DOCX under 1 MB, so a combined base64 payload of ≈ 4 MB is comfortable. The save action does the minimum work inside the lock (counter only) and performs Drive uploads outside it.

---

## 16. Google Drive Architecture

### 16.1 Folder structure (PRD §5, verbatim)

```
Quotation Archive/
├── _assets/
│   └── signatures/                    (private; authorized-person signature PNGs)
├── 2026/
│   ├── January/
│   │   └── SFC-RUH-QTN-2026-001/
│   │       ├── SFC-RUH-QTN-2026-001.pdf
│   │       └── SFC-RUH-QTN-2026-001.docx
│   └── August/
│       └── SFC-RUH-QTN-2026-004/
│           ├── SFC-RUH-QTN-2026-004.pdf
│           └── SFC-RUH-QTN-2026-004.docx
└── _backups/                          (§24)
```

Year and month are derived from the **quotation date**, never from a typed value (PRD §10). Month names are full English names (`January` … `December`) as shown in the PRD.

### 16.2 Root and hosting

The root folder id is stored in Script Property `DRIVE_ROOT_FOLDER_ID`. The root should live in a **Google Shared Drive**, not an individual's My Drive, so that documents survive staff changes and are not owned by one personal account. This is a deployment decision recorded in Phase 14.

### 16.3 Folder resolution

Folder creation is **get-or-create**, executed inside a script lock keyed to the folder path to prevent two concurrent saves from creating two `August` folders (a real Drive behaviour — Drive permits duplicate folder names). Resolution order: root → year → month → quotation number; each level is looked up by exact name among the parent's children before being created.

### 16.4 Upload and idempotent retry

PRD §37 requires that a retry must not create duplicate files. Therefore:

- If a file with the target name already exists in the quotation folder, its **content is replaced** via the Advanced Drive Service (`Drive.Files.update` with media). This preserves the file id, the URL, and Drive's own revision history — an audit trail for free.
- Only if no such file exists is a new file created.
- Uploads are transferred as base64 in the request body and reconstituted with `Utilities.newBlob(Utilities.base64Decode(b64), mimeType, filename)`.
- MIME types: `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

### 16.5 Permissions and URLs

Files inherit the archive's sharing; no per-file sharing is applied and nothing is made public. The response returns `webViewLink` for the folder, the PDF, and the DOCX. Users must already have access to the Shared Drive to open the links — the app never widens Drive permissions.

### 16.6 Error handling

Distinct, actionable error codes: `DRIVE_AUTH_FAILED`, `DRIVE_QUOTA_EXCEEDED`, `DRIVE_FOLDER_CREATE_FAILED`, `DRIVE_UPLOAD_FAILED`, `DRIVE_PARTIAL` (PDF uploaded, DOCX failed). Per PRD §37, a Drive failure means the quotation is **not** marked saved; the UI shows "Quotation was generated, but saving to Google Drive failed." with a **Retry Upload** action that reuses the same `draftId` and therefore the same quotation number and the same folder.

---

## 17. Google Sheets Architecture

### 17.1 Spreadsheet: "Quotation Tracking"

Its id lives in Script Property `TRACKING_SPREADSHEET_ID`. It contains one business sheet and several system sheets.

### 17.2 `Quotations` sheet

Columns A–H are exactly PRD §31, in the PRD's order. Columns I onward are system columns required by the task brief's Phase 11 scope and by the retry/idempotency design; they are additive, may be hidden, and carry no business meaning of their own.

| Col | Header | Notes |
|---|---|---|
| A | Quotation No. | canonical `SFC/RUH/QTN/YYYY/NNN`; **unique key** |
| B | Date | quotation date, `DD-MM-YYYY` (matches the document) |
| C | Client Name | |
| D | Company Name | |
| E | Quotation For | |
| F | Total Amount | server-computed grand total, SAR, 2 dp |
| G | Status | data validation: Pending \| Approved \| Rejected; default **Pending** |
| H | Drive Folder | `=HYPERLINK()` to the quotation folder |
| I | PDF URL | Phase 11 scope |
| J | DOCX URL | Phase 11 scope |
| K | Subtotal | server-computed |
| L | VAT Amount | server-computed |
| M | Authorized Person | snapshot name |
| N | Created By | user email |
| O | Created At | ISO 8601 UTC |
| P | Updated At | ISO 8601 UTC |
| Q | Draft ID | idempotency key; enables edit-in-place |

### 17.3 System sheets

| Sheet | Columns | Purpose |
|---|---|---|
| `Counters` | year, lastSequence, updatedAt | numbering authority (§7.4) |
| `Idempotency` | draftId, quotationNumber, createdAt | reservation idempotency (§7.5b) |
| `Users` | email, passwordHash, salt, role, active, createdAt, lastLoginAt | authentication (§18) |
| `Terms` | id, title, bodyTemplate, category, sortOrder, active, updatedAt, updatedBy | T&C library |
| `AuthorizedPersons` | id, name, designation, companyName, country, email, phone, signatureFileId, active | signatories |
| `Items` | id, category, name, defaultUnit, active | catalog |
| `Clients` | id, clientName, companyName, address, contactPerson, email, phone | client library |
| `Settings` | key, value | company settings |
| `AuditLog` | timestamp, actor, action, quotationNo, outcome, requestId | §19.9 |

`Users` and `AuditLog` are protected ranges, hidden from normal viewers; the spreadsheet itself is shared only with the company's operations staff.

### 17.4 Uniqueness of the quotation number

Enforced in three layers: the counter is the only issuer (§7.4); a pre-append scan rejects a number already present in column A; and a conditional-format rule highlights any duplicate that somehow appears through manual editing. `quotation.save` for an existing `draftId` **updates** the existing row rather than appending a second one.

### 17.5 Access

Only the Apps Script service identity writes programmatically. Staff may edit the `Status` column directly in the Sheet — this is the intended V1 tracking mechanism (PRD §31, §7). The app reads status back and never blindly overwrites it: a save of an existing quotation preserves the current Status value.

---

## 18. Authentication Architecture

### 18.1 Model

Per PRD §6: an email/username + password login for a small number of accounts, with `Admin` and `User` roles. No Supabase, no PostgreSQL. Credentials live in the protected `Users` sheet; all verification happens in Apps Script.

### 18.2 Password storage

- Per-user random 32-byte salt.
- **PBKDF2-HMAC-SHA256**, implemented over `Utilities.computeHmacSha256Signature`, iteration count tuned during Phase 02 to the highest value that keeps login under ~1.5 s in Apps Script (expected 20,000–50,000) and stored **per record** so it can be raised later without invalidating existing hashes.
- A server-side **pepper** from Script Property `PASSWORD_PEPPER` is mixed in, so a leaked spreadsheet alone does not permit offline cracking.
- Passwords are never stored in plaintext, never logged, never returned, and never placed in frontend source (PRD §6, §33).
- Account creation is Admin-only through an Apps Script action; there is no self-registration.

### 18.3 Sessions

- On success, Apps Script issues a compact **HMAC-SHA256-signed token** (JWT-shaped: `base64url(header).base64url(payload).signature`) containing `sub`, `role`, `jti`, `iat`, `exp`. The signing key is Script Property `SESSION_HMAC_SECRET`.
- TTL 8 hours, with silent renewal when a request arrives with under 1 hour remaining.
- Logout adds the `jti` to a short-lived revocation list in Script Properties/Cache.
- The token is held in memory in a React context and mirrored to `sessionStorage` so a page refresh does not log the user out. Apps Script cannot set an `HttpOnly` cookie for a cross-origin SPA, so this is the honest trade-off; it is mitigated by a short TTL, revocation, a strict CSP, and the absence of any `dangerouslySetInnerHTML` in the codebase (§19.6).
- Every request re-verifies signature, expiry, revocation, and the user's `active` flag server-side. A token is never trusted because the client says so.

### 18.4 Roles and route protection

| Capability | User | Admin |
|---|---|---|
| Create / edit / view quotations, generate documents, save to Drive | ✅ | ✅ |
| Manage the T&C library | ✅ | ✅ |
| Backdate a quotation into a previous year | ❌ | ✅ |
| Manage authorized persons and signatures | ❌ | ✅ |
| Company Settings | ❌ | ✅ |
| Manage users | ❌ | ✅ |
| Import reference terms | ❌ | ✅ |

Route protection is a `<RequireAuth>` / `<RequireRole role="Admin">` wrapper on the router. **Frontend guards are UX only** — the authoritative check is in Apps Script on every action, because the endpoint is public (§15.1).

### 18.5 Failure behaviour

Login failures return a single generic message ("Invalid email or password") with no account-existence disclosure, and are rate-limited (§19.8). Expired or invalid tokens produce `AUTH_EXPIRED`; the client clears the session and redirects to `/login` preserving the intended destination.

---

## 19. Security Architecture

### 19.1 Threat model

The endpoint is publicly reachable (§15.1) and executes as the company's Google identity with Drive and Sheets access. The primary threats are: unauthenticated invocation, token forgery, privilege escalation from User to Admin, tampered payloads (falsified totals), injection into Sheets, XSS in the SPA leading to token theft, and credential stuffing.

### 19.2 Authentication and authorisation

Every action except `auth.login` and `health` verifies the token before touching Drive or Sheets. Role checks are declared per action in a single table (§15.5) and enforced centrally in the router in `main.ts` — never scattered through handlers where one can be forgotten.

### 19.3 Input validation

- **Frontend:** Zod schemas driving React Hook Form; inline messages; export blocked while invalid (PRD §36).
- **Backend:** the same rule set from `shared/validation-rules.ts`, re-run server-side. Frontend validation is a convenience; the backend validation is the control.
- Rules: required client name / company name / address / quotation-for / ≥ 1 item / authorized person; non-empty descriptions; quantity > 0 and ≤ 1,000,000; unit price ≥ 0 and ≤ 1,000,000 SAR; unit from the allowed set or a sanitised custom string; string length caps on every text field; ISO date parsing with a sane range (± 5 years).
- **Totals are recomputed server-side** and mismatches rejected (§8.6).
- The quotation number in an update payload is ignored (§7.7).

### 19.4 Output validation

Before writing to Drive or Sheets: the number matches the canonical regex; the file-safe name matches `^[A-Z0-9-]+$`; folder path segments are validated against `^[A-Za-z0-9 _-]+$`; uploaded blobs are checked for the expected magic bytes (`%PDF-` and `PK\x03\x04`) and a size ceiling before upload.

### 19.5 Google Sheets injection

Any cell value beginning with `=`, `+`, `-`, or `@` is prefixed with `'` before being written, so a client name like `=IMPORTXML(...)` cannot become a live formula in the tracking sheet. Values are written with `setValue`/`setValues`, never assembled into formula strings — except the Drive Folder column, which is built as a `HYPERLINK` formula from a **validated** Drive URL (`^https://drive\.google\.com/`) and an escaped label.

### 19.6 XSS

React's default escaping is relied upon; `dangerouslySetInnerHTML` is banned by an ESLint rule (`react/no-danger` as an error). T&C bodies are plain text, not HTML — token resolution is a whitelist lookup (§10.2), never a template engine. A strict CSP is served by the static host: `default-src 'self'; connect-src 'self' https://script.google.com https://script.googleusercontent.com; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`.

### 19.7 Secrets and environment

- Nothing secret ever reaches the browser bundle. The only frontend variables are `VITE_GAS_ENDPOINT` (a URL, not a secret) and `VITE_APP_ENV`.
- All secrets live in Apps Script **Script Properties**: `SESSION_HMAC_SECRET`, `PASSWORD_PEPPER`, `DRIVE_ROOT_FOLDER_ID`, `TRACKING_SPREADSHEET_ID`, `ALLOWED_ORIGINS`.
- `.env*` is git-ignored; `.env.example` documents the variable names with empty values.
- Secret scanning runs in CI; a rotation procedure for both HMAC keys is documented in Phase 14.

### 19.8 Rate limiting

Per-email login throttling via `CacheService`: 5 failures in 15 minutes locks that email for 15 minutes. Per-token action throttling for expensive actions (`quotation.save`) at 20/minute. Exceeding either returns `RATE_LIMITED` with a retry hint.

### 19.9 Logging and error handling

- `AuditLog` records timestamp, actor email, action, quotation number, outcome, and `requestId` for every state-changing action.
- Logs never contain passwords, token contents, or full request payloads.
- Client-facing errors are generic and typed; stack traces and internal identifiers stay in `Logger`/Cloud Logging.
- The frontend surfaces `error.code` with a human message from a central map and shows the `requestId` so a user can quote it to an administrator.

### 19.10 CORS reality

Apps Script cannot enforce an origin allowlist through CORS headers. `ALLOWED_ORIGINS` is checked against a client-declared origin claim as **defence in depth only**, and the plan states plainly that this is not a security boundary. The real boundary is the session token plus per-action authorisation.

---

## 20. Testing Strategy

### 20.1 Layers

| Layer | Tool | Coverage |
|---|---|---|
| Unit — pure logic | Vitest | `shared/numbering`, `shared/money`, `shared/totals`, `shared/validation-rules`, `buildDocumentModel`, T&C token resolution, the PDF text measurer/wrapper |
| Unit — Apps Script | Vitest + hand-written `LockService` / `SpreadsheetApp` / `DriveApp` fakes | reservation, idempotency, uniqueness, role enforcement, Sheets-injection escaping, totals recomputation |
| Component | Vitest + Testing Library + jsdom | quotation form, item tables, T&C selector and modal, authorized-person selector, preview, login, guards |
| Integration | Vitest with a mocked `fetch` | full save flow, failure and retry paths |
| Document | Playwright (headless Chromium, pre-installed) | generate real PDFs/DOCXs, re-parse them, assert content and geometry |
| Manual | checklist | open generated DOCX in Microsoft Word; print the PDF |

### 20.2 Numbering test matrix (mandatory)

- first quotation of a year → `SFC/RUH/QTN/2026/001`
- sequential → `…/001` → `…/002` → `…/003`
- padding boundaries → `009 → 010`, `099 → 100`, `999 → 1000` (width grows, never truncates)
- year reset → last of 2026 is `…/2026/125`, first of 2027 is `…/2027/001`
- year comes from the quotation date, not `new Date()` — backdating uses the correct counter
- concurrency → N simultaneous reservations yield N distinct numbers with no gaps and no duplicates
- idempotency → the same `draftId` reserved twice returns the same number
- immutability → editing and re-saving a quotation preserves the number; a client-supplied different number is rejected
- propagation → the same number appears in the PDF body, the DOCX body, the Sheets row, the Drive folder name, and both filenames
- format → the canonical form matches the regex; the file-safe form is the canonical with `/` → `-`

### 20.3 Other required coverage

Money and totals (line rounding, category subtotals, discount, 15% VAT, grand total, the printed column summing to the printed total); validation (every rejection rule in PRD §36); auth (hash/verify round trip, token forge/expiry/revocation, role enforcement per action); document generation (single page, multi-page, table spanning a page break with a repeated header, conditional Remarks column, conditional totals, seal/text non-overlap, unsplit signature block); integrations (folder get-or-create, replace-not-duplicate on retry, Sheets append vs update, Drive failure → not marked saved, Sheets failure after Drive success → warning + retry); error handling for every error code.

### 20.4 Test data policy

Test fixtures live in `src/__fixtures__/` and `google-apps-script/__fixtures__/`, are obviously synthetic (`TEST_ONLY_` prefixes), and are imported **only** from `*.test.ts` files — enforced by an ESLint `no-restricted-imports` rule. No fixture is ever seeded into a Sheet, a Drive folder, or an application code path. Integration tests run against a **separate development spreadsheet and Drive folder**, never production (PRD §34).

---

## 21. Deployment Architecture

### 21.1 Frontend

Static build (`npm run build` → `dist/`) deployed to an HTTPS static host with atomic deploys and instant rollback — Cloudflare Pages, Netlify, or Vercel static. Requirements: HTTPS enforced with HSTS; SPA fallback to `index.html`; the security headers of §19.6; hashed asset filenames with long-lived caching and a no-cache `index.html`.

### 21.2 Backend

`clasp push` then `clasp deploy` to create an immutable, versioned deployment. Two deployments are maintained — **development** and **production** — bound to two different spreadsheets and two different Drive roots, so a test never touches production data. The production `/exec` URL is set as `VITE_GAS_ENDPOINT` in the host's build environment.

### 21.3 One-time production setup (Phase 14 runbook)

Create the Shared Drive and `Quotation Archive` root; create the `Quotation Tracking` spreadsheet with all sheets, headers, protected ranges, and the Status data validation; set all five Script Properties; create the first Admin user with a strong generated password delivered out of band; upload real signature images; run the reference-terms import; complete Company Settings; run the deployment validation checklist.

### 21.4 Deployment validation

Health check responds; login succeeds and a bad password fails; a real quotation is created end to end; the number is correct and sequential; the PDF and DOCX open correctly; the Drive tree is `Year / Month / Number`; the Sheets row is correct with a working folder link; a status change persists; a second quotation increments without duplication; **zero dummy rows exist in production** (PRD §34).

### 21.5 Rollback

Frontend: redeploy the previous build through the host's UI (seconds). Backend: re-point the production deployment id at the previous Apps Script version — safe because deployments are immutable. Data: Drive keeps file revisions and a 30-day trash; the Sheet has version history plus the daily backups of §24. A rollback never deletes issued quotation numbers.

---

## 22. Environment Configuration

### 22.1 Frontend (`.env`, all public by definition)

| Variable | Example | Notes |
|---|---|---|
| `VITE_GAS_ENDPOINT` | `https://script.google.com/macros/s/<id>/exec` | not a secret; the boundary is the token |
| `VITE_APP_ENV` | `development` \| `production` | gates dev-only affordances |
| `VITE_APP_VERSION` | injected from `package.json` at build | shown in the UI footer for support |

`.env.example` is committed with empty values; `.env`, `.env.local`, `.env.production` are git-ignored.

### 22.2 Backend (Apps Script Script Properties — all secret)

| Property | Purpose |
|---|---|
| `SESSION_HMAC_SECRET` | signs session tokens; ≥ 32 random bytes |
| `PASSWORD_PEPPER` | mixed into every password hash |
| `DRIVE_ROOT_FOLDER_ID` | the `Quotation Archive` folder id |
| `TRACKING_SPREADSHEET_ID` | the `Quotation Tracking` spreadsheet id |
| `ALLOWED_ORIGINS` | comma-separated origins, defence in depth (§19.10) |
| `COMPANY_CODE` / `BRANCH_CODE` / `DOC_TYPE_CODE` | `SFC` / `RUH` / `QTN` |

A startup guard fails fast with a clear error if any required property is missing, rather than producing corrupt output.

---

## 23. Error Handling

### 23.1 Codes

`AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_EXPIRED`, `FORBIDDEN`, `RATE_LIMITED`, `VALIDATION_FAILED`, `TOTALS_MISMATCH`, `QUOTATION_NUMBER_IMMUTABLE`, `DUPLICATE_QUOTATION_NUMBER`, `NUMBERING_LOCKED` (lock not acquired within 30 s), `DRIVE_AUTH_FAILED`, `DRIVE_QUOTA_EXCEEDED`, `DRIVE_FOLDER_CREATE_FAILED`, `DRIVE_UPLOAD_FAILED`, `DRIVE_PARTIAL`, `SHEETS_WRITE_FAILED`, `CONFIG_MISSING`, `INTERNAL_ERROR`.

### 23.2 Partial-failure semantics (PRD §37)

| Situation | Behaviour |
|---|---|
| Drive upload fails | quotation **not** marked saved; message "Quotation was generated, but saving to Google Drive failed."; **Retry Upload** reuses the same `draftId`, number, and folder |
| PDF uploaded, DOCX fails | `DRIVE_PARTIAL`; retry re-uploads only what is missing |
| Sheets write fails after Drive succeeds | warning + retry; the Drive files stay; the retry updates the existing row rather than appending |
| Reservation succeeds, save fails | the number stays reserved against the `draftId`; the next attempt reuses it; no number is burned |
| Lock unavailable | `NUMBERING_LOCKED`, user-facing "System busy, please try again", client retries with exponential backoff |

### 23.3 Client-side

TanStack Query retries idempotent reads 3× with exponential backoff; mutations are **not** auto-retried (only user-initiated retry, so a save can never be duplicated by a background retry). A React error boundary catches render failures without losing form state. Every error toast shows the `requestId`.

---

## 24. Backup Strategy

| Asset | Primary protection | Additional |
|---|---|---|
| Generated PDFs and DOCXs | Drive itself: revision history, 30-day trash, Google's redundancy | replace-in-place keeps prior revisions of every regenerated document |
| Tracking spreadsheet | Sheets version history | a daily time-driven Apps Script trigger copies the spreadsheet to `Quotation Archive/_backups/YYYY-MM-DD/` and prunes copies older than 90 days |
| Counters | inside the backed-up spreadsheet | the audit log independently records every issued number, so the counter can be reconstructed |
| Users | inside the backed-up spreadsheet | hashes only; a lost `PASSWORD_PEPPER` means passwords must be reset, so the pepper is escrowed with the company's own secret storage |
| Signature images | Drive `_assets/signatures/` | included in the Drive backup scope |
| Source code | Git / GitHub | the Apps Script source is in the repository, not only in the online editor |

Recovery objectives for V1: RPO 24 h for the tracking sheet (Drive files are effectively continuous), RTO under 2 h — redeploy the frontend, restore the Apps Script version, restore the spreadsheet copy.

---

## 25. Risks

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R-1 | Numbering format conflict between the PRD and the approved document | Wrong number on official documents | Certain (already present) | UR-01: canonical slash form from the reference; single constant; confirm with the company before Phase 03 completes |
| R-2 | Duplicate quotation numbers under concurrency | Two official documents share a number | Medium | Script lock + `SpreadsheetApp.flush()` + draft-id idempotency + pre-append uniqueness check + explicit concurrency tests |
| R-3 | Apps Script lock contention or 6-min timeout | Save fails | Low | Only the counter increment is inside the lock; uploads are outside; `NUMBERING_LOCKED` with client backoff |
| R-4 | `company-seal.png` has no alpha channel | White box over the letterhead watermark | High if unaddressed | Build-time alpha-keyed derivative; automated non-overlap and transparency tests |
| R-5 | `company-logo.png` is a JPEG with a `.png` extension | Decode failures | High if unaddressed | Magic-byte sniffing in the asset pipeline; never trust the extension |
| R-6 | No signature images supplied | Phase 06 cannot ship real data | Certain today | Build the upload flow; ship the library empty; never fabricate a signature |
| R-7 | Arabic shaping in generated documents | Garbled company name | Medium | PDF: never re-typeset Arabic — the letterhead is embedded as vectors. DOCX: one fixed RTL run, visually verified once |
| R-8 | Client-side generation means the browser produces official documents | Tampered totals | Medium | Server recomputes all arithmetic and rejects mismatches (§8.6) |
| R-9 | The Apps Script endpoint is public | Unauthenticated invocation | Certain by design | Token verification and role checks before any Drive/Sheets access; rate limiting; audit log |
| R-10 | Session token in `sessionStorage` | Theft via XSS | Low | No `dangerouslySetInnerHTML` (lint-enforced), strict CSP, 8-hour TTL, revocation list |
| R-11 | Google Sheets formula injection | Malicious formula in the tracking sheet | Medium | Prefix `= + - @` with `'`; validated hyperlink URLs only |
| R-12 | Apps Script daily runtime quota | Saves fail late in the day | Low | Minimal in-lock work; measure per-save runtime in Phase 13; Workspace account raises the ceiling to 6 h |
| R-13 | PDF and DOCX drift apart visually | Two different official documents | Medium | One shared `DocumentModel`; metric-compatible fonts; parity tests |
| R-14 | Approved layout has no totals block but the PRD requires one | Wrong-looking document | Certain (already present) | UR-04: `pricingMode`; default `amount`; confirm with the company |
| R-15 | Files owned by a personal Drive account | Documents lost when staff leave | Medium | Shared Drive requirement in the Phase 14 runbook |
| R-16 | Password hashing in Apps Script is slow | Poor login UX or weak parameters | Medium | Tune iterations in Phase 02 against a measured budget; store the count per record so it can be raised later |

---

## 26. Unresolved Requirements

Each item states a recommended default so that no phase is ever blocked. Every default is implemented behind a single constant or setting so a company decision can be applied in minutes.

| # | Question | Evidence | Recommended default |
|---|---|---|---|
| **UR-01** | Canonical number format: PRD §5/§9/§28 say `SFC-QTN-RUH-2026-001`; `reference/quotation-sample.pdf` says `SFC/RUH/QTN/2026/004` | Direct contradiction | **Canonical = `SFC/RUH/QTN/YYYY/###`** (the real document, and the task brief's mandate). File-safe = mechanical slug `SFC-RUH-QTN-YYYY-###`. Confirm the filename ordering with the company before Phase 10. |
| **UR-02** | Is there a second branch, or is `RUH` permanent for V1? | Letterhead lists a Jubail head office and a Riyadh branch | `RUH` fixed for V1, stored as a config constant so a branch dimension can be added without a rewrite |
| **UR-03** | Should the counter be per-branch when a second branch appears? | Not addressed | Counter keyed by `year` only in V1; the `Counters` sheet schema is `(year, …)` and can be widened to `(branch, year, …)` |
| **UR-04** | Does a quotation print a totals block? The approved sample prints rates only; PRD §19 mandates subtotal/VAT/grand total | Direct contradiction | Support both via `pricingMode`; **default `amount`** (PRD §19); `rate-only` reproduces the approved sample exactly |
| **UR-05** | Signature-block arrangement: PRD §25 says signature left / seal right; the approved document puts details left and both seal and signature right | Direct contradiction | Follow the **approved document**; PRD §25's binding requirement (seal on the right) is satisfied |
| **UR-06** | The client address is required by PRD §12 but does not appear in the approved layout | Gap | Capture it as required; render an `Address:` line in the meta block; make it hideable in Company Settings |
| **UR-07** | Page numbers: PRD §27 mentions professional page breaks; the approved document has none | Gap | **Off by default** to match the approved document; a Company Settings toggle adds `Page X of Y` |
| **UR-08** | The "Scope of Work" section appears in the approved document but not in PRD §8's section list | Gap | Include as an optional, editable, prefilled section, **on by default** |
| **UR-09** | Final closing-paragraph wording — PRD §23 says "will be provided later by the company" | Explicitly deferred | Seed with the approved document's two paragraphs, fully editable per quotation and in Company Settings |
| **UR-10** | Authentication method: PRD §6 specifies email + password; Google Workspace SSO would be materially more secure | Not addressed | Implement email + password per the PRD; document Google Sign-In with an account allowlist as a recommended Phase 2 hardening |
| **UR-11** | Quotation validity period — 7 days in both references | Consistent | Default 7 days, configurable; drives the `{{quotation.validityDays}}` token |
| **UR-12** | Discount: PRD §19 says "Discount if enabled"; neither reference shows one | Ambiguous | Implement, **disabled by default**, enabled per quotation |
| **UR-13** | Date format: the approved document shows `11-08-2026` | Clear | `DD-MM-YYYY` in documents and the Sheet; ISO `YYYY-MM-DD` in storage and APIs |
| **UR-14** | Who may change the quotation date (PRD §10: "if authorized")? | Ambiguous | Any user may set a date within the current year; only Admin may backdate into a previous year (audited) |
| **UR-15** | Should Drive month folders be English names or numbers? | PRD §5 shows `January`, `August` | Full English month names, exactly as the PRD shows |

---

## 27. Implementation Sequence

Strictly sequential. No phase begins before its predecessor is complete, green (typecheck + lint + build + tests), and committed.

```
00  Project Analysis          → ANALYSIS.md, no application code
01  Project Foundation        → Vite + React + TS strict + Tailwind + Router + shared types + API client + UI primitives
02  Authentication            → GAS auth, login, sessions, guards, roles
03  Quotation Core            → quotation CRUD, client info, Quotation For, date, status, SFC/RUH/QTN/YYYY/### reservation
04  Item Categories           → manpower / equipment / materials tables, units, rates, line + category totals
05  Terms & Conditions        → library, selection, ordering, in-quotation create/edit, tokens
06  Authorized Persons        → library, signatures, active/inactive, selection
07  Quotation Document        → shared DocumentModel + HTML preview at A4
08  PDF Generation            → pdf-lib + embedded letterhead + layout engine + pagination
09  DOCX Generation           → docx + header/footer/watermark + repeating table headers
10  Google Drive              → Year/Month/Number folders, upload, replace-on-retry, URLs
11  Google Sheets             → tracking row, uniqueness, status, timestamps
12  Security                  → hardening pass, CSP, rate limiting, injection defences, audit log
13  Testing                   → full matrix incl. numbering, concurrency, documents, integrations
14  Production Deployment     → build, clasp deploy, Drive/Sheets setup, secrets, monitoring, rollback
```

**Dependency notes.** 03 depends on 02 for the session token. 04 depends on 03 for the quotation shell. 07 depends on 04, 05, 06 for complete content. 08 and 09 both consume 07's `DocumentModel` and must not re-derive layout. 10 depends on 08 and 09 for real files. 11 depends on 10 for the folder URL. 12 audits 01–11 rather than adding features. 13 tests everything. 14 deploys.

**Deliberate cross-phase dependency (documented per the brief's §33):** the quotation-number reservation lives in Phase 03 rather than Phase 11, even though the `Counters` sheet is a Sheets artefact. The reservation is the atomic core of quotation creation and cannot be deferred to a later phase without leaving Phase 03 unable to produce a valid quotation. Phase 03 therefore creates the `Counters` and `Idempotency` sheets and their repositories; Phase 11 adds the `Quotations` tracking row and consumes what Phase 03 built.

**Per-phase exit criteria (all phases):** `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` succeeds; `npm test` passes; no dummy production data introduced; work committed to `claude/quotation-app-architecture-ycbwpa`.
