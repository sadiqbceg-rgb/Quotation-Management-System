/**
 * Pre-export validation.
 *
 * PRD §36: "Do not create a PDF/DOCX until required information is valid."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SEPARATE FROM FORM VALIDATION
 * ---------------------------------------------------------------------------
 * The form lets a user save an incomplete draft on purpose — that is how you
 * step away mid-quotation without losing work. Export is the opposite: the
 * output is an official offer to a client, and anything missing from it is
 * missing from a document that has already been sent.
 *
 * So these rules are stricter than the form's, and they run at the moment of
 * export rather than while typing. Each failure names the section to fix, so
 * the list is a to-do rather than a verdict.
 *
 * Two rules escalate a warning from an earlier phase into a block:
 *   - an unresolved `{{token}}` in a term (Phase 05 showed it as a warning);
 *   - a signature that will not load (Phase 06 showed it in the editor).
 * Both are gaps a reader would see, so neither may reach a client document.
 */

import { hasUnresolvedTokens, type TermTokenContext } from '@shared/term-tokens';
import { TEXT_LIMITS, isWithinLength } from '@shared/validation-rules';

export type ExportBlockerCode =
  | 'CLIENT_NAME'
  | 'CLIENT_COMPANY'
  | 'CLIENT_ADDRESS'
  | 'QUOTATION_FOR'
  | 'NO_ITEMS'
  | 'INVALID_ITEM'
  | 'NO_SIGNATORY'
  | 'NO_SIGNATURE_IMAGE'
  | 'CLOSING_PARAGRAPH'
  | 'UNRESOLVED_TOKEN'
  | 'SEAL_ASSET';

export interface ExportBlocker {
  code: ExportBlockerCode;
  /** What is wrong, in the user's terms. */
  message: string;
  /** Which part of the form to go and fix. */
  section: 'Quotation' | 'Client' | 'Items' | 'Terms' | 'Authorized Person' | 'Assets';
}

export interface ExportValidationInput {
  quotationFor: string;
  client: { clientName: string; companyName: string; address: string };
  lines: ReadonlyArray<{ description: string; quantity: number; unitPrice: number }>;
  terms: ReadonlyArray<{ title: string; body: string }>;
  closingParagraph: string;
  signatory: { name: string } | null;
  /** Whether the signature image actually loaded — not merely whether one exists. */
  signatureLoaded: boolean;
  sealLoaded: boolean;
  tokenContext: TermTokenContext;
}

/**
 * Everything blocking export, or an empty list when the quotation is ready.
 *
 * Returns ALL problems rather than the first: a user fixing one thing at a time
 * across four sections is a worse experience than a single list they can work
 * through.
 */
export function validateForExport(input: ExportValidationInput): ExportBlocker[] {
  const blockers: ExportBlocker[] = [];

  if (!isWithinLength(input.quotationFor, TEXT_LIMITS.quotationFor)) {
    blockers.push({
      code: 'QUOTATION_FOR',
      message: 'Quotation For is required.',
      section: 'Quotation',
    });
  }

  if (!isWithinLength(input.client.clientName, TEXT_LIMITS.clientName)) {
    blockers.push({ code: 'CLIENT_NAME', message: 'Client name is required.', section: 'Client' });
  }
  if (!isWithinLength(input.client.companyName, TEXT_LIMITS.companyName)) {
    blockers.push({
      code: 'CLIENT_COMPANY',
      message: 'Client company name is required.',
      section: 'Client',
    });
  }
  if (!isWithinLength(input.client.address, TEXT_LIMITS.address)) {
    blockers.push({
      code: 'CLIENT_ADDRESS',
      message: 'Client address is required.',
      section: 'Client',
    });
  }

  if (input.lines.length === 0) {
    blockers.push({
      code: 'NO_ITEMS',
      message: 'Add at least one quotation item.',
      section: 'Items',
    });
  } else {
    const invalid = input.lines.filter(
      (line) =>
        line.description.trim().length === 0 || line.quantity <= 0 || line.unitPrice < 0,
    );

    if (invalid.length > 0) {
      blockers.push({
        code: 'INVALID_ITEM',
        message:
          invalid.length === 1
            ? 'One item is missing a description or a valid quantity.'
            : `${String(invalid.length)} items are missing a description or a valid quantity.`,
        section: 'Items',
      });
    }
  }

  if (input.signatory === null) {
    blockers.push({
      code: 'NO_SIGNATORY',
      message: 'Select an authorized person to sign the quotation.',
      section: 'Authorized Person',
    });
  } else if (!input.signatureLoaded) {
    blockers.push({
      code: 'NO_SIGNATURE_IMAGE',
      message: `The signature image for ${input.signatory.name} could not be loaded. The document cannot be produced without it.`,
      section: 'Authorized Person',
    });
  }

  if (input.closingParagraph.trim().length === 0) {
    blockers.push({
      code: 'CLOSING_PARAGRAPH',
      message: 'A closing paragraph is required.',
      section: 'Terms',
    });
  }

  // Phase 05 showed these as a warning while editing. At export they block:
  // "{{rate}}" printed on a client's quotation is a gap where a price belongs.
  const unresolved = input.terms.filter((term) =>
    hasUnresolvedTokens(term.body, input.tokenContext),
  );

  if (unresolved.length > 0) {
    blockers.push({
      code: 'UNRESOLVED_TOKEN',
      message:
        unresolved.length === 1
          ? `The term "${unresolved[0]?.title ?? ''}" still contains a placeholder that needs a value.`
          : `${String(unresolved.length)} terms still contain placeholders that need values: ${unresolved.map((term) => term.title).join(', ')}.`,
      section: 'Terms',
    });
  }

  if (!input.sealLoaded) {
    blockers.push({
      code: 'SEAL_ASSET',
      message: 'The company seal image could not be loaded.',
      section: 'Assets',
    });
  }

  return blockers;
}

export function canExport(blockers: readonly ExportBlocker[]): boolean {
  return blockers.length === 0;
}
