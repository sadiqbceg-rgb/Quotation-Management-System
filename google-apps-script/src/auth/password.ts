/**
 * Password hashing.
 *
 * See IMPLEMENTATION_PLAN.md §18.2.
 *
 *   stored = HMAC-SHA256( PBKDF2-HMAC-SHA256(password, salt, iterations), pepper )
 *
 * Three separate defences:
 *
 *   salt      — per user, 32 random bytes, stored beside the hash. Defeats
 *               rainbow tables and makes each account an independent target.
 *   iterations— slows a brute-force attempt. Stored PER RECORD so the cost can
 *               be raised later without invalidating existing hashes: an old
 *               record verifies at its own count and is upgraded on next login.
 *   pepper    — a server-side secret from Script Properties, NOT in the
 *               spreadsheet. An attacker who exfiltrates the Users sheet still
 *               cannot mount an offline attack without also compromising the
 *               Apps Script project. This is the strongest of the three here.
 *
 * ---------------------------------------------------------------------------
 * ON THE ITERATION COUNT
 * ---------------------------------------------------------------------------
 * `Utilities.computeHmacSha256Signature` is a host bridge call, so it is orders
 * of magnitude slower than a native PBKDF2. The count that fits inside a
 * tolerable login is therefore far below the ~600k OWASP recommends for native
 * implementations, and DEFAULT_PBKDF2_ITERATIONS below is a starting point, not
 * a measured value.
 *
 * Run `measurePasswordHashCost()` in the Apps Script editor against the real
 * deployment, then set the highest count that keeps a login under ~1.5 s and
 * record it here and in google-apps-script/README.md. Because the count is
 * stored per record, raising it later is safe.
 */

import { bytesToHex, hexToBytes, randomBytes, textToBytes, timingSafeEqual } from './bytes';

/**
 * Starting point only — measure with `measurePasswordHashCost()` and tune.
 * See the note above before changing this.
 */
export const DEFAULT_PBKDF2_ITERATIONS = 10_000;

export const MIN_PBKDF2_ITERATIONS = 1_000;
export const SALT_BYTES = 32;

export interface PasswordRecord {
  /**
   * Lowercase hex of the final digest.
   *
   * Hex, not base64: every sheet write goes through `escapeForSheet`, which
   * prefixes an apostrophe to a value starting with `=`, `+`, `-` or `@`. A
   * base64 hash can start with `+` or `/`, so it would come back altered and
   * fail to match — intermittently, depending on the random salt. See
   * bytesToHex in bytes.ts.
   */
  hash: string;
  /** Lowercase hex of the per-user salt. */
  salt: string;
  iterations: number;
}

/** A fresh hex salt. */
export function generateSalt(): string {
  return bytesToHex(randomBytes(SALT_BYTES));
}

/**
 * PBKDF2-HMAC-SHA256 with dkLen = 32, which is exactly one output block, so no
 * block-concatenation loop is needed.
 */
function pbkdf2Sha256(passwordBytes: number[], saltBytes: number[], iterations: number): number[] {
  // U1 = HMAC(password, salt || INT_32_BE(1))
  const firstInput = saltBytes.concat([0, 0, 0, 1]);
  let u = Utilities.computeHmacSha256Signature(firstInput, passwordBytes);

  const derived = u.slice();

  for (let round = 1; round < iterations; round++) {
    u = Utilities.computeHmacSha256Signature(u, passwordBytes);
    for (let index = 0; index < derived.length; index++) {
      derived[index] = (derived[index] ?? 0) ^ (u[index] ?? 0);
    }
  }

  return derived;
}

/**
 * Derive the stored digest.
 *
 * The pepper is applied as a final HMAC rather than being mixed into the
 * expensive loop, so it stays a clean, separable secret.
 */
export function hashPassword(
  plainPassword: string,
  saltHex: string,
  iterations: number,
  pepper: string,
): string {
  if (!Number.isInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS) {
    throw new Error(`Refusing to hash with ${String(iterations)} iterations.`);
  }

  const derived = pbkdf2Sha256(textToBytes(plainPassword), hexToBytes(saltHex), iterations);

  return bytesToHex(Utilities.computeHmacSha256Signature(derived, textToBytes(pepper)));
}

/** Create the stored record for a new or changed password. */
export function createPasswordRecord(
  plainPassword: string,
  pepper: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): PasswordRecord {
  const salt = generateSalt();
  return { hash: hashPassword(plainPassword, salt, iterations, pepper), salt, iterations };
}

/** Verify a password in constant time with respect to the digest contents. */
export function verifyPassword(
  plainPassword: string,
  record: PasswordRecord,
  pepper: string,
): boolean {
  const candidate = hashPassword(plainPassword, record.salt, record.iterations, pepper);
  return timingSafeEqual(candidate, record.hash);
}

/**
 * A fixed-cost hash performed when no user matches the submitted email.
 *
 * Without it, "unknown account" would return measurably faster than "wrong
 * password", handing an attacker a free account-enumeration oracle (§19.2).
 */
export function performDummyHash(
  pepper: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): void {
  const dummySalt = bytesToHex(new Array<number>(SALT_BYTES).fill(0));
  hashPassword('timing-parity-placeholder', dummySalt, iterations, pepper);
}

/**
 * Operator utility. Run from the Apps Script editor to measure real hashing
 * cost on this deployment, then tune DEFAULT_PBKDF2_ITERATIONS.
 *
 * Not reachable through the web app.
 *
 * The result is LOGGED as well as returned: the editor's Run button discards a
 * return value, so an operator who only reads the execution log would otherwise
 * see the function start and finish and never learn the number it exists to
 * produce. The return value is unchanged for any programmatic caller.
 */
export function measurePasswordHashCost(iterations: number = DEFAULT_PBKDF2_ITERATIONS): string {
  const salt = generateSalt();
  const started = Date.now();
  hashPassword('measurement-only', salt, iterations, 'measurement-pepper');
  const elapsed = Date.now() - started;

  const measurement = `${String(iterations)} iterations took ${String(elapsed)} ms`;
  console.info(measurement);
  return measurement;
}
