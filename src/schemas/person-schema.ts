/**
 * Client-side authorized-person validation.
 *
 * The same bounds the Apps Script `person-validator` enforces, sourced from
 * `@shared/validation-rules` so the two cannot drift.
 *
 * Every field is required, unlike the client record where several are optional.
 * Each of these six lines is printed in the signature block, so a blank one
 * leaves a visible gap in a document that has already been sent.
 */

import { z } from 'zod';
import { PATTERNS, TEXT_LIMITS } from '@shared/validation-rules';

const trimmed = z.string().trim();

function required(label: string, limits: { min: number; max: number }) {
  return trimmed
    .min(Math.max(1, limits.min), `${label} is required`)
    .max(limits.max, `${label} is too long`);
}

export const personFormSchema = z.object({
  name: required('Name', TEXT_LIMITS.personName),
  designation: required('Designation', TEXT_LIMITS.personDesignation),
  companyName: required('Company name', TEXT_LIMITS.companyName),
  country: required('Country', TEXT_LIMITS.personCountry),
  email: required('Email', TEXT_LIMITS.email).regex(PATTERNS.email, 'Enter a valid email address'),
  phone: required('Phone', TEXT_LIMITS.phone).regex(PATTERNS.phone, 'Enter a valid phone number'),
});

export type PersonFormValues = z.infer<typeof personFormSchema>;

export function emptyPersonForm(): PersonFormValues {
  return { name: '', designation: '', companyName: '', country: '', email: '', phone: '' };
}

/**
 * Field-level errors, or `null` when the form is valid.
 *
 * Returned as a map rather than thrown so each message can be rendered under
 * the field it belongs to.
 */
export function validatePersonForm(values: PersonFormValues): Record<string, string> | null {
  const result = personFormSchema.safeParse(values);
  if (result.success) return null;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}
