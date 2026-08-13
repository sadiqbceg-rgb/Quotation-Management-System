import { useCallback, useState } from 'react';

import type { DocumentModel } from '@/services/document/document-model.types';
import { docxErrorMessage, DocxGenerationError } from '@/services/docx/docx-errors';

/** The OOXML media type. Word will not offer to open a file without it. */
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type DocxState =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'error'; message: string; code: string };

export interface UseGenerateDocxResult {
  state: DocxState;
  /** Generate and hand the file to the browser. */
  save: (model: DocumentModel, signature: Uint8Array | null) => Promise<void>;
  reset: () => void;
}

/**
 * Hand a generated file to the browser.
 *
 * The object URL is revoked immediately after the click. A signature image
 * lives in these bytes; leaving a URL alive would keep it reachable from the
 * page for as long as the tab is open. It is never written to disk by us and
 * never touches `localStorage`.
 */
function download(bytes: Uint8Array, filename: string): void {
  // Copy into a fresh ArrayBuffer: a Uint8Array may be backed by a
  // SharedArrayBuffer, which Blob does not accept.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  const blob = new Blob([buffer], { type: DOCX_MIME_TYPE });
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
 * Save the open quotation as a Word document (PRD §29).
 *
 * `docx` and the letterhead images are dynamically imported, so a user who
 * never presses this button never downloads any of it.
 *
 * The state machine always leaves `generating`: a failure surfaces a specific,
 * typed message and stops. A permanently spinning button is its own defect.
 */
export function useGenerateDocx(): UseGenerateDocxResult {
  const [state, setState] = useState<DocxState>({ status: 'idle' });

  const save = useCallback(
    async (model: DocumentModel, signature: Uint8Array | null): Promise<void> => {
      setState({ status: 'generating' });

      try {
        const [{ generateQuotationDocx }, { loadDocxAssets }] = await Promise.all([
          import('@/services/docx/docx-generator'),
          import('@/services/docx/docx-assets'),
        ]);

        const assets = await loadDocxAssets(signature);
        const result = await generateQuotationDocx(model, assets);

        download(result.bytes, result.filename);
        setState({ status: 'idle' });
      } catch (error: unknown) {
        setState({
          status: 'error',
          message: docxErrorMessage(error),
          code: error instanceof DocxGenerationError ? error.code : 'UNKNOWN',
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
