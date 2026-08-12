/**
 * Quotation actions: reserve a number, save, get, list, change status.
 *
 * See IMPLEMENTATION_PLAN.md §5 and §7.
 *
 * Role enforcement is NOT here — it is declared in the action table in main.ts
 * and applied by the router before any handler runs (§19.2).
 */

import { QUOTATION_STATUSES, type QuotationStatus } from '@shared/types';
import { isValidQuotationNumber } from '@shared/numbering';
import { writeAudit } from '../audit/audit-log';
import { quotationCodes } from '../config/properties';
import { ApiError, type Caller, type HandlerContext } from '../errors';
import { reserveQuotationNumber } from '../quotation-number/reserve';
import * as records from '../sheets/quotation-records-sheet';
import { validateQuotation } from '../validation/quotation-validator';

function requireCaller(context: HandlerContext): Caller {
  if (context.caller === null) {
    throw new ApiError('AUTH_REQUIRED', 'Authentication is required.');
  }
  return context.caller;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid request payload.');
  }
  return payload as Record<string, unknown>;
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

/* -------------------------------------------------------------------------- */
/* Reserve                                                                    */
/* -------------------------------------------------------------------------- */

export interface ReserveResponse {
  quotationNumber: string;
  fileSafeNumber: string;
  year: number;
  sequence: number;
}

/**
 * Issue the official quotation number for a draft.
 *
 * Reached only from an explicit user action. Opening the app or the New
 * Quotation form must never call this (PRD §35), and a test asserts the form
 * makes no request on mount.
 */
export function reserveNumber(payload: unknown, context: HandlerContext): ReserveResponse {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const reserved = reserveQuotationNumber({
    draftId: readString(body, 'draftId'),
    quotationDate: readString(body, 'quotationDate'),
  });

  writeAudit({
    actor: caller.email,
    action: 'quotation.reserveNumber',
    target: reserved.canonical,
    outcome: 'success',
    requestId: context.requestId,
  });

  return {
    quotationNumber: reserved.canonical,
    fileSafeNumber: reserved.fileSafe,
    year: reserved.year,
    sequence: reserved.sequence,
  };
}

/* -------------------------------------------------------------------------- */
/* Save                                                                       */
/* -------------------------------------------------------------------------- */

export interface SaveResponse {
  draftId: string;
  /** Empty while the quotation is still a draft. */
  quotationNumber: string;
  status: QuotationStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create or update a quotation.
 *
 * `finalize: true` reserves the official number (once) and applies the full
 * completeness rules. A draft save stores what exists so far without issuing
 * anything.
 */
export function save(payload: unknown, context: HandlerContext): SaveResponse {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const finalize = body['finalize'] === true;
  const validated = validateQuotation(body['quotation'], { requireComplete: finalize });

  const existing = records.findByDraftId(validated.draftId);

  /*
   * Number immutability (§7.7).
   *
   * The stored number is authoritative. A client that submits a DIFFERENT one
   * is rejected outright rather than quietly ignored, because a mismatch means
   * the two sides disagree about which document this is.
   */
  let quotationNumber = existing?.quotationNumber ?? '';

  if (
    existing !== null &&
    quotationNumber.length > 0 &&
    validated.submittedQuotationNumber !== undefined &&
    validated.submittedQuotationNumber !== quotationNumber
  ) {
    throw new ApiError(
      'QUOTATION_NUMBER_IMMUTABLE',
      'This quotation already has a number. A quotation number cannot be changed.',
    );
  }

  if (finalize && quotationNumber.length === 0) {
    quotationNumber = reserveQuotationNumber({
      draftId: validated.draftId,
      quotationDate: validated.quotationDate,
    }).canonical;
  }

  // Status is owned by the tracking sheet once issued; a re-save must never
  // reset an Approved quotation back to Pending (§17.2).
  const status: QuotationStatus = existing?.status ?? 'Pending';

  const stored = JSON.stringify({
    draftId: validated.draftId,
    quotationNumber,
    quotationDate: validated.quotationDate,
    quotationFor: validated.quotationFor,
    pricingMode: validated.pricingMode,
    currency: 'SAR',
    client: validated.client,
    lines: validated.lines,
    totals: validated.totals,
    discountRateBasisPoints: validated.discountRateBasisPoints,
    vatRateBasisPoints: validated.vatRateBasisPoints,
  });

  const result =
    existing === null
      ? records.insert({
          draftId: validated.draftId,
          quotationNumber,
          status,
          createdBy: caller.email,
          payload: stored,
        })
      : records.update({ ...existing, quotationNumber }, stored, status);

  // A newly issued number must be written onto an existing row too.
  if (existing !== null && existing.quotationNumber !== quotationNumber) {
    records.setQuotationNumber(existing, quotationNumber);
  }

  writeAudit({
    actor: caller.email,
    action: finalize ? 'quotation.finalize' : 'quotation.save',
    target: quotationNumber.length > 0 ? quotationNumber : validated.draftId,
    outcome: 'success',
    requestId: context.requestId,
  });

  return {
    draftId: result.draftId,
    quotationNumber,
    status: result.status,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

export interface QuotationSummary {
  draftId: string;
  quotationNumber: string;
  quotationDate: string;
  quotationFor: string;
  clientName: string;
  companyName: string;
  grandTotal: number;
  status: QuotationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredPayload {
  quotationDate?: unknown;
  quotationFor?: unknown;
  client?: { clientName?: unknown; companyName?: unknown };
  totals?: { grandTotal?: unknown };
}

function parsePayload(payload: string): StoredPayload {
  try {
    const parsed: unknown = JSON.parse(payload);
    // Every StoredPayload field is optional and `unknown`, and each is checked
    // individually below, so the narrowing above is enough on its own.
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function summarise(record: records.QuotationRecord): QuotationSummary {
  const parsed = parsePayload(record.payload);

  return {
    draftId: record.draftId,
    quotationNumber: record.quotationNumber,
    quotationDate: typeof parsed.quotationDate === 'string' ? parsed.quotationDate : '',
    quotationFor: typeof parsed.quotationFor === 'string' ? parsed.quotationFor : '',
    clientName: typeof parsed.client?.clientName === 'string' ? parsed.client.clientName : '',
    companyName: typeof parsed.client?.companyName === 'string' ? parsed.client.companyName : '',
    grandTotal: typeof parsed.totals?.grandTotal === 'number' ? parsed.totals.grandTotal : 0,
    status: record.status,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function list(_payload: unknown, context: HandlerContext): QuotationSummary[] {
  requireCaller(context);
  return records.listAll().map(summarise);
}

export interface GetResponse {
  quotation: unknown;
  status: QuotationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function get(payload: unknown, context: HandlerContext): GetResponse {
  requireCaller(context);
  const body = asRecord(payload);

  const draftId = readString(body, 'draftId');
  const quotationNumber = readString(body, 'quotationNumber');

  const record =
    draftId.length > 0
      ? records.findByDraftId(draftId)
      : records.findByQuotationNumber(quotationNumber);

  if (record === null) {
    throw new ApiError('VALIDATION_FAILED', 'That quotation could not be found.');
  }

  return {
    quotation: parsePayload(record.payload),
    status: record.status,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export function updateStatus(
  payload: unknown,
  context: HandlerContext,
): { quotationNumber: string; status: QuotationStatus } {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const quotationNumber = readString(body, 'quotationNumber');
  const statusText = readString(body, 'status');

  if (!isValidQuotationNumber(quotationNumber, quotationCodes())) {
    throw new ApiError('VALIDATION_FAILED', 'A valid quotation number is required.');
  }
  if (!(QUOTATION_STATUSES as readonly string[]).includes(statusText)) {
    throw new ApiError('VALIDATION_FAILED', 'Status must be Pending, Approved or Rejected.', {
      status: 'Choose a valid status.',
    });
  }

  const record = records.findByQuotationNumber(quotationNumber);
  if (record === null) {
    throw new ApiError('VALIDATION_FAILED', 'That quotation could not be found.');
  }

  const status = statusText as QuotationStatus;
  records.setStatus(record, status);

  writeAudit({
    actor: caller.email,
    action: 'quotation.updateStatus',
    target: `${quotationNumber}:${status}`,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { quotationNumber, status };
}
