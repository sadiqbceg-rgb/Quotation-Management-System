/**
 * One-time import of the company's real Terms & Conditions.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE
 * ---------------------------------------------------------------------------
 * The eleven terms below are a VERBATIM transcription of
 * `reference/existing-terms.docx`, the company's own "General Terms &
 * Conditions" document. They are real business content, not sample data, and
 * PRD §34's no-dummy-data rule does not apply to them.
 *
 * Nothing here is reworded, improved, reordered or extended. Two edits only,
 * both mechanical, both to the placeholders the company had already left in the
 * document (see IMPLEMENTATION_PLAN.md §10.2):
 *
 *   `{company}`  →  `{{company.name}}`   — resolvable
 *   `{SAR  }`    →  `{{rate}}`           — deliberately NOT resolvable
 *
 * `{{rate}}` is left outside the token whitelist on purpose. A quotation has no
 * single rate — the approved sample replaced that placeholder by hand with
 * "SAR 20.00 per hour ... for General Labour (40 Nos.) and SAR 30.00 per hour
 * for the Supervisor (1 No.)". Leaving it unresolvable means validation flags
 * it and a human must edit the term for that quotation, rather than a document
 * going out with a blank where a price belongs.
 *
 * ---------------------------------------------------------------------------
 * BEHAVIOUR
 * ---------------------------------------------------------------------------
 * Admin only, explicitly invoked, idempotent, and non-destructive: it inserts
 * only terms whose title is not already present, and never modifies an existing
 * row (PRD §21: "Do not automatically modify existing terms").
 *
 * The four PRD §20 labels with no counterpart in the reference document —
 * Mobilization, Manpower Replacement, Project Specific Terms and Transportation
 * — are still not invented here. The company has now supplied their wording, and
 * it is transcribed verbatim into COMPANY_DRAFT_TERMS below, kept separate
 * because it is DRAFT rather than approved content.
 */

import type { TermCategory } from '../sheets/terms-sheet';
import * as terms from '../sheets/terms-sheet';

interface ReferenceTerm {
  title: string;
  bodyTemplate: string;
  category: TermCategory;
}

/** Transcribed from reference/existing-terms.docx, in the document's order. */
export const REFERENCE_TERMS: readonly ReferenceTerm[] = [
  {
    title: 'Working Hours',
    bodyTemplate: 'Minimum 10 hours per day, 6 days per week.',
    category: 'Manpower',
  },
  {
    title: 'Manpower Rate',
    bodyTemplate:
      'The agreed manpower rate is {{rate}} per hour per person for Carpenters and Steel Fixers.',
    category: 'Manpower',
  },
  {
    title: 'Overtime',
    bodyTemplate:
      'Overtime, if required, shall be calculated on a pro-rata basis against the agreed hourly rate.',
    category: 'Manpower',
  },
  {
    title: 'Timesheet & Attendance',
    bodyTemplate:
      "Daily attendance and timesheets shall be maintained and approved by the Client's authorized representative. Approved timesheets shall be submitted before the 5th day of the following month for invoicing purposes.",
    category: 'Manpower',
  },
  {
    title: 'Food, Accommodation & Transportation',
    bodyTemplate:
      'Food, accommodation, transportation, and emergency medical support shall be provided by {{company.name}}.',
    category: 'Manpower',
  },
  {
    title: 'Site Requirements',
    bodyTemplate:
      'The Client shall provide all necessary site access, permits, work areas, tools/equipment where applicable, and other site requirements necessary for the manpower to perform their assigned duties.',
    category: 'General',
  },
  {
    title: 'Payment Terms',
    bodyTemplate:
      'Payment shall be made within 30 days against approved timesheets and submitted invoices.',
    category: 'General',
  },
  {
    title: 'Additional Requirements',
    bodyTemplate:
      'Any additional manpower, scope of work, working hours, or requirements outside the agreed scope shall be mutually agreed and priced separately.',
    category: 'General',
  },
  {
    title: 'VAT',
    bodyTemplate: '{{totals.vatRate}} VAT shall be added to the quoted rates as applicable.',
    category: 'General',
  },
  {
    title: 'Payment Method',
    bodyTemplate:
      "Payment shall be made through bank transfer to the company's designated bank account.",
    category: 'General',
  },
  {
    title: 'Quotation Validity',
    bodyTemplate:
      'This quotation shall remain valid for {{quotation.validityDays}} days from the date of issue.',
    category: 'General',
  },
];

/**
 * The four PRD §20 terms with no counterpart in the reference document.
 *
 * ---------------------------------------------------------------------------
 * THESE ARE COMPANY DRAFTS. THEY ARE NOT LEGALLY APPROVED.
 * ---------------------------------------------------------------------------
 * PRD §20 lists Mobilization, Manpower Replacement, Project Specific Terms and
 * Transportation as selectable terms, but `reference/existing-terms.docx` — the
 * company's approved "General Terms & Conditions" — contains none of them. Until
 * now they had no wording at all and this file said so.
 *
 * The company has since supplied the wording below. It is transcribed verbatim
 * and **marked DRAFT**: unlike REFERENCE_TERMS above, it is not a transcription
 * of an approved document, and nobody has confirmed it has been through legal
 * review.
 *
 * That distinction is kept in the code rather than only in a document because
 * these appear on a quotation the company is contractually bound by. An Admin
 * must read them in the Terms library and confirm them with whoever owns the
 * company's terms before a quotation carrying one is sent. `RUNBOOK.md` §5.3
 * carries that step.
 *
 * They are imported by the same Admin-invoked, idempotent import as the
 * approved terms — nothing here seeds itself, and an Admin may edit or
 * deactivate any of them afterwards through the normal library flow.
 */
export const COMPANY_DRAFT_TERMS: readonly ReferenceTerm[] = [
  {
    title: 'Mobilization',
    bodyTemplate:
      'Mobilization costs, resources, equipment and personnel required to commence the services shall be arranged in accordance with the agreed project schedule. Any additional mobilization requirements arising from changes to the project scope, location or schedule may be subject to additional charges upon prior approval.',
    category: 'General',
  },
  {
    title: 'Manpower Replacement',
    bodyTemplate:
      'The company reserves the right to replace assigned manpower when required due to operational requirements, performance, availability, leave, resignation or other circumstances. Replacement personnel will be provided with qualifications and experience appropriate to the agreed position and project requirements.',
    category: 'Manpower',
  },
  {
    title: 'Project Specific Terms',
    bodyTemplate:
      'Services shall be performed in accordance with the agreed quotation, project scope, specifications and applicable site requirements. Any work, materials, manpower or services outside the agreed scope shall require prior approval and may be subject to additional charges.',
    category: 'General',
  },
  {
    title: 'Transportation',
    bodyTemplate:
      'Transportation requirements related to the agreed scope of work shall be provided as specified in the quotation. Any transportation requirements outside the agreed scope, including additional trips, locations or schedule changes, may be subject to additional charges upon prior approval.',
    category: 'General',
  },
];

/**
 * Everything the import inserts: the approved terms, then the drafts.
 *
 * Order matters only for `sortOrder`, and the approved terms come first so the
 * library reads in the order of the company's own document.
 */
const ALL_IMPORTABLE_TERMS: readonly ReferenceTerm[] = [...REFERENCE_TERMS, ...COMPANY_DRAFT_TERMS];

export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
}

/**
 * Insert any reference term not already present, by title.
 *
 * Safe to run twice: the second run imports nothing and changes nothing.
 */
export function importReferenceTerms(actor: string): ImportResult {
  let imported = 0;
  let skipped = 0;
  let sortOrder = terms.nextSortOrder();

  for (const term of ALL_IMPORTABLE_TERMS) {
    if (terms.titleExists(term.title)) {
      skipped += 1;
      continue;
    }

    terms.createTerm({
      id: Utilities.getUuid(),
      title: term.title,
      bodyTemplate: term.bodyTemplate,
      category: term.category,
      sortOrder,
      updatedBy: actor,
    });

    sortOrder += 10;
    imported += 1;
  }

  return { imported, skipped, total: ALL_IMPORTABLE_TERMS.length };
}
