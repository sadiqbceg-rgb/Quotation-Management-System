import { describe, expect, it } from 'vitest';

import {
  PNG_COLOR_TYPE,
  PNG_SIGNATURE,
  hasPngSignature,
  readPngHeader,
  sanitizeFilename,
} from './png';
import {
  TEST_ONLY_buildJpeg,
  TEST_ONLY_buildOpaquePng,
  TEST_ONLY_buildPng,
} from '../google-apps-script/src/__fixtures__/png-fixtures';

/* -------------------------------------------------------------------------- */

describe('the signature', () => {
  it('accepts the real 8 bytes', () => {
    expect(hasPngSignature(TEST_ONLY_buildPng())).toBe(true);
  });

  it('rejects a JPEG', () => {
    expect(hasPngSignature(TEST_ONLY_buildJpeg())).toBe(false);
  });

  it('rejects anything shorter than the signature', () => {
    expect(hasPngSignature([0x89, 0x50])).toBe(false);
    expect(hasPngSignature([])).toBe(false);
  });

  it('handles the SIGNED bytes Apps Script produces', () => {
    // Utilities.base64Decode returns -128..127, so 0x89 arrives as -119.
    const signed = [...PNG_SIGNATURE].map((byte) => (byte > 127 ? byte - 256 : byte));
    expect(hasPngSignature(signed)).toBe(true);
  });
});

describe('reading the header', () => {
  it('reads the dimensions', () => {
    const header = readPngHeader(TEST_ONLY_buildPng({ width: 1234, height: 321 }));

    expect(header).toMatchObject({ width: 1234, height: 321, bitDepth: 8 });
  });

  it('detects an alpha channel', () => {
    expect(readPngHeader(TEST_ONLY_buildPng())?.hasAlpha).toBe(true);
    expect(readPngHeader(TEST_ONLY_buildOpaquePng())?.hasAlpha).toBe(false);
  });

  it('detects greyscale with alpha', () => {
    const bytes = TEST_ONLY_buildPng({ colorType: PNG_COLOR_TYPE.greyscaleAlpha });
    expect(readPngHeader(bytes)?.hasAlpha).toBe(true);
  });

  it('reports no alpha for a plain indexed image', () => {
    // Indexed without a tRNS chunk is opaque; the naive "does the file contain
    // the letters tRNS anywhere" check would get this wrong.
    const bytes = TEST_ONLY_buildPng({ colorType: PNG_COLOR_TYPE.indexed });
    expect(readPngHeader(bytes)?.hasAlpha).toBe(false);
  });

  it('returns null rather than throwing on rubbish', () => {
    expect(readPngHeader(TEST_ONLY_buildJpeg())).toBeNull();
    expect(readPngHeader([])).toBeNull();
    expect(readPngHeader([...new Array<number>(40).fill(0)])).toBeNull();
  });

  it('returns null for a truncated PNG', () => {
    expect(readPngHeader(TEST_ONLY_buildPng().slice(0, 20))).toBeNull();
  });

  it('returns null when the signature is right but IHDR is not first', () => {
    const bytes = TEST_ONLY_buildPng();
    // Corrupt the chunk type where IHDR should be.
    bytes[12] = 0x58;

    expect(readPngHeader(bytes)).toBeNull();
  });

  it('returns null for a zero-dimension image', () => {
    const bytes = TEST_ONLY_buildPng();
    bytes[16] = 0;
    bytes[17] = 0;
    bytes[18] = 0;
    bytes[19] = 0;

    expect(readPngHeader(bytes)).toBeNull();
  });
});

describe('filename sanitisation', () => {
  it('keeps a reasonable name', () => {
    expect(sanitizeFilename('signature-2026.png')).toBe('signature-2026.png');
  });

  it('strips path separators', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('..\\..\\windows\\system32')).not.toContain('\\');
  });

  it('collapses traversal sequences', () => {
    expect(sanitizeFilename('....//....//x.png')).not.toContain('..');
  });

  it('removes anything outside the allowed set', () => {
    expect(sanitizeFilename('sig na;ture$.png')).toBe('signature.png');
  });

  it('caps the length', () => {
    expect(sanitizeFilename('a'.repeat(500)).length).toBe(100);
  });

  it('can return empty, so the caller must supply its own name', () => {
    expect(sanitizeFilename('///')).toBe('___');
    expect(sanitizeFilename('@@@')).toBe('');
  });
});
