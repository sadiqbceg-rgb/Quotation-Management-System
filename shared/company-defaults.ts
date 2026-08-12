/**
 * Company-level defaults.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS CONFIGURATION AND NOT A STRING IN A COMPONENT
 * ---------------------------------------------------------------------------
 * PRD §23 says the final closing-paragraph wording "will be provided later by
 * the company" (IMPLEMENTATION_PLAN.md §26, UR-09). A value that will change is
 * configuration. Hard-coding it inside a React component would mean a code
 * change and a redeploy every time the marketing wording is revised.
 *
 * These are DEFAULTS. Company Settings overrides them once that surface exists,
 * and any quotation may override them again for itself without altering either.
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE
 * ---------------------------------------------------------------------------
 * The closing paragraph is a VERBATIM transcription of the two closing
 * paragraphs on page 2 of `reference/quotation-sample.pdf`, the company's own
 * approved quotation. Real company content, not sample data — PRD §34's
 * no-dummy-data rule does not apply to it. Nothing is reworded.
 *
 * Deliberately absent: the VAT number, address, phone and email. The reference
 * letterhead carries a C.R. number, not a VAT number, and the rest belong to
 * Company Settings. Inventing placeholder values for them is exactly what PRD
 * §34 forbids — `{{company.vatNumber}}` stays visibly unresolved until an
 * operator supplies the real one.
 */

/** UR-11: 7 days in both reference documents. Drives `{{quotation.validityDays}}`. */
export const DEFAULT_QUOTATION_VALIDITY_DAYS = 7;

/**
 * The company's own name, as printed on its letterhead and in the approved
 * quotation ("Speed Falcon Company"). Transcribed, not invented — it resolves
 * `{{company.name}}` in the imported reference terms.
 */
export const DEFAULT_COMPANY_NAME = 'Speed Falcon Company';

/**
 * The default closing paragraph, verbatim from the approved quotation.
 *
 * Two paragraphs separated by a blank line: the thank-you, then the P.O.
 * request. Stored as plain text with `\n\n` between them — terms and the
 * closing paragraph are never HTML (§10, security requirements).
 */
export const DEFAULT_CLOSING_PARAGRAPH = [
  'Thank you for the opportunity to participate in this bid. We are committed to delivering our services with the highest standards of quality and professionalism to ensure your complete satisfaction, as you are a valued client',
  'We kindly request that you issue the Purchase Order (P.O.) with Chambered Service Agreement at your earliest convenience.',
].join('\n\n');
