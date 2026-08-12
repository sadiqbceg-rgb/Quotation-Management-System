import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes } from '../__fixtures__/gas-fakes';
import {
  MAX_FAILURES,
  WINDOW_SECONDS,
  checkLock,
  clearFailures,
  recordFailure,
} from './rate-limit';

const EMAIL = 'staff@speedxksa.com';
const NOW = 1_800_000_000;

beforeEach(() => {
  installGasFakes(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lockout', () => {
  it('allows attempts below the threshold', () => {
    for (let attempt = 1; attempt < MAX_FAILURES; attempt++) {
      expect(recordFailure(EMAIL, NOW).locked).toBe(false);
    }
    expect(checkLock(EMAIL, NOW).locked).toBe(false);
  });

  it('locks on the fifth failure within the window', () => {
    for (let attempt = 1; attempt < MAX_FAILURES; attempt++) {
      recordFailure(EMAIL, NOW);
    }
    expect(recordFailure(EMAIL, NOW).locked).toBe(true);
    expect(checkLock(EMAIL, NOW).locked).toBe(true);
  });

  it('reports how long the lock has left', () => {
    for (let attempt = 0; attempt < MAX_FAILURES; attempt++) {
      recordFailure(EMAIL, NOW);
    }
    const status = checkLock(EMAIL, NOW + 60);
    expect(status.locked).toBe(true);
    expect(status.retryAfterSeconds).toBe(WINDOW_SECONDS - 60);
  });

  it('releases the lock once the window has passed', () => {
    for (let attempt = 0; attempt < MAX_FAILURES; attempt++) {
      recordFailure(EMAIL, NOW);
    }
    expect(checkLock(EMAIL, NOW + WINDOW_SECONDS).locked).toBe(false);
  });

  it('starts a fresh window when failures are spread out', () => {
    for (let attempt = 0; attempt < MAX_FAILURES - 1; attempt++) {
      recordFailure(EMAIL, NOW);
    }
    // The next failure lands after the first window elapsed, so the count resets.
    expect(recordFailure(EMAIL, NOW + WINDOW_SECONDS + 1).locked).toBe(false);
  });

  it('clears the counter after a successful sign-in', () => {
    for (let attempt = 0; attempt < MAX_FAILURES; attempt++) {
      recordFailure(EMAIL, NOW);
    }
    clearFailures(EMAIL);
    expect(checkLock(EMAIL, NOW).locked).toBe(false);
  });
});

describe('isolation', () => {
  it('locks one account without affecting another', () => {
    for (let attempt = 0; attempt < MAX_FAILURES; attempt++) {
      recordFailure(EMAIL, NOW);
    }
    expect(checkLock(EMAIL, NOW).locked).toBe(true);
    expect(checkLock('someone.else@speedxksa.com', NOW).locked).toBe(false);
  });

  it('treats email casing and whitespace as the same account', () => {
    for (let attempt = 0; attempt < MAX_FAILURES; attempt++) {
      recordFailure(EMAIL, NOW);
    }
    expect(checkLock('  STAFF@SpeedXKSA.com ', NOW).locked).toBe(true);
  });

  it('does not put the raw email in the cache key', () => {
    recordFailure(EMAIL, NOW);
    const env = installGasFakes(vi.stubGlobal);
    // Re-installing gives a clean cache; assert on the previous run's key shape.
    recordFailure(EMAIL, NOW);
    for (const key of env.cache.entries.keys()) {
      expect(key).not.toContain(EMAIL);
      expect(key.startsWith('lf_')).toBe(true);
    }
  });
});
