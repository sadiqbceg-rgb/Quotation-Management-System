/**
 * Quotation actions: reserve a number, save, get, list, change status.
 *
 * See IMPLEMENTATION_PLAN.md §5 and §7.
 *
 * Role enforcement is NOT here — it is declared in the action table in main.ts
 * and applied by the router before any handler runs (§19.2).
 */

import { QUOTATION_STATUSES, type QuotationStatus } from '@shared/types';
import {
  DOCUMENT_KINDS,
  describeArchivePath,
  documentFileName,
  quotationFolderSegments,
  type DocumentKind,
} from '@shared/drive-paths';
import type { DriveTarget } from '@shared/drive-links';
import { isValidQuotationNumber } from '@shared/numbering';
import { PATTERNS } from '@shared/validation-rules';
import { writeAudit } from '../audit/audit-log';
import { quotationCodes } from '../config/properties';
import { findByName } from '../drive/file-upload';
import { resolveFolderPath } from '../drive/folder-resolver';
import { targetOf } from '../drive/drive-urls';
import { storeQuotationDocuments } from '../drive/quotation-storage';
import { ApiError, type Caller, type HandlerContext } from '../errors';
import { lookupForSnapshot } from '../persons/handlers';
import { reserveQuotationNumber } from '../quotation-number/reserve';
import { computeMoney, recordQuotationTracking } from './tracking';
import * as records from '../sheets/quotation-records-sheet';
import * as tracking from '../sheets/quotations-sheet';
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

/** A stored JSON number, or nothing. Anything else in the cell is not a number. */
function integerOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
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

  /*
   * Validity days — the stored snapshot wins over an omission.
   *
   * The same shape as `quotationNumber` and `status` above: what the record
   * already holds is authoritative, and the request may replace it but never
   * silently erase it. A client that re-saves an existing quotation without
   * sending `validityDays` — an older build, a caller talking to the endpoint
   * directly — must not strip a quotation of the validity it was issued with,
   * because nothing else in the system can recover that number afterwards.
   *
   * Nothing here consults Company Settings. The default is applied once, when
   * the quotation is first written, by the client that creates it.
   */
  const storedValidityDays =
    existing === null ? undefined : integerOrUndefined(parsePayload(existing.payload).validityDays);
  const validityDays = validated.validityDays ?? storedValidityDays;

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
    // The Company Settings default as it stood when this quotation was created.
    // Stored beside the VAT rate for exactly the same reason.
    validityDays,
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

/**
 * Whether the tracking row was written (PRD §30 step 13).
 *
 * A separate outcome from the Drive save, because the two fail independently
 * and PRD §37 treats them differently: a Drive failure means the quotation is
 * not saved, while a Sheets failure after a successful upload means the
 * documents ARE safe and only the register is behind. The UI shows a warning
 * with a retry rather than an error.
 */
export interface TrackingOutcome {
  status: 'recorded' | 'failed' | 'skipped';
  /** `appended` on a first save, `updated` on a re-save. */
  disposition?: 'appended' | 'updated';
  /** Present when `failed`; already a user-facing sentence. */
  message?: string;
  code?: string;
}

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
  tracking: TrackingOutcome;
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
 * status, and no URL is recorded anywhere — the tracking row is written only
 * on `success`, and a failure to write it never fails the upload.
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
   * PRD §30 step 13 — the tracking row.
   *
   * Written only on `success`. A row claiming a document that is not in the
   * archive is worse than no row at all (§23.2), so a `partial` upload is
   * reported as `skipped` and the register stays untouched until the retry
   * completes the archive.
   *
   * A failure here NEVER fails the upload. The documents are in Drive, their
   * links are real, and telling the user the save failed would send them to
   * re-upload two megabytes to fix a spreadsheet row.
   */
  const tracking: TrackingOutcome =
    result.outcome === 'success'
      ? recordTrackingRow({
          record,
          stored,
          quotationDate,
          codes,
          createdBy: record.createdBy.length > 0 ? record.createdBy : caller.email,
          folderUrl: result.folder.url,
          pdfUrl: result.files.pdf.url,
          docxUrl: result.files.docx.url,
          requestId: context.requestId,
          actor: caller.email,
        })
      : { status: 'skipped' };

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
    tracking,
  };
}

/* -------------------------------------------------------------------------- */
/* Tracking (PRD §30 step 13, §31)                                            */
/* -------------------------------------------------------------------------- */

interface RecordTrackingArgs {
  record: records.QuotationRecord;
  stored: StoredPayload;
  quotationDate: string;
  codes: ReturnType<typeof quotationCodes>;
  createdBy: string;
  folderUrl: string;
  pdfUrl: string;
  docxUrl: string;
  requestId: string;
  actor: string;
}

/**
 * Write the register row, converting any failure into a reportable outcome.
 *
 * Never throws. The caller has already put the documents in Drive; a
 * spreadsheet problem must surface as a warning with a retry, not as a failed
 * save (PRD §37).
 */
function recordTrackingRow(args: RecordTrackingArgs): TrackingOutcome {
  try {
    const recorded = recordQuotationTracking({
      quotationNumber: args.record.quotationNumber,
      quotationDate: args.quotationDate,
      clientName: typeof args.stored.client?.clientName === 'string' ? args.stored.client.clientName : '',
      companyName:
        typeof args.stored.client?.companyName === 'string' ? args.stored.client.companyName : '',
      quotationFor: typeof args.stored.quotationFor === 'string' ? args.stored.quotationFor : '',
      authorizedPerson:
        typeof args.stored.authorizedPerson?.name === 'string'
          ? args.stored.authorizedPerson.name
          : '',
      // Recomputed from the stored lines, never taken from the request.
      money: computeMoney(args.stored),
      driveFolderUrl: args.folderUrl,
      pdfUrl: args.pdfUrl,
      docxUrl: args.docxUrl,
      createdBy: args.createdBy,
      draftId: args.record.draftId,
      codes: args.codes,
    });

    writeAudit({
      actor: args.actor,
      action: 'quotation.tracking',
      target: `${args.record.quotationNumber} ${recorded.disposition}`,
      outcome: 'success',
      requestId: args.requestId,
    });

    return { status: 'recorded', disposition: recorded.disposition };
  } catch (thrown: unknown) {
    const code = thrown instanceof ApiError ? thrown.code : 'SHEETS_WRITE_FAILED';

    writeAudit({
      actor: args.actor,
      action: 'quotation.tracking',
      target: `${args.record.quotationNumber} ${code}`,
      outcome: 'failure',
      requestId: args.requestId,
    });

    return {
      status: 'failed',
      code,
      message:
        thrown instanceof ApiError
          ? thrown.message
          : 'The documents were saved to Google Drive, but quotation tracking was not updated.',
    };
  }
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
  /** Halalas. The register stores SAR, so a tracked row is converted back. */
  grandTotal: number;
  status: QuotationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** The archive folder, when the quotation has been saved to Drive. */
  driveFolderUrl: string;
  pdfUrl: string;
  docxUrl: string;
  /** True when the quotation has a row in the tracking register (PRD §31). */
  tracked: boolean;
}

interface StoredPayload {
  quotationDate?: unknown;
  quotationFor?: unknown;
  client?: { clientName?: unknown; companyName?: unknown };
  authorizedPerson?: { name?: unknown } | null;
  totals?: { grandTotal?: unknown };
  lines?: unknown;
  discountRateBasisPoints?: unknown;
  vatRateBasisPoints?: unknown;
  /** Absent on a quotation stored before this field existed. */
  validityDays?: unknown;
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
    driveFolderUrl: '',
    pdfUrl: '',
    docxUrl: '',
    tracked: false,
  };
}

/** A register row, as the list sees it. */
function fromTrackingRow(row: tracking.QuotationRow): QuotationSummary {
  return {
    draftId: row.draftId,
    quotationNumber: row.quotationNumber,
    // Back to ISO for the client, which formats dates in one place.
    quotationDate: fromSheetDate(row.date),
    quotationFor: row.quotationFor,
    clientName: row.clientName,
    companyName: row.companyName,
    grandTotal: Math.round(row.totalAmount * 100),
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    driveFolderUrl: row.driveFolderUrl,
    pdfUrl: row.pdfUrl,
    docxUrl: row.docxUrl,
    tracked: true,
  };
}

/** `11-08-2026` → `2026-08-11`. The inverse of `toSheetDate`. */
function fromSheetDate(value: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (match === null) return value.trim();

  const [, day = '', month = '', year = ''] = match;
  return `${year}-${month}-${day}`;
}

/**
 * The quotation register.
 *
 * The tracking sheet is AUTHORITATIVE for anything that has been saved to
 * Drive: staff edit Status there by hand (§17.5), and a list that read status
 * from anywhere else would show a quotation as Pending after someone had
 * approved it.
 *
 * Drafts have no register row — they have no number yet — so they come from
 * `QuotationRecords`. Dropping them would leave a user unable to find the
 * quotation they were halfway through writing.
 */
export function list(_payload: unknown, context: HandlerContext): QuotationSummary[] {
  requireCaller(context);

  const tracked = tracking.listQuotationRows();
  const byDraftId = new Set(tracked.map((row) => row.draftId).filter((id) => id.length > 0));
  const byNumber = new Set(tracked.map((row) => row.quotationNumber));

  const untracked = records
    .listAll()
    .filter((record) => !byDraftId.has(record.draftId) && !byNumber.has(record.quotationNumber))
    .map(summarise);

  return [...tracked.map(fromTrackingRow), ...untracked];
}

export interface GetResponse {
  quotation: unknown;
  status: QuotationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** The archive links, when the quotation has been saved to Drive. */
  driveFolderUrl: string;
  pdfUrl: string;
  docxUrl: string;
  tracked: boolean;
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

  /*
   * Status comes from the REGISTER when a row exists. Staff approve and reject
   * in the Sheet (§17.5), so the record's own copy is a stale snapshot the
   * moment someone does.
   */
  const row =
    tracking.findByDraftId(record.draftId) ??
    tracking.findByQuotationNumber(record.quotationNumber);

  return {
    quotation: parsePayload(record.payload),
    status: row?.status ?? record.status,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    driveFolderUrl: row?.driveFolderUrl ?? '',
    pdfUrl: row?.pdfUrl ?? '',
    docxUrl: row?.docxUrl ?? '',
    tracked: row !== null,
  };
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How long to wait for the discard lock. Apps Script caps this at 30 s.
 */
export const DISCARD_LOCK_TIMEOUT_MS = 30_000;

/** Injectable so a test can drive the lock and observe the critical section. */
export interface DiscardLock {
  tryLock: (timeoutMs: number) => boolean;
  releaseLock: () => void;
}

let discardLockOverride: DiscardLock | null = null;

/** Tests only. */
export function TEST_ONLY_setDiscardLock(lock: DiscardLock | null): void {
  discardLockOverride = lock;
}

function defaultDiscardLock(): DiscardLock {
  // getScriptLock, not getUserLock: the race is between two REQUESTS touching
  // the same record, and they may come from different people.
  return LockService.getScriptLock();
}

/**
 * Discard a draft that has not been issued a number.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WHOLE THING IS ONE CRITICAL SECTION
 * ---------------------------------------------------------------------------
 * The read, the "has it been numbered?" check and the delete have to be
 * atomic. Without the lock:
 *
 *   - a discard can read "no number yet", a concurrent finalize can then issue
 *     one, and the discard deletes a quotation that now HAS a number. The
 *     number is burned, the record is gone, and the counter has moved;
 *   - two simultaneous discards both read the row and both delete, and the
 *     second `deleteRow` shifts an unrelated record out from under a row
 *     number another request is holding.
 *
 * `flush()` before release makes the delete durable, so the next holder cannot
 * read a row this one has already removed.
 *
 * Idempotency is preserved: a second discard of the same draft finds nothing
 * and is refused with the same "could not be found" message, never a crash.
 */
export function discardDraft(
  payload: unknown,
  context: HandlerContext,
): { success: true; deletedDraftId: string } {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const draftId = readString(body, 'draftId');
  if (draftId.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'A valid draft identifier is required.');
  }

  const lock = discardLockOverride ?? defaultDiscardLock();
  if (!lock.tryLock(DISCARD_LOCK_TIMEOUT_MS)) {
    throw new ApiError('RATE_LIMITED', 'The system is busy. Please try again.');
  }

  try {
    const record = records.findByDraftId(draftId);
    if (record === null) {
      throw new ApiError('VALIDATION_FAILED', 'That draft could not be found.');
    }

    if (record.quotationNumber.length > 0) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This quotation has already received a quotation number and cannot be discarded.',
      );
    }

    if (record.createdBy.length > 0 && caller.email !== record.createdBy) {
      throw new ApiError('FORBIDDEN', 'Only the creator of this draft can discard it.');
    }

    records.deleteByDraftId(draftId);
    SpreadsheetApp.flush();

    writeAudit({
      actor: caller.email,
      action: 'quotation.discardDraft',
      target: draftId,
      outcome: 'success',
      requestId: context.requestId,
    });

    return { success: true, deletedDraftId: draftId };
  } finally {
    // Always released, including on every refusal above.
    lock.releaseLock();
  }
}

export function updateStatus(
  payload: unknown,
  context: HandlerContext,
): { quotationNumber: string; status: QuotationStatus; tracked: boolean } {
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

  /*
   * Both stores. The register is what staff read (PRD §31) and what `list`
   * returns; `QuotationRecords` keeps its own copy so a quotation that has not
   * reached Drive yet still has a status. Writing only one leaves the two
   * disagreeing about a commercial decision.
   */
  const row = tracking.setRowStatus(quotationNumber, status);
  records.setStatus(record, status);

  writeAudit({
    actor: caller.email,
    action: 'quotation.updateStatus',
    target: `${quotationNumber}:${status}${row === null ? ' (not in register)' : ''}`,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { quotationNumber, status, tracked: row !== null };
}

/* -------------------------------------------------------------------------- */
/* Retry tracking (PRD §37)                                                   */
/* -------------------------------------------------------------------------- */

export interface RecordTrackingResponse {
  draftId: string;
  quotationNumber: string;
  tracking: TrackingOutcome;
}

/**
 * Write the register row for a quotation whose documents are already in Drive.
 *
 * The retry behind the "tracking was not updated" warning. It re-reads the
 * archive rather than trusting the client for the URLs, and it costs nothing
 * near the two megabytes a document re-upload would — which is the entire point
 * of separating it from `uploadToDrive`.
 *
 * Idempotent: `upsertQuotationRow` locates the row by `Draft ID`, so pressing
 * Retry twice updates one row rather than appending a second.
 */
export function recordTracking(
  payload: unknown,
  context: HandlerContext,
): RecordTrackingResponse {
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
  if (!isValidQuotationNumber(record.quotationNumber, codes)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'This quotation has no number yet, so it cannot be tracked.',
    );
  }

  const stored = parsePayload(record.payload);
  const quotationDate = typeof stored.quotationDate === 'string' ? stored.quotationDate : '';

  if (!PATTERNS.isoDate.test(quotationDate)) {
    throw new ApiError('VALIDATION_FAILED', 'This quotation has no valid date.');
  }

  // Read the archive back. Both documents must be there: a register row that
  // links to a half-filed quotation is the inconsistency §23.2 forbids.
  const archived = findArchivedDocuments(record.quotationNumber, quotationDate, codes);

  if (archived === null) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'The documents are not in Google Drive yet. Save the quotation to Drive first.',
    );
  }

  const outcome = recordTrackingRow({
    record,
    stored,
    quotationDate,
    codes,
    createdBy: record.createdBy.length > 0 ? record.createdBy : caller.email,
    folderUrl: archived.folderUrl,
    pdfUrl: archived.pdfUrl,
    docxUrl: archived.docxUrl,
    requestId: context.requestId,
    actor: caller.email,
  });

  if (outcome.status === 'failed') {
    throw new ApiError(
      'SHEETS_WRITE_FAILED',
      outcome.message ??
        'The documents were saved to Google Drive, but quotation tracking was not updated.',
    );
  }

  return { draftId, quotationNumber: record.quotationNumber, tracking: outcome };
}

interface ArchivedDocuments {
  folderUrl: string;
  pdfUrl: string;
  docxUrl: string;
}

/**
 * The archive's own view of a quotation.
 *
 * Read-only use of the Phase 10 modules. Folder resolution is get-or-create and
 * idempotent, so calling it here cannot create anything that was not going to
 * exist anyway.
 */
function findArchivedDocuments(
  quotationNumber: string,
  quotationDate: string,
  codes: ReturnType<typeof quotationCodes>,
): ArchivedDocuments | null {
  const folder = resolveFolderPath(quotationFolderSegments(quotationDate, quotationNumber, codes));

  const pdf = findByName(folder, documentFileName(quotationNumber, 'pdf', codes));
  const docx = findByName(folder, documentFileName(quotationNumber, 'docx', codes));

  if (pdf === null || docx === null) return null;

  return {
    folderUrl: targetOf(folder).url,
    pdfUrl: targetOf(pdf).url,
    docxUrl: targetOf(docx).url,
  };
}
