/**
 * Upload validation — the check that stops this endpoint becoming an arbitrary
 * file-upload service filed under the company's letterhead.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TEST_ONLY_documentBase64,
  TEST_ONLY_wrongFormatBase64,
} from '../__fixtures__/document-fixtures';
import { installGasFakes } from '../__fixtures__/gas-fakes';
import { ApiError } from '../errors';
import { UPLOAD_LIMITS } from '@shared/validation-rules';
import { assertCombinedSize, validateDocumentUpload } from './document-validator';

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

describe('accepting a real document', () => {
  it('accepts a PDF and reports its size and MIME type', () => {
    const result = validateDocumentUpload('pdf', TEST_ONLY_documentBase64('pdf', 4_096));

    expect(result.kind).toBe('pdf');
    expect(result.byteLength).toBe(4_096);
    expect(result.mimeType).toBe('application/pdf');
  });

  it('accepts a DOCX', () => {
    const result = validateDocumentUpload('docx', TEST_ONLY_documentBase64('docx', 4_096));

    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('returns the decoded bytes, so nothing decodes twice', () => {
    const result = validateDocumentUpload('pdf', TEST_ONLY_documentBase64('pdf'));

    // `%PDF-`, as SIGNED Apps Script bytes.
    expect(result.bytes.slice(0, 5).map((byte) => byte & 0xff)).toEqual([
      0x25, 0x50, 0x44, 0x46, 0x2d,
    ]);
  });
});

describe('the magic-byte check', () => {
  it('rejects a PNG claiming to be a PDF', () => {
    // The exact case a MIME-type or extension check waves through.
    expect(codeOf(() => validateDocumentUpload('pdf', TEST_ONLY_wrongFormatBase64()))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('rejects a DOCX that is really a PDF, and the reverse', () => {
    expect(codeOf(() => validateDocumentUpload('docx', TEST_ONLY_documentBase64('pdf')))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => validateDocumentUpload('pdf', TEST_ONLY_documentBase64('docx')))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('names the format in the message, so the user knows what went wrong', () => {
    try {
      validateDocumentUpload('pdf', TEST_ONLY_wrongFormatBase64());
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).message).toMatch(/not a PDF/i);
    }
  });
});

describe('sizes', () => {
  it('rejects a file over the per-file cap', () => {
    const oversized = TEST_ONLY_documentBase64('pdf', UPLOAD_LIMITS.documentMaxBytes + 1_024);

    expect(codeOf(() => validateDocumentUpload('pdf', oversized))).toBe('VALIDATION_FAILED');
  });

  it('rejects an empty or near-empty file', () => {
    expect(codeOf(() => validateDocumentUpload('pdf', ''))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => validateDocumentUpload('pdf', TEST_ONLY_documentBase64('pdf', 64)))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('rejects two files that are each legal but together are not', () => {
    const big = validateDocumentUpload('pdf', TEST_ONLY_documentBase64('pdf', 4_096));

    // Under the combined cap.
    expect(() => assertCombinedSize([big, big])).not.toThrow();

    const nearLimit = {
      ...big,
      byteLength: UPLOAD_LIMITS.documentMaxBytes,
    };
    expect(codeOf(() => assertCombinedSize([nearLimit, nearLimit, nearLimit]))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('malformed input', () => {
  it('rejects a data: URI rather than decoding it to garbage', () => {
    expect(
      codeOf(() =>
        validateDocumentUpload('pdf', `data:application/pdf;base64,${TEST_ONLY_documentBase64('pdf')}`),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('rejects something that is not base64 at all', () => {
    expect(codeOf(() => validateDocumentUpload('pdf', 'not base64 !!'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => validateDocumentUpload('pdf', 42))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => validateDocumentUpload('pdf', null))).toBe('VALIDATION_FAILED');
  });
});
