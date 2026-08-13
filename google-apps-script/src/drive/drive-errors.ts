/**
 * Turning a Drive exception into a code someone can act on.
 *
 * Apps Script reports every Drive failure as a plain `Error` with a prose
 * message. "An unexpected error occurred" tells a user nothing about whether
 * they should free up space, call an administrator, or simply press Retry — so
 * the message is classified once, here, and every Drive call site uses it.
 *
 * The classification is deliberately conservative: anything unrecognised keeps
 * the caller's own fallback code rather than being guessed at.
 */

import { ApiError } from '../errors';

/** Codes this module may produce. A subset of the global taxonomy (§23.1). */
export type DriveErrorCode =
  | 'DRIVE_AUTH_FAILED'
  | 'DRIVE_QUOTA_EXCEEDED'
  | 'DRIVE_FOLDER_CREATE_FAILED'
  | 'DRIVE_UPLOAD_FAILED';

const USER_MESSAGES: Record<DriveErrorCode, string> = {
  DRIVE_AUTH_FAILED: 'The application could not access Google Drive.',
  DRIVE_QUOTA_EXCEEDED: 'Google Drive is out of space. Free some space and try again.',
  DRIVE_FOLDER_CREATE_FAILED: 'The quotation folder could not be created in Google Drive.',
  DRIVE_UPLOAD_FAILED: 'Quotation was generated, but saving to Google Drive failed.',
};

function messageOf(thrown: unknown): string {
  return (thrown instanceof Error ? thrown.message : String(thrown)).toLowerCase();
}

/** True for the one thing that must never be swallowed: a misconfiguration. */
export function isConfigMissing(thrown: unknown): boolean {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  return raw.indexOf('CONFIG_MISSING:') === 0;
}

/**
 * Classify a thrown Drive error.
 *
 * Returns `null` when nothing in the message identifies the cause, so the
 * caller applies the code that fits where it happened — a failure inside folder
 * creation is a folder failure even when Drive will not say why.
 */
export function classifyDriveError(thrown: unknown): DriveErrorCode | null {
  const message = messageOf(thrown);

  if (message.indexOf('quota') !== -1 || message.indexOf('storage') !== -1) {
    return 'DRIVE_QUOTA_EXCEEDED';
  }
  if (
    message.indexOf('permission') !== -1 ||
    message.indexOf('access denied') !== -1 ||
    message.indexOf('unauthorized') !== -1 ||
    message.indexOf('not have access') !== -1
  ) {
    return 'DRIVE_AUTH_FAILED';
  }
  return null;
}

/**
 * The typed error for a failed Drive call.
 *
 * Rethrows a configuration failure untouched: `CONFIG_MISSING` is handled by
 * the router and naming a missing Script Property is the whole point of it.
 * The original message is never forwarded to the client — it can name folder
 * ids and account addresses (§19.9) — but it is left as the `cause` so it
 * reaches Cloud Logging.
 */
export function driveError(thrown: unknown, fallback: DriveErrorCode): ApiError {
  if (isConfigMissing(thrown)) throw thrown;

  const code = classifyDriveError(thrown) ?? fallback;
  return new ApiError(code, USER_MESSAGES[code]);
}
