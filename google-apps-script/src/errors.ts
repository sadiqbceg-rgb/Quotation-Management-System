/**
 * The backend error taxonomy and handler context.
 *
 * Kept separate from main.ts so handler modules can throw typed errors without
 * importing the router, which would be circular.
 *
 * These codes mirror `src/services/api/errors.ts` on the frontend, which maps
 * each to a generic user-facing message. See IMPLEMENTATION_PLAN.md §23.1.
 */

import type { Role } from './auth/token';

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'TOTALS_MISMATCH'
  | 'QUOTATION_NUMBER_IMMUTABLE'
  | 'DUPLICATE_QUOTATION_NUMBER'
  | 'NUMBERING_LOCKED'
  | 'DRIVE_AUTH_FAILED'
  | 'DRIVE_QUOTA_EXCEEDED'
  | 'DRIVE_FOLDER_CREATE_FAILED'
  | 'DRIVE_UPLOAD_FAILED'
  | 'DRIVE_PARTIAL'
  | 'SHEETS_WRITE_FAILED'
  | 'CONFIG_MISSING'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly fields: Record<string, string> | undefined;
  /**
   * What actually went wrong, for the server log only.
   *
   * NEVER serialised: `failure()` in main.ts builds the client body from `code`,
   * `message` and `fields`, and this is not among them. It exists because the
   * alternative was losing the reason entirely — a Drive refusal was classified
   * into a generic code and the original text discarded, so an operator had
   * nothing to read and the same failure stayed undiagnosable every time.
   *
   * A plain string rather than the thrown value: whatever Drive threw may hold
   * a folder id or an account address (§19.9), and a caller that logs this must
   * be handed prose, not an object to expand.
   */
  public readonly detail: string | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    fields?: Record<string, string>,
    detail?: string,
  ) {
    super(message);
    this.code = code;
    this.fields = fields;
    this.detail = detail;
  }
}

/** The authenticated caller, resolved from the session token by the router. */
export interface Caller {
  email: string;
  role: Role;
  /** Token id, needed so logout can revoke exactly this token. */
  jti: string;
  /** Token expiry, epoch seconds. */
  exp: number;
}

export interface HandlerContext {
  requestId: string;
  /** Null only for actions declared `public`. */
  caller: Caller | null;
}
