/**
 * What happens after something fails — PRD §37 and IMPLEMENTATION_PLAN §23.2.
 *
 * ---------------------------------------------------------------------------
 * THE PROPERTY EVERY TEST HERE SHARES
 * ---------------------------------------------------------------------------
 * A failure must leave the system CONSISTENT. Not merely "the error was shown":
 * no orphaned Drive file, no half-written register row, no burned quotation
 * number, and a retry that completes the job rather than doing it twice.
 *
 * Each case runs against the real backend over a faked network, so the recovery
 * is exercised through the same code path the user's Retry button uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { createFakeBackend, type FakeBackend } from '../../../test/fakes/backend';
import { AppError } from '@/services/api/errors';
import { saveQuotation, type QuotationPayload } from '@/services/quotation/quotation-service';
import { saveToDrive, encodeDocument } from '@/services/google-drive/drive-service';
import { retryTracking } from '@/services/google-sheets/sheets-service';
import { useSaveToDrive } from '@/hooks/useSaveToDrive';
import type { DocumentModel } from '@/services/document/document-model.types';
import { QUOTATIONS_SHEET_NAME } from '../../../google-apps-script/src/sheets/quotations-sheet';
import { readLastSequence } from '../../../google-apps-script/src/sheets/counters-sheet';
import { TEST_ONLY_documentBytes } from '../../../google-apps-script/src/__fixtures__/document-fixtures';

const QUOTATION_DATE = '2026-08-11';
const EMAIL = 'staff@speedxksa.com';

let backend: FakeBackend;
let token: string;
let signatoryId: string;
let draftCounter = 0;

beforeEach(() => {
  draftCounter = 0;
  backend = createFakeBackend(vi.stubGlobal);
  signatoryId = backend.seedSignatory();
  token = backend.signIn(EMAIL);
});

afterEach(() => {
  backend.teardown();
  vi.unstubAllGlobals();
});

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

function documents(kinds: Array<'pdf' | 'docx'> = ['pdf', 'docx']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const kind of kinds) {
    result[kind] = encodeDocument(Uint8Array.from(TEST_ONLY_documentBytes(kind)));
  }
  return result;
}

/** Finalize a quotation and return its draft id and issued number. */
async function issued(): Promise<{ draftId: string; quotationNumber: string; fileSafe: string }> {
  const draft = quotation();
  const result = await saveQuotation(draft, true, token);
  return {
    draftId: draft.draftId,
    quotationNumber: result.quotationNumber,
    fileSafe: result.quotationNumber.split('/').join('-'),
  };
}

function upload(
  target: { draftId: string; quotationNumber: string },
  kinds: Array<'pdf' | 'docx'> = ['pdf', 'docx'],
) {
  return saveToDrive(
    {
      draftId: target.draftId,
      documents: documents(kinds),
    },
    token,
  );
}

/* -------------------------------------------------------------------------- */
/* A Drive upload that fails                                                   */
/* -------------------------------------------------------------------------- */

describe('when the Drive upload fails', () => {
  it('does not mark the quotation saved', async () => {
    const target = await issued();
    backend.env.drive.failNextCreate('An unexpected error occurred.');

    await expect(upload(target)).rejects.toBeInstanceOf(AppError);

    // Nothing in Drive, and — critically — no register row claiming there is.
    expect(backend.env.drive.files()).toEqual([]);
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toEqual([]);
  });

  it('keeps the quotation number reserved, so no number is burned', async () => {
    const target = await issued();
    backend.env.drive.failNextCreate('An unexpected error occurred.');
    await upload(target).catch(() => undefined);

    // The counter did not move, and the retry gets the SAME number back.
    expect(readLastSequence(2026)).toBe(1);

    const again = await saveQuotation({ ...quotation({ draftId: target.draftId }) }, true, token);
    expect(again.quotationNumber).toBe(target.quotationNumber);
    expect(readLastSequence(2026)).toBe(1);
  });

  it('retries into the same folder, with no duplicate files', async () => {
    const target = await issued();
    backend.env.drive.failNextCreate('An unexpected error occurred.');
    await upload(target).catch(() => undefined);

    const retry = await upload(target);

    expect(retry.outcome).toBe('success');
    expect(backend.env.drive.filesIn(`2026/August/${target.fileSafe}`)).toHaveLength(2);
    expect(
      backend.env.drive.folderPaths().filter((path) => path.endsWith(target.fileSafe)),
    ).toHaveLength(1);
  });

  it('writes the register row only once the archive is complete', async () => {
    const target = await issued();
    backend.env.drive.failNextCreate('An unexpected error occurred.');
    await upload(target).catch(() => undefined);

    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toEqual([]);

    await upload(target);
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);
  });

  it('reports a permanent failure as a permanent failure, not as a retry loop', async () => {
    const target = await issued();

    for (let attempt = 0; attempt < 3; attempt++) {
      backend.env.drive.failNextCreate('An unexpected error occurred.');
      const error = await upload(target).catch((thrown: unknown) => thrown);
      expect(error, `attempt ${String(attempt + 1)}`).toBeInstanceOf(AppError);
    }

    // Three failures later the archive is still empty — nothing accumulated.
    expect(backend.env.drive.files()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* A half-filed archive                                                        */
/* -------------------------------------------------------------------------- */

describe('when only one document reaches Drive', () => {
  async function halfFiled() {
    const target = await issued();
    await upload(target, ['pdf']);
    return target;
  }

  it('is reported as partial, naming what is missing', async () => {
    const target = await issued();
    const result = await upload(target, ['pdf']);

    expect(result.outcome).toBe('partial');
    expect(result.missing).toEqual(['docx']);
  });

  it('still hands back the link to the document that did land', async () => {
    const target = await issued();
    const result = await upload(target, ['pdf']);

    expect(result.files.pdf?.url ?? '').toMatch(/^https:\/\/drive\.google\.com\//);
    expect(result.folder.url).toMatch(/^https:\/\/drive\.google\.com\//);
  });

  it('leaves the register empty rather than claiming a document that is not there', async () => {
    await halfFiled();
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toEqual([]);
  });

  it('is completed by a retry that uploads only what was missing', async () => {
    const target = await halfFiled();
    const completed = await upload(target, ['docx']);

    expect(completed.outcome).toBe('success');
    expect(backend.env.drive.filesIn(`2026/August/${target.fileSafe}`)).toHaveLength(2);
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* DRIVE_PARTIAL — raised in the browser (see error-codes.test.ts)             */
/* -------------------------------------------------------------------------- */

const MODEL = {
  pageSize: 'A4',
  quotationNumber: 'SFC/RUH/QTN/2026/001',
  fileSafeNumber: 'SFC-RUH-QTN-2026-001',
  blocks: [],
  showRemarksColumn: false,
  pricingMode: 'amount',
  showPageNumbers: false,
} as DocumentModel;

/*
 * Hoisted, not registered per test: the generators are dynamically imported
 * inside the flow, and `loadPdfAssets` fetches the letterhead over HTTP — which
 * this file has redirected into the Apps Script router. The real generators are
 * covered by their own suites against real files; what is under test here is
 * the recovery.
 */
vi.mock('@/services/pdf/pdf-generator', () => ({
  generateQuotationPdf: () =>
    Promise.resolve({
      bytes: Uint8Array.from(TEST_ONLY_documentBytes('pdf')),
      pageCount: 1,
      filename: 'SFC-RUH-QTN-2026-001.pdf',
    }),
}));
vi.mock('@/services/pdf/pdf-assets', () => ({ loadPdfAssets: () => Promise.resolve({}) }));
vi.mock('@/services/docx/docx-generator', () => ({
  generateQuotationDocx: () =>
    Promise.resolve({
      bytes: Uint8Array.from(TEST_ONLY_documentBytes('docx')),
      estimatedPageCount: 1,
      filename: 'SFC-RUH-QTN-2026-001.docx',
    }),
}));
vi.mock('@/services/docx/docx-assets', () => ({ loadDocxAssets: () => Promise.resolve({}) }));

describe('the hook the Save button uses', () => {
  it('raises DRIVE_PARTIAL when the backend reports a half-filed archive', async () => {
    const target = await issued();

    // Leave the PDF in the folder so the next create is the DOCX, then fail it.
    await upload(target, ['pdf']);
    backend.env.drive.failNextCreate('An unexpected error occurred.');

    const { result } = renderHook(() => useSaveToDrive());

    await act(async () => {
      await result.current.save({
        model: { ...MODEL, quotationNumber: target.quotationNumber },
        draftId: target.draftId,
        signature: new Uint8Array([1, 2, 3]),
        token,
      });
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });

    // The typed code, which is what the UI switches on to offer Retry Upload.
    const state = result.current.state;
    if (state.status !== 'error') throw new Error(`Expected an error, got ${state.status}.`);

    expect(state.code).toBe('DRIVE_PARTIAL');
    expect(state.partial?.missing).toEqual(['docx']);
  });

  it('never reports a Drive failure as a successful save', async () => {
    const target = await issued();
    backend.env.drive.failNextCreate('An unexpected error occurred.');

    const { result } = renderHook(() => useSaveToDrive());

    await act(async () => {
      await result.current.save({
        model: { ...MODEL, quotationNumber: target.quotationNumber },
        draftId: target.draftId,
        signature: new Uint8Array([1, 2, 3]),
        token,
      });
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });
    expect(result.current.state.status).not.toBe('saved');
  });

  it('completes the archive when the user presses Retry', async () => {
    const target = await issued();
    await upload(target, ['pdf']);
    backend.env.drive.failNextCreate('An unexpected error occurred.');

    const { result } = renderHook(() => useSaveToDrive());

    await act(async () => {
      await result.current.save({
        model: { ...MODEL, quotationNumber: target.quotationNumber },
        draftId: target.draftId,
        signature: new Uint8Array([1, 2, 3]),
        token,
      });
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });

    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('saved');
    });

    // Two files, one folder, one register row: the retry finished the job
    // rather than doing it again.
    expect(backend.env.drive.filesIn(`2026/August/${target.fileSafe}`)).toHaveLength(2);
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The register write failing after Drive succeeded                            */
/* -------------------------------------------------------------------------- */

/**
 * Let the FOLDER lock succeed and make the next one — the register's — fail.
 *
 * Both go through `LockService.getScriptLock()`, so a blanket failure would
 * break folder resolution and the upload would never get as far as the register
 * write this is about. Counting acquisitions is what isolates the one that
 * matters.
 */
function failLockAfter(successfulAcquisitions: number): () => void {
  const realLock = LockService;
  let granted = 0;

  vi.stubGlobal('LockService', {
    getScriptLock: () => ({
      tryLock: (_timeoutMs: number): boolean => {
        granted += 1;
        return granted <= successfulAcquisitions;
      },
      waitLock: (): void => undefined,
      releaseLock: (): void => undefined,
      hasLock: (): boolean => false,
    }),
    getUserLock: () => realLock.getUserLock(),
  });

  return () => {
    vi.stubGlobal('LockService', realLock);
  };
}

describe('when the register write fails after Drive succeeded', () => {
  it('keeps the documents and reports tracking as failed, not the save', async () => {
    const target = await issued();

    const restore = failLockAfter(1);
    const result = await upload(target).finally(restore);

    // The upload SUCCEEDED. Telling the user otherwise would send them to
    // re-upload two megabytes to fix a spreadsheet row (§23.2).
    expect(result.outcome).toBe('success');
    expect(result.tracking.status).toBe('failed');
    expect(backend.env.drive.filesIn(`2026/August/${target.fileSafe}`)).toHaveLength(2);
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toEqual([]);
  });

  it('is fixed by a tracking retry that costs no re-upload', async () => {
    const target = await issued();

    const restore = failLockAfter(1);
    await upload(target).finally(restore);

    const before = backend.env.drive.files().length;
    const retried = await retryTracking(target.draftId, token);

    expect(retried.tracking.status).toBe('recorded');
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);
    // No document was sent again: the server re-reads the archive for the URLs.
    expect(backend.env.drive.files()).toHaveLength(before);
  });

  it('updates the existing row on retry rather than appending a second one', async () => {
    const target = await issued();
    await upload(target);
    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);

    await retryTracking(target.draftId, token);
    await retryTracking(target.draftId, token);

    expect(backend.env.spreadsheet.dataRows(QUOTATIONS_SHEET_NAME)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The network itself                                                          */
/* -------------------------------------------------------------------------- */

describe('when the connection drops', () => {
  it('is reported as NETWORK_ERROR, which is recoverable, not as a data error', async () => {
    backend.failNextRequest();

    const error = await saveQuotation(quotation(), true, token).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('NETWORK_ERROR');
  });

  it('burns no quotation number when the request never arrived', async () => {
    backend.failNextRequest();
    await saveQuotation(quotation(), true, token).catch(() => undefined);

    expect(readLastSequence(2026)).toBe(0);
  });

  it('reuses the number when the request DID arrive but the answer was lost', async () => {
    /*
     * The failure mode idempotency exists for: the server issued a number and
     * the response never made it back, so the browser retries the same draft.
     * A second number here would leave a permanent gap in the company's
     * official sequence (§7.5b).
     */
    const draft = quotation();
    const first = await saveQuotation(draft, true, token);

    const retried = await saveQuotation(draft, true, token);

    expect(retried.quotationNumber).toBe(first.quotationNumber);
    expect(readLastSequence(2026)).toBe(1);
  });
});
