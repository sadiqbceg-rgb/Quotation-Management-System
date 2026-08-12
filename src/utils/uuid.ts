/**
 * Identifier helpers.
 *
 * `crypto.randomUUID` is available in every browser this application targets
 * and in Node 20+, so no dependency is needed.
 */

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('A secure random UUID source is required but is not available.');
}

/** Correlates a client request with its backend audit-log entry. */
export function newRequestId(): string {
  return randomUuid();
}

/**
 * Mint the draft id for a new quotation.
 *
 * Created when the user clicks "New Quotation" and carried until the quotation
 * is finalized. It is the idempotency key for quotation-number reservation:
 * reserving twice with the same draft id returns the SAME number rather than
 * burning a new one. See IMPLEMENTATION_PLAN.md §7.5(b).
 *
 * Minting a draft id does not reserve anything (PRD §35).
 */
export function newDraftId(): string {
  return randomUuid();
}

/** A stable client-side id for a list row, so reordering does not remount inputs. */
export function newLineItemId(): string {
  return randomUuid();
}
