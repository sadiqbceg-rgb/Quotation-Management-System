/**
 * TEST ONLY — a deterministic clock and a deterministic id source.
 *
 * A suite that depends on `Date.now()` or on a random UUID is a suite that
 * fails once a year, or once in a thousand runs, for reasons nobody can
 * reproduce. Both are pinned here so every test is reproducible.
 *
 * `withFrozenClock` is deliberately synchronous-in, synchronous-out: the fake
 * timers it installs are torn down in a `finally`, so a throwing assertion
 * cannot leak a frozen clock into the next test in the file.
 */

import { vi } from 'vitest';

/**
 * Pin the system clock for the duration of `body`.
 *
 * Used to prove that the quotation YEAR comes from the quotation date rather
 * than from the machine: freeze the clock in one year, hand the reserver a date
 * in another, and assert on the number that comes back (§7.6).
 */
export function withFrozenClock<T>(isoInstant: string, body: () => T): T {
  const at = new Date(isoInstant);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`withFrozenClock("${isoInstant}"): not a valid instant.`);
  }

  vi.useFakeTimers();
  vi.setSystemTime(at);
  try {
    return body();
  } finally {
    vi.useRealTimers();
  }
}

/** The same, for an async body. */
export async function withFrozenClockAsync<T>(
  isoInstant: string,
  body: () => Promise<T>,
): Promise<T> {
  const at = new Date(isoInstant);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`withFrozenClockAsync("${isoInstant}"): not a valid instant.`);
  }

  vi.useFakeTimers();
  vi.setSystemTime(at);
  try {
    return await body();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * A counter-backed id source.
 *
 * Returns `TEST_ONLY_<prefix>-1`, `…-2`, … — obviously synthetic, ordered, and
 * identical on every run, so a failure message names the same draft every time.
 */
export function sequentialIds(prefix: string): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `TEST_ONLY_${prefix}-${String(next)}`;
  };
}
