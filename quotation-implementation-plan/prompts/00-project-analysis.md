# Phase 00 — Project Analysis

> Run this prompt first. It produces documentation only. **No application code is written in this phase.**

---

# Objective

Independently inspect the entire repository, the PRD, and every reference asset, and produce a written analysis that the following fourteen implementation phases will rely on. Verify — do not assume — the findings recorded in `quotation-implementation-plan/IMPLEMENTATION_PLAN.md`, and record any place where your own inspection disagrees with it.

The deliverable is a single new file: `quotation-implementation-plan/ANALYSIS.md`.

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

> In Phase 00 there is no application code yet, so the typecheck / lint / build / test commands have nothing to run against. State that explicitly in your final report rather than skipping it silently. Every later phase must actually run them.

---

# Prerequisites

- Repository cloned; branch `claude/quotation-app-implementation` checked out.
- No prior phase is required.

---

# Files to Inspect

Every file in the repository. It is small — inspect all of it:

- `PRD/quotation-prd.md` — read all 1,376 lines, all 47 sections. Do not skim.
- `reference/quotation-sample.pdf` — 2 pages. Extract text with coordinates, image placements, vector drawings, fonts and sizes. Render both pages to PNG and look at them.
- `reference/letterhead.pdf` — 1 page. Same treatment.
- `reference/company-logo.png` — inspect the actual bytes, not the extension.
- `reference/company-seal.png` — check dimensions, colour mode, and whether an alpha channel exists.
- `reference/existing-terms.docx` — unzip it and read `word/document.xml`; extract every term verbatim.
- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md` — read in full; you are verifying it.
- Repository root: confirm what build tooling, source directories, and configuration files do and do not exist.

---

# Implementation Scope

In scope: reading, measuring, extracting, rendering, and documenting.

Out of scope: creating any application source file, installing any runtime dependency, scaffolding a project, modifying `PRD/`, modifying `reference/`, or changing `IMPLEMENTATION_PLAN.md`.

Analysis tooling (a PDF/image library in a scratch directory outside the repository) may be installed to perform the inspection. It must not be added to the repository or to any manifest.

---

# Required Changes

Create `quotation-implementation-plan/ANALYSIS.md` containing:

1. **Repository inventory** — every file, its real type (verified by content), and its size.
2. **Confirmation that the repository is greenfield** — explicitly list the build/config/source artefacts that are absent.
3. **PRD summary** — every functional requirement, grouped, with section references.
4. **Reference quotation layout specification** — page size; measured margins; the letterhead header and footer geometry; the watermark rect; the items-table column and row geometry; the signature block geometry including the seal and signature image rects; fonts, sizes, leading, paragraph spacing; brand colours as hex.
5. **Reference letterhead specification** — element rects, embedded fonts, whether the page is vector and reusable as a background.
6. **Asset findings** — for each image: real format, dimensions, colour mode, presence or absence of an alpha channel, and the consequence for document generation.
7. **Terms & Conditions extraction** — all 11 terms verbatim, plus every template placeholder found in the text.
8. **The quotation number as it actually appears in the reference document**, quoted exactly, with the page and coordinates you read it from.
9. **Contradictions between the PRD and the reference material** — each one stated as: PRD says X (section reference), the reference shows Y (file and location), recommended resolution.
10. **Gaps and missing inputs** — anything a later phase needs that the repository does not contain.
11. **Reusable code inventory** — state the finding plainly, with evidence.
12. **Risk register** — technical risks with likelihood, impact, and mitigation.
13. **Agreements and disagreements with `IMPLEMENTATION_PLAN.md`** — an explicit list. If you find nothing to disagree with, say so.

Every measured number must be traceable to the file and page it came from.

---

# Expected Files / Components

```
quotation-implementation-plan/ANALYSIS.md      (new — the only file this phase creates)
```

---

# Architecture Requirements

- Record, do not decide. Where the plan has already chosen an architecture, your job is to verify the choice is consistent with the evidence and flag it if not.
- The V1 architecture is fixed: React + TypeScript frontend → Google Apps Script → Google Drive + Google Sheets. No Supabase. No PostgreSQL. No traditional database. Confirm nothing in the repository contradicts this.

---

# Files That Must NOT Be Changed

- `PRD/quotation-prd.md`
- `reference/letterhead.pdf`
- `reference/quotation-sample.pdf`
- `reference/company-logo.png`
- `reference/company-seal.png`
- `reference/existing-terms.docx`
- `quotation-implementation-plan/IMPLEMENTATION_PLAN.md`
- `quotation-implementation-plan/prompts/*`

Reference files are read-only inputs. Do not rename, move, convert, re-encode, or optimise them. Write any extracted or rendered derivative to a scratch directory outside the repository.

---

# Data Requirements

- Report only data you actually read out of the files.
- Do not invent field names, units, prices, clients, or quotation numbers.
- The one real quotation number in the repository (`SFC/RUH/QTN/2026/004`) is reference evidence — quote it as such, never reuse it as sample data.
- Create no clients, quotations, users, prices, signatures, Drive URLs, or Sheets records.

---

# Security Requirements

- Note any credential, token, key, or personal data present in the repository or embedded in the reference documents. Do not reproduce secrets in `ANALYSIS.md`.
- The reference documents contain real business contact details and a real person's signature image. Do not extract the signature image into the repository.
- Record the security implications of the mandated architecture, especially that a Google Apps Script Web App deployed for anonymous access has a publicly reachable URL.

---

# Validation Requirements

Before finishing, verify:

- [ ] The PRD was read in full, not sampled.
- [ ] Both PDFs were rendered and visually examined, not only text-extracted.
- [ ] Image formats were determined from file content, not from file extensions.
- [ ] All 11 terms were extracted from the DOCX.
- [ ] Every geometric figure in `ANALYSIS.md` is traceable to a file and page.
- [ ] Every PRD/reference contradiction is listed with a recommended resolution.
- [ ] No file outside `quotation-implementation-plan/ANALYSIS.md` was created or modified.

---

# Testing Requirements

There is no application code to test in this phase. Instead, validate the analysis itself:

- Re-extract at least two measurements with a second method (for example, text-block bounding boxes and a rendered-image inspection) and confirm they agree.
- Confirm the extracted quotation number matches the regex `^SFC\/RUH\/QTN\/\d{4}\/\d{3,}$`.
- Confirm the page dimensions of both PDFs are A4.

State in your final report that no automated test suite exists yet and that Phase 13 establishes the full suite.

---

# TypeScript Requirements

No TypeScript is written in this phase. Any throwaway inspection script must live outside the repository. Later phases use strict TypeScript with `any` avoided.

---

# Build Requirements

There is no build in this phase because no build tooling exists. Confirm this explicitly by showing that `package.json` is absent, and state it in your final report. Phase 01 establishes the build.

---

# Lint Requirements

There is no lint configuration in this phase. Confirm its absence explicitly and state it in your final report. Phase 01 establishes ESLint and Prettier.

---

# Error Handling

- If a reference file cannot be parsed, report exactly which file and which operation failed, and try an alternative tool before concluding anything.
- Never guess a measurement you could not take. Write "could not be determined" and explain why.
- If the PRD and the reference material conflict, record both positions — do not silently pick one and present it as fact.

---

# Completion Criteria

- [ ] `quotation-implementation-plan/ANALYSIS.md` exists and covers all thirteen required subjects.
- [ ] Every measurement is sourced.
- [ ] All PRD/reference contradictions are documented with recommendations.
- [ ] All missing inputs are listed.
- [ ] No application code was created.
- [ ] No file in `PRD/` or `reference/` was modified — verify with `git status`.
- [ ] Work committed to `claude/quotation-app-implementation`.

---

# Stop Conditions

**Stop immediately after `ANALYSIS.md` is written and committed.**

Do not scaffold the project. Do not create `package.json`. Do not install runtime dependencies. Do not write React, TypeScript, or Apps Script source. Do not begin Phase 01.

Stop and ask the user if:

- The PRD and the reference material conflict in a way that changes the data model or the document layout beyond the contradictions already recorded in `IMPLEMENTATION_PLAN.md` §26.
- A reference file is unreadable or appears corrupt.
- The repository contains source code that this prompt says should not exist — that would mean the phase sequence has already been started, and you must report that instead of proceeding.
