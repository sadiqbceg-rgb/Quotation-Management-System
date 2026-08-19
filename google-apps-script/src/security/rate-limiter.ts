/**
 * Per-action throttling and the global circuit breaker.
 *
 * See IMPLEMENTATION_PLAN.md §19.8.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS PROTECTING
 * ---------------------------------------------------------------------------
 * Not the data — that is the token's job, and the login throttle in
 * `auth/rate-limit.ts` covers credential stuffing. This protects the DEPLOYMENT.
 *
 * Apps Script gives the whole company one shared budget: six minutes per
 * execution and ninety minutes (consumer) or six hours (Workspace) of total
 * runtime per DAY. A signed-in user with a loop that saves a quotation in a
 * retry loop can exhaust it before lunch, and every other user then gets errors
 * for the rest of the day. That is a denial of service that needs no attacker
 * and no vulnerability — just a bug in a client.
 *
 * So there are two limits:
 *
 *   - **Per token, per action.** A single session cannot spend the budget.
 *   - **Global.** Every session together cannot either.
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED
 * ---------------------------------------------------------------------------
 * If `CacheService` is unreachable the request is REFUSED, matching the login
 * throttle. A limiter that quietly disables itself under load is worse than no
 * limiter, because the gap opens exactly when it is needed and nothing reports
 * it.
 *
 * The cost of that choice is bounded and visible: the user sees `RATE_LIMITED`
 * and can retry, rather than the company silently losing its quota.
 */

import { ApiError } from '../errors';
import { textToBytes } from '../auth/bytes';

/** A fixed window. Simpler than a sliding one, and enough at this scale. */
export const WINDOW_SECONDS = 60;

/**
 * Calls per minute, per action.
 *
 * Only the expensive actions are listed; everything else is a sheet read.
 * `quotation.save` is §19.8's 20/minute. The two upload paths are lower because
 * each carries megabytes and does Drive work.
 */
export const ACTION_LIMITS: Record<string, number> = {
  'quotation.save': 20,
  'quotation.discardDraft': 10,
  'quotation.uploadToDrive': 10,
  'persons.uploadSignature': 10,
  'quotation.recordTracking': 20,
  /*
   * User administration. Each PBKDF2 hash costs roughly a second of host bridge
   * calls, so credential resets are capped tightest; the other two take the
   * script lock and are capped low so a loop cannot hold it against everyone
   * else. Nobody administering a sub-ten-person company reaches these.
   */
  'admin.createUser': 10,
  'admin.resetUserCredential': 10,
  'admin.setUserActive': 20,
  'admin.setUserRole': 20,
  /*
   * Customer library. Writes are cheap — one append or a few cell writes — but
   * `nameExists` reads the whole sheet, so a loop is worth bounding.
   */
  'clients.create': 30,
  'clients.update': 30,
  'clients.deactivate': 20,
};

/**
 * Calls per minute across every session.
 *
 * Sized so a handful of people working normally never see it: a busy user makes
 * a few requests a minute, and the whole company is under ten people (PRD §6).
 * A client stuck in a loop hits it in seconds.
 */
export const GLOBAL_LIMIT_PER_MINUTE = 300;

const GLOBAL_KEY = 'rl_global';

function cache(): GoogleAppsScript.Cache.Cache {
  return CacheService.getScriptCache();
}

/**
 * Cache keys are derived from a digest, never from the raw token.
 *
 * A session token in a shared cache namespace is a credential written somewhere
 * it does not need to be — and cache keys have a length limit a JWT exceeds.
 */
function tokenKey(action: string, token: string): string {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    textToBytes(`${action}|${token}`),
  );
  return `rl_${Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '').substring(0, 40)}`;
}

interface WindowState {
  count: number;
  /** Epoch seconds when the window opened. */
  startedAt: number;
}

function readWindow(key: string): WindowState | null {
  const raw = cache().get(key);
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    const count = candidate['count'];
    const startedAt = candidate['startedAt'];

    if (typeof count !== 'number' || typeof startedAt !== 'number') return null;
    return { count, startedAt };
  } catch {
    return null;
  }
}

export interface LimitDecision {
  allowed: boolean;
  /** Seconds until the window resets. Zero when allowed. */
  retryAfterSeconds: number;
}

const ALLOWED: LimitDecision = { allowed: true, retryAfterSeconds: 0 };

/** Count one call against a window, and report whether it is over the limit. */
function consume(key: string, limit: number, now: number): LimitDecision {
  const existing = readWindow(key);
  const withinWindow = existing !== null && now - existing.startedAt < WINDOW_SECONDS;

  const next: WindowState = withinWindow
    ? { count: existing.count + 1, startedAt: existing.startedAt }
    : { count: 1, startedAt: now };

  const remaining = Math.max(1, WINDOW_SECONDS - (now - next.startedAt));
  cache().put(key, JSON.stringify(next), remaining);

  return next.count > limit ? { allowed: false, retryAfterSeconds: remaining } : ALLOWED;
}

/**
 * Apply both limits to one request.
 *
 * The global counter is consumed for EVERY action, including the cheap reads:
 * a runaway client hammering `quotation.list` exhausts the daily quota just as
 * effectively as one hammering `save`.
 *
 * Returns rather than throws, so the caller decides what to audit.
 */
export function checkRequestLimits(
  action: string,
  token: string | undefined,
  now: number,
): LimitDecision {
  try {
    const global = consume(GLOBAL_KEY, GLOBAL_LIMIT_PER_MINUTE, now);
    if (!global.allowed) return global;

    const limit = ACTION_LIMITS[action];
    if (limit === undefined) return ALLOWED;

    /*
     * An unauthenticated caller cannot reach a throttled action — every one of
     * them requires a session — so a missing token here means the router will
     * reject the request a moment later anyway. Counting it globally (above) is
     * the part that matters.
     */
    if (token === undefined || token.length === 0) return ALLOWED;

    return consume(tokenKey(action, token), limit, now);
  } catch {
    // Fail closed. See the header comment.
    console.error('Rate limiter could not reach CacheService; refusing the request.');
    return { allowed: false, retryAfterSeconds: WINDOW_SECONDS };
  }
}

/** The typed refusal, with a retry hint the client can act on. */
export function rateLimitError(decision: LimitDecision): ApiError {
  return new ApiError(
    'RATE_LIMITED',
    `Too many requests. Please wait ${String(decision.retryAfterSeconds)} seconds and try again.`,
  );
}

/** Test and maintenance helper: forget every window. */
export function TEST_ONLY_resetGlobalWindow(): void {
  cache().remove(GLOBAL_KEY);
}
