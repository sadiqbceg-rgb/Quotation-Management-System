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
 * The four PRD §20 checkbox labels with no counterpart in the reference
 * document — Mobilization, Manpower Replacement, Project Specific Terms, and
 * Transportation as a standalone term — are NOT invented here. The company
 * supplies their wording through the normal create flow.
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

  for (const term of REFERENCE_TERMS) {
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

  return { imported, skipped, total: REFERENCE_TERMS.length };
}
