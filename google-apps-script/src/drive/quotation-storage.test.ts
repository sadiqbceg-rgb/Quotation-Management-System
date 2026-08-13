/**
 * Filing a quotation in the archive — naming, replace-on-retry, and the
 * partial-failure case.
 *
 * Everything runs against the in-memory Drive fake. No test touches a real
 * Drive, so no test folder or file can appear in the company's archive.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { TEST_ONLY_documentBase64 } from '../__fixtures__/document-fixtures';
import { ApiError } from '../errors';
import { validateDocumentUpload } from '../validation/document-validator';
import { storeQuotationDocuments } from './quotation-storage';
import { DEFAULT_QUOTATION_CODES } from '@shared/numbering';

let env: GasEnvironment;

const NUMBER = 'SFC/RUH/QTN/2026/004';
const DATE = '2026-08-11';
const FOLDER = '2026/August/SFC-RUH-QTN-2026-004';

beforeEach(() => {
  vi.unstubAllGlobals();
  env = installGasFakes(vi.stubGlobal);
});

function documents(kinds: Array<'pdf' | 'docx'> = ['pdf', 'docx'], sizeBytes = 2_048) {
  const result: Record<string, ReturnType<typeof validateDocumentUpload>> = {};
  for (const kind of kinds) {
    result[kind] = validateDocumentUpload(kind, TEST_ONLY_documentBase64(kind, sizeBytes));
  }
  return result;
}

function store(kinds: Array<'pdf' | 'docx'> = ['pdf', 'docx'], sizeBytes = 2_048) {
  return storeQuotationDocuments({
    quotationNumber: NUMBER,
    quotationDate: DATE,
    codes: DEFAULT_QUOTATION_CODES,
    documents: documents(kinds, sizeBytes),
  });
}

/* -------------------------------------------------------------------------- */

describe('the archive layout (PRD §5)', () => {
  it('files the documents under Year / Month / Number', () => {
    const result = store();

    expect(result.outcome).toBe('success');
    expect(result.path).toEqual(['2026', 'August', 'SFC-RUH-QTN-2026-004']);
    expect(env.drive.folderPaths()).toContain(FOLDER);
  });

  it('names both files after the issued number', () => {
    store();

    expect(env.drive.filesIn(FOLDER).map((file) => file.name).sort()).toEqual([
      'SFC-RUH-QTN-2026-004.docx',
      'SFC-RUH-QTN-2026-004.pdf',
    ]);
  });

  it('stores them with the right MIME types', () => {
    store();
    const files = env.drive.filesIn(FOLDER);

    expect(files.find((file) => file.name.endsWith('.pdf'))?.mimeType).toBe('application/pdf');
    expect(files.find((file) => file.name.endsWith('.docx'))?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('uses the quotation date, not today', () => {
    const result = storeQuotationDocuments({
      quotationNumber: 'SFC/RUH/QTN/2026/001',
      quotationDate: '2026-01-15',
      codes: DEFAULT_QUOTATION_CODES,
      documents: documents(),
    });

    expect(result.path).toEqual(['2026', 'January', 'SFC-RUH-QTN-2026-001']);
  });

  it('keeps two quotations of the same month in one month folder', () => {
    store();
    storeQuotationDocuments({
      quotationNumber: 'SFC/RUH/QTN/2026/005',
      quotationDate: '2026-08-28',
      codes: DEFAULT_QUOTATION_CODES,
      documents: documents(),
    });

    expect(env.drive.folderPaths().filter((path) => path === '2026/August')).toHaveLength(1);
    expect(env.drive.folderPaths()).toContain('2026/August/SFC-RUH-QTN-2026-005');
  });

  it('refuses a number the application did not issue', () => {
    expect(() =>
      storeQuotationDocuments({
        quotationNumber: '../../etc/passwd',
        quotationDate: DATE,
        codes: DEFAULT_QUOTATION_CODES,
        documents: documents(),
      }),
    ).toThrow();
  });
});

/* -------------------------------------------------------------------------- */

describe('the result', () => {
  it('returns the folder link and both file links', () => {
    const result = store();
    if (result.outcome !== 'success') expect.unreachable('expected success');

    for (const target of [result.folder, result.files.pdf, result.files.docx]) {
      expect(target.url).toMatch(/^https:\/\/drive\.google\.com\//);
      expect(target.fileId.length).toBeGreaterThan(0);
    }
  });

  it('reports what it created', () => {
    const result = store();

    expect(result.uploaded.map((file) => file.disposition)).toEqual(['created', 'created']);
  });
});

/* -------------------------------------------------------------------------- */

describe('retrying (PRD §37)', () => {
  it('replaces the files instead of duplicating them', () => {
    const first = store();
    const second = store();

    expect(env.drive.filesIn(FOLDER)).toHaveLength(2);
    expect(env.drive.files().map((file) => file.name)).not.toContain(
      'SFC-RUH-QTN-2026-004 (1).pdf',
    );

    if (first.outcome !== 'success' || second.outcome !== 'success') {
      expect.unreachable('expected success');
    }
    // Same ids, so the URL already shown to the user still resolves.
    expect(second.files.pdf.fileId).toBe(first.files.pdf.fileId);
    expect(second.files.docx.fileId).toBe(first.files.docx.fileId);
  });

  it('replaces through the Advanced Drive Service, keeping Drive revisions', () => {
    store();
    expect(env.drive.updateCalls()).toHaveLength(0);

    const second = store(['pdf', 'docx'], 4_096);

    expect(env.drive.updateCalls()).toHaveLength(2);
    expect(second.uploaded.map((file) => file.disposition)).toEqual(['replaced', 'replaced']);
    // The content really changed, not just the metadata.
    expect(env.drive.filesIn(FOLDER)[0]?.bytes.length).toBe(4_096);
  });

  it('reuses the same folder', () => {
    const first = store();
    const second = store();

    expect(second.folder.fileId).toBe(first.folder.fileId);
    expect(env.drive.folderPaths().filter((path) => path === FOLDER)).toHaveLength(1);
  });

  it('uploads only what is missing, and then reports success', () => {
    // The PDF went up; the DOCX did not.
    const partial = store(['pdf']);
    expect(partial.outcome).toBe('partial');
    if (partial.outcome !== 'partial') expect.unreachable('expected partial');
    expect(partial.missing).toEqual(['docx']);

    // The retry sends only the DOCX — and the PDF already in the folder is
    // recognised, so the quotation is complete.
    const retried = store(['docx']);

    expect(retried.outcome).toBe('success');
    expect(env.drive.filesIn(FOLDER)).toHaveLength(2);
    // The PDF was not re-uploaded, so its id is unchanged.
    if (retried.outcome !== 'success') expect.unreachable('expected success');
    expect(retried.files.pdf.fileId).toBe(partial.files.pdf?.fileId);
  });
});

/* -------------------------------------------------------------------------- */

describe('partial failure', () => {
  it('reports DOCX-failed as partial, keeping the PDF link', () => {
    // The PDF is filed; the DOCX upload then fails.
    store(['pdf']);
    env.drive.failNextCreate('Service error');

    const result = storeQuotationDocuments({
      quotationNumber: NUMBER,
      quotationDate: DATE,
      codes: DEFAULT_QUOTATION_CODES,
      documents: documents(['docx']),
    });

    expect(result.outcome).toBe('partial');
    if (result.outcome !== 'partial') expect.unreachable('expected partial');

    expect(result.missing).toEqual(['docx']);
    // The PDF is genuinely in the archive, so its link is genuinely returned.
    expect(result.files.pdf?.url).toMatch(/^https:\/\/drive\.google\.com\//);
    expect(result.files.docx).toBeNull();
  });

  it('is a plain failure, not a partial, when nothing was stored', () => {
    env.drive.failNextCreate('Service error');

    // Nothing reached the archive, so the specific Drive code is more useful
    // to the user than "some files did not upload".
    expect(() => store()).toThrow(ApiError);
    expect(env.drive.filesIn(FOLDER)).toHaveLength(0);
  });

  it('surfaces a quota failure by its own code', () => {
    env.drive.failNextCreate('User storage quota exceeded');

    try {
      store();
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('DRIVE_QUOTA_EXCEEDED');
    }
  });

  it('refuses to file nothing at all', () => {
    expect(() =>
      storeQuotationDocuments({
        quotationNumber: NUMBER,
        quotationDate: DATE,
        codes: DEFAULT_QUOTATION_CODES,
        documents: {},
      }),
    ).toThrow(ApiError);
  });

  it('reports a missing Advanced Drive Service rather than a corrupt upload', () => {
    store();
    env.drive.disableAdvancedService();

    try {
      store();
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as ApiError).code).toBe('DRIVE_UPLOAD_FAILED');
      expect((error as ApiError).message).toMatch(/not fully configured/i);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('security', () => {
  it('never calls a sharing API', () => {
    store();
    store();

    // Files inherit the archive's permissions; nothing is made public (§16.5).
    expect(env.drive.sharingCalls()).toEqual([]);
  });

  it('does not upload inside the folder lock', () => {
    store();

    // One acquisition for folder resolution, released before either upload —
    // a 2 MB upload holding the global lock would serialise every user.
    expect(env.lock.acquisitions()).toBe(1);
    expect(env.lock.isHeld()).toBe(false);
  });
});
