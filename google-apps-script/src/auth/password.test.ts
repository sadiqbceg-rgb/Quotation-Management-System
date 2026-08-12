import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { escapeForSheet, needsFormulaEscaping } from '@shared/validation-rules';
import { installGasFakes } from '../__fixtures__/gas-fakes';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  createPasswordRecord,
  generateSalt,
  hashPassword,
  performDummyHash,
  verifyPassword,
} from './password';

const PEPPER = 'test-only-pepper';
// Kept low so the suite stays fast; the algorithm is identical at any count.
const ITERATIONS = 1_000;

beforeEach(() => {
  installGasFakes(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hashing', () => {
  it('round-trips a correct password', () => {
    const record = createPasswordRecord('correct horse battery staple', PEPPER, ITERATIONS);
    expect(verifyPassword('correct horse battery staple', record, PEPPER)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const record = createPasswordRecord('correct horse battery staple', PEPPER, ITERATIONS);
    expect(verifyPassword('Correct horse battery staple', record, PEPPER)).toBe(false);
    expect(verifyPassword('', record, PEPPER)).toBe(false);
  });

  it('produces different hashes for the same password under different salts', () => {
    const first = createPasswordRecord('same-password', PEPPER, ITERATIONS);
    const second = createPasswordRecord('same-password', PEPPER, ITERATIONS);

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('is deterministic for a fixed salt and iteration count', () => {
    const salt = generateSalt();
    expect(hashPassword('pw', salt, ITERATIONS, PEPPER)).toBe(
      hashPassword('pw', salt, ITERATIONS, PEPPER),
    );
  });

  it('honours the iteration count', () => {
    const salt = generateSalt();
    expect(hashPassword('pw', salt, 1_000, PEPPER)).not.toBe(
      hashPassword('pw', salt, 2_000, PEPPER),
    );
  });

  it('refuses an iteration count below the floor', () => {
    expect(() => hashPassword('pw', generateSalt(), 10, PEPPER)).toThrow();
  });
});

describe('pepper', () => {
  it('makes a stolen spreadsheet useless without the server-side secret', () => {
    // The whole point of the pepper: the salt and hash are in the sheet, but a
    // verification cannot succeed without the Script Property too (§18.2).
    const record = createPasswordRecord('pw', PEPPER, ITERATIONS);
    expect(verifyPassword('pw', record, 'a-different-pepper')).toBe(false);
    expect(verifyPassword('pw', record, '')).toBe(false);
  });
});

describe('salt', () => {
  it('is 32 bytes and unique per call', () => {
    const salts = new Set(Array.from({ length: 20 }, () => generateSalt()));
    expect(salts.size).toBe(20);
    // 32 raw bytes → 64 hex characters.
    expect([...salts][0]).toHaveLength(64);
  });
});

describe('sheet-safe encoding', () => {
  /*
   * Regression test.
   *
   * Credential material was originally base64, which can begin with `+` or `/`.
   * Every sheet write passes through `escapeForSheet`, which prefixes an
   * apostrophe to a value starting with `=`, `+`, `-` or `@` to stop formula
   * injection — so a hash could be stored altered and then fail to verify.
   * The failure was intermittent, appearing only when the random salt happened
   * to produce such a value. Hex cannot collide with the escaper.
   */
  it('never produces a value that the sheet escaper would alter', () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const record = createPasswordRecord('pw', PEPPER, 1_000);
      for (const value of [record.hash, record.salt]) {
        expect(value).toMatch(/^[0-9a-f]+$/);
        expect(needsFormulaEscaping(value)).toBe(false);
        expect(escapeForSheet(value)).toBe(value);
      }
    }
  });
});

describe('timing parity', () => {
  it('provides a dummy hash for the unknown-account path', () => {
    // Login calls this when no user matches, so "unknown account" costs the
    // same as "wrong password" and cannot be used to enumerate accounts.
    expect(() => {
      performDummyHash(PEPPER, ITERATIONS);
    }).not.toThrow();
  });
});

describe('defaults', () => {
  it('exposes an iteration count that must be measured on the real deployment', () => {
    expect(DEFAULT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(1_000);
  });
});
