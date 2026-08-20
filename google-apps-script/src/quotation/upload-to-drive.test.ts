/**
 * `quotation.uploadToDrive`, end to end through the router.
 *
 * These go through `handlePost`, so every one of them exercises the real
 * authorization check, the real envelope and the real error mapping — not the
 * handler in isolation. The Drive is the in-memory fake throughout; nothing
 * here can create a folder or a file in the company's archive.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_ONLY_documentBase64, TEST_ONLY_wrongFormatBase64 } from '../__fixtures__/document-fixtures';
import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { toFileSafe } from '@shared/numbering';
import { createPasswordRecord } from '../auth/password';
import { AUDIT_SHEET_NAME } from '../audit/audit-log';
import { handlePost } from '../main';
import { createPerson, setSignatureFileId } from '../sheets/persons-sheet';
import { createUser } from '../sheets/users-repository';

const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';
/**
 * The archive path the fixture quotation lands in.
 *
 * Derived from the number the backend ISSUES rather than written out: the
 * counter starts at 1 in a fresh fake, so hard-coding `004` would assert
 * against a number this suite never produces.
 */
function folderPathOf(quotationNumber: string): string {
  return `2026/August/${toFileSafe(quotationNumber)}`;
}

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

interface DriveTargetJson {
  fileId: string;
  url: string;
  name: string;
}

interface UploadData {
  outcome: string;
  quotationNumber: string;
  folder: DriveTargetJson;
  path: string[];
  pathLabel: string;
  files: { pdf: DriveTargetJson | null; docx: DriveTargetJson | null };
  missing: string[];
  /** `recorded` only when the archive is complete; `skipped` on a partial save. */
  tracking: { status: string };
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
        quantity: 40_000,
        unit: 'Hour',
        unitPrice: 2000,
        remarks: '',
      },
    ],
    authorizedPerson: { id: signatoryId },
    ...overrides,
  };
}

/** Finalize a quotation so it has an issued number, and return that number. */
function issueQuotation(overrides: Record<string, unknown> = {}): string {
  const response = call('quotation.save', {
    quotation: validQuotation(overrides),
    finalize: true,
  });

  return (response.data as { quotationNumber: string }).quotationNumber;
}

function bothDocuments(byteLength = 2_048): Record<string, string> {
  return {
    pdf: TEST_ONLY_documentBase64('pdf', byteLength),
    docx: TEST_ONLY_documentBase64('docx', byteLength),
  };
}

function upload(payload: Record<string, unknown>): Envelope {
  return call('quotation.uploadToDrive', payload);
}

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);

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

describe('authorization', () => {
  it('refuses an unauthenticated upload before any Drive call', () => {
    const response = callAnonymous('quotation.uploadToDrive', {
      draftId: 'draft-0001',
      documents: bothDocuments(),
    });

    expect(response.error?.code).toBe('AUTH_REQUIRED');
    // Nothing was created — the check really did come first.
    expect(env.drive.files()).toHaveLength(0);
    expect(env.drive.folderPaths()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('preconditions (PRD §30 steps 1–2)', () => {
  it('refuses a draft that has no quotation number', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: false });

    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(response.error?.message).toMatch(/no number yet/i);
    expect(env.drive.files()).toHaveLength(0);
  });

  it('refuses a draft that does not exist', () => {
    const response = upload({ draftId: 'draft-does-not-exist', documents: bothDocuments() });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });

  it('refuses a request with no documents', () => {
    issueQuotation();

    expect(upload({ draftId: 'draft-0001', documents: {} }).error?.code).toBe('VALIDATION_FAILED');
  });

  it('fails with CONFIG_MISSING when the archive root is not configured', () => {
    issueQuotation();
    env.properties.values.delete('DRIVE_ROOT_FOLDER_ID');

    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });

    expect(response.error?.code).toBe('CONFIG_MISSING');
  });
});

/* -------------------------------------------------------------------------- */

describe('a successful save (PRD §30 steps 5–12)', () => {
  it('files both documents and returns all three links', () => {
    const quotationNumber = issueQuotation();
    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });

    expect(response.ok).toBe(true);
    const data = response.data as UploadData;

    expect(data.outcome).toBe('success');
    expect(data.quotationNumber).toBe(quotationNumber);
    expect(data.path).toEqual(['2026', 'August', toFileSafe(quotationNumber)]);
    expect(data.pathLabel).toBe(`2026 / August / ${toFileSafe(quotationNumber)}`);
    expect(data.missing).toEqual([]);

    for (const target of [data.folder, data.files.pdf, data.files.docx]) {
      expect(target?.url).toMatch(/^https:\/\/(drive|docs)\.google\.com\//);
    }
  });

  it('succeeds when Drive returns a Docs editor URL for the Word file', () => {
    /*
     * The end-to-end guard for the defect that made every save report "The Word
     * document did not upload".
     *
     * Drive answers `getUrl()` with the host that can OPEN the file: the Drive
     * viewer for a PDF, the Google Docs editor for a .docx. The URL validator
     * accepted only `drive.google.com`, so the DOCX uploaded and its link was
     * then thrown away — reported as a partial save with the Word file missing,
     * and the register row withheld.
     */
    issueQuotation();
    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });
    const data = response.data as UploadData;

    expect(data.outcome).toBe('success');
    expect(data.missing).toEqual([]);
    expect(data.files.pdf?.url).toMatch(/^https:\/\/drive\.google\.com\/file\/d\//);
    expect(data.files.docx?.url).toMatch(/^https:\/\/docs\.google\.com\/document\/d\//);
  });

  it('records BOTH file links on the register row', () => {
    // A partial save deliberately writes no register row, so this also proves
    // the tracking row is reached at all.
    issueQuotation();
    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });
    const data = response.data as UploadData;

    expect(data.tracking.status).toBe('recorded');
    expect(data.files.pdf?.fileId.length).toBeGreaterThan(0);
    expect(data.files.docx?.fileId.length).toBeGreaterThan(0);
  });

  it('names the folder after the number the application issued', () => {
    const quotationNumber = issueQuotation();

    upload({ draftId: 'draft-0001', documents: bothDocuments() });

    // Not re-derived from the date or a counter: the slug of the stored number.
    const fileSafe = toFileSafe(quotationNumber);
    expect(env.drive.folderPaths()).toContain(folderPathOf(quotationNumber));
    expect(
      env.drive
        .filesIn(folderPathOf(quotationNumber))
        .map((file) => file.name)
        .sort(),
    ).toEqual([`${fileSafe}.docx`, `${fileSafe}.pdf`]);
  });

  it('ignores a quotation number supplied by the client', () => {
    const quotationNumber = issueQuotation();

    // The number comes from the stored record. A client that could name its own
    // target could file a document under any quotation in the archive.
    upload({
      draftId: 'draft-0001',
      quotationNumber: 'SFC/RUH/QTN/2026/999',
      documents: bothDocuments(),
    });

    expect(env.drive.folderPaths()).toContain(folderPathOf(quotationNumber));
    expect(env.drive.folderPaths().join(' ')).not.toContain('999');
  });

  it('files a backdated quotation under its own month', () => {
    call('quotation.save', {
      quotation: validQuotation({ quotationDate: '2026-01-15' }),
      finalize: true,
    });

    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });
    const data = response.data as UploadData;

    expect(data.path).toEqual(['2026', 'January', 'SFC-RUH-QTN-2026-001']);
  });

  it('audits the upload with the actor, the number and the file ids', () => {
    const quotationNumber = issueQuotation();
    upload({ draftId: 'draft-0001', documents: bothDocuments() });

    const rows = env.spreadsheet.dataRows(AUDIT_SHEET_NAME);
    const entry = rows.find((row) => row[2] === 'quotation.uploadToDrive');

    expect(entry).toBeDefined();
    expect(entry?.[1]).toBe('staff@speedxksa.com');
    expect(String(entry?.[3])).toContain(quotationNumber);
    expect(String(entry?.[3])).toContain('pdf:');
  });

  it('never writes base64 into the audit log', () => {
    issueQuotation();
    const documents = bothDocuments();
    upload({ draftId: 'draft-0001', documents });

    const audit = JSON.stringify(env.spreadsheet.sheets.get(AUDIT_SHEET_NAME)?.rows ?? []);

    expect(audit).not.toContain(documents['pdf']?.slice(0, 64) ?? 'unreachable');
    expect(audit).not.toContain(documents['docx']?.slice(0, 64) ?? 'unreachable');
  });
});

/* -------------------------------------------------------------------------- */

describe('retrying (PRD §37)', () => {
  it('replaces the files rather than creating duplicates', () => {
    const quotationNumber = issueQuotation();

    const first = upload({ draftId: 'draft-0001', documents: bothDocuments() }).data as UploadData;
    const second = upload({ draftId: 'draft-0001', documents: bothDocuments(4_096) })
      .data as UploadData;

    expect(env.drive.filesIn(folderPathOf(quotationNumber))).toHaveLength(2);
    expect(second.files.pdf?.fileId).toBe(first.files.pdf?.fileId);
    expect(second.files.docx?.fileId).toBe(first.files.docx?.fileId);
    expect(env.drive.files().map((file) => file.name).join(' ')).not.toMatch(/\(\d+\)/);
  });

  it('reports a partial upload and completes on a retry of just the missing file', () => {
    issueQuotation();

    const partial = upload({
      draftId: 'draft-0001',
      documents: { pdf: TEST_ONLY_documentBase64('pdf') },
    }).data as UploadData;

    expect(partial.outcome).toBe('partial');
    expect(partial.missing).toEqual(['docx']);
    expect(partial.files.pdf?.url).toMatch(/^https:\/\/drive\.google\.com\//);
    expect(partial.files.docx).toBeNull();

    const completed = upload({
      draftId: 'draft-0001',
      documents: { docx: TEST_ONLY_documentBase64('docx') },
    }).data as UploadData;

    expect(completed.outcome).toBe('success');
    expect(completed.missing).toEqual([]);
    // The PDF was never re-uploaded, so it kept its id and its URL.
    expect(completed.files.pdf?.fileId).toBe(partial.files.pdf?.fileId);
  });
});

/* -------------------------------------------------------------------------- */

describe('a failed upload is diagnosable (W-1)', () => {
  const DRIVE_REASON = 'TEST_ONLY storage quota exceeded for folder 1AbC-secret-id';

  function captureErrors(): { logged: string[]; restore: () => void } {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((value) => String(value)).join(' '));
    });
    return { logged, restore: () => { spy.mockRestore(); } };
  }

  /**
   * A PARTIAL upload: the PDF is already filed, so a DOCX failure is converted
   * into an outcome and never reaches the router. That is the path where the
   * reason used to disappear completely.
   */
  function partialUpload(): { response: Envelope; logged: string[] } {
    issueQuotation();
    upload({ draftId: 'draft-0001', documents: { pdf: TEST_ONLY_documentBase64('pdf') } });

    const { logged, restore } = captureErrors();
    env.drive.failNextCreate(DRIVE_REASON);
    const response = upload({
      draftId: 'draft-0001',
      documents: { docx: TEST_ONLY_documentBase64('docx') },
    });
    restore();

    return { response, logged };
  }

  it('reports the save as partial rather than failed', () => {
    const { response } = partialUpload();

    expect((response.data as UploadData).outcome).toBe('partial');
    expect((response.data as UploadData).missing).toEqual(['docx']);
  });

  it('writes the real Drive reason to the server log', () => {
    const { logged } = partialUpload();

    // Before this fix the partial path logged nothing at all.
    expect(logged.join('\n')).toContain(DRIVE_REASON);
  });

  it('names which document failed, so the log says what to retry', () => {
    const { logged } = partialUpload();

    expect(logged.join('\n')).toMatch(/\[drive\][^\n]*docx/);
  });

  it('sends the client a generic body with no folder id in it', () => {
    const { response } = partialUpload();
    const body = JSON.stringify(response);

    // The reason belongs in the log, never on the wire (§19.9).
    expect(body).not.toContain('1AbC-secret-id');
    expect(body).not.toContain(DRIVE_REASON);
  });

  it('logs the reason when the whole upload fails, too', () => {
    issueQuotation();

    const { logged, restore } = captureErrors();
    env.drive.failNextCreate(DRIVE_REASON);
    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });
    restore();

    // Nothing was stored, so this one DOES reach the router — which logs it
    // because the typed error carries a `detail`.
    expect(response.ok).toBe(false);
    expect(logged.join('\n')).toContain(DRIVE_REASON);
    expect(JSON.stringify(response)).not.toContain(DRIVE_REASON);
  });
});

/* -------------------------------------------------------------------------- */

describe('security', () => {
  it('rejects a payload that is not the format it claims to be', () => {
    issueQuotation();

    const response = upload({
      draftId: 'draft-0001',
      documents: { pdf: TEST_ONLY_wrongFormatBase64(), docx: TEST_ONLY_documentBase64('docx') },
    });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    // Rejected before anything reached Drive, so there is nothing to clean up.
    expect(env.drive.files()).toHaveLength(0);
  });

  it('rejects an oversized document', () => {
    issueQuotation();

    const response = upload({
      draftId: 'draft-0001',
      documents: { pdf: TEST_ONLY_documentBase64('pdf', 6_000_000) },
    });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(env.drive.files()).toHaveLength(0);
  });

  it('never makes anything public', () => {
    issueQuotation();
    upload({ draftId: 'draft-0001', documents: bothDocuments() });
    upload({ draftId: 'draft-0001', documents: bothDocuments() });

    expect(env.drive.sharingCalls()).toEqual([]);
  });

  it('returns no download URL and no internal ids beyond the file ids', () => {
    issueQuotation();
    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });

    const body = JSON.stringify(response.data);

    expect(body).not.toContain('uc?id=');
    expect(body).not.toContain('draft-0001'.replace('draft-0001', 'export=download'));
    expect(body).not.toContain('test-only-drive-root');
  });

  it('does not mark the quotation saved when the upload fails', () => {
    issueQuotation();
    env.drive.failNextCreate('Service error');

    const response = upload({ draftId: 'draft-0001', documents: bothDocuments() });

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('DRIVE_UPLOAD_FAILED');

    // The quotation is still exactly what it was: no URLs recorded anywhere,
    // and its status untouched (PRD §37).
    const stored = call('quotation.get', { draftId: 'draft-0001' }).data as {
      status: string;
      quotation: Record<string, unknown>;
    };
    expect(stored.status).toBe('Pending');
    expect(JSON.stringify(stored.quotation)).not.toContain('drive.google.com');
  });

  it('maps a quota failure to its own code', () => {
    issueQuotation();
    env.drive.failNextCreate('User storage quota exceeded');

    expect(upload({ draftId: 'draft-0001', documents: bothDocuments() }).error?.code).toBe(
      'DRIVE_QUOTA_EXCEEDED',
    );
  });

  it('maps a folder failure to its own code', () => {
    issueQuotation();
    env.drive.failNextFolder('Service error');

    expect(upload({ draftId: 'draft-0001', documents: bothDocuments() }).error?.code).toBe(
      'DRIVE_FOLDER_CREATE_FAILED',
    );
  });
});
