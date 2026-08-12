/**
 * Signature upload validation.
 *
 * PRD §33 item 14 and IMPLEMENTATION_PLAN.md §11.2.
 *
 * ---------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------
 * The verdict comes from the BYTES. Not the declared MIME type, not the
 * filename extension, not what the browser said — all three are supplied by
 * whoever is calling, and the endpoint is publicly reachable. A JPEG renamed
 * `signature.png` is rejected here, which is exactly the case a MIME-type check
 * would wave through.
 *
 * Everything is checked BEFORE the file reaches Drive, so a rejected upload
 * leaves nothing behind to clean up.
 */

import { readPngHeader, sanitizeFilename, type PngHeader } from '@shared/png';
import { base64ByteLength, isBase64Payload } from '@shared/signature';
import { UPLOAD_LIMITS } from '@shared/validation-rules';
import { ApiError } from '../errors';

/**
 * Sane bounds for a signature image.
 *
 * The lower bound is a legibility floor: §11.2 recommends ≥ 600 px wide, but a
 * hard refusal at that width would block a company whose only scan is smaller,
 * so 100 px is the refusal point and 600 px is a warning. The upper bound stops
 * a decompression-bomb header claiming a 60,000 px image.
 */
export const SIGNATURE_DIMENSIONS = {
  minWidth: 100,
  minHeight: 30,
  maxWidth: 10_000,
  maxHeight: 10_000,
  /** Below this, the signature will look soft at document scale. */
  recommendedWidth: 600,
} as const;

export interface ValidatedSignature {
  bytes: number[];
  header: PngHeader;
  filename: string;
  byteLength: number;
  /**
   * Non-fatal problems the Admin should see.
   *
   * The most important one: a PNG with no alpha channel. A signature scanned
   * onto white paper is a valid PNG and will upload happily, then paint a white
   * box across the letterhead in the finished quotation. Warning rather than
   * refusing is deliberate — cropping and background removal are the company's
   * decision, not something this system should make for them.
   */
  warnings: string[];
}

function fail(message: string, field = 'signature'): never {
  throw new ApiError('VALIDATION_FAILED', message, { [field]: message });
}

/**
 * Validate a base64 signature upload.
 *
 * Returns the decoded bytes so the caller does not decode twice — the second
 * decode is where "validated one thing, stored another" bugs come from.
 */
export function validateSignatureUpload(
  base64: unknown,
  rawFilename: unknown,
): ValidatedSignature {
  if (typeof base64 !== 'string' || base64.length === 0) {
    fail('A signature image is required.');
  }

  // A `data:` URI would decode to garbage; refuse it rather than guess.
  if (base64.indexOf('data:') === 0 || !isBase64Payload(base64)) {
    fail('The signature image could not be read. Upload a PNG file.');
  }

  // Check the declared size before decoding, so an oversized payload is never
  // expanded into memory.
  if (base64ByteLength(base64) > UPLOAD_LIMITS.signatureMaxBytes) {
    fail(
      `The signature must be ${String(Math.floor(UPLOAD_LIMITS.signatureMaxBytes / 1024))} KB or smaller.`,
    );
  }

  let bytes: number[];
  try {
    bytes = Utilities.base64Decode(base64);
  } catch {
    fail('The signature image could not be read. Upload a PNG file.');
  }

  if (bytes.length > UPLOAD_LIMITS.signatureMaxBytes) {
    fail(
      `The signature must be ${String(Math.floor(UPLOAD_LIMITS.signatureMaxBytes / 1024))} KB or smaller.`,
    );
  }

  const header = readPngHeader(bytes);
  if (header === null) {
    // Covers a JPEG renamed .png, a PDF, an SVG, and a truncated file alike.
    fail('That file is not a PNG image. Upload a PNG with a transparent background.');
  }

  if (
    header.width < SIGNATURE_DIMENSIONS.minWidth ||
    header.height < SIGNATURE_DIMENSIONS.minHeight
  ) {
    fail('That image is too small to use as a signature.');
  }
  if (
    header.width > SIGNATURE_DIMENSIONS.maxWidth ||
    header.height > SIGNATURE_DIMENSIONS.maxHeight
  ) {
    fail('That image is too large. Crop it to the signature itself.');
  }

  const warnings: string[] = [];

  if (!header.hasAlpha) {
    warnings.push(
      'This PNG has no transparent background, so it will print as a white box over the letterhead. Re-export it with transparency.',
    );
  }
  if (header.width < SIGNATURE_DIMENSIONS.recommendedWidth) {
    warnings.push(
      `This image is ${String(header.width)} px wide. At least ${String(SIGNATURE_DIMENSIONS.recommendedWidth)} px is recommended, or it may look soft in the PDF.`,
    );
  }

  const sanitised = typeof rawFilename === 'string' ? sanitizeFilename(rawFilename) : '';

  return {
    bytes,
    header,
    // A rejected name is replaced, never used to derive a path.
    filename: sanitised.length === 0 ? 'signature.png' : sanitised,
    byteLength: bytes.length,
    warnings,
  };
}
