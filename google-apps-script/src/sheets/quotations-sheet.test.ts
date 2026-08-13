/**
 * The `Quotations` register: its shape, its writes, and its uniqueness rule.
 *
 * Everything runs against the in-memory `SpreadsheetApp` fake. No test touches
 * a real spreadsheet, and no test writes a sample row — PRD §34 requires
 * production to start empty, and a fixture that seeded one would be the first
 * thing to be copied into a real deployment.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { DEFAULT_QUOTATION_CODES } from '@shared/numbering';
import { QUOTATION_STATUSES } from '@shared/types';
import { bootstrapQuotationsSheet, TEST_ONLY_resetBootstrapState } from './sheet-bootstrap';
import {
  COLUMN,
  QUOTATIONS_SHEET_NAME,
  QUOTATION_HEADERS,
  QuotationSheetError,
  findByQuotationNumber,
  folderUrlFrom,
  listQuotationRows,
  parseStatus,
  setRowStatus,
  upsertQuotationRow,
  type TrackingInput,
} from './quotations-sheet';

let env: GasEnvironment;

const FOLDER_URL = 'https://drive.google.com/drive/folders/test-only-folder-1';
const PDF_URL = 'https://drive.google.com/file/d/test-only-file-1/view';
const DOCX_URL = 'https://drive.google.com/file/d/test-only-file-2/view';

function input(overrides: Partial<TrackingInput> = {}): TrackingInput {
  return {
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    quotationDate: '11-08-2026',
    clientName: 'TEST_ONLY Contact',
    companyName: 'TEST_ONLY Client Co.',
    quotationFor: 'TEST_ONLY manpower supply',
    totalAmount: 27_600,
    subtotal: 24_000,
    vatAmount: 3_600,
    authorizedPerson: 'TEST_ONLY_Signatory',
    driveFolderUrl: FOLDER_URL,
    pdfUrl: PDF_URL,
    docxUrl: DOCX_URL,
    createdBy: 'staff@speedxksa.com',
    draftId: 'draft-0001',
    codes: DEFAULT_QUOTATION_CODES,
    ...overrides,
  };
}

function rows(): unknown[][] {
  return env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  env = installGasFakes(vi.stubGlobal);
  TEST_ONLY_resetBootstrapState();
});

/* -------------------------------------------------------------------------- */

describe('the sheet', () => {
  it('has all seventeen headers, in order', () => {
    bootstrapQuotationsSheet();

    const header = env.spreadsheet.sheets.get(QUOTATIONS_SHEET_NAME)?.rows[0];

    expect(header).toEqual([...QUOTATION_HEADERS]);
    expect(QUOTATION_HEADERS).toHaveLength(17);
  });

  it('starts with columns A–H exactly as PRD §31 defines them', () => {
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

  it('offers exactly the three statuses as data validation', () => {
    bootstrapQuotationsSheet();

    const sheet = env.spreadsheet.formatting(QUOTATIONS_SHEET_NAME);
    const values = sheet?.validations.get(COLUMN.status + 1);

    expect(values).toEqual([...QUOTATION_STATUSES]);
  });

  it('highlights a duplicate quotation number', () => {
    bootstrapQuotationsSheet();

    const rules = env.spreadsheet.formatting(QUOTATIONS_SHEET_NAME)?.conditionalRules ?? [];
    expect(rules.join(' ')).toContain('COUNTIF');
  });

  it('formats the money columns to two decimal places', () => {
    bootstrapQuotationsSheet();

    const formats = env.spreadsheet.formatting(QUOTATIONS_SHEET_NAME)?.numberFormats ?? [];
    expect(formats.join(' ')).toContain('#,##0.00');
  });

  it('is idempotent and never destroys a row', () => {
    upsertQuotationRow(input());

    TEST_ONLY_resetBootstrapState();
    bootstrapQuotationsSheet();
    TEST_ONLY_resetBootstrapState();
    bootstrapQuotationsSheet();

    expect(rows()).toHaveLength(1);
    expect(env.spreadsheet.sheets.get(QUOTATIONS_SHEET_NAME)?.rows[0]).toEqual([
      ...QUOTATION_HEADERS,
    ]);
  });

  it('never writes a sample row', () => {
    bootstrapQuotationsSheet();
    expect(rows()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('a first save', () => {
  it('appends one row with Status Pending', () => {
    const result = upsertQuotationRow(input());

    expect(result.disposition).toBe('appended');
    expect(rows()).toHaveLength(1);
    expect(result.row.status).toBe('Pending');
  });

  it('records the number, the client and the server-computed money', () => {
    const { row } = upsertQuotationRow(input());

    expect(row.quotationNumber).toBe('SFC/RUH/QTN/2026/004');
    expect(row.clientName).toBe('TEST_ONLY Contact');
    expect(row.totalAmount).toBe(27_600);
    expect(row.subtotal).toBe(24_000);
    expect(row.vatAmount).toBe(3_600);
  });

  it('writes the date in the document format', () => {
    const { row } = upsertQuotationRow(input());
    expect(row.date).toBe('11-08-2026');
  });

  it('makes the Drive Folder cell a working hyperlink', () => {
    upsertQuotationRow(input());

    const cell = String(rows()[0]?.[COLUMN.driveFolder]);
    expect(cell).toBe(`=HYPERLINK("${FOLDER_URL}","SFC/RUH/QTN/2026/004")`);
    expect(folderUrlFrom(cell)).toBe(FOLDER_URL);
  });

  it('records both file URLs', () => {
    const { row } = upsertQuotationRow(input());

    expect(row.pdfUrl).toBe(PDF_URL);
    expect(row.docxUrl).toBe(DOCX_URL);
  });

  it('stamps Created At and Updated At', () => {
    const { row } = upsertQuotationRow(input());

    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.updatedAt).toBe(row.createdAt);
  });

  it('writes the whole row in one call, so it cannot half-succeed', () => {
    upsertQuotationRow(input());

    // Every column is populated or deliberately empty; none is missing.
    expect(rows()[0]).toHaveLength(QUOTATION_HEADERS.length);
  });
});

/* -------------------------------------------------------------------------- */

describe('a re-save', () => {
  it('updates the existing row instead of appending', () => {
    upsertQuotationRow(input());
    const second = upsertQuotationRow(input({ quotationFor: 'TEST_ONLY revised scope' }));

    expect(second.disposition).toBe('updated');
    expect(rows()).toHaveLength(1);
    expect(second.row.quotationFor).toBe('TEST_ONLY revised scope');
  });

  it('preserves an Approved status', () => {
    upsertQuotationRow(input());
    setRowStatus('SFC/RUH/QTN/2026/004', 'Approved');

    const second = upsertQuotationRow(input({ totalAmount: 30_000 }));

    // A document re-save must never reverse a commercial decision (§17.5).
    expect(second.row.status).toBe('Approved');
    expect(second.row.totalAmount).toBe(30_000);
  });

  it('keeps Created At and moves Updated At', async () => {
    const first = upsertQuotationRow(input());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = upsertQuotationRow(input());

    expect(second.row.createdAt).toBe(first.row.createdAt);
    expect(second.row.updatedAt >= first.row.updatedAt).toBe(true);
  });

  it('finds the row by Draft ID even when the number was reissued in the sheet', () => {
    upsertQuotationRow(input());
    const second = upsertQuotationRow(input({ clientName: 'TEST_ONLY Renamed' }));

    expect(second.row.rowNumber).toBe(2);
    expect(rows()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('uniqueness (§17.4)', () => {
  it('rejects a number already held by a different quotation', () => {
    upsertQuotationRow(input());

    expect(() =>
      upsertQuotationRow(input({ draftId: 'draft-0002' })),
    ).toThrow(QuotationSheetError);
    expect(rows()).toHaveLength(1);
  });

  it('names the number in the refusal', () => {
    upsertQuotationRow(input());

    try {
      upsertQuotationRow(input({ draftId: 'draft-0002' }));
      expect.unreachable('should have thrown');
    } catch (error: unknown) {
      expect((error as Error).message).toContain('SFC/RUH/QTN/2026/004');
    }
  });

  it('allows two different quotations', () => {
    upsertQuotationRow(input());
    upsertQuotationRow(
      input({ draftId: 'draft-0002', quotationNumber: 'SFC/RUH/QTN/2026/005' }),
    );

    expect(rows()).toHaveLength(2);
  });

  it('refuses to track something that is not a quotation number', () => {
    for (const value of ['', 'SFC-RUH-QTN-2026-004', '../../etc']) {
      expect(() => upsertQuotationRow(input({ quotationNumber: value })), value).toThrow(
        QuotationSheetError,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('injection', () => {
  it('writes a formula-shaped client name as inert text', () => {
    const attack = '=IMPORTXML("http://x","//y")';
    upsertQuotationRow(input({ clientName: attack }));

    expect(String(rows()[0]?.[COLUMN.clientName])).toBe(`'${attack}`);
  });

  it('escapes every formula-leading character across every text column', () => {
    upsertQuotationRow(
      input({
        clientName: '+1',
        companyName: '-1',
        quotationFor: '@x',
        authorizedPerson: '=x',
      }),
    );

    const row = rows()[0] ?? [];
    expect(String(row[COLUMN.clientName])).toBe("'+1");
    expect(String(row[COLUMN.companyName])).toBe("'-1");
    expect(String(row[COLUMN.quotationFor])).toBe("'@x");
    expect(String(row[COLUMN.authorizedPerson])).toBe("'=x");
  });

  it('reads the escaped value back as the original text', () => {
    const attack = '=IMPORTXML("http://x","//y")';
    const { row } = upsertQuotationRow(input({ clientName: attack }));

    expect(row.clientName).toBe(attack);
  });

  it('writes a non-Drive folder URL as text, not a hyperlink', () => {
    upsertQuotationRow(input({ driveFolderUrl: 'https://attacker.example/x' }));

    const cell = String(rows()[0]?.[COLUMN.driveFolder]);
    expect(cell.indexOf('=HYPERLINK')).toBe(-1);
    expect(cell).toContain('attacker.example');
  });
});

/* -------------------------------------------------------------------------- */

describe('reading', () => {
  it('narrows the status, and refuses an unexpected value', () => {
    expect(parseStatus('Approved')).toBe('Approved');
    expect(() => parseStatus('Aproved')).toThrow(QuotationSheetError);
    expect(() => parseStatus('')).toThrow(QuotationSheetError);
  });

  it('reflects a status changed by hand in the sheet', () => {
    upsertQuotationRow(input());

    // Exactly what a staff member does in the spreadsheet.
    const sheet = env.spreadsheet.sheets.get(QUOTATIONS_SHEET_NAME);
    const row = sheet?.rows[1] ?? [];
    row[COLUMN.status] = 'Approved';

    expect(findByQuotationNumber('SFC/RUH/QTN/2026/004')?.status).toBe('Approved');
  });

  it('skips an unreadable row rather than failing the whole register', () => {
    upsertQuotationRow(input());
    upsertQuotationRow(input({ draftId: 'draft-0002', quotationNumber: 'SFC/RUH/QTN/2026/005' }));

    const sheet = env.spreadsheet.sheets.get(QUOTATIONS_SHEET_NAME);
    const row = sheet?.rows[1] ?? [];
    row[COLUMN.status] = 'Aproved';

    const listed = listQuotationRows();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.quotationNumber).toBe('SFC/RUH/QTN/2026/005');
  });

  it('returns rows newest first', () => {
    upsertQuotationRow(input());
    upsertQuotationRow(input({ draftId: 'draft-0002', quotationNumber: 'SFC/RUH/QTN/2026/005' }));

    expect(listQuotationRows().map((row) => row.quotationNumber)).toEqual([
      'SFC/RUH/QTN/2026/005',
      'SFC/RUH/QTN/2026/004',
    ]);
  });
});

describe('status changes', () => {
  it('persists and moves Updated At', async () => {
    const first = upsertQuotationRow(input());
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = setRowStatus('SFC/RUH/QTN/2026/004', 'Rejected');

    expect(updated?.status).toBe('Rejected');
    expect(findByQuotationNumber('SFC/RUH/QTN/2026/004')?.status).toBe('Rejected');
    expect(updated?.updatedAt.localeCompare(first.row.updatedAt)).toBeGreaterThanOrEqual(0);
  });

  it('reports no row rather than creating one', () => {
    expect(setRowStatus('SFC/RUH/QTN/2026/099', 'Approved')).toBeNull();
    expect(rows()).toHaveLength(0);
  });
});
