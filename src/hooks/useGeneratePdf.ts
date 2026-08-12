import { useCallback, useState } from 'react';

import type { DocumentModel } from '@/services/document/document-model.types';
import { pdfErrorMessage, PdfGenerationError } from '@/services/pdf/pdf-errors';

export type PdfState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'error'; message: string; code: string };

export interface UseGeneratePdfResult {
  state: PdfState;
  /** Generate and hand the file to the browser. */
  save: (model: DocumentModel, signature: Uint8Array | null) => Promise<void>;
  reset: () => void;
}

/**
 * Hand a generated file to the browser.
 *
 * The object URL is revoked immediately after the click. A signature image
 * lives in these bytes; leaving a URL alive would keep it reachable from the
 * page for as long as the tab is open.
 */
function download(bytes: Uint8Array, filename: string): void {
  // Copy into a fresh ArrayBuffer: a Uint8Array may be backed by a
  // SharedArrayBuffer, which Blob does not accept.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  const blob = new Blob([buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}

/**
 * Save the open quotation as a PDF (PRD §29).
 *
 * `pdf-lib`, the fonts and the letterhead are dynamically imported, so a user
 * who never presses this button never downloads any of it.
 *
 * The state machine always leaves `generating`: a failure surfaces a specific,
 * typed message and returns to idle. A permanently spinning button is its own
 * defect.
 */
export function useGeneratePdf(): UseGeneratePdfResult {
  const [state, setState] = useState<PdfState>({ status: 'idle' });

  const save = useCallback(
    async (model: DocumentModel, signature: Uint8Array | null): Promise<void> => {
      setState({ status: 'generating' });

      try {
        const [{ generateQuotationPdf }, { loadPdfAssets }] = await Promise.all([
          import('@/services/pdf/pdf-generator'),
          import('@/services/pdf/pdf-assets'),
        ]);

        const assets = await loadPdfAssets(signature);
        const result = await generateQuotationPdf(model, assets);

        download(result.bytes, result.filename);
        setState({ status: 'idle' });
      } catch (error: unknown) {
        setState({
          status: 'error',
          message: pdfErrorMessage(error),
          code: error instanceof PdfGenerationError ? error.code : 'UNKNOWN',
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return { state, save, reset };
}
