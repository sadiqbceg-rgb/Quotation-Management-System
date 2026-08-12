/**
 * Client-side term validation.
 *
 * The same bounds the Apps Script `term-validator` enforces, sourced from
 * `@shared/validation-rules` so the two cannot drift. This is a convenience for
 * the user; the server check is the control.
 */

import { z } from 'zod';
import { TEXT_LIMITS } from '@shared/validation-rules';
import { ITEM_CATEGORIES } from '@shared/types';

const trimmed = z.string().trim();

export const TERM_CATEGORIES = [...ITEM_CATEGORIES, 'General'] as const;

export const termFormSchema = z.object({
  title: trimmed
    .min(TEXT_LIMITS.termTitle.min, 'A term name is required')
    .max(TEXT_LIMITS.termTitle.max, 'The term name is too long'),
  bodyTemplate: trimmed
    .min(TEXT_LIMITS.termBody.min, 'Term content is required')
    .max(TEXT_LIMITS.termBody.max, 'The term content is too long'),
  category: z.enum(TERM_CATEGORIES),
});

export type TermFormValues = z.infer<typeof termFormSchema>;

export const closingParagraphSchema = trimmed.max(
  TEXT_LIMITS.closingParagraph.max,
  'The closing paragraph is too long',
);

/**
 * Field-level errors for a term form, or `null` when it is valid.
 *
 * Returned as a plain map rather than thrown, so the caller can render the
 * message under the field the user is actually looking at.
 */
export function validateTermForm(values: {
  title: string;
  bodyTemplate: string;
}): Record<string, string> | null {
  const result = termFormSchema.safeParse({ ...values, category: 'General' });
  if (result.success) return null;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}
