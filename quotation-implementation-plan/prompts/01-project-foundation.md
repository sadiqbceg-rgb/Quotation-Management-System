# Phase 01 — Project Foundation

---

# Objective

Scaffold the React + TypeScript application and the Google Apps Script backend project, and establish the shared foundations every later phase builds on: strict TypeScript, routing with an application shell, Tailwind styling, environment handling, shared domain types, shared pure logic (numbering, money, totals, validation rules), the Apps Script transport client, and a small set of reusable UI primitives.

This phase produces a running, empty, professional application shell. It creates **no** quotation features, **no** authentication logic, and **no** document generation.

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

- Phase 00 complete; `quotation-implementation-plan/ANALYSIS.md` exists.
- Node 22+ and npm 10+ available.

---

# Files to Inspect

- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — §3 (stack), §6 (data model), §7 (numbering), §8 (money), §12.4 and §2.4 (layout constants), §15 (Apps Script), §22 (environment), §27 (sequence).
- `quotation-implementation-plan/ANALYSIS.md` — all findings from Phase 00.
- `PRD/quotation-prd.md` — §3 (stack), §7 (navigation), §38 (UI/UX), §41 (structure), §46 (phasing).
- `reference/quotation-sample.pdf` — for the measured layout constants only.
- Repository root — confirm nothing already exists before creating it.

---

# Implementation Scope

**In scope**

1. Vite + React 19 + TypeScript 5 (strict) application at the repository root, source in `src/`.
2. Tailwind CSS 4 with a corporate theme using the brand colours measured from the reference.
3. React Router 7 with an authenticated-application layout shell and all eight PRD §7 navigation destinations as empty placeholder pages.
4. `shared/` — pure, dependency-free modules imported by both the web app and the Apps Script backend: domain types, quotation-number formatting, money arithmetic, totals calculation, validation rule constants.
5. `google-apps-script/` — TypeScript project, `appsscript.json`, esbuild bundling, `clasp` configuration, a `doGet` health endpoint, a `doPost` router skeleton with the request/response envelope, and Script-Property accessors with a fail-fast configuration guard.
6. The frontend API client that speaks the Apps Script transport correctly (POST, `text/plain` body, action discriminator, typed envelope, typed errors).
7. Environment handling and `.env.example`.
8. Reusable UI primitives: Button, Input, Select, Checkbox, Textarea, Field/Label/ErrorText, Card, Table, Modal, Toast, Spinner, EmptyState, PageHeader.
9. Document layout constants module (`src/config/document-layout.ts`) holding the measured geometry from the reference.
10. Tooling: ESLint 9 flat config, Prettier 3, Vitest 3 + Testing Library + jsdom, npm scripts, `.gitignore`.

**Out of scope** — belongs to later phases

Login and sessions (02). Quotation forms, CRUD, and number reservation (03). Item tables (04). Terms (05). Authorized persons (06). Document model and preview (07). PDF (08). DOCX (09). Drive (10). Sheets (11). Security hardening (12). Full test suite (13). Deployment (14).

---

# Required Changes

## 1. Tooling and configuration

- `package.json` with scripts: `dev`, `build`, `preview`, `typecheck` (`tsc --noEmit`), `lint`, `lint:fix`, `format`, `test`, `test:watch`, `gas:build`, `gas:push`.
- `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`, and path aliases `@/*` → `src/*` and `@shared/*` → `shared/*`.
- `vite.config.ts` with the React plugin, the path aliases, and the Vitest configuration.
- `eslint.config.js` (flat) with `typescript-eslint` recommended-type-checked, `react-hooks`, `jsx-a11y`, plus these project rules as **errors**: `react/no-danger`, `@typescript-eslint/no-explicit-any`, `@typescript-eslint/no-floating-promises`, and a `no-restricted-imports` rule forbidding imports from `src/__fixtures__/**` outside `*.test.*` files.
- `.prettierrc`, `.gitignore` (`node_modules`, `dist`, `dist-gas`, `.env*` except `.env.example`, `src/assets/generated`, `.clasp.json`), `.env.example`.

## 2. Shared modules (`shared/`)

- `types.ts` — the entity interfaces from `IMPLEMENTATION_PLAN.md` §6.1 and §6.2. Types only; no logic.
- `numbering.ts` — `formatQuotationNumber(year, sequence)`, `parseQuotationNumber(s)`, `toFileSafe(canonical)`, `QUOTATION_NUMBER_REGEX`. Codes come from parameters or constants, never hard-coded inside string literals scattered around. Padding is **minimum width 3, never truncating**.
- `money.ts` — halalas arithmetic: `sarToHalalas`, `halalasToSar`, `roundHalfUp`, `multiplyQuantityByRate(qtyMilli, rateHalalas)`, `formatSar(halalas)` → `SAR 12,500.00`, `formatQuantity(milli)`. No floating-point accumulation anywhere.
- `totals.ts` — the calculation model of `IMPLEMENTATION_PLAN.md` §8.3, pure and deterministic. This exact module runs on both the client and the server, which is what makes the server-side recomputation check meaningful.
- `validation-rules.ts` — the numeric bounds, string length caps, and allowed-unit lists as plain constants, consumed by both the Zod schemas and the Apps Script validator.

`shared/` must import nothing from `src/`, nothing from `google-apps-script/`, and no runtime dependency. It must contain no browser API and no Apps Script API.

## 3. Frontend structure

Follow PRD §41:

```
src/
├── components/{quotation,client,items,terms,signatories,common}/
├── pages/{login,dashboard,quotations,customers,items,terms,signatories,settings}/
├── services/{api,quotation,google-drive,google-sheets}/
├── templates/{quotation-pdf,quotation-docx}/     (created empty with a README; filled in 08/09)
├── types/
├── utils/
├── hooks/
├── config/
└── assets/{fonts,generated}/
```

Create the eight placeholder pages with a `PageHeader` and an `EmptyState` reading "This section is implemented in a later phase." — a real placeholder, not fabricated content.

## 4. Application shell

Left sidebar navigation with exactly the PRD §7 destinations: Dashboard, New Quotation, Quotations, Customers, Items / Services, Terms & Conditions, Authorized Persons, Company Settings. Top bar with the company name and a placeholder user slot. Responsive: desktop primary, usable on tablet, functional on mobile (PRD §3). No animations beyond simple state transitions, no gradients, no decorative cards (PRD §38).

## 5. API client (`src/services/api/`)

- `client.ts` — a single `callAction<TReq, TRes>(action, payload, token?)` that POSTs to `import.meta.env.VITE_GAS_ENDPOINT` with `Content-Type: text/plain;charset=utf-8`, a JSON string body, `redirect: 'follow'`, an `AbortController` timeout, and a generated `requestId`.
- `envelope.ts` — the request/response envelope types from `IMPLEMENTATION_PLAN.md` §15.4.
- `errors.ts` — the `AppError` class, the error-code union from §23.1, and a code → user-message map.
- `actions.ts` — the typed action-name union from §15.5. Only `health` is wired in this phase.

Add a code comment explaining **why** the content type is `text/plain`: Apps Script Web Apps do not answer CORS preflight, so the request must qualify as a CORS simple request. Without that note a future contributor will "fix" it to `application/json` and break every call.

## 6. Apps Script backend skeleton (`google-apps-script/`)

- `src/main.ts` — `doPost(e)` parsing the envelope, dispatching on `action` through a central table that declares the required role per action, and returning the JSON envelope via `ContentService`. `doGet(e)` returns a health payload. Unknown actions return `VALIDATION_FAILED`. No authentication logic yet — leave a single clearly-marked integration point for Phase 02.
- `src/config/properties.ts` — typed Script Property accessors with a `assertConfigured()` guard that throws `CONFIG_MISSING` listing every missing key.
- `appsscript.json` — V8 runtime, timezone `Asia/Riyadh`, web-app access configuration.
- `tsconfig.json`, `esbuild.config.mjs` bundling to `dist-gas/Code.js` as an ES2019 IIFE with `doPost`/`doGet` exposed globally, `.clasp.json.example`.
- `README.md` documenting the `clasp` setup, the two deployments (development and production), and the required Script Properties.

## 7. Document layout constants

`src/config/document-layout.ts` — A4 dimensions, the measured body box, margins in points and twips, the table geometry, the signature block geometry including the seal and signature rects, typography sizes and leading, and the brand colours. Every value carries a comment citing where in `reference/quotation-sample.pdf` or `reference/letterhead.pdf` it was measured.

---

# Expected Files / Components

```
package.json, package-lock.json, tsconfig.json, tsconfig.node.json, vite.config.ts
eslint.config.js, .prettierrc, .gitignore, .env.example, index.html, README.md

shared/{types,numbering,money,totals,validation-rules}.ts

src/main.tsx, src/App.tsx, src/router.tsx, src/index.css
src/components/common/{Button,Input,Select,Checkbox,Textarea,Field,Card,Table,Modal,Toast,
                       Spinner,EmptyState,PageHeader,AppLayout,Sidebar,TopBar}.tsx
src/pages/{login,dashboard,quotations,customers,items,terms,signatories,settings}/index.tsx
src/services/api/{client,envelope,errors,actions}.ts
src/config/{env,document-layout,navigation}.ts
src/types/index.ts        (re-exports @shared/types)
src/utils/{cn,format-date,uuid}.ts
src/hooks/useToast.ts

google-apps-script/appsscript.json, tsconfig.json, esbuild.config.mjs,
  .clasp.json.example, README.md
google-apps-script/src/main.ts
google-apps-script/src/config/properties.ts
```

---

# Architecture Requirements

- V1 architecture is fixed: React + TypeScript → Google Apps Script → Google Drive + Google Sheets.
- **Do not add Supabase. Do not add PostgreSQL. Do not add any database, ORM, or migration tool.**
- Do not add a Node/Express server, Next.js, or any server-rendered tier.
- One shared source of truth for numbering, money, totals, and validation rules — used by both the frontend and Apps Script. Never two implementations.
- The API client is the only module that calls `fetch`. Feature services call the API client.
- Keep `shared/` free of every framework and platform API.
- Configuration constants (`SFC`, `RUH`, `QTN`, VAT rate, currency) are declared once and referenced, never inlined at call sites.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/*` — every file, read-only. Do not rename, convert, re-encode, or optimise.
- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md`
- `quotation-implementation-plan/prompts/*`
- `quotation-implementation-plan/ANALYSIS.md`

---

# Data Requirements

- Type definitions and empty states only.
- **No seed data of any kind.** No demo clients, no demo quotations, no demo users, no demo prices, no demo items, no demo terms, no demo authorized persons, no fabricated quotation numbers, no fake Drive URLs, no fake Sheets rows.
- The unit lists in `validation-rules.ts` are configuration taken verbatim from PRD §14–§16, not sample data.
- `.env.example` contains empty values only — never a real endpoint URL, id, or secret.
- Test fixtures, if any are needed for the smoke tests, live in `src/__fixtures__/` with a `TEST_ONLY_` prefix and are importable only from test files.

---

# Security Requirements

- No secrets in the frontend. `VITE_GAS_ENDPOINT` and `VITE_APP_ENV` are the only frontend variables, and neither is secret.
- All backend secrets are read from Script Properties; none is committed, and `.clasp.json` is git-ignored.
- Enable the `react/no-danger` ESLint rule as an **error** now, so the XSS surface never opens.
- The Apps Script `doPost` router must already have the role-declaration table in place, even though every action is public in this phase, so Phase 02 slots authentication into an existing check rather than retrofitting one.
- Do not log request payloads.
- `.gitignore` must cover `.env*` (except `.env.example`) and `.clasp.json` before the first commit.

---

# Validation Requirements

- `src/config/env.ts` validates required environment variables at startup and fails with a clear, actionable message when `VITE_GAS_ENDPOINT` is missing — never a silent `undefined` in a URL.
- `assertConfigured()` in Apps Script throws `CONFIG_MISSING` naming every absent property.
- `parseQuotationNumber` rejects anything not matching `^SFC\/RUH\/QTN\/(\d{4})\/(\d{3,})$`.
- Money helpers reject non-finite and non-integer minor-unit inputs.

---

# Testing Requirements

Set up Vitest and write the foundation tests:

- `shared/numbering` — `formatQuotationNumber(2026, 1)` → `SFC/RUH/QTN/2026/001`; `(2026, 9)` → `009`; `(2026, 10)` → `010`; `(2026, 99)` → `099`; `(2026, 100)` → `100`; `(2026, 1000)` → `1000`; year is taken from the argument and never hard-coded; `parseQuotationNumber` round-trips; `toFileSafe('SFC/RUH/QTN/2026/004')` → `SFC-RUH-QTN-2026-004`; invalid strings are rejected.
- `shared/money` — `roundHalfUp` boundaries; `multiplyQuantityByRate` with fractional quantities; `formatSar` output shape; no floating-point drift over a 1,000-line summation.
- `shared/totals` — subtotal, discount, 15% VAT, grand total on integer inputs; disabled discount and disabled VAT.
- `src/services/api/client` — builds a `text/plain` POST, includes `action` and `requestId`, parses success and error envelopes, maps an error code to a user message, and handles a timeout.
- Component smoke tests — the app shell renders all eight navigation items; each placeholder page renders without crashing.

All tests must pass.

---

# TypeScript Requirements

- `strict: true` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.
- No `any`. Use `unknown` with narrowing at the parse boundary of the API envelope.
- No `@ts-ignore`. `@ts-expect-error` only with a comment explaining why, and only if unavoidable.
- Exported functions have explicit return types.
- `npx tsc --noEmit` must be clean for both the app and `google-apps-script/`.

---

# Build Requirements

- `npm run build` completes with no errors and no warnings that indicate misconfiguration.
- `npm run gas:build` produces `dist-gas/Code.js` with `doPost` and `doGet` on the global object.
- `npm run dev` serves the shell and every route renders.
- No unused dependency is added. Do not install a PDF, DOCX, Drive, or Sheets library in this phase — those arrive in the phases that use them.

---

# Lint Requirements

- `npm run lint` is clean with zero errors and zero warnings.
- `npm run format` leaves no diff.
- The `react/no-danger`, `no-explicit-any`, `no-floating-promises`, and fixture-import restrictions are active and enforced.

---

# Error Handling

- `AppError` with the code union from `IMPLEMENTATION_PLAN.md` §23.1 exists and is used by the API client.
- Network failure, timeout, non-JSON response, and Apps Script HTML error pages each map to a distinct, typed error — never an unhandled rejection.
- A top-level React error boundary renders a recoverable error screen.
- Toast infrastructure exists and displays the `requestId` alongside the message.
- The Apps Script router wraps every handler in try/catch and always returns the envelope — it never returns a raw exception or an HTML error page to the client.

---

# Completion Criteria

- [ ] `npm run dev` serves the shell; all eight routes render.
- [ ] `npx tsc --noEmit` clean for the app and for `google-apps-script/`.
- [ ] `npm run lint` clean.
- [ ] `npm run build` succeeds.
- [ ] `npm run gas:build` produces a valid `dist-gas/Code.js`.
- [ ] `npm test` passes, including the full numbering padding matrix.
- [ ] `shared/` imports nothing from `src/` or `google-apps-script/`.
- [ ] No Supabase, no PostgreSQL, no database dependency anywhere in `package.json`.
- [ ] No dummy production data anywhere.
- [ ] `git status` shows no modification to `PRD/` or `reference/`.
- [ ] Committed to `claude/quotation-app-architecture-ycbwpa`.

---

# Stop Conditions

**Stop after the foundation is green and committed.**

Do not implement login, sessions, or route guards (Phase 02). Do not implement the quotation form or number reservation (Phase 03). Do not implement item tables, terms, authorized persons, the document model, PDF, DOCX, Drive, or Sheets. Do not create a real `.clasp.json` or deploy anything.

Stop and ask the user if:

- The mandated stack cannot be installed for a concrete technical reason.
- Following PRD §41's structure conflicts with something discovered in Phase 00.
- Any instruction here would require adding a database or a server tier.
