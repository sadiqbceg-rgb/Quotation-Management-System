/**
 * Server-side validation for terms — both the master library and the copies a
 * quotation carries.
 *
 * See IMPLEMENTATION_PLAN.md §10 and PRD §20–§22.
 *
 * The two live together deliberately. A library term and a quotation term hold
 * the same user-supplied text under the same limits; splitting the rules across
 * two files is how they drift, and a quotation term is the one that reaches a
 * client's inbox.
 *
 * Terms are PLAIN TEXT. Nothing here accepts, sanitises or emits HTML — the
 * renderers take text, so the XSS surface stays closed by construction rather
 * than by a sanitiser that has to be right every time.
 */

import { DEFAULT_CLOSING_PARAGRAPH } from '@shared/company-defaults';
import { TERM_SOURCES, type TermSource } from '@shared/types';
import {
  QUOTATION_LIMITS,
  TEXT_LIMITS,
  isWithinLength,
  stripControlCharacters,
} from '@shared/validation-rules';
import { ApiError } from '../errors';

export type TermFields = Record<string, string>;

/** Trim, and strip control characters that have no business in a document. */
export function cleanTermText(value: unknown): string {
  return typeof value === 'string' ? stripControlCharacters(value).trim() : '';
}

/**
 * Check a title/body pair against the shared limits.
 *
 * Returns the field errors rather than throwing, so a caller validating many
 * terms can report every problem at once instead of one per round trip.
 */
export function checkTermText(title: string, body: string, prefix = ''): TermFields {
  const fields: TermFields = {};

  if (!isWithinLength(title, TEXT_LIMITS.termTitle)) {
    fields[`${prefix}title`] =
      `Title must be ${String(TEXT_LIMITS.termTitle.min)}-${String(TEXT_LIMITS.termTitle.max)} characters.`;
  }
  if (!isWithinLength(body, TEXT_LIMITS.termBody)) {
    fields[`${prefix}body`] =
      `Content must be ${String(TEXT_LIMITS.termBody.min)}-${String(TEXT_LIMITS.termBody.max)} characters.`;
  }

  return fields;
}

/** The library form: the body is a template, so the field is named for that. */
export function assertValidTermTemplate(title: string, bodyTemplate: string): void {
  const fields = checkTermText(title, bodyTemplate);

  if (Object.keys(fields).length > 0) {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', {
      ...(fields['title'] === undefined ? {} : { title: fields['title'] }),
      ...(fields['body'] === undefined ? {} : { bodyTemplate: fields['body'] }),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Terms as carried on a quotation                                            */
/* -------------------------------------------------------------------------- */

/**
 * A term as stored on a quotation.
 *
 * `body` is the resolved SNAPSHOT text, not a template reference (§6.3 and
 * §10.4). A library edit years later must not be able to change what a client
 * was actually sent.
 */
export interface ValidatedQuotationTerm {
  id: string;
  title: string;
  body: string;
  /** The unresolved template, so reopening the quotation returns it editable. */
  bodyTemplate: string;
  sortOrder: number;
  source: TermSource;
}

function toSource(value: unknown): TermSource {
  return typeof value === 'string' && (TERM_SOURCES as readonly string[]).includes(value)
    ? (value as TermSource)
    : 'library';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Validate the terms attached to a quotation.
 *
 * `sortOrder` is REASSIGNED from array position rather than trusted. The
 * document numbers positionally (1, 2, 3 …), so two terms sharing an order —
 * or a gap — would produce a quotation whose numbering the client can see is
 * wrong. Position is the one source that cannot collide.
 */
export function validateQuotationTerms(raw: unknown, fields: TermFields): ValidatedQuotationTerm[] {
  if (raw === undefined || raw === null) return [];

  if (!Array.isArray(raw)) {
    fields['terms'] = 'Terms & Conditions are malformed.';
    return [];
  }

  if (raw.length > QUOTATION_LIMITS.maxTerms) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `A quotation may contain at most ${String(QUOTATION_LIMITS.maxTerms)} terms.`,
    );
  }

  const terms: ValidatedQuotationTerm[] = [];
  const seen: string[] = [];

  raw.forEach((entry, index) => {
    const source = record(entry);
    if (source === null) {
      fields[`terms.${String(index)}`] = 'This term is malformed.';
      return;
    }

    const id = cleanTermText(source['id']);
    const title = cleanTermText(source['title']);
    const body = cleanTermText(source['body']);
    const template = cleanTermText(source['bodyTemplate']);

    if (id.length === 0 || id.length > 80) {
      fields[`terms.${String(index)}.id`] = 'This term is missing an identifier.';
      return;
    }

    // The same term twice would print as two identically-titled numbered
    // clauses. Reject rather than silently de-duplicate: the user chose it.
    if (seen.includes(id)) {
      fields[`terms.${String(index)}.id`] = 'This term is selected more than once.';
      return;
    }
    seen.push(id);

    const problems = checkTermText(title, body, `terms.${String(index)}.`);
    if (Object.keys(problems).length > 0) {
      for (const key of Object.keys(problems)) {
        const message = problems[key];
        if (message !== undefined) fields[key] = message;
      }
      return;
    }

    // The template is optional on the wire; a term saved without one is simply
    // its own template. Capped like the body, since it is stored too.
    if (template.length > TEXT_LIMITS.termBody.max) {
      fields[`terms.${String(index)}.body`] = 'This term is too long.';
      return;
    }

    terms.push({
      id,
      title,
      body,
      bodyTemplate: template.length === 0 ? body : template,
      sortOrder: terms.length,
      source: toSource(source['source']),
    });
  });

  return terms;
}

/**
 * Validate the closing paragraph, falling back to the company default.
 *
 * An omitted value means "use the default", not "reject the save". PRD §23 and
 * §39 make this a configurable default that a quotation may override, so the
 * server already knows the right answer when the client sends nothing —
 * failing the request instead would be a validation error the user cannot act
 * on.
 *
 * Length is still enforced: an oversized paragraph is a genuine problem, and it
 * has to be caught before it reaches a sheet cell.
 */
export function validateClosingParagraph(raw: unknown, fields: TermFields): string {
  const value = cleanTermText(raw);

  if (value.length === 0) return DEFAULT_CLOSING_PARAGRAPH;

  if (!isWithinLength(value, TEXT_LIMITS.closingParagraph)) {
    fields['closingParagraph'] =
      `The closing paragraph must be ${String(TEXT_LIMITS.closingParagraph.min)}-${String(TEXT_LIMITS.closingParagraph.max)} characters.`;
  }

  return value;
}
