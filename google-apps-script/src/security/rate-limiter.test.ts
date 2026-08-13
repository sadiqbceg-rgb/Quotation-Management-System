/**
 * Throttling and the circuit breaker.
 *
 * What is being protected is the DEPLOYMENT's shared Apps Script quota, not the
 * data — so the interesting assertions are that a single session cannot spend
 * it, that every session together cannot either, and that a limiter which
 * cannot reach the cache refuses rather than waves everything through.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import {
  ACTION_LIMITS,
  GLOBAL_LIMIT_PER_MINUTE,
  WINDOW_SECONDS,
  checkRequestLimits,
  rateLimitError,
} from './rate-limiter';

let env: GasEnvironment;

const TOKEN = 'test-only.token.aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_TOKEN = 'test-only.token.bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

beforeEach(() => {
  vi.unstubAllGlobals();
  env = installGasFakes(vi.stubGlobal);
});

/** Call an action `times` times and return the last decision. */
function callTimes(action: string, token: string, times: number, now = 1_000) {
  let decision = checkRequestLimits(action, token, now);
  for (let index = 1; index < times; index += 1) {
    decision = checkRequestLimits(action, token, now);
  }
  return decision;
}

/* -------------------------------------------------------------------------- */

describe('per-action limits', () => {
  it('allows a session up to the limit', () => {
    const limit = ACTION_LIMITS['quotation.save'] ?? 0;

    expect(limit).toBe(20);
    expect(callTimes('quotation.save', TOKEN, limit).allowed).toBe(true);
  });

  it('refuses the call after the limit, with a retry hint', () => {
    const limit = ACTION_LIMITS['quotation.save'] ?? 0;
    const decision = callTimes('quotation.save', TOKEN, limit + 1);

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_SECONDS);
  });

  it('throttles the two upload paths harder than an ordinary save', () => {
    expect(ACTION_LIMITS['persons.uploadSignature']).toBe(10);
    expect(ACTION_LIMITS['quotation.uploadToDrive']).toBe(10);

    expect(callTimes('persons.uploadSignature', TOKEN, 11).allowed).toBe(false);
  });

  it('counts each session separately', () => {
    const limit = ACTION_LIMITS['quotation.save'] ?? 0;
    callTimes('quotation.save', TOKEN, limit + 1);

    // One user's loop must not lock out a colleague.
    expect(checkRequestLimits('quotation.save', OTHER_TOKEN, 1_000).allowed).toBe(true);
  });

  it('counts each action separately', () => {
    callTimes('persons.uploadSignature', TOKEN, 11);

    expect(checkRequestLimits('quotation.save', TOKEN, 1_000).allowed).toBe(true);
  });

  it('opens a new window once the old one lapses', () => {
    const limit = ACTION_LIMITS['quotation.save'] ?? 0;
    expect(callTimes('quotation.save', TOKEN, limit + 1).allowed).toBe(false);

    // A fixed window: the counter resets rather than sliding.
    expect(checkRequestLimits('quotation.save', TOKEN, 1_000 + WINDOW_SECONDS + 1).allowed).toBe(
      true,
    );
  });

  it('does not throttle a read that costs nothing', () => {
    expect(ACTION_LIMITS['quotation.list']).toBeUndefined();
    expect(callTimes('quotation.list', TOKEN, 50).allowed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('the circuit breaker', () => {
  it('counts every action, including the cheap reads', () => {
    // A client hammering `list` exhausts the daily quota just as effectively as
    // one hammering `save`, so the global window has to see it.
    let decision = checkRequestLimits('quotation.list', TOKEN, 1_000);
    for (let index = 1; index <= GLOBAL_LIMIT_PER_MINUTE; index += 1) {
      decision = checkRequestLimits('quotation.list', TOKEN, 1_000);
    }

    expect(decision.allowed).toBe(false);
  });

  it('applies across sessions, not per session', () => {
    for (let index = 0; index < GLOBAL_LIMIT_PER_MINUTE; index += 1) {
      checkRequestLimits('quotation.list', TOKEN, 1_000);
    }

    // A second session inherits the exhausted global budget.
    expect(checkRequestLimits('quotation.list', OTHER_TOKEN, 1_000).allowed).toBe(false);
  });

  it('counts an unauthenticated call too', () => {
    for (let index = 0; index < GLOBAL_LIMIT_PER_MINUTE + 1; index += 1) {
      checkRequestLimits('health', undefined, 1_000);
    }

    expect(checkRequestLimits('health', undefined, 1_000).allowed).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('failing closed', () => {
  it('refuses when the cache is unreachable', () => {
    vi.stubGlobal('CacheService', {
      getScriptCache: () => {
        throw new Error('Service unavailable');
      },
    });

    // A limiter that silently disables itself under load opens the gap exactly
    // when it is needed, and nothing reports it.
    expect(checkRequestLimits('quotation.save', TOKEN, 1_000).allowed).toBe(false);
  });

  it('refuses when the cache returns nonsense', () => {
    vi.stubGlobal('CacheService', {
      getScriptCache: () => ({
        get: (): string => 'not json',
        put: (): void => {
          throw new Error('Service unavailable');
        },
        remove: (): void => undefined,
      }),
    });

    expect(checkRequestLimits('quotation.save', TOKEN, 1_000).allowed).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('the refusal', () => {
  it('is RATE_LIMITED and tells the user how long to wait', () => {
    const error = rateLimitError({ allowed: false, retryAfterSeconds: 42 });

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toContain('42');
  });

  it('never names the action or the token', () => {
    const error = rateLimitError({ allowed: false, retryAfterSeconds: 5 });

    expect(error.message).not.toContain('quotation.save');
    expect(error.message).not.toContain(TOKEN);
  });

  it('writes no raw token into the cache namespace', () => {
    checkRequestLimits('quotation.save', TOKEN, 1_000);

    for (const key of env.cache.entries.keys()) {
      expect(key).not.toContain(TOKEN);
    }
  });
});
