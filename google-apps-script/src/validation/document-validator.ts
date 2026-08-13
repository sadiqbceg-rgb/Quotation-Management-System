/**
 * Validation of an uploaded quotation document.
 *
 * PRD §33 item 14, and the mirror of `image-validator.ts` for the signature
 * path — same rule, same reasoning:
 *
 * ---------------------------------------------------------------------------
 * THE VERDICT COMES FROM THE BYTES
 * ---------------------------------------------------------------------------
 * Not the declared kind, not the filename. This endpoint is publicly reachable
 * and takes base64 from whoever calls it; without a magic-byte check it is an
 * arbitrary file-upload service that happens to file its uploads neatly under
 * the company's letterhead archive.
 *
 * Everything is checked BEFORE anything reaches Drive, so a rejected upload
 * leaves nothing behind to clean up.
 */

import { DOCUMENT_MIME_TYPES, type DocumentKind } from '@shared/drive-paths';
import { base64ByteLength, isBase64Payload } from '@shared/signature';
import { UPLOAD_LIMITS } from '@shared/validation-rules';
import { ApiError } from '../errors';

/** `%PDF-` and `PK\x03\x04`, as unsigned byte values. */
export const MAGIC_BYTES: Record<DocumentKind, readonly number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
  docx: [0x50, 0x4b, 0x03, 0x04],
};

/** A document smaller than this cannot be a real quotation. */
const MIN_DOCUMENT_BYTES = 1_024;

/** Both documents together, so one request cannot be sized to defeat the cap. */
export const COMBINED_MAX_BYTES = UPLOAD_LIMITS.documentMaxBytes * 2;

export interface ValidatedDocument {
  kind: DocumentKind;
  /** SIGNED bytes, as Apps Script produces them. */
  bytes: number[];
  mimeType: string;
  byteLength: number;
}

const KIND_LABELS: Record<DocumentKind, string> = { pdf: 'PDF', docx: 'Word document' };

function fail(message: string): never {
  throw new ApiError('VALIDATION_FAILED', message);
}

/**
 * Compare against the file's leading bytes.
 *
 * Apps Script's `base64Decode` returns SIGNED bytes (-128..127), so every value
 * is masked back to 0..255 before comparison. Skipping that makes the check
 * pass for any file whose first byte happens to be under 0x80 — which includes
 * every one of the formats this is meant to reject.
 */
function hasMagicBytes(bytes: readonly number[], magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;

  for (let index = 0; index < magic.length; index++) {
    if (((bytes[index] ?? 0) & 0xff) !== magic[index]) return false;
  }
  return true;
}

/**
 * Validate one base64 document.
 *
 * Returns the decoded bytes so the caller does not decode twice — decoding
 * again is where "validated one thing, stored another" comes from.
 */
export function validateDocumentUpload(kind: DocumentKind, base64: unknown): ValidatedDocument {
  const label = KIND_LABELS[kind];

  if (typeof base64 !== 'string' || base64.length === 0) {
    fail(`The ${label} is missing. Generate the quotation again and retry.`);
  }
  if (base64.indexOf('data:') === 0 || !isBase64Payload(base64)) {
    fail(`The ${label} could not be read. Generate the quotation again and retry.`);
  }

  // Checked from the ENCODED length first, so an oversized payload is never
  // expanded into memory to find out how big it is.
  if (base64ByteLength(base64) > UPLOAD_LIMITS.documentMaxBytes) {
    fail(
      `The ${label} is larger than ${String(Math.floor(UPLOAD_LIMITS.documentMaxBytes / 1_048_576))} MB. Split the quotation into smaller ones.`,
    );
  }

  let bytes: number[];
  try {
    bytes = Utilities.base64Decode(base64);
  } catch {
    fail(`The ${label} could not be read. Generate the quotation again and retry.`);
  }

  if (bytes.length > UPLOAD_LIMITS.documentMaxBytes) {
    fail(
      `The ${label} is larger than ${String(Math.floor(UPLOAD_LIMITS.documentMaxBytes / 1_048_576))} MB. Split the quotation into smaller ones.`,
    );
  }
  if (bytes.length < MIN_DOCUMENT_BYTES) {
    fail(`The ${label} is empty. Generate the quotation again and retry.`);
  }
  if (!hasMagicBytes(bytes, MAGIC_BYTES[kind])) {
    fail(`That file is not a ${label}. Generate the quotation again and retry.`);
  }

  return {
    kind,
    bytes,
    mimeType: DOCUMENT_MIME_TYPES[kind],
    byteLength: bytes.length,
  };
}

/** Refuse a request whose documents together exceed the combined cap. */
export function assertCombinedSize(documents: readonly ValidatedDocument[]): void {
  const total = documents.reduce((sum, document) => sum + document.byteLength, 0);

  if (total > COMBINED_MAX_BYTES) {
    fail('The quotation documents are too large to upload. Split the quotation into smaller ones.');
  }
}
