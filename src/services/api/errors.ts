/**
 * The application error taxonomy.
 *
 * See IMPLEMENTATION_PLAN.md §23.1. Every backend failure maps to one of these
 * codes; the UI maps each code to a non-technical message and always shows the
 * requestId so a user can quote it to an administrator.
 */

export const ERROR_CODES = [
  // auth
  'AUTH_REQUIRED',
  'AUTH_INVALID',
  'AUTH_EXPIRED',
  'FORBIDDEN',
  'RATE_LIMITED',

  // validation
  'VALIDATION_FAILED',
  'TOTALS_MISMATCH',

  // quotation numbering
  'QUOTATION_NUMBER_IMMUTABLE',
  'DUPLICATE_QUOTATION_NUMBER',
  'NUMBERING_LOCKED',

  // Google Drive
  'DRIVE_AUTH_FAILED',
  'DRIVE_QUOTA_EXCEEDED',
  'DRIVE_FOLDER_CREATE_FAILED',
  'DRIVE_UPLOAD_FAILED',
  'DRIVE_PARTIAL',

  // Google Sheets
  'SHEETS_WRITE_FAILED',

  // infrastructure
  'CONFIG_MISSING',
  'NETWORK_ERROR',
  'TIMEOUT',
  'BAD_RESPONSE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export interface AppErrorOptions {
  fields?: Record<string, string>;
  requestId?: string;
  cause?: unknown;
}

export class AppError extends Error {
  public override readonly name = 'AppError';
  public readonly code: ErrorCode;
  public readonly fields: Record<string, string> | undefined;
  public readonly requestId: string | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.fields = options.fields;
    this.requestId = options.requestId;
  }
}

/**
 * User-facing messages. Deliberately generic: they must not disclose whether an
 * account exists, what a sheet is called, or anything about internal state (§19.9).
 */
const USER_MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: 'Please sign in to continue.',
  AUTH_INVALID: 'Invalid email or password.',
  AUTH_EXPIRED: 'Your session has expired. Please sign in again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',

  VALIDATION_FAILED: 'Please correct the highlighted fields and try again.',
  TOTALS_MISMATCH: 'The quotation totals could not be verified. Please reload and try again.',

  QUOTATION_NUMBER_IMMUTABLE:
    'This quotation already has a number. A quotation number cannot be changed.',
  DUPLICATE_QUOTATION_NUMBER:
    'That quotation number already exists. Please contact an administrator.',
  NUMBERING_LOCKED: 'The system is busy issuing a quotation number. Please try again.',

  DRIVE_AUTH_FAILED: 'The application could not access Google Drive.',
  DRIVE_QUOTA_EXCEEDED: 'Google Drive storage is full. Please contact an administrator.',
  DRIVE_FOLDER_CREATE_FAILED: 'The quotation folder could not be created in Google Drive.',
  DRIVE_UPLOAD_FAILED: 'Quotation was generated, but saving to Google Drive failed.',
  DRIVE_PARTIAL: 'Some quotation files did not upload. Please retry the upload.',

  SHEETS_WRITE_FAILED:
    'The documents were saved to Google Drive, but quotation tracking was not updated.',

  CONFIG_MISSING: 'The application is not fully configured. Please contact an administrator.',
  NETWORK_ERROR: 'Could not reach the server. Check your connection and try again.',
  TIMEOUT: 'The request took too long. Please try again.',
  BAD_RESPONSE: 'The server returned an unexpected response. Please try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

export function userMessageForCode(code: ErrorCode): string {
  return USER_MESSAGES[code];
}

/** The message to show for any thrown value, with the requestId appended when known. */
export function describeError(error: unknown): string {
  if (error instanceof AppError) {
    const base = userMessageForCode(error.code);
    return error.requestId === undefined ? base : `${base} (Reference: ${error.requestId})`;
  }
  return USER_MESSAGES.INTERNAL_ERROR;
}
