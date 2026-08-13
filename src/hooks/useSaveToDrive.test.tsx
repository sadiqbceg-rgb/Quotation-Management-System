/**
 * The Save to Google Drive flow, from the browser's side.
 *
 * `fetch` is stubbed, so no request leaves the machine and no Drive — real or
 * otherwise — is touched. The generators are stubbed too: they have their own
 * suites that build real PDFs and real DOCX packages, and what matters here is
 * the state machine, the retry, and the fact that a failure never reads as a
 * successful save (PRD §37).
 */

import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RetryUpload } from '@/components/quotation/RetryUpload';
import { SaveProgress } from '@/components/quotation/SaveProgress';
import { SaveResult } from '@/components/quotation/SaveResult';
import { useSaveToDrive } from './useSaveToDrive';
import type { SaveToDriveResult } from '@/services/google-drive/drive-service';
import type { DocumentModel } from '@/services/document/document-model.types';

const MODEL = {
  pageSize: 'A4',
  quotationNumber: 'SFC/RUH/QTN/2026/004',
  fileSafeNumber: 'SFC-RUH-QTN-2026-004',
  blocks: [],
  showRemarksColumn: false,
  pricingMode: 'amount',
  showPageNumbers: false,
} as DocumentModel;

const FOLDER_URL = 'https://drive.google.com/drive/folders/test-only-folder-1';
const PDF_URL = 'https://drive.google.com/file/d/test-only-file-1/view';
const DOCX_URL = 'https://drive.google.com/file/d/test-only-file-2/view';

function target(url: string, fileId: string, name: string) {
  return { fileId, url, name };
}

function successBody(missing: string[] = []) {
  return {
    ok: true,
    requestId: 'test-request',
    data: {
      outcome: missing.length === 0 ? 'success' : 'partial',
      draftId: 'draft-0001',
      quotationNumber: 'SFC/RUH/QTN/2026/004',
      folder: target(FOLDER_URL, 'test-only-folder-1', 'SFC-RUH-QTN-2026-004'),
      path: ['2026', 'August', 'SFC-RUH-QTN-2026-004'],
      pathLabel: '2026 / August / SFC-RUH-QTN-2026-004',
      files: {
        pdf: target(PDF_URL, 'test-only-file-1', 'SFC-RUH-QTN-2026-004.pdf'),
        docx: missing.includes('docx')
          ? null
          : target(DOCX_URL, 'test-only-file-2', 'SFC-RUH-QTN-2026-004.docx'),
      },
      missing,
    },
  };
}

/*
 * Hoisted, not `doMock` in a hook: the generators are dynamically imported
 * INSIDE the flow, and `loadPdfAssets` fetches the letterhead over HTTP. A
 * per-test mock registered after the module graph is warm lets the real loader
 * run and quietly eat the stubbed fetch response, which is exactly the kind of
 * failure that makes a suite pass for the wrong reason.
 */
vi.mock('@/services/pdf/pdf-generator', () => ({
  generateQuotationPdf: () =>
    Promise.resolve({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pageCount: 1,
      filename: 'x.pdf',
    }),
}));
vi.mock('@/services/pdf/pdf-assets', () => ({ loadPdfAssets: () => Promise.resolve({}) }));
vi.mock('@/services/docx/docx-generator', () => ({
  generateQuotationDocx: () =>
    Promise.resolve({
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      estimatedPageCount: 1,
      filename: 'x.docx',
    }),
}));
vi.mock('@/services/docx/docx-assets', () => ({ loadDocxAssets: () => Promise.resolve({}) }));

const fetchMock = vi.fn();

/** Every request body the hook sent, parsed. */
function sentBodies(): Array<{ action: string; payload: { documents: Record<string, string> } }> {
  return fetchMock.mock.calls.map((call) => {
    const init = call[1] as { body: string };
    return JSON.parse(init.body) as {
      action: string;
      payload: { documents: Record<string, string> };
    };
  });
}

function respondWith(body: unknown): void {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function request() {
  return { model: MODEL, draftId: 'draft-0001', signature: new Uint8Array([1, 2, 3]), token: 't' };
}

/* -------------------------------------------------------------------------- */

describe('a successful save', () => {
  it('ends with the folder and both file links', async () => {
    respondWith(successBody());

    const { result } = renderHook(() => useSaveToDrive());
    await act(async () => {
      await result.current.save(request());
    });

    expect(result.current.state.status).toBe('saved');
    if (result.current.state.status !== 'saved') expect.unreachable('expected saved');

    expect(result.current.state.result.folder.url).toBe(FOLDER_URL);
    expect(result.current.state.result.files.pdf?.url).toBe(PDF_URL);
    expect(result.current.state.result.files.docx?.url).toBe(DOCX_URL);
  });

  it('sends both documents as base64 on the first save', async () => {
    respondWith(successBody());

    const { result } = renderHook(() => useSaveToDrive());
    await act(async () => {
      await result.current.save(request());
    });

    const [body] = sentBodies();
    expect(body?.action).toBe('quotation.uploadToDrive');
    expect(Object.keys(body?.payload.documents ?? {}).sort()).toEqual(['docx', 'pdf']);
    // Bare base64: a `data:` prefix is rejected server-side.
    expect(body?.payload.documents['pdf']).toBe('JVBERg==');
  });
});

/* -------------------------------------------------------------------------- */

describe('a failed save (PRD §37)', () => {
  it('never reports a Drive failure as saved', async () => {
    respondWith({
      ok: false,
      requestId: 'test-request',
      error: { code: 'DRIVE_UPLOAD_FAILED', message: 'nope' },
    });

    const { result } = renderHook(() => useSaveToDrive());
    await act(async () => {
      await result.current.save(request());
    });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status !== 'error') expect.unreachable('expected error');

    expect(result.current.state.message).toMatch(/saving to google drive failed/i);
    expect(result.current.state.canRetry).toBe(true);
  });

  it('leaves the loading state — a permanently spinning button is its own defect', async () => {
    respondWith({
      ok: false,
      requestId: 'test-request',
      error: { code: 'DRIVE_QUOTA_EXCEEDED', message: 'full' },
    });

    const { result } = renderHook(() => useSaveToDrive());
    await act(async () => {
      await result.current.save(request());
    });

    expect(result.current.state.status).not.toBe('saving');
  });

  it('retries with the same draft id, and succeeds', async () => {
    respondWith({
      ok: false,
      requestId: 'test-request',
      error: { code: 'DRIVE_UPLOAD_FAILED', message: 'nope' },
    });
    respondWith(successBody());

    const { result } = renderHook(() => useSaveToDrive());
    await act(async () => {
      await result.current.save(request());
    });
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.state.status).toBe('saved');

    const bodies = sentBodies();
    expect(bodies).toHaveLength(2);
    // The same draft, so the same number and the same folder — which is what
    // makes replace-in-place able to guarantee no duplicate file.
    expect(JSON.stringify(bodies[1])).toContain('draft-0001');
  });

  it('does not regenerate the documents on a retry', async () => {
    respondWith({
      ok: false,
      requestId: 'test-request',
      error: { code: 'DRIVE_UPLOAD_FAILED', message: 'nope' },
    });
    respondWith(successBody());

    const { result } = renderHook(() => useSaveToDrive());
    await act(async () => {
      await result.current.save(request());
    });
    await act(async () => {
      await result.current.retry();
    });

    const bodies = sentBodies();
    // Byte-identical payloads: the retry uploads what failed, not a re-render.
    expect(bodies[1]?.payload.documents).toEqual(bodies[0]?.payload.documents);
  });
});

/* -------------------------------------------------------------------------- */

describe('a partial upload', () => {
  it('is reported as a failure, with what is missing named', async () => {
    respondWith(successBody(['docx']));

    const { result } = renderHook(() => useSaveToDrive());
    await act(async () => {
      await result.current.save(request());
    });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status !== 'error') expect.unreachable('expected error');

    expect(result.current.state.code).toBe('DRIVE_PARTIAL');
    expect(result.current.state.message).toMatch(/word document did not upload/i);
    // The PDF that DID upload keeps its link, so the user is not sent hunting.
    expect(result.current.state.partial?.files.pdf?.url).toBe(PDF_URL);
  });

  it('retries only what is missing', async () => {
    respondWith(successBody(['docx']));
    respondWith(successBody());

    const { result } = renderHook(() => useSaveToDrive());
    await act(async () => {
      await result.current.save(request());
    });
    await act(async () => {
      await result.current.retry();
    });

    const bodies = sentBodies();
    expect(Object.keys(bodies[0]?.payload.documents ?? {}).sort()).toEqual(['docx', 'pdf']);
    // The PDF is already filed; re-sending it would be wasted bandwidth.
    expect(Object.keys(bodies[1]?.payload.documents ?? {})).toEqual(['docx']);
  });
});

/* -------------------------------------------------------------------------- */

describe('the panels', () => {
  it('name the current step while saving', () => {
    render(<SaveProgress step="uploading" />);

    // The live region carries the current step; the list beneath repeats every
    // step, so the assertion targets the announcement specifically.
    expect(screen.getByText(/uploading to google drive…/i)).toBeInTheDocument();
    expect(screen.getByText(/generating the pdf/i)).toBeInTheDocument();
  });

  it('show the folder and both files on success', () => {
    const result = successBody().data as unknown as SaveToDriveResult;
    render(<SaveResult result={result} />);

    expect(screen.getByRole('link', { name: /open folder/i })).toHaveAttribute('href', FOLDER_URL);
    expect(screen.getByRole('link', { name: /open pdf/i })).toHaveAttribute('href', PDF_URL);
    expect(screen.getByRole('link', { name: /open word file/i })).toHaveAttribute('href', DOCX_URL);
    expect(screen.getByText(/2026 \/ August \/ SFC-RUH-QTN-2026-004/)).toBeInTheDocument();
  });

  it('show the PRD §37 message and a working retry on failure', () => {
    const onRetry = vi.fn();
    render(
      <RetryUpload
        message="Quotation was generated, but saving to Google Drive failed."
        requestId="test-request"
        partial={null}
        canRetry
        isRetrying={false}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Quotation was generated, but saving to Google Drive failed\./,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/test-request/);

    const retry = screen.getByRole('button', { name: /retry upload/i });
    expect(retry).toBeEnabled();
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('say that retrying will not duplicate the files', () => {
    render(
      <RetryUpload
        message="failed"
        requestId={undefined}
        partial={null}
        canRetry
        isRetrying={false}
        onRetry={vi.fn()}
      />,
    );

    // People hesitate to retry an upload because they expect a second copy.
    expect(screen.getByText(/replaces the files rather than adding copies/i)).toBeInTheDocument();
  });
});
