/**
 * Which actions must leave an audit trail, and what may never be in one.
 *
 * See IMPLEMENTATION_PLAN.md §19.9.
 *
 * ---------------------------------------------------------------------------
 * WHY A LIST RATHER THAN A CONVENTION
 * ---------------------------------------------------------------------------
 * "Every state-changing action writes an audit entry" is a rule that holds
 * until someone adds the next handler. Declaring the set here turns it into
 * something a test can check: `security/audit.test.ts` runs every action in the
 * router's table and fails if a state-changing one wrote nothing — so the
 * omission is caught when the action is added, not during an incident.
 *
 * `audit/audit-log.ts` still does the writing. This module owns the POLICY.
 *
 * ---------------------------------------------------------------------------
 * WHAT AN ENTRY MAY CONTAIN
 * ---------------------------------------------------------------------------
 * Who, what, which thing, the outcome, and the request id. Never a password,
 * never a token, never a full payload, never base64 file content — an audit log
 * that has to be protected as carefully as the credentials it records is not an
 * audit log, it is a second copy of the secrets.
 */

/**
 * Actions that change state and must therefore be audited.
 *
 * Reads are deliberately absent: auditing `quotation.list` would bury the
 * entries that matter under one row per page view, and the sheet is the audit
 * trail people actually read.
 */
export const AUDITED_ACTIONS: readonly string[] = [
  'auth.login',
  'auth.logout',
  'admin.createUser',
  'admin.resetUserCredential',
  'admin.setUserActive',
  'admin.setUserRole',

  'quotation.reserveNumber',
  'quotation.save',
  'quotation.discardDraft',
  'quotation.updateStatus',
  'quotation.uploadToDrive',
  'quotation.recordTracking',

  'settings.update',

  'clients.create',
  'clients.update',
  'clients.deactivate',

  'items.create',
  'items.update',
  'items.deactivate',

  'terms.create',
  'terms.update',
  'terms.deactivate',
  'terms.reorder',
  'admin.importReferenceTerms',

  'persons.create',
  'persons.update',
  'persons.deactivate',
  'persons.uploadSignature',
];

/** Actions that only read. They must NOT write an audit entry. */
export const READ_ONLY_ACTIONS: readonly string[] = [
  'health',
  // Reads configuration state and probes Drive and Sheets. Changes nothing,
  // and reports names and booleans only — never a value (§19.7).
  'admin.diagnostics',
  'auth.me',
  // Reads the account list. Returns no password material — `ManagedUser` has
  // no field for it — so this changes nothing and discloses nothing an Admin
  // cannot already read in the sheet.
  'admin.listUsers',
  'quotation.get',
  'quotation.list',
  // Reads company defaults and the deployment codes printed on every
  // quotation. No secret and no resource id is in the response.
  'settings.get',
  'clients.list',
  'items.list',
  'terms.list',
  'persons.list',
  // Reads a signature image. Audited by its absence deliberately: it happens
  // once per quotation preview, and the entry would say nothing the save entry
  // does not already say.
  'persons.getSignature',
];

export function isAuditedAction(action: string): boolean {
  return AUDITED_ACTIONS.indexOf(action) !== -1;
}

/**
 * Patterns that must never appear in an audit target.
 *
 * Used by the verification suite rather than at write time: a runtime scan of
 * every entry would cost a regex per row for a check that a test can make
 * permanently. What matters is that a regression is caught, not that it is
 * caught in production.
 */
export const FORBIDDEN_IN_AUDIT: readonly RegExp[] = [
  // A password field, however it was spelled.
  /password/i,
  // A JWT: three base64url segments.
  /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  // A long base64 run — a document or an image payload.
  /[A-Za-z0-9+/]{200,}={0,2}/,
  // The Script Property names themselves.
  /SESSION_HMAC_SECRET|PASSWORD_PEPPER|BOOTSTRAP_ADMIN_PASSWORD/,
];

/** True when a value is safe to write into the audit sheet. */
export function isSafeAuditValue(value: string): boolean {
  return !FORBIDDEN_IN_AUDIT.some((pattern) => pattern.test(value));
}
