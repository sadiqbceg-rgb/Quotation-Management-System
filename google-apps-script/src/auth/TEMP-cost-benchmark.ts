/**
 * ===========================================================================
 * TEMPORARY — PBKDF2 COST BENCHMARK. DELETE AFTER TUNING.
 * ===========================================================================
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `measurePasswordHashCost` takes an iteration count, but the Apps Script
 * editor's Run button can only invoke a ZERO-ARGUMENT function — so from the
 * editor it can only ever be measured at its default. This wrapper exists
 * solely to measure other counts, and should be deleted once
 * DEFAULT_PBKDF2_ITERATIONS has been chosen.
 *
 * ---------------------------------------------------------------------------
 * WHY A SWEEP WITH REPEATS, NOT ONE NUMBER
 * ---------------------------------------------------------------------------
 * The first DEV readings for 10,000 iterations were 5474, 6917 and 8812 ms —
 * each successive run SLOWER than the last. That is not warm-up, which gets
 * faster; it looks like throttling or a contended runner. A single measurement
 * of a single count on such a machine is not evidence of anything.
 *
 * So every count is measured several times, and all counts are measured in ONE
 * execution. Comparing figures taken seconds apart inside one run controls for
 * the drift that makes separate runs incomparable, and the repeats show how
 * noisy the machine is rather than hiding it behind an average.
 *
 * Read the SPREAD, not the best figure. Login performs one hash, so the number
 * a user actually waits for is closer to the worst case than the best.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 * It changes nothing. It does not write to any sheet, does not touch a user
 * record, does not read or write any Script Property, and does not alter
 * DEFAULT_PBKDF2_ITERATIONS. It measures, logs, and returns.
 *
 * It is NOT in the ACTIONS table, so it is unreachable over HTTP.
 */

import { measurePasswordHashCost } from './password';

/**
 * The counts to measure, cheapest first.
 *
 * 1,000 is MIN_PBKDF2_ITERATIONS — the floor `hashPassword` enforces, and the
 * lowest value that could ever be chosen. 10,000 is the current default, kept
 * in the sweep as the baseline the other figures are read against.
 */
const BENCHMARK_ITERATION_COUNTS = [1_000, 2_000, 4_000, 10_000];

/** Enough repeats to see variance, few enough to stay well inside the 6-minute limit. */
const BENCHMARK_REPEATS = 3;

/**
 * Measure several iteration counts and log every reading.
 *
 * Each measurement is logged by `measurePasswordHashCost` itself, so this adds
 * no second source of truth for the numbers — it only decides what to measure.
 */
export function runPasswordCostBenchmark(): void {
  console.info(
    `TEMPORARY benchmark: ${String(BENCHMARK_ITERATION_COUNTS.length)} counts ` +
      `x ${String(BENCHMARK_REPEATS)} runs each. Read the spread, not the best figure.`,
  );

  for (const iterations of BENCHMARK_ITERATION_COUNTS) {
    for (let attempt = 0; attempt < BENCHMARK_REPEATS; attempt += 1) {
      measurePasswordHashCost(iterations);
    }
  }

  console.info(
    'Benchmark complete. Pick the highest count whose SLOWEST reading keeps a ' +
      'login acceptable, then delete TEMP-cost-benchmark.ts.',
  );
}
