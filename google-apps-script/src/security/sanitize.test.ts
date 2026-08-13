/**
 * The parse boundary.
 *
 * These are regression tests for a control, not for a feature: each one fails
 * if the corresponding refusal is removed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes } from '../__fixtures__/gas-fakes';
import { ApiError } from '../errors';
import {
  FORBIDDEN_KEYS,
  MAX_ARRAY_LENGTH,
  MAX_DEPTH,
  assertSafeStructure,
  hasUnsafeCharacters,
  parseRequestBody,
  stripUnsafeCharacters,
} from './sanitize';

beforeEach(() => {
  vi.unstubAllGlobals();
  installGasFakes(vi.stubGlobal);
});

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof ApiError ? error.code : 'NOT_API_ERROR';
  }
  return 'NO_ERROR';
}

/* -------------------------------------------------------------------------- */

describe('prototype pollution', () => {
  it('refuses every forbidden key at the top level', () => {
    for (const key of FORBIDDEN_KEYS) {
      expect(codeOf(() => parseRequestBody(`{"${key}":{"polluted":true}}`)), key).toBe(
        'VALIDATION_FAILED',
      );
    }
  });

  it('refuses one buried deep inside a payload', () => {
    const body = JSON.stringify({
      action: 'quotation.save',
      payload: { quotation: { client: { nested: { deeper: {} } } } },
    }).replace('"deeper":{}', '"deeper":{"__proto__":{"polluted":true}}');

    expect(codeOf(() => parseRequestBody(body))).toBe('VALIDATION_FAILED');
  });

  it('refuses one inside an array element', () => {
    const body = '{"payload":{"lines":[{"a":1},{"constructor":{"x":1}}]}}';
    expect(codeOf(() => parseRequestBody(body))).toBe('VALIDATION_FAILED');
  });

  it('leaves the global prototype untouched either way', () => {
    codeOf(() => parseRequestBody('{"__proto__":{"polluted":true}}'));

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('still accepts an ordinary payload', () => {
    const parsed = parseRequestBody('{"action":"health","payload":{"a":[1,2,{"b":"c"}]}}');

    expect(parsed).toEqual({ action: 'health', payload: { a: [1, 2, { b: 'c' }] } });
  });
});

/* -------------------------------------------------------------------------- */

describe('structural limits', () => {
  it('refuses a payload nested past the limit', () => {
    let body = '{"a":1}';
    for (let depth = 0; depth < MAX_DEPTH + 4; depth += 1) body = `{"a":${body}}`;

    expect(codeOf(() => parseRequestBody(body))).toBe('VALIDATION_FAILED');
  });

  it('accepts a payload at a realistic depth', () => {
    // `payload.quotation.lines[0].description` — four levels.
    const body = JSON.stringify({
      payload: { quotation: { lines: [{ description: 'TEST_ONLY' }] } },
    });

    expect(() => parseRequestBody(body)).not.toThrow();
  });

  it('refuses an oversized array', () => {
    const huge = { lines: new Array<number>(MAX_ARRAY_LENGTH + 1).fill(0) };

    expect(codeOf(() => assertSafeStructure(huge))).toBe('VALIDATION_FAILED');
  });

  it('survives a deeply nested payload without overflowing its own stack', () => {
    // The walk is iterative for exactly this reason: a recursive one would
    // blow up before its own depth check could refuse the payload.
    let body = '{"a":1}';
    for (let depth = 0; depth < 20_000; depth += 1) body = `{"a":${body}}`;

    expect(codeOf(() => parseRequestBody(body))).toBe('VALIDATION_FAILED');
  });

  it('refuses malformed JSON with a typed error, never an exception', () => {
    expect(codeOf(() => parseRequestBody('not json'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => parseRequestBody(''))).toBe('VALIDATION_FAILED');
  });
});

/* -------------------------------------------------------------------------- */

describe('unsafe characters', () => {
  it('strips control characters', () => {
    expect(stripUnsafeCharacters('a\u0000b')).toBe('ab');
    expect(stripUnsafeCharacters('a\u001fb')).toBe('ab');
    expect(stripUnsafeCharacters('a\u007fb')).toBe('ab');
  });

  it('keeps the whitespace a term body legitimately contains', () => {
    expect(stripUnsafeCharacters('line one\nline two\tindented\r\n')).toBe(
      'line one\nline two\tindented\r\n',
    );
  });

  it('strips a right-to-left override', () => {
    // Renders the rest of a cell backwards, so a spreadsheet row can be made to
    // read as something other than what it contains.
    expect(stripUnsafeCharacters('invoice\u202egpj.exe')).toBe('invoicegpj.exe');
    expect(stripUnsafeCharacters('a\u200bb')).toBe('ab');
  });

  it('keeps the Arabic the letterhead legitimately carries', () => {
    const arabic = 'شركة سبيد';
    expect(stripUnsafeCharacters(arabic)).toBe(arabic);
  });

  it('reports whether a value carries one', () => {
    expect(hasUnsafeCharacters('ordinary text')).toBe(false);
    expect(hasUnsafeCharacters('a\u202eb')).toBe(true);
    // The regex is rebuilt per call, so a previous match cannot leave state
    // behind and make the next call report the wrong answer.
    expect(hasUnsafeCharacters('a\u202eb')).toBe(true);
  });
});
