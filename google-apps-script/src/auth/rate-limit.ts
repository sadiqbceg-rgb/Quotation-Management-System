/**
 * Login throttling.
 *
 * See IMPLEMENTATION_PLAN.md §19.8: five failures for one email within fifteen
 * minutes locks that email for fifteen minutes.
 *
 * Backed by CacheService, whose entries expire on their own — exactly the
 * semantics a sliding lockout window wants, with no cleanup to get wrong.
 *
 * Fails CLOSED. If the cache is unreachable the attempt is refused rather than
 * allowed: a security control that silently disables itself under load is worse
 * than no control, because nothing surfaces the gap.
 */

import { textToBytes } from './bytes';

export const MAX_FAILURES = 5;
export const WINDOW_SECONDS = 15 * 60;

interface FailureState {
  count: number;
  /** Epoch seconds of the first failure in the current window. */
  firstAt: number;
}

/**
 * Cache keys are derived, not raw emails: cache keys have a length limit and
 * there is no reason to write user identifiers into a shared cache namespace.
 */
function cacheKey(email: string): string {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    textToBytes(email.trim().toLowerCase()),
  );
  return `lf_${Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '').substring(0, 40)}`;
}

function cache(): GoogleAppsScript.Cache.Cache {
  return CacheService.getScriptCache();
}

function readState(key: string): FailureState | null {
  const raw = cache().get(key);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    const count = candidate['count'];
    const firstAt = candidate['firstAt'];
    if (typeof count !== 'number' || typeof firstAt !== 'number') return null;
    return { count, firstAt };
  } catch {
    return null;
  }
}

export interface LockStatus {
  locked: boolean;
  /** Seconds until the lock lifts. Zero when not locked. */
  retryAfterSeconds: number;
}

export function checkLock(email: string, now: number): LockStatus {
  const state = readState(cacheKey(email));
  if (state === null || state.count < MAX_FAILURES) {
    return { locked: false, retryAfterSeconds: 0 };
  }

  const elapsed = now - state.firstAt;
  if (elapsed >= WINDOW_SECONDS) {
    return { locked: false, retryAfterSeconds: 0 };
  }

  return { locked: true, retryAfterSeconds: WINDOW_SECONDS - elapsed };
}

/** Record a failed attempt and report whether that failure tripped the lock. */
export function recordFailure(email: string, now: number): LockStatus {
  const key = cacheKey(email);
  const existing = readState(key);

  const withinWindow = existing !== null && now - existing.firstAt < WINDOW_SECONDS;
  const next: FailureState = withinWindow
    ? { count: existing.count + 1, firstAt: existing.firstAt }
    : { count: 1, firstAt: now };

  // Keep the entry alive for a full window from its first failure.
  const remaining = Math.max(1, WINDOW_SECONDS - (now - next.firstAt));
  cache().put(key, JSON.stringify(next), remaining);

  return next.count >= MAX_FAILURES
    ? { locked: true, retryAfterSeconds: remaining }
    : { locked: false, retryAfterSeconds: 0 };
}

/** Clear the counter after a successful sign-in. */
export function clearFailures(email: string): void {
  cache().remove(cacheKey(email));
}
