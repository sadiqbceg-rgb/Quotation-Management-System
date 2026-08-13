/**
 * The branded `Base64Png` type, and the conversions at its edges.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE BRAND IS FOR
 * ---------------------------------------------------------------------------
 * A signature travels as base64, and so does a `data:` URI, and so does most of
 * a Drive URL. They are all strings, and mixing them up puts
 * `data:image/png;base64,data:image/png;base64,…` into an `<img src>` — which
 * renders as nothing, on a document, with no error anywhere.
 *
 * `base64Png` is the only way to obtain the branded type, and it refuses
 * anything that is not a bare payload. These tests are about that boundary.
 */

import { describe, expect, it } from 'vitest';

import {
  base64ByteLength,
  base64Png,
  base64PngToBytes,
  isBase64Payload,
  toDataUri,
} from './signature';
import { TEST_ONLY_buildPng } from '../google-apps-script/src/__fixtures__/png-fixtures';

/** A real PNG, as base64 — not a signature, per PRD §34. */
function samplePayload(): string {
  return Buffer.from(Uint8Array.from(TEST_ONLY_buildPng({ width: 8, height: 4 }))).toString(
    'base64',
  );
}

/* -------------------------------------------------------------------------- */

describe('recognising a bare base64 payload', () => {
  it('accepts a real one', () => {
    expect(isBase64Payload(samplePayload())).toBe(true);
  });

  it.each([
    ['a data: URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['a Drive URL', 'https://drive.google.com/file/d/abc123/view'],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['a sentence', 'TEST_ONLY not base64 at all!'],
    ['base64 with a stray character', 'iVBORw0KGgo=$'],
  ])('rejects %s', (_name, value) => {
    expect(isBase64Payload(value)).toBe(false);
  });
});

describe('base64Png', () => {
  it('returns the same string, branded', () => {
    const payload = samplePayload();
    expect(base64Png(payload)).toBe(payload);
  });

  it('refuses a data: URI rather than storing one twice over', () => {
    // The failure this prevents: `toDataUri(base64Png(alreadyADataUri))` gives
    // `data:image/png;base64,data:image/png;base64,…`, which renders as
    // nothing at all — on a document, silently.
    expect(() => base64Png('data:image/png;base64,iVBORw0KGgo=')).toThrow(/bare base64/i);
  });

  it('refuses an empty value, so a missing signature is never a blank image', () => {
    expect(() => base64Png('')).toThrow();
  });
});

describe('toDataUri', () => {
  it('produces exactly one prefix, ready for an <img src>', () => {
    const uri = toDataUri(base64Png(samplePayload()));

    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    expect(uri.split('data:').length - 1).toBe(1);
  });
});

describe('base64PngToBytes', () => {
  it('round-trips to the exact bytes that were encoded', () => {
    const original = Uint8Array.from(TEST_ONLY_buildPng({ width: 8, height: 4 }));
    const decoded = base64PngToBytes(base64Png(samplePayload()));

    expect(decoded).toEqual(original);
  });

  it('produces a real PNG signature, so the embedder recognises it', () => {
    const decoded = base64PngToBytes(base64Png(samplePayload()));
    expect([...decoded.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('handles a payload whose length is not a multiple of three', () => {
    // The padding cases: '=' and '=='. A decoder that mishandles either
    // truncates the last byte or two of the image.
    for (const width of [3, 5, 7]) {
      const bytes = Uint8Array.from(TEST_ONLY_buildPng({ width, height: 2 }));
      const payload = Buffer.from(bytes).toString('base64');

      expect(base64PngToBytes(base64Png(payload)), `width ${String(width)}`).toEqual(bytes);
    }
  });
});

describe('base64ByteLength', () => {
  it('reports the decoded size without decoding, so a cap can be applied first', () => {
    // The point: a 6 MB upload is refused before 6 MB is decoded into memory.
    for (const width of [1, 3, 8, 32]) {
      const bytes = Uint8Array.from(TEST_ONLY_buildPng({ width, height: 4 }));
      const payload = Buffer.from(bytes).toString('base64');

      expect(base64ByteLength(payload), `width ${String(width)}`).toBe(bytes.length);
    }
  });

  it('accounts for both padding forms', () => {
    // 'AAAA' → 3 bytes, 'AAA=' → 2, 'AA==' → 1.
    expect(base64ByteLength('AAAA')).toBe(3);
    expect(base64ByteLength('AAA=')).toBe(2);
    expect(base64ByteLength('AA==')).toBe(1);
  });

  it('reports zero for an empty payload rather than a negative number', () => {
    expect(base64ByteLength('')).toBe(0);
  });
});
