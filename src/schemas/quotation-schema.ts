/**
 * Client-side quotation validation.
 *
 * The same rule set the Apps Script validator enforces, sourced from
 * `@shared/validation-rules` so the two cannot drift.
 *
 * This is a CONVENIENCE for the user — immediate, inline feedback. It is not a
 * security control: the endpoint is public, so the server re-validates
 * everything and recomputes every total (IMPLEMENTATION_PLAN.md §19.3).
 */

import { z } from 'zod';
import { PATTERNS, TEXT_LIMITS } from '@shared/validation-rules';
import { PRICING_MODES, QUOTATION_STATUSES } from '@shared/types';

const trimmed = z.string().trim();

function required(label: string, limits: { min: number; max: number }) {
  return trimmed
    .min(Math.max(1, limits.min), `${label} is required`)
    .max(limits.max, `${label} is too long`);
}

function optional(limits: { min: number; max: number }) {
  return trimmed.max(limits.max, 'Too long').optional().or(z.literal(''));
}

/** PRD §12: client name, company name and address are required; the rest are not. */
export const clientSchema = z.object({
  clientName: required('Client name', TEXT_LIMITS.clientName),
  companyName: required('Company name', TEXT_LIMITS.companyName),
  address: required('Address', TEXT_LIMITS.address),
  contactPerson: optional(TEXT_LIMITS.contactPerson),
  email: trimmed
    .refine((value) => value === '' || PATTERNS.email.test(value), 'Enter a valid email address')
    .optional()
    .or(z.literal('')),
  phone: trimmed
    .refine((value) => value === '' || PATTERNS.phone.test(value), 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  projectName: optional(TEXT_LIMITS.projectName),
  projectLocation: optional(TEXT_LIMITS.projectLocation),
  clientReference: optional(TEXT_LIMITS.clientReference),
});

export const quotationFormSchema = z.object({
  quotationDate: trimmed.regex(PATTERNS.isoDate, 'Enter a valid date'),
  quotationFor: required('Quotation For', TEXT_LIMITS.quotationFor),
  pricingMode: z.enum(PRICING_MODES),
  status: z.enum(QUOTATION_STATUSES),
  vatEnabled: z.boolean(),
  /** Whole percent, converted to basis points before it leaves the browser. */
  vatRatePercent: z.number().min(0).max(100),
  discountEnabled: z.boolean(),
  discountRatePercent: z.number().min(0).max(100),
  /** PRD §23. Defaults from Company Settings, editable per quotation. */
  closingParagraph: required('A closing paragraph', TEXT_LIMITS.closingParagraph),
  client: clientSchema,
});

export type QuotationFormValues = z.infer<typeof quotationFormSchema>;

/**
 * The draft schema.
 *
 * A draft may be incomplete — the user is mid-typing — so required-field rules
 * are relaxed. Completeness is enforced only at finalize, mirroring PRD §36:
 * "Do not create a PDF/DOCX until required information is valid."
 */
export const quotationDraftSchema = quotationFormSchema.extend({
  quotationFor: trimmed.max(TEXT_LIMITS.quotationFor.max, 'Quotation For is too long'),
  closingParagraph: trimmed.max(
    TEXT_LIMITS.closingParagraph.max,
    'The closing paragraph is too long',
  ),
  client: clientSchema.partial().extend({
    clientName: trimmed.max(TEXT_LIMITS.clientName.max, 'Too long'),
    companyName: trimmed.max(TEXT_LIMITS.companyName.max, 'Too long'),
    address: trimmed.max(TEXT_LIMITS.address.max, 'Too long'),
  }),
});

export const PERCENT_TO_BASIS_POINTS = 100;
