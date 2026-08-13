/**
 * Quotation actions: reserve a number, save, get, list, change status.
 *
 * See IMPLEMENTATION_PLAN.md §5 and §7.
 *
 * Role enforcement is NOT here — it is declared in the action table in main.ts
 * and applied by the router before any handler runs (§19.2).
 */

import { QUOTATION_STATUSES, type QuotationStatus } from '@shared/types';
import { DOCUMENT_KINDS, describeArchivePath, type DocumentKind } from '@shared/drive-paths';
import type { DriveTarget } from '@shared/drive-links';
import { isValidQuotationNumber } from '@shared/numbering';
import { PATTERNS } from '@shared/validation-rules';
import { writeAudit } from '../audit/audit-log';
import { quotationCodes } from '../config/properties';
import { storeQuotationDocuments } from '../drive/quotation-storage';
import { ApiError, type Caller, type HandlerContext } from '../errors';
import { lookupForSnapshot } from '../persons/handlers';
import { reserveQuotationNumber } from '../quotation-number/reserve';
import * as records from '../sheets/quotation-records-sheet';
import {
  assertCombinedSize,
  validateDocumentUpload,
  type ValidatedDocument,
} from '../validation/document-validator';
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
  const validated = validateQuotation(body['quotation'], {
    requireComplete: finalize,
    lookupPerson: lookupForSnapshot,
  });

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
    scopeOfWork: validated.scopeOfWork,
    pricingMode: validated.pricingMode,
    currency: 'SAR',
    client: validated.client,
    lines: validated.lines,
    // Snapshot text, not a reference (§10.4). A later library edit must not be
    // able to change what this client was sent.
    terms: validated.terms,
    closingParagraph: validated.closingParagraph,
    // A snapshot, not a live reference (§6.3): editing the person later must
    // not change the signature block on a quotation already issued.
    authorizedPerson: validated.authorizedPerson,
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
/* Upload to Drive (PRD §30)                                                  */
/* -------------------------------------------------------------------------- */

export interface UploadToDriveResponse {
  outcome: 'success' | 'partial';
  draftId: string;
  quotationNumber: string;
  folder: DriveTarget;
  /** Root-relative: `['2026', 'August', 'SFC-RUH-QTN-2026-004']`. */
  path: string[];
  /** Human-readable form of the same path, for the success panel. */
  pathLabel: string;
  files: { pdf: DriveTarget | null; docx: DriveTarget | null };
  /** Empty on success. What a Retry Upload must send. */
  missing: DocumentKind[];
}

/**
 * Upload the generated documents to the Drive archive.
 *
 * PRD §30 steps 5–12 and 15. Steps 1–4 (validate, ensure a number, generate the
 * two files) happen in the browser, which is where the generators live; this
 * action is what turns their output into archived documents.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES A RETRY SAFE
 * ---------------------------------------------------------------------------
 * The `draftId` is the key to everything. It resolves to the stored quotation,
 * whose number was issued once and is immutable (§7.7), which yields the same
 * folder and the same two filenames — so a retry replaces content in place and
 * can never produce `SFC-RUH-QTN-2026-004 (1).pdf`.
 *
 * The number is read from the STORED RECORD, never from the request. A client
 * that could name its own target folder could file a document under any
 * quotation in the archive.
 *
 * PRD §37: on failure the quotation is not marked saved. Nothing here writes a
 * status, and no URL is recorded anywhere — the tracking row is Phase 11's, and
 * it is only reached on `success` (see the integration point below).
 */
export function uploadToDrive(payload: unknown, context: HandlerContext): UploadToDriveResponse {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const draftId = readString(body, 'draftId');
  if (draftId.length === 0 || draftId.length > 64) {
    throw new ApiError('VALIDATION_FAILED', 'A valid draft identifier is required.');
  }

  const record = records.findByDraftId(draftId);
  if (record === null) {
    throw new ApiError('VALIDATION_FAILED', 'That quotation could not be found.');
  }

  const codes = quotationCodes();

  // PRD §30 step 2. A draft has no number, and a folder cannot be named after
  // one that does not exist yet.
  if (!isValidQuotationNumber(record.quotationNumber, codes)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'This quotation has no number yet. Create the quotation before saving it to Google Drive.',
    );
  }

  const stored = parsePayload(record.payload);
  const quotationDate = typeof stored.quotationDate === 'string' ? stored.quotationDate : '';

  // The year and month folders come from this date (PRD §10), so an unusable
  // one has to fail here rather than file the quotation under the wrong month.
  if (!PATTERNS.isoDate.test(quotationDate)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'This quotation has no valid date, so it cannot be filed in the archive.',
    );
  }

  const documentsPayload = asRecord(body['documents']);
  const documents: Partial<Record<DocumentKind, ValidatedDocument>> = {};

  for (const kind of DOCUMENT_KINDS) {
    const supplied = documentsPayload[kind];
    // Absent is legitimate on a retry; present-but-wrong never is.
    if (supplied === undefined || supplied === null) continue;
    documents[kind] = validateDocumentUpload(kind, supplied);
  }

  const validated = DOCUMENT_KINDS.map((kind) => documents[kind]).filter(
    (document): document is ValidatedDocument => document !== undefined,
  );

  if (validated.length === 0) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'No quotation documents were supplied for upload.',
    );
  }
  assertCombinedSize(validated);

  const result = storeQuotationDocuments({
    quotationNumber: record.quotationNumber,
    quotationDate,
    codes,
    documents,
  });

  /*
   * PHASE 11 INTEGRATION POINT.
   *
   * On `success`, the tracking row is written here: the quotation number, the
   * client, the totals, the folder URL and both file URLs. It is deliberately
   * NOT written on `partial` — a row claiming a document that is not in the
   * archive is worse than no row at all (§23.2).
   *
   * Phase 10 stops at returning the URLs; nothing below this comment writes to
   * the `Quotations` sheet.
   */

  writeAudit({
    actor: caller.email,
    action: 'quotation.uploadToDrive',
    // The number and the file ids — never the payloads, never base64 (§19.7).
    target: [
      record.quotationNumber,
      result.outcome,
      ...result.uploaded.map((file) => `${file.kind}:${file.fileId}:${file.disposition}`),
    ].join(' '),
    outcome: result.outcome === 'success' ? 'success' : 'failure',
    requestId: context.requestId,
  });

  return {
    outcome: result.outcome,
    draftId,
    quotationNumber: record.quotationNumber,
    folder: result.folder,
    path: result.path,
    pathLabel: describeArchivePath(result.path),
    files: result.files,
    missing: result.outcome === 'success' ? [] : result.missing,
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
