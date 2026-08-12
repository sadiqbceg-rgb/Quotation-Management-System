/**
 * Typed PDF generation failures.
 *
 * Every failure carries a CODE, so the UI can say something specific rather
 * than "something went wrong" — and so a support conversation can start from
 * "the letterhead didn't load" instead of a screenshot.
 *
 * Mirrors the taxonomy in `src/services/api/errors.ts`, which is where the
 * `requestId` convention comes from.
 */

export const PDF_ERROR_CODES = [
  'LETTERHEAD_MISSING',
  'FONT_EMBED_FAILED',
  'SEAL_MISSING',
  'SIGNATURE_MISSING',
  'INVALID_MODEL',
  'QUOTATION_NUMBER_REQUIRED',
  'TOO_LARGE',
  'LAYOUT_FAILED',
  'OUTPUT_INVALID',
] as const;

export type PdfErrorCode = (typeof PDF_ERROR_CODES)[number];

export interface PdfGenerationErrorOptions {
  cause?: unknown;
  /** Correlates a failure with a backend request, when one was involved. */
  requestId?: string;
}

export class PdfGenerationError extends Error {
  public override readonly name = 'PdfGenerationError';
  public readonly code: PdfErrorCode;
  public readonly requestId: string | undefined;

  constructor(code: PdfErrorCode, message: string, options: PdfGenerationErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.requestId = options.requestId;
  }
}

/** The user-facing message for a thrown value, whatever it turns out to be. */
export function pdfErrorMessage(error: unknown): string {
  if (error instanceof PdfGenerationError) return error.message;
  return 'The PDF could not be produced. Please try again.';
}
