/**
 * Server-side quotation validation.
 *
 * See IMPLEMENTATION_PLAN.md §19.3 and PRD §36.
 *
 * The client runs the same rule set through Zod, but that is a convenience for
 * the user. THIS is the control: the Apps Script endpoint is publicly
 * reachable, so anything the browser checked can simply be skipped by a caller
 * that talks to the endpoint directly.
 *
 * Totals are recomputed here rather than trusted, using the very same
 * `shared/totals.ts` the browser used (§8.6). Running identical code on both
 * sides is what makes a mismatch meaningful instead of a false alarm.
 */

import { halalas, milli, type Halalas, type Milli } from '@shared/money';
import { isValidQuotationNumber } from '@shared/numbering';
import { calculateTotals, totalsMatch, type TotalsLineInput } from '@shared/totals';
import {
  PATTERNS,
  PRICE_LIMITS,
  QUANTITY_LIMITS,
  QUOTATION_LIMITS,
  TEXT_LIMITS,
  isWithinLength,
  stripControlCharacters,
} from '@shared/validation-rules';
import {
  ITEM_CATEGORIES,
  PRICING_MODES,
  QUOTATION_STATUSES,
  type ItemCategory,
  type PricingMode,
  type QuotationStatus,
  type Totals,
} from '@shared/types';
import { quotationCodes } from '../config/properties';
import { ApiError } from '../errors';
import {
  validateClosingParagraph,
  validateQuotationTerms,
  type ValidatedQuotationTerm,
} from './term-validator';
import {
  validatePersonSnapshot,
  type StoredPersonLookup,
  type ValidatedPersonSnapshot,
} from './person-validator';

export interface ValidatedClient {
  clientName: string;
  companyName: string;
  address: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  projectName?: string;
  projectLocation?: string;
  clientReference?: string;
}

export interface ValidatedLine {
  category: ItemCategory;
  /**
   * What the row says: Designation, Equipment Description or Material
   * Description depending on the category (PRD §14–§16).
   *
   * Stored, not derived. The document's first column is this text — a quotation
   * whose rows have quantities and prices but no descriptions is not a document
   * anyone can read.
   */
  description: string;
  quantity: Milli;
  unit: string;
  unitPrice: Halalas;
  remarks: string;
}

export interface ValidatedQuotation {
  draftId: string;
  quotationDate: string;
  quotationFor: string;
  /** The "1. Scope of Work" intro paragraph. Optional (§26 UR-08). */
  scopeOfWork: string;
  pricingMode: PricingMode;
  status: QuotationStatus;
  client: ValidatedClient;
  lines: ValidatedLine[];
  /** The snapshot terms this quotation carries. Order is positional (§10.3). */
  terms: ValidatedQuotationTerm[];
  closingParagraph: string;
  /** Rebuilt from the stored record, never trusted from the client (§11.3). */
  authorizedPerson: ValidatedPersonSnapshot | null;
  totals: Totals;
  discountRateBasisPoints: number | undefined;
  vatRateBasisPoints: number | undefined;
  /** Present only on an update; the server ignores it and re-reads storage. */
  submittedQuotationNumber: string | undefined;
}

type Fields = Record<string, string>;

/** The shared bounds, expressed in the minor units actually stored. */
const QUANTITY_CEILING_MILLI = QUANTITY_LIMITS.max * 1000;
const PRICE_CEILING_HALALAS = PRICE_LIMITS.maxSar * 100;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError('VALIDATION_FAILED', `${label} is missing or malformed.`);
  }
  return value as Record<string, unknown>;
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? stripControlCharacters(value).trim() : '';
}

function optionalText(source: Record<string, unknown>, key: string): string | undefined {
  const value = text(source, key);
  return value.length === 0 ? undefined : value;
}

function integer(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * Reject prototype-pollution keys before anything is read.
 *
 * `__proto__` in a JSON payload can corrupt every object in the execution if a
 * later merge is careless. Cheaper to refuse the payload than to audit every
 * downstream assignment.
 */
function assertNoPollutedKeys(source: Record<string, unknown>): void {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      throw new ApiError('VALIDATION_FAILED', 'Request payload contains a disallowed key.');
    }
  }
}

function validateClient(source: Record<string, unknown>, fields: Fields): ValidatedClient {
  const client = record(source['client'], 'Client information');
  assertNoPollutedKeys(client);

  const clientName = text(client, 'clientName');
  const companyName = text(client, 'companyName');
  const address = text(client, 'address');

  if (!isWithinLength(clientName, TEXT_LIMITS.clientName)) {
    fields['client.clientName'] = 'Client name is required.';
  }
  if (!isWithinLength(companyName, TEXT_LIMITS.companyName)) {
    fields['client.companyName'] = 'Company name is required.';
  }
  if (!isWithinLength(address, TEXT_LIMITS.address)) {
    fields['client.address'] = 'Address is required.';
  }

  const email = optionalText(client, 'email');
  if (email !== undefined && !PATTERNS.email.test(email)) {
    fields['client.email'] = 'Enter a valid email address.';
  }

  const phone = optionalText(client, 'phone');
  if (phone !== undefined && !PATTERNS.phone.test(phone)) {
    fields['client.phone'] = 'Enter a valid phone number.';
  }

  const validated: ValidatedClient = { clientName, companyName, address };

  const contactPerson = optionalText(client, 'contactPerson');
  if (contactPerson !== undefined) validated.contactPerson = contactPerson;
  if (email !== undefined) validated.email = email;
  if (phone !== undefined) validated.phone = phone;

  const projectName = optionalText(client, 'projectName');
  if (projectName !== undefined) validated.projectName = projectName;

  const projectLocation = optionalText(client, 'projectLocation');
  if (projectLocation !== undefined) validated.projectLocation = projectLocation;

  const clientReference = optionalText(client, 'clientReference');
  if (clientReference !== undefined) validated.clientReference = clientReference;

  return validated;
}

function isCategory(value: unknown): value is ItemCategory {
  return typeof value === 'string' && (ITEM_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Validate the line items.
 *
 * Phase 03 owns the quotation shell; Phase 04 owns the category tables. The
 * rules are enforced here from the start so the endpoint is never briefly
 * willing to accept an unvalidated item.
 */
function validateLines(
  source: Record<string, unknown>,
  fields: Fields,
  options: { requireComplete: boolean },
): ValidatedLine[] {
  const raw = source['lines'];
  if (raw === undefined) return [];

  if (!Array.isArray(raw)) {
    fields['lines'] = 'Quotation items are malformed.';
    return [];
  }

  if (raw.length > QUOTATION_LIMITS.maxLineItems) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `A quotation may contain at most ${String(QUOTATION_LIMITS.maxLineItems)} items.`,
    );
  }

  const lines: ValidatedLine[] = [];

  raw.forEach((entry, index) => {
    const line = record(entry, `Item ${String(index + 1)}`);
    assertNoPollutedKeys(line);

    const category = line['category'];
    const quantity = integer(line, 'quantity');
    const unitPrice = integer(line, 'unitPrice');

    if (!isCategory(category)) {
      fields[`lines.${String(index)}.category`] = 'Select a valid category.';
      return;
    }
    if (quantity === undefined || quantity <= 0) {
      fields[`lines.${String(index)}.quantity`] = 'Quantity must be greater than zero.';
      return;
    }
    if (quantity > QUANTITY_CEILING_MILLI) {
      fields[`lines.${String(index)}.quantity`] = 'Quantity is too large.';
      return;
    }
    if (unitPrice === undefined || unitPrice < 0) {
      fields[`lines.${String(index)}.unitPrice`] = 'Price must not be negative.';
      return;
    }
    if (unitPrice > PRICE_CEILING_HALALAS) {
      fields[`lines.${String(index)}.unitPrice`] = 'Price is too large.';
      return;
    }

    const description = text(line, 'description');
    const unit = text(line, 'unit');
    const remarks = text(line, 'remarks');

    // Required only when the quotation is being finalized: a draft may hold a
    // half-typed row, but a printed table may not have a blank first column.
    if (options.requireComplete && !isWithinLength(description, TEXT_LIMITS.itemDescription)) {
      fields[`lines.${String(index)}.description`] = 'A description is required.';
      return;
    }
    if (description.length > TEXT_LIMITS.itemDescription.max) {
      fields[`lines.${String(index)}.description`] = 'The description is too long.';
      return;
    }
    if (unit.length > TEXT_LIMITS.unit.max) {
      fields[`lines.${String(index)}.unit`] = 'The unit is too long.';
      return;
    }
    if (remarks.length > TEXT_LIMITS.remarks.max) {
      fields[`lines.${String(index)}.remarks`] = 'The remark is too long.';
      return;
    }

    lines.push({
      category,
      description,
      quantity: milli(quantity),
      unit,
      unitPrice: halalas(unitPrice),
      remarks,
    });
  });

  return lines;
}

function validateDate(value: string, fields: Fields): void {
  if (!PATTERNS.isoDate.test(value)) {
    fields['quotationDate'] = 'Enter a valid date.';
    return;
  }

  const parsed = new Date(`${value}T00:00:00Z`).getTime();
  if (Number.isNaN(parsed)) {
    fields['quotationDate'] = 'Enter a valid date.';
    return;
  }

  const yearsMs = QUOTATION_LIMITS.dateRangeYears * 365.25 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  if (parsed < now - yearsMs || parsed > now + yearsMs) {
    fields['quotationDate'] =
      `Date must be within ${String(QUOTATION_LIMITS.dateRangeYears)} years of today.`;
  }
}

/**
 * Validate a submitted quotation and recompute its totals.
 *
 * `requireComplete` is false for a draft save and true when the quotation is
 * being finalized, matching PRD §36: a draft may be incomplete, but a document
 * may never be produced from one.
 */
export interface ValidateQuotationOptions {
  requireComplete: boolean;
  /**
   * How to resolve an authorized person by id.
   *
   * Injected rather than imported so this module stays free of a Sheets
   * dependency and can be exercised without a spreadsheet.
   */
  lookupPerson: (id: string) => StoredPersonLookup | null;
}

export function validateQuotation(
  payload: unknown,
  options: ValidateQuotationOptions,
): ValidatedQuotation {
  const source = record(payload, 'Quotation');
  assertNoPollutedKeys(source);

  const fields: Fields = {};

  const draftId = text(source, 'draftId');
  if (draftId.length === 0 || draftId.length > 64) {
    throw new ApiError('VALIDATION_FAILED', 'A valid draft identifier is required.');
  }

  const quotationDate = text(source, 'quotationDate');
  validateDate(quotationDate, fields);

  const quotationFor = text(source, 'quotationFor');
  if (options.requireComplete && !isWithinLength(quotationFor, TEXT_LIMITS.quotationFor)) {
    fields['quotationFor'] = 'Quotation For is required.';
  } else if (quotationFor.length > TEXT_LIMITS.quotationFor.max) {
    fields['quotationFor'] = 'Quotation For is too long.';
  }

  const scopeOfWork = text(source, 'scopeOfWork');
  if (scopeOfWork.length > TEXT_LIMITS.scopeOfWork.max) {
    fields['scopeOfWork'] = 'Scope of Work is too long.';
  }

  const pricingModeText = text(source, 'pricingMode');
  const pricingMode: PricingMode = (PRICING_MODES as readonly string[]).includes(pricingModeText)
    ? (pricingModeText as PricingMode)
    : 'amount';

  const statusText = text(source, 'status');
  const status: QuotationStatus = (QUOTATION_STATUSES as readonly string[]).includes(statusText)
    ? (statusText as QuotationStatus)
    : 'Pending';

  const client = validateClient(source, options.requireComplete ? fields : {});
  const lines = validateLines(source, fields, { requireComplete: options.requireComplete });

  if (options.requireComplete && lines.length === 0) {
    fields['lines'] = 'Add at least one quotation item.';
  }

  // Terms are always validated, draft or not: the text is user-supplied and
  // ends up in a sheet cell either way (§19.5).
  const terms = validateQuotationTerms(source['terms'], fields);
  const closingParagraph = validateClosingParagraph(source['closingParagraph'], fields);

  // Rebuilt from storage, so the text a caller sent is discarded. The endpoint
  // is public; accepting a client-supplied name and designation would let
  // someone issue a quotation signed by a person who never agreed to sign it.
  const authorizedPerson = validatePersonSnapshot(source['authorizedPerson'], options.lookupPerson, {
    requireComplete: options.requireComplete,
  });

  const discountRateBasisPoints = integer(source, 'discountRateBasisPoints');
  const vatRateBasisPoints = integer(source, 'vatRateBasisPoints');

  const submittedNumber = optionalText(source, 'quotationNumber');
  if (submittedNumber !== undefined && !isValidQuotationNumber(submittedNumber, quotationCodes())) {
    fields['quotationNumber'] = 'The quotation number is not valid.';
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', fields);
  }

  const totalsInput = {
    lines: lines as readonly TotalsLineInput[],
    discountRateBasisPoints,
    vatRateBasisPoints,
  };

  const totals = calculateTotals(totalsInput);

  // The client's own figures, if it sent any, must agree exactly.
  const submittedTotals = source['totals'];
  if (submittedTotals !== undefined) {
    const candidate = record(submittedTotals, 'Totals') as unknown as Totals;
    if (!totalsMatch(totals, candidate)) {
      throw new ApiError(
        'TOTALS_MISMATCH',
        'The quotation totals could not be verified. Please reload and try again.',
      );
    }
  }

  return {
    draftId,
    quotationDate,
    quotationFor,
    scopeOfWork,
    pricingMode,
    status,
    client,
    lines,
    terms,
    closingParagraph,
    authorizedPerson,
    totals,
    discountRateBasisPoints,
    vatRateBasisPoints,
    submittedQuotationNumber: submittedNumber,
  };
}
