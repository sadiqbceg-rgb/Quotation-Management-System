/**
 * The Drive archive as a whole — many quotations, many months, many retries.
 *
 * `src/drive/quotation-storage.test.ts` covers one quotation at a time. What it
 * cannot show is what the archive looks like after a year of use, and that is
 * where the mistakes live: a month name derived from the clock rather than the
 * quotation date misfiles every backdated quotation, and a folder resolver that
 * creates rather than reuses leaves two "August" folders that nobody notices
 * until a document is filed in the wrong one.
 *
 * Everything runs against the in-memory Drive fake. No test touches a real
 * Drive, so no test folder can appear in the company's archive (PRD §34).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../src/__fixtures__/gas-fakes';
import { TEST_ONLY_documentBase64 } from '../src/__fixtures__/document-fixtures';
import { storeQuotationDocuments } from '../src/drive/quotation-storage';
import { validateDocumentUpload } from '../src/validation/document-validator';
import { reserveQuotationNumber } from '../src/quotation-number/reserve';
import { DEFAULT_QUOTATION_CODES, toFileSafe } from '@shared/numbering';
import { MONTH_FOLDER_NAMES } from '@shared/drive-paths';
import { withFrozenClock } from '../../test/helpers/clock';

let env: GasEnvironment;

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Kind = 'pdf' | 'docx';

function documents(kinds: readonly Kind[] = ['pdf', 'docx'], sizeBytes = 2_048) {
  const result: Partial<Record<Kind, ReturnType<typeof validateDocumentUpload>>> = {};
  for (const kind of kinds) {
    result[kind] = validateDocumentUpload(kind, TEST_ONLY_documentBase64(kind, sizeBytes));
  }
  return result;
}

/** Reserve a real number for a date, then file documents against it. */
function fileQuotation(
  draftId: string,
  quotationDate: string,
  kinds: readonly Kind[] = ['pdf', 'docx'],
  sizeBytes = 2_048,
) {
  const issued = reserveQuotationNumber({ draftId, quotationDate });
  const result = storeQuotationDocuments({
    quotationNumber: issued.canonical,
    quotationDate,
    codes: DEFAULT_QUOTATION_CODES,
    documents: documents(kinds, sizeBytes),
  });
  return { issued, result };
}

/* -------------------------------------------------------------------------- */
/* Month naming, all twelve                                                    */
/* -------------------------------------------------------------------------- */

describe('the month folder', () => {
  it.each(
    MONTH_FOLDER_NAMES.map((name, index) => {
      const month = String(index + 1).padStart(2, '0');
      return [name, `2026-${month}-15`] as const;
    }),
  )('is named %s for a quotation dated %s', (expected, quotationDate) => {
    const { result } = fileQuotation(`TEST_ONLY_draft-${expected}`, quotationDate);
    expect(result.path[1]).toBe(expected);
  });

  it('is spelled out in full, in English, matching PRD §5', () => {
    // Not "08", not "Aug", not a locale-dependent rendering — the archive is
    // browsed by people and the PRD writes the names out.
    const { result } = fileQuotation('TEST_ONLY_draft-august', '2026-08-11');
    expect(result.path).toEqual(['2026', 'August', 'SFC-RUH-QTN-2026-001']);
  });

  it('files the last day of a month in that month, not the next', () => {
    // A UTC/local slip here moves a 31 January quotation into February.
    const { result } = fileQuotation('TEST_ONLY_draft-jan31', '2026-01-31');
    expect(result.path.slice(0, 2)).toEqual(['2026', 'January']);
  });

  it('files the first day of a month in that month, not the previous', () => {
    const { result } = fileQuotation('TEST_ONLY_draft-mar01', '2026-03-01');
    expect(result.path.slice(0, 2)).toEqual(['2026', 'March']);
  });
});

/* -------------------------------------------------------------------------- */
/* Backdating                                                                  */
/* -------------------------------------------------------------------------- */

describe('a backdated quotation', () => {
  it('is filed under the year and month it is DATED, not the day it was saved', () => {
    const { result } = withFrozenClock('2027-04-20T11:00:00.000Z', () =>
      fileQuotation('TEST_ONLY_draft-backdated', '2026-11-03'),
    );

    expect(result.path.slice(0, 2)).toEqual(['2026', 'November']);
  });

  it('sits beside the quotations of its own month, not the current one', () => {
    withFrozenClock('2027-04-20T11:00:00.000Z', () => {
      fileQuotation('TEST_ONLY_draft-a', '2026-11-03');
      fileQuotation('TEST_ONLY_draft-b', '2026-11-28');
      fileQuotation('TEST_ONLY_draft-c', '2027-04-20');
    });

    const paths = env.drive.folderPaths();
    expect(paths.filter((path) => path === '2026/November')).toHaveLength(1);
    expect(paths.filter((path) => path === '2027/April')).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Folder reuse across a working year                                          */
/* -------------------------------------------------------------------------- */

describe('the archive after a year of use', () => {
  const YEAR_OF_QUOTATIONS = [
    ['TEST_ONLY_draft-1', '2026-01-05'],
    ['TEST_ONLY_draft-2', '2026-01-19'],
    ['TEST_ONLY_draft-3', '2026-02-02'],
    ['TEST_ONLY_draft-4', '2026-08-11'],
    ['TEST_ONLY_draft-5', '2026-08-30'],
    ['TEST_ONLY_draft-6', '2026-12-31'],
    ['TEST_ONLY_draft-7', '2027-01-04'],
  ] as const;

  function fileAll(): string[] {
    return YEAR_OF_QUOTATIONS.map(
      ([draftId, date]) => fileQuotation(draftId, date).issued.fileSafe,
    );
  }

  it('creates exactly one folder per year and one per month', () => {
    fileAll();
    const paths = env.drive.folderPaths();

    const years = paths.filter((path) => !path.includes('/'));
    expect(years.sort()).toEqual(['2026', '2027']);

    const months = paths.filter((path) => path.split('/').length === 2);
    expect(months.sort()).toEqual([
      '2026/August',
      '2026/December',
      '2026/February',
      '2026/January',
      '2027/January',
    ]);
  });

  it('gives each quotation its own numbered folder', () => {
    const numbers = fileAll();
    const quotationFolders = env.drive
      .folderPaths()
      .filter((path) => path.split('/').length === 3)
      .map((path) => path.split('/')[2] ?? '');

    expect(quotationFolders.sort()).toEqual([...numbers].sort());
    expect(new Set(quotationFolders).size).toBe(numbers.length);
  });

  it('never creates a duplicate folder at any level', () => {
    fileAll();
    const paths = env.drive.folderPaths();
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('files two documents per quotation and no more', () => {
    const numbers = fileAll();
    expect(env.drive.files()).toHaveLength(numbers.length * 2);
  });

  it('never calls a sharing API, for any of them', () => {
    fileAll();
    // Every document in the archive is private by inheritance. A single call
    // here would put a client's pricing on a public URL (§16.5).
    expect(env.drive.sharingCalls()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Retry                                                                       */
/* -------------------------------------------------------------------------- */

describe('retrying a save', () => {
  const DRAFT = 'TEST_ONLY_draft-retry';
  const DATE = '2026-08-11';

  it('replaces both documents rather than filing a second copy', () => {
    const { issued } = fileQuotation(DRAFT, DATE, ['pdf', 'docx'], 2_048);

    // Same draft: the number is reused, so the folder and names are identical.
    const again = storeQuotationDocuments({
      quotationNumber: reserveQuotationNumber({ draftId: DRAFT, quotationDate: DATE }).canonical,
      quotationDate: DATE,
      codes: DEFAULT_QUOTATION_CODES,
      documents: documents(['pdf', 'docx'], 4_096),
    });

    expect(again.outcome).toBe('success');

    const folder = `2026/August/${issued.fileSafe}`;
    const files = env.drive.filesIn(folder);
    expect(files).toHaveLength(2);

    // Replaced in place: the content changed, the ids did not.
    for (const file of files) expect(file.bytes).toHaveLength(4_096);
    expect(env.drive.updateCalls()).toHaveLength(2);
  });

  it('keeps the same file ids, so a link already in the register still works', () => {
    const first = fileQuotation(DRAFT, DATE);
    if (first.result.outcome !== 'success') throw new Error('first save should succeed');
    const originalPdfId = first.result.files.pdf.fileId;

    const again = storeQuotationDocuments({
      quotationNumber: first.issued.canonical,
      quotationDate: DATE,
      codes: DEFAULT_QUOTATION_CODES,
      documents: documents(['pdf', 'docx'], 4_096),
    });
    if (again.outcome !== 'success') throw new Error('retry should succeed');

    expect(again.files.pdf.fileId).toBe(originalPdfId);
  });

  it('completes an archive left half-filed, uploading only what is missing', () => {
    const issued = reserveQuotationNumber({ draftId: DRAFT, quotationDate: DATE });

    const partial = storeQuotationDocuments({
      quotationNumber: issued.canonical,
      quotationDate: DATE,
      codes: DEFAULT_QUOTATION_CODES,
      documents: documents(['pdf']),
    });
    expect(partial.outcome).toBe('partial');

    const completed = storeQuotationDocuments({
      quotationNumber: issued.canonical,
      quotationDate: DATE,
      codes: DEFAULT_QUOTATION_CODES,
      documents: documents(['docx']),
    });

    expect(completed.outcome).toBe('success');
    // One upload on the retry, not two: the PDF was already there.
    expect(completed.uploaded.map((file) => file.kind)).toEqual(['docx']);
    expect(env.drive.filesIn(`2026/August/${issued.fileSafe}`)).toHaveLength(2);
  });

  it('leaves nothing orphaned when the folder itself cannot be created', () => {
    env.drive.failNextFolder('Drive is unavailable right now.');

    expect(() => fileQuotation(DRAFT, DATE)).toThrow();

    // Not one file, not a half-built path: the resolver failed before any
    // upload, which is the whole reason resolution comes first (§15.6).
    expect(env.drive.files()).toEqual([]);
    expect(env.drive.folderPaths()).not.toContain(`2026/August`);
  });
});

/* -------------------------------------------------------------------------- */
/* Naming is never invented                                                    */
/* -------------------------------------------------------------------------- */

describe('names come from the issued number', () => {
  it('uses the file-safe form for the folder and both files', () => {
    const { issued } = fileQuotation('TEST_ONLY_draft-name', '2026-08-11');
    const expected = toFileSafe(issued.canonical);

    expect(
      env.drive
        .filesIn(`2026/August/${expected}`)
        .map((file) => file.name)
        .sort(),
    ).toEqual([`${expected}.docx`, `${expected}.pdf`]);
  });

  it('refuses a number the application never issued, rather than filing it', () => {
    expect(() =>
      storeQuotationDocuments({
        quotationNumber: 'TEST_ONLY not a quotation number',
        quotationDate: '2026-08-11',
        codes: DEFAULT_QUOTATION_CODES,
        documents: documents(),
      }),
    ).toThrow();

    expect(env.drive.files()).toEqual([]);
  });

  it('never puts a path separator into a folder name', () => {
    fileQuotation('TEST_ONLY_draft-sep', '2026-08-11');

    for (const path of env.drive.folderPaths()) {
      for (const segment of path.split('/')) {
        expect(segment).not.toBe('');
        expect(segment).toMatch(/^[A-Za-z0-9 _-]+$/);
      }
    }
  });
});
