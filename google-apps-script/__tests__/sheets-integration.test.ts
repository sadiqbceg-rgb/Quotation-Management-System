/**
 * The tracking register as a whole — a working year's worth of rows.
 *
 * `src/sheets/quotations-sheet.test.ts` covers one row at a time. This covers
 * the register: that a re-save updates rather than accumulates, that the cost
 * of a save does not grow with the number of rows, that the escaping invariant
 * holds across every text column of every row, and that reading and filtering
 * behave when the sheet has been edited by hand — which it will be, because
 * it is a spreadsheet and people open it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../src/__fixtures__/gas-fakes';
import {
  COLUMN,
  QUOTATIONS_SHEET_NAME,
  QUOTATION_HEADERS,
  findByDraftId,
  findByQuotationNumber,
  listQuotationRows,
  setRowStatus,
  upsertQuotationRow,
  type TrackingInput,
} from '../src/sheets/quotations-sheet';
import { bootstrapQuotationsSheet } from '../src/sheets/sheet-bootstrap';
import { DEFAULT_QUOTATION_CODES } from '@shared/numbering';
import { FORMULA_INJECTION_PREFIXES, unescapeFromSheet } from '@shared/validation-rules';

let env: GasEnvironment;

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
  bootstrapQuotationsSheet();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

let sequence = 0;

function tracking(overrides: Partial<TrackingInput> = {}): TrackingInput {
  sequence += 1;
  const padded = String(sequence).padStart(3, '0');

  return {
    quotationNumber: `SFC/RUH/QTN/2026/${padded}`,
    quotationDate: '11-08-2026',
    clientName: `TEST_ONLY Contact ${padded}`,
    companyName: `TEST_ONLY Client Co. ${padded}`,
    quotationFor: 'TEST_ONLY manpower supply',
    totalAmount: 920,
    subtotal: 800,
    vatAmount: 120,
    authorizedPerson: 'TEST_ONLY_Signatory',
    driveFolderUrl: `https://drive.google.com/drive/folders/folder-000000-${padded}`,
    pdfUrl: `https://drive.google.com/file/d/file-pdf-${padded}/view`,
    docxUrl: `https://drive.google.com/file/d/file-docx-${padded}/view`,
    createdBy: 'staff@speedxksa.com',
    draftId: `TEST_ONLY_draft-${padded}`,
    codes: DEFAULT_QUOTATION_CODES,
    ...overrides,
  };
}

function seed(count: number): TrackingInput[] {
  const written: TrackingInput[] = [];
  for (let index = 0; index < count; index++) {
    const input = tracking();
    upsertQuotationRow(input);
    written.push(input);
  }
  return written;
}

beforeEach(() => {
  sequence = 0;
});

/* -------------------------------------------------------------------------- */
/* Append versus update                                                        */
/* -------------------------------------------------------------------------- */

describe('a register of many quotations', () => {
  it('holds exactly one row per quotation', () => {
    seed(25);
    expect(env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(25);
  });

  it('updates in place when the same draft is saved again, however many rows exist', () => {
    const written = seed(25);
    const target = written[7];
    if (target === undefined) throw new Error('seed did not produce row 8');

    upsertQuotationRow({ ...target, quotationFor: 'TEST_ONLY revised scope' });

    const rows = env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME);
    expect(rows).toHaveLength(25);
    expect(rows[7]?.[COLUMN.quotationFor]).toBe('TEST_ONLY revised scope');
  });

  it('preserves a status set by hand when the quotation is re-saved', () => {
    const written = seed(5);
    const target = written[2];
    if (target === undefined) throw new Error('seed did not produce row 3');

    setRowStatus(target.quotationNumber, 'Approved');
    upsertQuotationRow({ ...target, totalAmount: 1_000 });

    const row = findByQuotationNumber(target.quotationNumber);
    expect(row?.status).toBe('Approved');
    expect(row?.totalAmount).toBe(1_000);
  });

  it('refuses a number already held by a different quotation, however deep in the sheet', () => {
    const written = seed(30);
    const existing = written[11];
    if (existing === undefined) throw new Error('seed did not produce row 12');

    expect(() =>
      upsertQuotationRow(tracking({ quotationNumber: existing.quotationNumber })),
    ).toThrow();

    expect(env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(30);
  });
});

/* -------------------------------------------------------------------------- */
/* Cost                                                                        */
/* -------------------------------------------------------------------------- */

describe('the cost of a save', () => {
  it('does not grow with the size of the register', () => {
    /*
     * Apps Script charges a host round trip per `getRange`, and a six-minute
     * execution cap means a per-row scan is what eventually stops the company
     * saving quotations at all. This measures the round trips a single save
     * costs at three register sizes; they must be identical.
     */
    function costOfOneSaveAfter(existingRows: number): number {
      vi.unstubAllGlobals();
      env = installGasFakes(vi.stubGlobal);
      bootstrapQuotationsSheet();
      sequence = 0;
      seed(existingRows);

      const before = env.spreadsheet.rangeCalls();
      upsertQuotationRow(tracking());
      return env.spreadsheet.rangeCalls() - before;
    }

    const empty = costOfOneSaveAfter(0);
    const hundred = costOfOneSaveAfter(100);
    const fiveHundred = costOfOneSaveAfter(500);
    const thousand = costOfOneSaveAfter(1_000);

    // An empty register costs less: there is nothing to scan, so the lookup
    // returns before it reads. From the first row onwards the cost is flat.
    expect(empty).toBeGreaterThan(0);
    expect(empty).toBeLessThanOrEqual(hundred);
    expect({ hundred, fiveHundred, thousand }).toEqual({
      hundred,
      fiveHundred: hundred,
      thousand: hundred,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Injection, across every row and every text column                          */
/* -------------------------------------------------------------------------- */

describe('formula injection', () => {
  /** Every column that carries text a user typed. */
  const TEXT_COLUMNS = [
    COLUMN.clientName,
    COLUMN.companyName,
    COLUMN.quotationFor,
    COLUMN.authorizedPerson,
    COLUMN.createdBy,
  ];

  it.each(FORMULA_INJECTION_PREFIXES)(
    'neutralises a value beginning with "%s" in every text column',
    (prefix) => {
      const payload = `${prefix}HYPERLINK("https://example.invalid","click")`;

      upsertQuotationRow(
        tracking({
          clientName: payload,
          companyName: payload,
          quotationFor: payload,
          authorizedPerson: payload,
          createdBy: payload,
        }),
      );

      const row = env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)[0];
      if (row === undefined) throw new Error('no row was written');

      for (const column of TEXT_COLUMNS) {
        const cell = String(row[column]);
        expect(cell.startsWith(prefix), `column ${String(column)} was left live`).toBe(false);
        // Neutralised, not mangled: the user's text comes back intact.
        expect(unescapeFromSheet(cell)).toBe(payload);
      }
    },
  );

  it('leaves no live formula anywhere in the register, at any size', () => {
    seed(20);
    upsertQuotationRow(
      tracking({ clientName: '=1+1', companyName: '@import', quotationFor: '-2' }),
    );

    const rows = env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME);

    for (const [index, row] of rows.entries()) {
      for (const [column, cell] of row.entries()) {
        if (typeof cell !== 'string') continue;

        // The one documented exception: the Drive Folder cell is a HYPERLINK
        // built from a validated Drive URL, never from user text (§19.5).
        if (column === COLUMN.driveFolder) continue;

        expect(
          FORMULA_INJECTION_PREFIXES.some((prefix) => cell.startsWith(prefix)),
          `row ${String(index)}, column ${String(column)}: "${cell}"`,
        ).toBe(false);
      }
    }
  });

  it('builds the Drive Folder hyperlink only from a real Drive URL', () => {
    upsertQuotationRow(tracking());
    const live = String(env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)[0]?.[COLUMN.driveFolder]);
    expect(live.startsWith('=HYPERLINK(')).toBe(true);

    upsertQuotationRow(tracking({ driveFolderUrl: `java${'script'}:alert(1)` }));
    const inert = String(env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)[1]?.[COLUMN.driveFolder]);
    expect(inert.startsWith('=')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Reading a sheet people have edited                                          */
/* -------------------------------------------------------------------------- */

describe('reading the register', () => {
  it('returns rows newest first, so the register opens on recent work', () => {
    const written = seed(10);
    const numbers = listQuotationRows().map((row) => row.quotationNumber);

    expect(numbers[0]).toBe(written[9]?.quotationNumber);
    expect(numbers.at(-1)).toBe(written[0]?.quotationNumber);
  });

  it('finds a quotation by draft id and by number, and they agree', () => {
    const written = seed(12);
    const target = written[6];
    if (target === undefined) throw new Error('seed did not produce row 7');

    const byDraft = findByDraftId(target.draftId);
    const byNumber = findByQuotationNumber(target.quotationNumber);

    expect(byDraft?.quotationNumber).toBe(target.quotationNumber);
    expect(byNumber?.draftId).toBe(target.draftId);
    expect(byDraft?.rowNumber).toBe(byNumber?.rowNumber);
  });

  it('reports a quotation that is not there rather than inventing one', () => {
    seed(3);
    expect(findByDraftId('TEST_ONLY_draft-does-not-exist')).toBeNull();
    expect(findByQuotationNumber('SFC/RUH/QTN/2026/999')).toBeNull();
  });

  it('skips a row somebody broke by hand instead of failing the whole register', () => {
    seed(5);

    // What a person does: selects a status cell and types something else.
    const sheet = env.spreadsheet.formatting(QUOTATIONS_SHEET_NAME);
    if (sheet === undefined) throw new Error('no register sheet');
    const brokenRow = sheet.rows[3];
    if (brokenRow === undefined) throw new Error('no row 3');
    brokenRow[COLUMN.status] = 'TEST_ONLY Maybe';

    const rows = listQuotationRows();
    expect(rows).toHaveLength(4);
    // The register still opens, and the four intact rows are all readable.
    expect(rows.every((row) => row.quotationNumber.length > 0)).toBe(true);
  });

  it('reflects a status changed by hand in the sheet', () => {
    const written = seed(4);
    const target = written[1];
    if (target === undefined) throw new Error('seed did not produce row 2');

    const sheet = env.spreadsheet.formatting(QUOTATIONS_SHEET_NAME);
    const row = sheet?.rows[2];
    if (row === undefined) throw new Error('no row 2');
    row[COLUMN.status] = 'Rejected';

    expect(findByQuotationNumber(target.quotationNumber)?.status).toBe('Rejected');
  });
});

/* -------------------------------------------------------------------------- */
/* The schema does not drift                                                   */
/* -------------------------------------------------------------------------- */

describe('the schema', () => {
  it('keeps A-H exactly as PRD §31 defines them, whatever else is added', () => {
    expect(QUOTATION_HEADERS.slice(0, 8)).toEqual([
      'Quotation No.',
      'Date',
      'Client Name',
      'Company Name',
      'Quotation For',
      'Total Amount',
      'Status',
      'Drive Folder',
    ]);
  });

  it('writes as many cells as it declares headers', () => {
    upsertQuotationRow(tracking());
    const row = env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)[0];
    expect(row).toHaveLength(QUOTATION_HEADERS.length);
  });

  it('ships an empty register — no sample row, ever (PRD §34)', () => {
    vi.unstubAllGlobals();
    env = installGasFakes(vi.stubGlobal);
    bootstrapQuotationsSheet();

    expect(env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toEqual([]);
  });
});
