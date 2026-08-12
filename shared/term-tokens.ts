/**
 * Terms & Conditions template tokens.
 *
 * See IMPLEMENTATION_PLAN.md §10.2.
 *
 * `reference/existing-terms.docx` contains the literal strings `{SAR  }` and
 * `{company}`, which proves the company already treats its standard terms as
 * templates rather than fixed text. This module is the resolver.
 *
 * SECURITY: resolution is a lookup in a CLOSED, explicitly built map. There is
 * no expression evaluation, no `eval`, no template engine that can execute
 * code, and no dynamic property access driven by user input — a term body is
 * user-supplied text, so anything else would be a code-execution path straight
 * through the T&C editor.
 *
 * An unknown token is left verbatim and REPORTED, never silently blanked. A
 * quotation that quietly dropped "{{rate}}" would go to a client with a gap
 * where a price should be.
 */

/** Every token the system will substitute. Anything else is unknown by design. */
export const TERM_TOKEN_NAMES = [
  'company.name',
  'company.vatNumber',
  'client.companyName',
  'client.clientName',
  'quotation.number',
  'quotation.date',
  'quotation.validityDays',
  'totals.vatRate',
] as const;

export type TermTokenName = (typeof TERM_TOKEN_NAMES)[number];

export interface TermTokenContext {
  companyName: string;
  companyVatNumber: string;
  clientCompanyName: string;
  clientName: string;
  quotationNumber: string;
  /** Already formatted for display, e.g. "11-08-2026". */
  quotationDate: string;
  validityDays: string;
  /** Already formatted, e.g. "15%". */
  vatRate: string;
}

/** `{{token.name}}` — a bounded character set, so the pattern cannot run away. */
const TOKEN_PATTERN = /\{\{([A-Za-z0-9_.]{1,40})\}\}/g;

function buildMap(context: TermTokenContext): Record<TermTokenName, string> {
  // Built explicitly, key by key. Never spread from caller-controlled data.
  return {
    'company.name': context.companyName,
    'company.vatNumber': context.companyVatNumber,
    'client.companyName': context.clientCompanyName,
    'client.clientName': context.clientName,
    'quotation.number': context.quotationNumber,
    'quotation.date': context.quotationDate,
    'quotation.validityDays': context.validityDays,
    'totals.vatRate': context.vatRate,
  };
}

export interface TokenResolution {
  text: string;
  /** Token names found in the text that the system does not substitute. */
  unknownTokens: string[];
  /**
   * Whitelisted tokens the context has no value for yet — an unconfigured VAT
   * number, a number not yet issued. Left verbatim, exactly like an unknown
   * token: substituting an empty string is the silent-blank failure this module
   * exists to prevent.
   */
  emptyTokens: TermTokenName[];
}

/**
 * Substitute the whitelisted tokens in a term body.
 *
 * Unresolved tokens survive into the output unchanged so the gap is visible on
 * screen, and are listed so validation can warn before export — which is
 * exactly what the company did by hand in the approved quotation, where
 * `{SAR  }` became real per-category rates.
 */
export function resolveTermTokens(text: string, context: TermTokenContext): TokenResolution {
  const map = buildMap(context);
  const unknown: string[] = [];
  const empty: TermTokenName[] = [];

  const resolved = text.replace(TOKEN_PATTERN, (whole: string, name: string) => {
    // hasOwnProperty via Object.prototype: a body containing {{constructor}} or
    // {{__proto__}} must not reach anything on the prototype chain.
    if (Object.prototype.hasOwnProperty.call(map, name)) {
      const value = map[name as TermTokenName];
      if (value.length > 0) return value;

      if (!empty.includes(name as TermTokenName)) empty.push(name as TermTokenName);
      return whole;
    }

    if (!unknown.includes(name)) unknown.push(name);
    return whole;
  });

  return { text: resolved, unknownTokens: unknown, emptyTokens: empty };
}

/** Every token name in a body the system could not fill in, in one list. */
export function findUnresolvedTokens(text: string, context: TermTokenContext): string[] {
  const resolution = resolveTermTokens(text, context);
  return [...resolution.unknownTokens, ...resolution.emptyTokens];
}

/** True when a body still needs a human to fill something in before export. */
export function hasUnresolvedTokens(text: string, context: TermTokenContext): boolean {
  return findUnresolvedTokens(text, context).length > 0;
}

/** An empty context: every token unresolved. Useful as a starting point. */
export function emptyTokenContext(): TermTokenContext {
  return {
    companyName: '',
    companyVatNumber: '',
    clientCompanyName: '',
    clientName: '',
    quotationNumber: '',
    quotationDate: '',
    validityDays: '',
    vatRate: '',
  };
}
