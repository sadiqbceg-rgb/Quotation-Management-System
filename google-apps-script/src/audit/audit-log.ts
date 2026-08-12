/**
 * Audit log.
 *
 * Every state-changing action writes exactly one entry. See
 * IMPLEMENTATION_PLAN.md §19.9.
 *
 * What must NEVER appear here: a password, a token, a full request payload, or
 * base64 file content. The log records who did what, to which target, with what
 * outcome — nothing more.
 */

import { appendRow, getOrCreateSheet } from '../sheets/sheet-access';

export const AUDIT_SHEET_NAME = 'AuditLog';

export const AUDIT_HEADERS = [
  'Timestamp',
  'Actor',
  'Action',
  'Target',
  'Outcome',
  'Request ID',
] as const;

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEntry {
  /** The acting user's email, or the attempted email for a failed sign-in. */
  actor: string;
  action: string;
  /** What was acted on: a quotation number, an email, a person id. Never a secret. */
  target?: string;
  outcome: AuditOutcome;
  requestId: string;
}

/**
 * Append an audit entry.
 *
 * Deliberately never throws: a logging failure must not fail the user's
 * operation. It reports to Cloud Logging and moves on.
 */
export function writeAudit(entry: AuditEntry): void {
  try {
    const sheet = getOrCreateSheet(AUDIT_SHEET_NAME, AUDIT_HEADERS);
    appendRow(sheet, [
      new Date().toISOString(),
      entry.actor,
      entry.action,
      entry.target ?? '',
      entry.outcome,
      entry.requestId,
    ]);
  } catch (thrown: unknown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    console.error(`[${entry.requestId}] Audit write failed: ${message}`);
  }
}
