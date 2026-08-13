/**
 * Typed DOCX generation failures.
 *
 * Mirrors `pdf-errors.ts`. Kept separate rather than shared because the two
 * renderers fail in genuinely different ways — a DOCX has no letterhead to
 * embed and no font to subset — and a union of both codes would leave every
 * handler checking for cases that cannot arise.
 */

export const DOCX_ERROR_CODES = [
  'ASSET_MISSING',
  'SEAL_MISSING',
  'SIGNATURE_MISSING',
  'INVALID_MODEL',
  'QUOTATION_NUMBER_REQUIRED',
  'TOO_LARGE',
  'PACKAGING_FAILED',
  'OUTPUT_INVALID',
] as const;

export type DocxErrorCode = (typeof DOCX_ERROR_CODES)[number];

export interface DocxGenerationErrorOptions {
  cause?: unknown;
  requestId?: string;
}

export class DocxGenerationError extends Error {
  public override readonly name = 'DocxGenerationError';
  public readonly code: DocxErrorCode;
  public readonly requestId: string | undefined;

  constructor(code: DocxErrorCode, message: string, options: DocxGenerationErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.requestId = options.requestId;
  }
}

export function docxErrorMessage(error: unknown): string {
  if (error instanceof DocxGenerationError) return error.message;
  return 'The Word document could not be produced. Please try again.';
}
