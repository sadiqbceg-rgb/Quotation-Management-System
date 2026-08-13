/**
 * TEST ONLY — a cooperative scheduler that makes concurrency tests genuine.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * JavaScript is single-threaded, so a test cannot literally run two Apps Script
 * executions at once. A `for` loop calling `reserveQuotationNumber()` N times
 * proves nothing about mutual exclusion: each call has already finished before
 * the next begins, so a version with the lock deleted passes it just as well.
 *
 * What CAN be reproduced faithfully is the shape of the race. A real Apps
 * Script deployment runs concurrent executions against one shared spreadsheet,
 * and the dangerous window is between reading the counter and writing it back.
 * So this scheduler SUSPENDS a request inside that window — at the moment it
 * reads the counter — and starts every other pending request from inside it,
 * on top of the suspended one's own stack.
 *
 * That is real re-entrancy, not simulated. The suspended request is genuinely
 * mid-critical-section while the others run. If the lock is honoured, each
 * intruder is refused at `tryLock` and retries later; if it is not, they read
 * the same stale counter value the suspended request read, and the duplicate
 * that a real deployment would produce shows up here too.
 *
 * `interleave` is deliberately agnostic about what it is running — it takes a
 * function and a seam to fire at, and reports what happened.
 */

/** What one attempt at one operation did. */
export interface AttemptOutcome<T> {
  id: string;
  /** The value returned, when the attempt succeeded. */
  value: T | null;
  /** The value thrown, when it did not. */
  error: unknown;
  /** How deep inside other operations' critical sections this attempt began. */
  depth: number;
}

export interface InterleaveReport<T> {
  /** The final outcome per id, after retries. */
  settled: Map<string, AttemptOutcome<T>>;
  /** Every attempt made, in the order it was made, retries included. */
  attempts: Array<AttemptOutcome<T>>;
  /** Attempts that began inside another operation's critical section. */
  reentrant: Array<AttemptOutcome<T>>;
}

export interface InterleaveOptions<T> {
  /** The operations to run, identified so a failure names the right one. */
  ids: readonly string[];
  /** The operation. Returning a value settles the id; throwing leaves it pending. */
  run: (id: string) => T;
  /**
   * Install a callback at the seam an operation should be suspended at, and
   * remove it when passed null. For the numbering suite this is the fake
   * spreadsheet's read hook, fired as the counter is read.
   */
  arm: (atSeam: ((label: string) => void) | null) => void;
  /**
   * Only suspend at seams with this label — the `Counters` sheet, and not the
   * half-dozen other reads a reservation makes.
   */
  seam: string;
  /**
   * How many rounds of retries to allow. A refused attempt is retried exactly
   * as a client backing off would; this bounds the loop so a genuinely stuck
   * operation fails the test instead of hanging it.
   */
  maxRounds?: number;
  /** Guards against unbounded recursion if a seam fires more than expected. */
  maxDepth?: number;
}

/**
 * Run every id, interleaving each one into the others' critical sections.
 *
 * Every id is attempted at least once. Ids whose attempt threw are retried in
 * later rounds, so a design where contention is resolved by retrying — which is
 * what `NUMBERING_LOCKED` asks the client to do — settles, while a design that
 * cannot make progress runs out of rounds and fails loudly.
 */
export function interleave<T>(options: InterleaveOptions<T>): InterleaveReport<T> {
  const maxRounds = options.maxRounds ?? options.ids.length + 2;
  const maxDepth = options.maxDepth ?? 12;

  const settled = new Map<string, AttemptOutcome<T>>();
  const attempts: Array<AttemptOutcome<T>> = [];
  const reentrant: Array<AttemptOutcome<T>> = [];

  /** Ids currently on the stack — an operation must never re-enter itself. */
  const running = new Set<string>();
  let depth = 0;

  function pending(): string[] {
    return options.ids.filter((id) => !settled.has(id) && !running.has(id));
  }

  function attempt(id: string): void {
    running.add(id);
    depth += 1;

    const outcome: AttemptOutcome<T> = { id, value: null, error: null, depth: depth - 1 };

    try {
      outcome.value = options.run(id);
      settled.set(id, outcome);
    } catch (error) {
      outcome.error = error;
    } finally {
      depth -= 1;
      running.delete(id);
      attempts.push(outcome);
      if (outcome.depth > 0) reentrant.push(outcome);
    }
  }

  options.arm((label) => {
    if (label !== options.seam) return;
    if (depth >= maxDepth) return;

    // Everything not already on the stack barges in, here, while the operation
    // that triggered this seam is suspended mid-critical-section.
    for (const id of pending()) attempt(id);
  });

  try {
    for (let round = 0; round < maxRounds; round++) {
      const remaining = pending();
      if (remaining.length === 0) break;

      const next = remaining[0];
      if (next === undefined) break;
      attempt(next);
    }
  } finally {
    options.arm(null);
  }

  const unsettled = options.ids.filter((id) => !settled.has(id));
  if (unsettled.length > 0) {
    throw new Error(
      `interleave: ${String(unsettled.length)} of ${String(options.ids.length)} operations never ` +
        `settled within ${String(maxRounds)} rounds: ${unsettled.join(', ')}. ` +
        `Last error: ${describeLastError(attempts)}`,
    );
  }

  return { settled, attempts, reentrant };
}

function describeLastError<T>(attempts: ReadonlyArray<AttemptOutcome<T>>): string {
  for (let index = attempts.length - 1; index >= 0; index--) {
    const error = attempts[index]?.error;
    if (error == null) continue;

    // Whatever was thrown, rendered readably: a bare `String(unknown)` on a
    // plain object gives "[object Object]", which is the least useful thing a
    // failure message can say.
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    if (typeof error === 'object') return JSON.stringify(error);
    return typeof error === 'string' ? error : JSON.stringify(error);
  }
  return '(none)';
}
