/**
 * Every error code in IMPLEMENTATION_PLAN.md §23.1, produced by a REAL path.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CENSUS AT THE BOTTOM MATTERS MORE THAN THE TESTS ABOVE IT
 * ---------------------------------------------------------------------------
 * A taxonomy is easy to write and easy to let rot. A code nobody can produce is
 * either dead — in which case the frontend carries a user message for a failure
 * that cannot happen — or it is reachable by a path nobody has exercised, which
 * is worse. So each code below is produced by driving the system into the state
 * that causes it, never by constructing an `ApiError` in the test, and the last
 * describe block fails if any code in the union has no test.
 *
 * The two codes deliberately absent are noted at the census, with reasons.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../src/__fixtures__/gas-fakes';
import { TEST_ONLY_documentBase64 } from '../src/__fixtures__/document-fixtures';
import { handlePost } from '../src/main';
import { ApiError, type ErrorCode } from '../src/errors';
import { createPasswordRecord, MIN_PBKDF2_ITERATIONS } from '../src/auth/password';
import { createUser } from '../src/sheets/users-repository';
import { createPerson, setSignatureFileId } from '../src/sheets/persons-sheet';
import { reserveQuotationNumber } from '../src/quotation-number/reserve';
import { recordReservation } from '../src/sheets/idempotency-sheet';
import { writeLastSequence } from '../src/sheets/counters-sheet';
import { storeQuotationDocuments } from '../src/drive/quotation-storage';
import { validateDocumentUpload } from '../src/validation/document-validator';
import { recordQuotationTracking } from '../src/quotation/tracking';
import { DEFAULT_QUOTATION_CODES } from '@shared/numbering';
import { GLOBAL_LIMIT_PER_MINUTE } from '../src/security/rate-limiter';

const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';
const QUOTATION_DATE = '2026-08-11';

/**
 * PBKDF2 iterations for the fixtures here: the lowest the module will accept.
 *
 * `hashPassword` refuses anything below `MIN_PBKDF2_ITERATIONS`, and that floor
 * is a real control — a deployment that tuned the cost down to nothing would be
 * storing passwords that are barely hashed. So the tests take the floor rather
 * than a convenient literal, and it is imported rather than copied so lowering
 * it in production cannot silently lower it here.
 *
 * Production tunes `DEFAULT_PBKDF2_ITERATIONS` far higher (SECURITY.md); the
 * count itself is covered by `auth/password.test.ts`.
 */
const TEST_ITERATIONS = MIN_PBKDF2_ITERATIONS;

/**
 * The password material, derived ONCE.
 *
 * Every test reinstalls the fakes and therefore re-seeds the user, and PBKDF2
 * at the module's minimum cost is genuinely expensive — deriving it per test
 * doubled the work for a value that never changes. The salt is part of the
 * material, so reusing it reuses the same account entirely; the sign-in that
 * follows still runs a real verification hash, which is the half that is
 * actually under test here.
 */
let material: ReturnType<typeof createPasswordRecord> | null = null;

function passwordMaterial(): ReturnType<typeof createPasswordRecord> {
  material ??= createPasswordRecord(PASSWORD, PEPPER, TEST_ITERATIONS);
  return material;
}

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

let env: GasEnvironment;
let token: string;
let signatoryId: string;

/** Codes this file has proved reachable. Checked against the union at the end. */
const proved = new Set<ErrorCode>();

function prove(code: ErrorCode, actual: string | undefined): void {
  expect(actual).toBe(code);
  proved.add(code);
}

function postRaw(body: string): Envelope {
  const output = handlePost(body) as unknown as { getContent: () => string };
  return JSON.parse(output.getContent()) as Envelope;
}

function call(action: string, payload: unknown = {}): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload, token }));
}

function callWith(tokenValue: string | undefined, action: string, payload: unknown = {}): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload, token: tokenValue }));
}

let draftCounter = 0;

function validQuotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  draftCounter += 1;
  return {
    draftId: `TEST_ONLY_draft-${String(draftCounter)}`,
    quotationDate: QUOTATION_DATE,
    quotationFor: 'TEST_ONLY manpower supply',
    pricingMode: 'amount',
    status: 'Pending',
    closingParagraph: 'TEST_ONLY closing paragraph.',
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

function seedUser(role: 'Admin' | 'User', email: string): void {
  const seeded = passwordMaterial();
  createUser({
    email,
    passwordHash: seeded.hash,
    salt: seeded.salt,
    iterations: seeded.iterations,
    role,
  });
}

function signIn(email: string): string {
  const response = callWith(undefined, 'auth.login', { email, password: PASSWORD });
  return (response.data as { token: string }).token;
}

function documents(kinds: Array<'pdf' | 'docx'> = ['pdf', 'docx']) {
  const result: Partial<Record<'pdf' | 'docx', ReturnType<typeof validateDocumentUpload>>> = {};
  for (const kind of kinds)
    result[kind] = validateDocumentUpload(kind, TEST_ONLY_documentBase64(kind));
  return result;
}

beforeEach(() => {
  draftCounter = 0;
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

  seedUser('User', 'staff@speedxksa.com');
  token = signIn('staff@speedxksa.com');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Authentication and authorisation                                            */
/* -------------------------------------------------------------------------- */

describe('AUTH_REQUIRED', () => {
  it('is what a protected action answers with no token at all', () => {
    const response = callWith(undefined, 'quotation.list', {});
    prove('AUTH_REQUIRED', response.error?.code);
  });
});

describe('AUTH_INVALID', () => {
  it('is what a forged token gets', () => {
    const forged = `${token.split('.').slice(0, 2).join('.')}.dGFtcGVyZWQ`;
    const response = callWith(forged, 'quotation.list', {});
    prove('AUTH_INVALID', response.error?.code);
  });

  it('is also the answer to a wrong password — the same code, the same wording', () => {
    const response = callWith(undefined, 'auth.login', {
      email: 'staff@speedxksa.com',
      password: 'TEST_ONLY_wrong-password-entirely',
    });
    prove('AUTH_INVALID', response.error?.code);
  });
});

describe('AUTH_EXPIRED', () => {
  it('is what a token past its expiry gets', () => {
    // Eight hours and a minute later (§18.3): the signature is still valid, so
    // this cannot be reached by tampering — only by waiting.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 8 * 60 * 60 * 1000 + 60_000));
    try {
      const response = call('quotation.list', {});
      prove('AUTH_EXPIRED', response.error?.code);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FORBIDDEN', () => {
  it('is what a User gets for an Admin action', () => {
    const response = call('admin.createUser', {
      email: 'someone-else@speedxksa.com',
      password: PASSWORD,
      role: 'User',
    });
    prove('FORBIDDEN', response.error?.code);
  });
});

describe('RATE_LIMITED', () => {
  it('is what the sixth failed sign-in for one email gets', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      callWith(undefined, 'auth.login', {
        email: 'staff@speedxksa.com',
        password: 'TEST_ONLY_wrong-password',
      });
    }

    const response = callWith(undefined, 'auth.login', {
      email: 'staff@speedxksa.com',
      password: PASSWORD,
    });
    prove('RATE_LIMITED', response.error?.code);
  });

  it('is also what the global circuit breaker answers with', () => {
    for (let request = 0; request < GLOBAL_LIMIT_PER_MINUTE; request++) {
      call('quotation.list', {});
    }
    const response = call('quotation.list', {});
    prove('RATE_LIMITED', response.error?.code);
  });
});

/* -------------------------------------------------------------------------- */
/* Validation and totals                                                       */
/* -------------------------------------------------------------------------- */

describe('VALIDATION_FAILED', () => {
  it('is what an incomplete quotation gets on finalize', () => {
    const response = call('quotation.save', {
      quotation: validQuotation({ quotationFor: '' }),
      finalize: true,
    });
    prove('VALIDATION_FAILED', response.error?.code);
  });
});

describe('TOTALS_MISMATCH', () => {
  it('is what a payload whose totals disagree with the server gets', () => {
    const response = call('quotation.save', {
      quotation: validQuotation({
        totals: {
          categorySubtotals: { Manpower: 1 },
          subtotal: 1,
          discountAmount: 0,
          vatAmount: 0,
          grandTotal: 1,
          discountRateBasisPoints: 0,
          vatRateBasisPoints: 1_500,
        },
      }),
      finalize: true,
    });
    prove('TOTALS_MISMATCH', response.error?.code);
  });
});

/* -------------------------------------------------------------------------- */
/* Numbering                                                                   */
/* -------------------------------------------------------------------------- */

describe('QUOTATION_NUMBER_IMMUTABLE', () => {
  it('is what an attempt to change an issued number gets', () => {
    const quotation = validQuotation();
    const issued = call('quotation.save', { quotation, finalize: true });
    expect(issued.ok, JSON.stringify(issued.error)).toBe(true);

    const response = call('quotation.save', {
      quotation: { ...quotation, quotationNumber: 'SFC/RUH/QTN/2026/999' },
      finalize: true,
    });
    prove('QUOTATION_NUMBER_IMMUTABLE', response.error?.code);
  });
});

describe('DUPLICATE_QUOTATION_NUMBER', () => {
  it('is what a counter that disagrees with the ledger gets', () => {
    // The state a hand-edited counter row produces: the ledger already holds
    // the number the counter is about to hand out again.
    recordReservation('TEST_ONLY_some-other-draft', 'SFC/RUH/QTN/2026/001');
    writeLastSequence(2026, 0);

    let thrown: unknown = null;
    try {
      reserveQuotationNumber({ draftId: 'TEST_ONLY_draft-x', quotationDate: QUOTATION_DATE });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    prove('DUPLICATE_QUOTATION_NUMBER', (thrown as ApiError).code);
  });
});

describe('NUMBERING_LOCKED', () => {
  it('is what a request that cannot get the lock in 30 s gets', () => {
    let thrown: unknown = null;
    try {
      reserveQuotationNumber(
        { draftId: 'TEST_ONLY_draft-locked', quotationDate: QUOTATION_DATE },
        { lock: { tryLock: () => false, releaseLock: () => undefined } },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    prove('NUMBERING_LOCKED', (thrown as ApiError).code);
  });
});

/* -------------------------------------------------------------------------- */
/* Drive                                                                       */
/* -------------------------------------------------------------------------- */

function storeAfterDriveFailure(message: string): unknown {
  env.drive.failNextCreate(message);
  try {
    storeQuotationDocuments({
      quotationNumber: 'SFC/RUH/QTN/2026/001',
      quotationDate: QUOTATION_DATE,
      codes: DEFAULT_QUOTATION_CODES,
      documents: documents(['pdf']),
    });
  } catch (error) {
    return error;
  }
  return null;
}

describe('DRIVE_AUTH_FAILED', () => {
  it('is what Drive refusing on permissions gets classified as', () => {
    const thrown = storeAfterDriveFailure('You do not have access to this folder.');
    expect(thrown).toBeInstanceOf(ApiError);
    prove('DRIVE_AUTH_FAILED', (thrown as ApiError).code);
  });
});

describe('DRIVE_QUOTA_EXCEEDED', () => {
  it('is what a full Drive gets classified as', () => {
    const thrown = storeAfterDriveFailure('The user has exceeded their Drive storage quota.');
    expect(thrown).toBeInstanceOf(ApiError);
    prove('DRIVE_QUOTA_EXCEEDED', (thrown as ApiError).code);
  });
});

describe('DRIVE_FOLDER_CREATE_FAILED', () => {
  it('is what a folder that cannot be created gets', () => {
    env.drive.failNextFolder('Drive is unavailable right now.');

    let thrown: unknown = null;
    try {
      storeQuotationDocuments({
        quotationNumber: 'SFC/RUH/QTN/2026/001',
        quotationDate: QUOTATION_DATE,
        codes: DEFAULT_QUOTATION_CODES,
        documents: documents(['pdf']),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    prove('DRIVE_FOLDER_CREATE_FAILED', (thrown as ApiError).code);
  });
});

describe('DRIVE_UPLOAD_FAILED', () => {
  it('is what an upload failure with no identifiable cause gets', () => {
    const thrown = storeAfterDriveFailure('An unexpected error occurred.');
    expect(thrown).toBeInstanceOf(ApiError);
    prove('DRIVE_UPLOAD_FAILED', (thrown as ApiError).code);
  });
});

describe('the partial upload the client turns into DRIVE_PARTIAL', () => {
  /*
   * DRIVE_PARTIAL is raised in the BROWSER, not here, and deliberately so.
   *
   * A half-filed quotation is not a failed request: the folder exists, the PDF
   * is in it, and its link is real and worth showing. So the backend answers
   * `ok` with `outcome: 'partial'` and the list of what is still missing, and
   * `useSaveToDrive` turns that into an `AppError('DRIVE_PARTIAL')` for the UI.
   * Reporting it as a transport-level error here would throw away the links.
   *
   * This test covers the backend half — the shape the client depends on. The
   * frontend half is proved in `src/__tests__/integration/error-recovery.test.tsx`.
   */
  it('reports the PDF as filed and the DOCX as missing, without failing the request', () => {
    const quotation = validQuotation();
    const saved = call('quotation.save', { quotation, finalize: true });
    expect(saved.ok, JSON.stringify(saved.error)).toBe(true);
    const number = (saved.data as { quotationNumber: string }).quotationNumber;

    // The PDF is filed first, on its own, so it is already in the folder.
    call('quotation.uploadToDrive', {
      draftId: quotation['draftId'],
      quotationNumber: number,
      quotationDate: QUOTATION_DATE,
      documents: { pdf: TEST_ONLY_documentBase64('pdf') },
    });

    // Now both are sent. The PDF is REPLACED in place (no create), so the next
    // create is the DOCX — and that is the one that fails.
    env.drive.failNextCreate('An unexpected error occurred.');
    const response = call('quotation.uploadToDrive', {
      draftId: quotation['draftId'],
      quotationNumber: number,
      quotationDate: QUOTATION_DATE,
      documents: {
        pdf: TEST_ONLY_documentBase64('pdf'),
        docx: TEST_ONLY_documentBase64('docx'),
      },
    });

    expect(response.ok).toBe(true);
    const data = response.data as {
      outcome: string;
      missing: string[];
      files: { pdf: { url: string } | null; docx: { url: string } | null };
      tracking: { status: string };
    };
    expect(data.outcome).toBe('partial');
    expect(data.missing).toEqual(['docx']);

    // The PDF's link is real and still handed back — that is why a partial
    // upload is not reported as a failed request.
    expect(data.files.pdf?.url ?? '').toMatch(/^https:\/\/drive\.google\.com\//);
    expect(data.files.docx).toBeNull();

    // And the register is deliberately NOT written: a row claiming a document
    // that is not in the archive is worse than no row at all (§23.2).
    expect(data.tracking.status).toBe('skipped');

    // The PDF is still there: a DOCX failure does not undo it.
    const fileSafe = number.split('/').join('-');
    expect(env.drive.filesIn(`2026/August/${fileSafe}`).map((file) => file.name)).toEqual([
      `${fileSafe}.pdf`,
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Sheets                                                                      */
/* -------------------------------------------------------------------------- */

describe('SHEETS_WRITE_FAILED', () => {
  it('is what a register that cannot be locked gets', () => {
    let thrown: unknown = null;
    try {
      recordQuotationTracking(
        {
          quotationNumber: 'SFC/RUH/QTN/2026/001',
          quotationDate: QUOTATION_DATE,
          clientName: 'TEST_ONLY Contact',
          companyName: 'TEST_ONLY Client Co.',
          quotationFor: 'TEST_ONLY manpower supply',
          authorizedPerson: 'TEST_ONLY_Signatory',
          money: { subtotal: 800, vatAmount: 120, grandTotal: 920 },
          driveFolderUrl: 'https://drive.google.com/drive/folders/folder-000000-1',
          pdfUrl: 'https://drive.google.com/file/d/file-000000-1/view',
          docxUrl: 'https://drive.google.com/file/d/file-000000-2/view',
          createdBy: 'staff@speedxksa.com',
          draftId: 'TEST_ONLY_draft-1',
          codes: DEFAULT_QUOTATION_CODES,
        },
        { lock: { tryLock: () => false, releaseLock: () => undefined } },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    prove('SHEETS_WRITE_FAILED', (thrown as ApiError).code);
  });
});

/* -------------------------------------------------------------------------- */
/* Infrastructure                                                              */
/* -------------------------------------------------------------------------- */

describe('CONFIG_MISSING', () => {
  it('is what an unconfigured deployment answers with', () => {
    env.properties.values.delete('TRACKING_SPREADSHEET_ID');

    const response = call('quotation.list', {});
    prove('CONFIG_MISSING', response.error?.code);
  });

  it('does not name the property in an ordinary action, only in health', () => {
    env.properties.values.delete('TRACKING_SPREADSHEET_ID');

    const ordinary = call('quotation.list', {});
    expect(ordinary.error?.message ?? '').not.toContain('TRACKING_SPREADSHEET_ID');

    // `health` is the diagnostic channel, and naming the missing key by name —
    // never its value — is the whole point of it (§19.7, SECURITY.md).
    const health = callWith(undefined, 'health', {});
    expect(JSON.stringify(health.data)).toContain('TRACKING_SPREADSHEET_ID');
  });
});

describe('INTERNAL_ERROR', () => {
  it('is what an unexpected exception becomes, with nothing internal leaking', () => {
    // A host failure nothing in the code anticipates: the spreadsheet itself
    // throws. The router must not forward the message.
    vi.stubGlobal('SpreadsheetApp', {
      openById: () => {
        throw new Error('TEST_ONLY internal detail: sheet id 1a2b3c, user root@internal');
      },
      flush: () => undefined,
    });

    const response = call('quotation.list', {});
    prove('INTERNAL_ERROR', response.error?.code);

    const message = response.error?.message ?? '';
    expect(message).not.toContain('1a2b3c');
    expect(message).not.toContain('root@internal');
    expect(message).not.toContain('TEST_ONLY internal detail');
  });
});

/* -------------------------------------------------------------------------- */
/* The census                                                                  */
/* -------------------------------------------------------------------------- */

describe('the taxonomy', () => {
  /**
   * Every code in §23.1. Kept as a literal list rather than derived from the
   * type: a union cannot be enumerated at runtime, and a list that has to be
   * edited by hand is the point — adding a code without a test fails here.
   */
  const ALL_CODES: ErrorCode[] = [
    'AUTH_REQUIRED',
    'AUTH_INVALID',
    'AUTH_EXPIRED',
    'FORBIDDEN',
    'RATE_LIMITED',
    'VALIDATION_FAILED',
    'TOTALS_MISMATCH',
    'QUOTATION_NUMBER_IMMUTABLE',
    'DUPLICATE_QUOTATION_NUMBER',
    'NUMBERING_LOCKED',
    'DRIVE_AUTH_FAILED',
    'DRIVE_QUOTA_EXCEEDED',
    'DRIVE_FOLDER_CREATE_FAILED',
    'DRIVE_UPLOAD_FAILED',
    'DRIVE_PARTIAL',
    'SHEETS_WRITE_FAILED',
    'CONFIG_MISSING',
    'INTERNAL_ERROR',
  ];

  /**
   * Codes the BACKEND never emits, with where they are raised instead.
   *
   * Being explicit is the point: without this list, "the backend cannot produce
   * DRIVE_PARTIAL" would be indistinguishable from "nobody wrote the test".
   */
  const RAISED_IN_THE_BROWSER: Record<string, string> = {
    DRIVE_PARTIAL:
      "useSaveToDrive, from the backend's ok/outcome:partial response — see " +
      'src/__tests__/integration/error-recovery.test.tsx',
  };

  it('has a real path to every code it declares', () => {
    const unproved = ALL_CODES.filter(
      (code) => !proved.has(code) && RAISED_IN_THE_BROWSER[code] === undefined,
    );

    expect(
      unproved,
      'Each of these is declared in §23.1 and carries a user-facing message, ' +
        'but nothing in this file could make the system produce it.',
    ).toEqual([]);
  });

  it('accounts for every code it does not raise itself', () => {
    for (const code of Object.keys(RAISED_IN_THE_BROWSER)) {
      expect(ALL_CODES, `${code} is not in the taxonomy`).toContain(code);
      expect(proved.has(code as ErrorCode), `${code} is raised by the backend after all`).toBe(
        false,
      );
    }
  });

  it('produces no code that is not in the taxonomy', () => {
    const stray = [...proved].filter((code) => !ALL_CODES.includes(code));
    expect(stray).toEqual([]);
  });
});
