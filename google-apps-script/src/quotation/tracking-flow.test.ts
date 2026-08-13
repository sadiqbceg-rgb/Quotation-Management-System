/**
 * The register, end to end through the router.
 *
 * Save → upload to Drive → tracking row → list → status change → retry. Every
 * call goes through `handlePost`, so the real authorization check, the real
 * envelope and the real error mapping are exercised each time.
 *
 * Drive and Sheets are both in-memory fakes. Nothing here can create a folder,
 * a file or a row anywhere real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_ONLY_documentBase64 } from '../__fixtures__/document-fixtures';
import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { AUDIT_SHEET_NAME } from '../audit/audit-log';
import { createPasswordRecord } from '../auth/password';
import { handlePost } from '../main';
import { createPerson, setSignatureFileId } from '../sheets/persons-sheet';
import { COLUMN, QUOTATIONS_SHEET_NAME } from '../sheets/quotations-sheet';
import { TEST_ONLY_resetBootstrapState } from '../sheets/sheet-bootstrap';
import { createUser } from '../sheets/users-repository';

const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

interface TrackingOutcomeJson {
  status: string;
  disposition?: string;
  message?: string;
  code?: string;
}

interface UploadData {
  outcome: string;
  quotationNumber: string;
  tracking: TrackingOutcomeJson;
}

interface SummaryJson {
  draftId: string;
  quotationNumber: string;
  quotationDate: string;
  clientName: string;
  grandTotal: number;
  status: string;
  driveFolderUrl: string;
  pdfUrl: string;
  docxUrl: string;
  tracked: boolean;
}

let env: GasEnvironment;
let token: string;
let signatoryId: string;

function postRaw(body: string): Envelope {
  const output = handlePost(body) as unknown as { getContent: () => string };
  return JSON.parse(output.getContent()) as Envelope;
}

function call(action: string, payload: unknown = {}): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload, token }));
}

function callAnonymous(action: string, payload: unknown = {}): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload }));
}

function validQuotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draftId: 'draft-0001',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY manpower supply',
    pricingMode: 'amount',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
    },
    lines: [
      {
        category: 'Manpower',
        description: 'TEST_ONLY General Labour',
        // 40 hours at SAR 20.00 → SAR 800.00.
        quantity: 40_000,
        unit: 'Hour',
        unitPrice: 2_000,
        remarks: '',
      },
    ],
    authorizedPerson: { id: signatoryId },
    vatRateBasisPoints: 1_500,
    ...overrides,
  };
}

function issue(overrides: Record<string, unknown> = {}): string {
  const response = call('quotation.save', {
    quotation: validQuotation(overrides),
    finalize: true,
  });
  return (response.data as { quotationNumber: string }).quotationNumber;
}

function documents(byteLength = 2_048): Record<string, string> {
  return {
    pdf: TEST_ONLY_documentBase64('pdf', byteLength),
    docx: TEST_ONLY_documentBase64('docx', byteLength),
  };
}

function upload(draftId = 'draft-0001'): UploadData {
  return call('quotation.uploadToDrive', { draftId, documents: documents() }).data as UploadData;
}

function registerRows(): unknown[][] {
  return env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME);
}

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
  TEST_ONLY_resetBootstrapState();

  const person = createPerson({
    id: 'TEST_ONLY-person-1',
    name: 'TEST_ONLY_Signatory',
    designation: 'TEST_ONLY Designation',
    companyName: 'TEST_ONLY Company',
    country: 'TEST_ONLY Country',
    email: 'test-only.signatory@example.invalid',
    phone: '+966 50 000 0000',
  });
  setSignatureFileId(person, 'TEST_ONLY-signature-file');
  signatoryId = person.id;

  const material = createPasswordRecord(PASSWORD, PEPPER, 1_000);
  createUser({
    email: 'staff@speedxksa.com',
    passwordHash: material.hash,
    salt: material.salt,
    iterations: material.iterations,
    role: 'User',
  });

  const login = callAnonymous('auth.login', {
    email: 'staff@speedxksa.com',
    password: PASSWORD,
  });
  token = (login.data as { token: string }).token;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

describe('a successful Drive save (PRD §30 step 13)', () => {
  it('writes the tracking row automatically', () => {
    const quotationNumber = issue();
    const data = upload();

    expect(data.tracking.status).toBe('recorded');
    expect(data.tracking.disposition).toBe('appended');

    expect(registerRows()).toHaveLength(1);
    expect(String(registerRows()[0]?.[COLUMN.quotationNumber])).toBe(quotationNumber);
  });

  it('records the number that is on the documents', () => {
    const quotationNumber = issue();
    const data = upload();

    // PRD §31: the number in the Sheet must exactly match the documents'.
    expect(data.quotationNumber).toBe(quotationNumber);
    expect(String(registerRows()[0]?.[COLUMN.quotationNumber])).toBe(quotationNumber);
  });

  it('computes the money server-side', () => {
    issue();
    upload();

    const row = registerRows()[0] ?? [];
    // SAR 800.00 + 15% VAT.
    expect(row[COLUMN.subtotal]).toBe(800);
    expect(row[COLUMN.vatAmount]).toBe(120);
    expect(row[COLUMN.totalAmount]).toBe(920);
  });

  it('links the Drive folder and records both file URLs', () => {
    issue();
    upload();

    const row = registerRows()[0] ?? [];
    expect(String(row[COLUMN.driveFolder])).toMatch(
      /^=HYPERLINK\("https:\/\/drive\.google\.com\//,
    );
    expect(String(row[COLUMN.pdfUrl])).toMatch(/^https:\/\/drive\.google\.com\//);
    expect(String(row[COLUMN.docxUrl])).toMatch(/^https:\/\/drive\.google\.com\//);
  });

  it('audits the write with the actor and the number', () => {
    const quotationNumber = issue();
    upload();

    const entry = env.spreadsheet
      .dataRows(AUDIT_SHEET_NAME)
      .find((row) => row[2] === 'quotation.tracking');

    expect(entry?.[1]).toBe('staff@speedxksa.com');
    expect(String(entry?.[3])).toContain(quotationNumber);
    expect(String(entry?.[3])).toContain('appended');
  });

  it('does not write a row when the upload was only partial', () => {
    issue();

    const data = call('quotation.uploadToDrive', {
      draftId: 'draft-0001',
      documents: { pdf: TEST_ONLY_documentBase64('pdf') },
    }).data as UploadData;

    // A row claiming a document that is not in the archive is worse than none.
    expect(data.outcome).toBe('partial');
    expect(data.tracking.status).toBe('skipped');
    expect(registerRows()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('a re-save', () => {
  it('updates the row rather than appending a second', () => {
    issue();
    upload();

    const second = upload();

    expect(second.tracking.disposition).toBe('updated');
    expect(registerRows()).toHaveLength(1);
  });

  it('preserves a status set in the sheet', () => {
    const quotationNumber = issue();
    upload();

    call('quotation.updateStatus', { quotationNumber, status: 'Approved' });
    upload();

    expect(String(registerRows()[0]?.[COLUMN.status])).toBe('Approved');
  });

  it('carries a corrected total through to the register', () => {
    issue();
    upload();

    call('quotation.save', {
      quotation: validQuotation({
        lines: [
          {
            category: 'Manpower',
            description: 'TEST_ONLY General Labour',
            quantity: 80_000,
            unit: 'Hour',
            unitPrice: 2_000,
            remarks: '',
          },
        ],
      }),
      finalize: true,
    });
    upload();

    expect(registerRows()[0]?.[COLUMN.subtotal]).toBe(1_600);
    expect(registerRows()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('the list (PRD §31)', () => {
  it('returns tracked quotations with their links and status', () => {
    const quotationNumber = issue();
    upload();

    const rows = call('quotation.list').data as SummaryJson[];
    const row = rows.find((entry) => entry.quotationNumber === quotationNumber);

    expect(row?.tracked).toBe(true);
    expect(row?.status).toBe('Pending');
    expect(row?.grandTotal).toBe(92_000);
    expect(row?.quotationDate).toBe('2026-08-11');
    expect(row?.driveFolderUrl).toMatch(/^https:\/\/drive\.google\.com\//);
  });

  it('reflects a status changed by hand in the sheet', () => {
    issue();
    upload();

    // Exactly what a staff member does in the spreadsheet.
    const sheet = env.spreadsheet.sheets.get(QUOTATIONS_SHEET_NAME);
    const row = sheet?.rows[1] ?? [];
    row[COLUMN.status] = 'Approved';

    const rows = call('quotation.list').data as SummaryJson[];
    expect(rows[0]?.status).toBe('Approved');
  });

  it('still lists a draft that has never reached the register', () => {
    call('quotation.save', {
      quotation: validQuotation({ draftId: 'draft-0002' }),
      finalize: false,
    });

    const rows = call('quotation.list').data as SummaryJson[];
    const draft = rows.find((entry) => entry.draftId === 'draft-0002');

    expect(draft).toBeDefined();
    expect(draft?.tracked).toBe(false);
    expect(draft?.quotationNumber).toBe('');
  });

  it('lists a tracked quotation exactly once', () => {
    const quotationNumber = issue();
    upload();

    const rows = call('quotation.list').data as SummaryJson[];
    expect(rows.filter((entry) => entry.quotationNumber === quotationNumber)).toHaveLength(1);
  });

  it('never returns a row index or the spreadsheet id', () => {
    issue();
    upload();

    const body = JSON.stringify(call('quotation.list').data);

    expect(body).not.toContain('rowNumber');
    expect(body).not.toContain('test-only-spreadsheet');
  });
});

/* -------------------------------------------------------------------------- */

describe('status changes', () => {
  it('persists to the register and is audited', () => {
    const quotationNumber = issue();
    upload();

    const response = call('quotation.updateStatus', { quotationNumber, status: 'Approved' });

    expect((response.data as { tracked: boolean }).tracked).toBe(true);
    expect(String(registerRows()[0]?.[COLUMN.status])).toBe('Approved');

    const entry = env.spreadsheet
      .dataRows(AUDIT_SHEET_NAME)
      .find((row) => row[2] === 'quotation.updateStatus');
    expect(String(entry?.[3])).toContain('Approved');
  });

  it('accepts only the three allowed values', () => {
    const quotationNumber = issue();
    upload();

    expect(
      call('quotation.updateStatus', { quotationNumber, status: 'Aproved' }).error?.code,
    ).toBe('VALIDATION_FAILED');
    expect(String(registerRows()[0]?.[COLUMN.status])).toBe('Pending');
  });

  it('is refused without a session', () => {
    const quotationNumber = issue();
    upload();

    expect(
      callAnonymous('quotation.updateStatus', { quotationNumber, status: 'Approved' }).error?.code,
    ).toBe('AUTH_REQUIRED');
  });
});

/* -------------------------------------------------------------------------- */

describe('retrying the register write (PRD §37)', () => {
  it('is refused without a session', () => {
    expect(callAnonymous('quotation.recordTracking', { draftId: 'draft-0001' }).error?.code).toBe(
      'AUTH_REQUIRED',
    );
  });

  it('refuses when the documents are not in Drive yet', () => {
    issue();

    const response = call('quotation.recordTracking', { draftId: 'draft-0001' });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(response.error?.message).toMatch(/not in google drive/i);
    expect(registerRows()).toHaveLength(0);
  });

  it('writes the row from the archive, without re-sending the documents', () => {
    const quotationNumber = issue();

    // The upload succeeded but the register write did not: clear the row the
    // way a failed Sheets write would have left things.
    upload();
    const sheet = env.spreadsheet.sheets.get(QUOTATIONS_SHEET_NAME);
    if (sheet !== undefined) sheet.rows = sheet.rows.slice(0, 1);

    const response = call('quotation.recordTracking', { draftId: 'draft-0001' });
    const data = response.data as { tracking: TrackingOutcomeJson; quotationNumber: string };

    expect(data.tracking.status).toBe('recorded');
    expect(data.quotationNumber).toBe(quotationNumber);
    expect(registerRows()).toHaveLength(1);
    expect(String(registerRows()[0]?.[COLUMN.driveFolder])).toContain('drive.google.com');
  });

  it('updates rather than duplicating when pressed twice', () => {
    issue();
    upload();

    call('quotation.recordTracking', { draftId: 'draft-0001' });
    const second = call('quotation.recordTracking', { draftId: 'draft-0001' });

    expect((second.data as { tracking: TrackingOutcomeJson }).tracking.disposition).toBe('updated');
    expect(registerRows()).toHaveLength(1);
  });

  it('refuses a draft with no quotation number', () => {
    call('quotation.save', {
      quotation: validQuotation({ draftId: 'draft-0002' }),
      finalize: false,
    });

    expect(call('quotation.recordTracking', { draftId: 'draft-0002' }).error?.code).toBe(
      'VALIDATION_FAILED',
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('security', () => {
  it('writes a formula-shaped client name as inert text', () => {
    const attack = '=IMPORTXML("http://x","//y")';

    call('quotation.save', {
      quotation: validQuotation({
        client: {
          clientName: attack,
          companyName: 'TEST_ONLY Client Co.',
          address: 'TEST_ONLY Address, Riyadh',
        },
      }),
      finalize: true,
    });
    upload();

    expect(String(registerRows()[0]?.[COLUMN.clientName])).toBe(`'${attack}`);
  });

  it('ignores a client-supplied total', () => {
    issue();

    call('quotation.uploadToDrive', {
      draftId: 'draft-0001',
      totalAmount: 999_999,
      documents: documents(),
    });

    // Recomputed from the stored lines, every time.
    expect(registerRows()[0]?.[COLUMN.totalAmount]).toBe(920);
  });

  it('never logs a base64 payload into the audit sheet', () => {
    issue();
    const payload = documents();
    call('quotation.uploadToDrive', { draftId: 'draft-0001', documents: payload });

    const audit = JSON.stringify(env.spreadsheet.sheets.get(AUDIT_SHEET_NAME)?.rows ?? []);
    expect(audit).not.toContain(payload['pdf']?.slice(0, 64) ?? 'unreachable');
  });
});
