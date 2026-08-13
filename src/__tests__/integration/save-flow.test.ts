/**
 * The save flow, browser to backend, over a faked network only.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS COVERS THAT NOTHING ELSE DOES
 * ---------------------------------------------------------------------------
 * `useSaveToDrive.test.tsx` stubs `fetch` with hand-written bodies; the Apps
 * Script suites call `handlePost` directly. Both pass while disagreeing about
 * the envelope between them — a renamed field, an unmapped code, a payload key
 * off by a letter. Here the real frontend services call the real backend router
 * through `test/fakes/backend.ts`, so the contract is exercised rather than
 * assumed.
 *
 * Only the network is faked. No Google service is reached, and nothing leaves
 * the machine (PRD §34).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeBackend, type FakeBackend } from '../../../test/fakes/backend';
import { AppError } from '@/services/api/errors';
import { login, fetchCurrentUser, logout } from '@/services/auth/auth-service';
import {
  saveQuotation,
  listQuotations,
  getQuotationByDraftId,
  type QuotationPayload,
} from '@/services/quotation/quotation-service';
import { saveToDrive, encodeDocument } from '@/services/google-drive/drive-service';
import { setQuotationStatus, retryTracking } from '@/services/google-sheets/sheets-service';
import { QUOTATIONS_SHEET_NAME } from '../../../google-apps-script/src/sheets/quotations-sheet';
import { TEST_ONLY_documentBytes } from '../../../google-apps-script/src/__fixtures__/document-fixtures';
import { TEST_ONLY_PASSWORD } from '../../../test/fakes/backend';

const EMAIL = 'staff@speedxksa.com';
const QUOTATION_DATE = '2026-08-11';

let backend: FakeBackend;
let token: string;
let signatoryId: string;

beforeEach(() => {
  backend = createFakeBackend(vi.stubGlobal);
  signatoryId = backend.seedSignatory();
  token = backend.signIn(EMAIL);
});

afterEach(() => {
  backend.teardown();
  vi.unstubAllGlobals();
});

let draftCounter = 0;

function quotation(overrides: Partial<QuotationPayload> = {}): QuotationPayload {
  draftCounter += 1;
  return {
    draftId: `TEST_ONLY_draft-${String(draftCounter)}`,
    quotationDate: QUOTATION_DATE,
    quotationFor: 'TEST_ONLY manpower supply',
    pricingMode: 'amount',
    status: 'Pending',
    scopeOfWork: 'TEST_ONLY scope paragraph.',
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
  } as QuotationPayload;
}

function documents() {
  return {
    pdf: encodeDocument(Uint8Array.from(TEST_ONLY_documentBytes('pdf'))),
    docx: encodeDocument(Uint8Array.from(TEST_ONLY_documentBytes('docx'))),
  };
}

beforeEach(() => {
  draftCounter = 0;
});

/* -------------------------------------------------------------------------- */
/* Sign in                                                                     */
/* -------------------------------------------------------------------------- */

describe('signing in', () => {
  it('returns a token and the user the backend actually holds', async () => {
    const result = await login(EMAIL, TEST_ONLY_PASSWORD);

    expect(result.token.split('.')).toHaveLength(3);
    expect(result.user.email).toBe(EMAIL);
    expect(result.user.role).toBe('User');
  });

  it('never returns password material of any kind', async () => {
    const result = await login(EMAIL, TEST_ONLY_PASSWORD);
    const serialised = JSON.stringify(result);

    expect(serialised).not.toContain(TEST_ONLY_PASSWORD);
    expect(serialised.toLowerCase()).not.toContain('passwordhash');
    expect(serialised.toLowerCase()).not.toContain('salt');
  });

  it('throws a typed AUTH_INVALID for a wrong password, not a bare Error', async () => {
    // The code, not the message: messages change, and the UI switches on code.
    await expect(login(EMAIL, 'TEST_ONLY_wrong-password')).rejects.toMatchObject({
      name: 'AppError',
      code: 'AUTH_INVALID',
    });
  });

  it('gives an unknown account exactly the same code as a wrong password', async () => {
    const unknown = await login('nobody@speedxksa.com', TEST_ONLY_PASSWORD).catch(
      (error: unknown) => error,
    );
    const wrong = await login(EMAIL, 'TEST_ONLY_wrong-password').catch((error: unknown) => error);

    expect(unknown).toBeInstanceOf(AppError);
    expect(wrong).toBeInstanceOf(AppError);
    expect((unknown as AppError).code).toBe((wrong as AppError).code);
  });

  it('resolves the signed-in user from the token alone', async () => {
    const user = await fetchCurrentUser(token);
    expect(user.email).toBe(EMAIL);
  });

  it('makes the token useless once it is revoked', async () => {
    await logout(token);

    const error = await listQuotations(token).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(AppError);

    // A revoked token is "no session", not "a bad session" — and all three auth
    // codes drive the same client recovery (`SessionHooks.onAuthFailure`), so
    // what matters is that it is one of them and the token stops working.
    expect(['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED']).toContain((error as AppError).code);
  });
});

/* -------------------------------------------------------------------------- */
/* The transport                                                               */
/* -------------------------------------------------------------------------- */

describe('the transport the backend actually receives', () => {
  it('carries the action and the payload the service meant to send', async () => {
    await saveQuotation(quotation(), false, token);

    const last = backend.requests.at(-1);
    expect(last?.action).toBe('quotation.save');
    expect(last?.payload).toMatchObject({ finalize: false });
  });

  it('is a CORS simple request — text/plain, no Authorization header', async () => {
    const calls: Array<[unknown, { headers?: Record<string, string> }]> = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: unknown, init: { headers?: Record<string, string> }) => {
      calls.push([input, init]);
      return real(input as string, init);
    });

    await saveQuotation(quotation(), false, token);

    const headers = calls[0]?.[1].headers ?? {};
    // `application/json` or an Authorization header triggers a preflight, and
    // an Apps Script Web App cannot answer one (§15.2).
    expect(headers['Content-Type']).toBe('text/plain;charset=utf-8');
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('authorization');
  });
});

/* -------------------------------------------------------------------------- */
/* Draft, then finalize                                                        */
/* -------------------------------------------------------------------------- */

describe('saving a draft', () => {
  it('issues no quotation number, because the user has not asked for one', async () => {
    const result = await saveQuotation(quotation(), false, token);

    // PRD §35: opening or saving a draft must never consume a number.
    expect(result.quotationNumber ?? '').toBe('');
  });

  it('can be read back with everything the user typed', async () => {
    const draft = quotation();
    await saveQuotation(draft, false, token);

    const stored = await getQuotationByDraftId(draft.draftId, token);
    expect(stored.quotation.quotationFor).toBe('TEST_ONLY manpower supply');
    expect(stored.quotation.lines).toHaveLength(1);
    expect(stored.status).toBe('Pending');
  });

  it('updates the same draft rather than accumulating one row per keystroke', async () => {
    const draft = quotation();
    await saveQuotation(draft, false, token);
    await saveQuotation({ ...draft, quotationFor: 'TEST_ONLY revised' }, false, token);

    const stored = await getQuotationByDraftId(draft.draftId, token);
    expect(stored.quotation.quotationFor).toBe('TEST_ONLY revised');
  });
});

describe('finalizing', () => {
  it('issues the first number of the year, in canonical form', async () => {
    const result = await saveQuotation(quotation(), true, token);
    expect(result.quotationNumber).toBe('SFC/RUH/QTN/2026/001');
  });

  it('gives a second quotation the next number, never a duplicate', async () => {
    const first = await saveQuotation(quotation(), true, token);
    const second = await saveQuotation(quotation(), true, token);

    expect(second.quotationNumber).toBe('SFC/RUH/QTN/2026/002');
    expect(second.quotationNumber).not.toBe(first.quotationNumber);
  });

  it('keeps the number when the quotation is edited and saved again', async () => {
    const draft = quotation();
    const issued = await saveQuotation(draft, true, token);

    const again = await saveQuotation(
      { ...draft, quotationFor: 'TEST_ONLY revised after issue' },
      true,
      token,
    );

    expect(again.quotationNumber).toBe(issued.quotationNumber);
  });

  it('refuses a client that submits a different number, with a typed code', async () => {
    const draft = quotation();
    await saveQuotation(draft, true, token);

    await expect(
      saveQuotation({ ...draft, quotationNumber: 'SFC/RUH/QTN/2026/777' }, true, token),
    ).rejects.toMatchObject({ code: 'QUOTATION_NUMBER_IMMUTABLE' });
  });

  it('recomputes the totals rather than trusting the browser', async () => {
    const draft = quotation();
    await saveQuotation(draft, true, token);

    const stored = await getQuotationByDraftId(draft.draftId, token);

    // 40.000 hours at SAR 20.00 = SAR 800.00, +15% VAT = SAR 920.00, in halalas.
    expect(stored.quotation.totals?.['subtotal']).toBe(80_000);
    expect(stored.quotation.totals?.['vatAmount']).toBe(12_000);
    expect(stored.quotation.totals?.['grandTotal']).toBe(92_000);
  });

  it('refuses totals the browser made up, rather than storing them', async () => {
    await expect(
      saveQuotation(
        {
          ...quotation(),
          totals: {
            categorySubtotals: { Manpower: 1 },
            subtotal: 1,
            discountAmount: 0,
            vatAmount: 0,
            grandTotal: 1,
            discountRateBasisPoints: 0,
            vatRateBasisPoints: 1_500,
          },
        } as QuotationPayload,
        true,
        token,
      ),
    ).rejects.toMatchObject({ code: 'TOTALS_MISMATCH' });
  });
});

/* -------------------------------------------------------------------------- */
/* Save to Drive, then the register                                            */
/* -------------------------------------------------------------------------- */

describe('the whole save', () => {
  async function saveEverything() {
    const draft = quotation();
    const issued = await saveQuotation(draft, true, token);

    const stored = await saveToDrive(
      {
        draftId: draft.draftId,
        documents: documents(),
      },
      token,
    );

    return { draft, issued, stored };
  }

  it('files both documents and reports success', async () => {
    const { stored } = await saveEverything();

    expect(stored.outcome).toBe('success');
    expect(stored.missing).toEqual([]);
    expect(stored.files.pdf?.url ?? '').toMatch(/^https:\/\/drive\.google\.com\//);
    expect(stored.files.docx?.url ?? '').toMatch(/^https:\/\/drive\.google\.com\//);
  });

  it('creates the Year / Month / Number folders PRD §5 asks for', async () => {
    const { issued, stored } = await saveEverything();
    const fileSafe = issued.quotationNumber.split('/').join('-');

    expect(stored.path).toEqual(['2026', 'August', fileSafe]);
    expect(backend.env.drive.folderPaths()).toContain(`2026/August/${fileSafe}`);
  });

  it('adds exactly one row to the register, carrying the Drive folder link', async () => {
    const { issued, stored } = await saveEverything();

    const rows = backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe(issued.quotationNumber);
    expect(String(rows[0]?.[7])).toContain(stored.folder.url);
  });

  it('reports the register write as done, not merely attempted', async () => {
    const { stored } = await saveEverything();
    expect(stored.tracking.status).toBe('recorded');
  });

  it('shows the quotation in the register listing, with its status', async () => {
    const { issued } = await saveEverything();

    const listed = await listQuotations(token);
    const found = listed.find((row) => row.quotationNumber === issued.quotationNumber);

    expect(found?.status).toBe('Pending');
    expect(found?.clientName).toBe('TEST_ONLY Contact');
  });

  it('changes a status through the service and reads it back changed', async () => {
    const { issued } = await saveEverything();

    const changed = await setQuotationStatus(issued.quotationNumber, 'Approved', token);
    expect(changed.status).toBe('Approved');
    expect(changed.tracked).toBe(true);

    const listed = await listQuotations(token);
    expect(listed.find((row) => row.quotationNumber === issued.quotationNumber)?.status).toBe(
      'Approved',
    );
  });

  it('keeps a status of Approved when the quotation is saved again', async () => {
    const { draft, issued } = await saveEverything();
    await setQuotationStatus(issued.quotationNumber, 'Approved', token);

    await saveQuotation({ ...draft, quotationFor: 'TEST_ONLY revised' }, true, token);
    await saveToDrive(
      {
        draftId: draft.draftId,
        documents: documents(),
      },
      token,
    );

    const listed = await listQuotations(token);
    expect(
      listed.find((row) => row.quotationNumber === issued.quotationNumber)?.status,
      'a re-save must not reset a decision somebody made',
    ).toBe('Approved');
  });

  it('does not duplicate the row or the files when the whole save is repeated', async () => {
    const { draft, issued } = await saveEverything();
    const fileSafe = issued.quotationNumber.split('/').join('-');

    await saveToDrive({ draftId: draft.draftId, documents: documents() }, token);

    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);
    expect(backend.env.drive.filesIn(`2026/August/${fileSafe}`)).toHaveLength(2);
  });

  it('leaves the register untouched by a retry that has nothing to do', async () => {
    const { draft } = await saveEverything();

    const retried = await retryTracking(draft.draftId, token);
    expect(retried.tracking.status).toBe('recorded');
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Authorisation is enforced by the server, not by the router                  */
/* -------------------------------------------------------------------------- */

describe('authorisation over the wire', () => {
  it('refuses a save with no token at all', async () => {
    await expect(saveQuotation(quotation(), true, '')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('refuses an Admin action to a User, whatever the browser believes', async () => {
    await expect(
      // A `User` token against an Admin-only action. The SPA's route guard is a
      // convenience; this is the control (§18.4).
      import('@/services/auth/auth-service').then((module) =>
        module.createUser(
          { email: 'someone@speedxksa.com', password: TEST_ONLY_PASSWORD, role: 'User' },
          token,
        ),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
