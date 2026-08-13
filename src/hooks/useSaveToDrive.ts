import { useCallback, useRef, useState } from 'react';

import type { DocumentModel } from '@/services/document/document-model.types';
import { AppError, messageOf } from '@/services/api/errors';
import {
  encodeDocument,
  saveToDrive,
  type DocumentPayload,
  type SaveToDriveResult,
} from '@/services/google-drive/drive-service';
import { DOCUMENT_KINDS, type DocumentKind } from '@shared/drive-paths';

/**
 * The steps of PRD §30, as the user sees them.
 *
 * Named rather than a percentage: "Uploading to Google Drive" is information a
 * person can act on when it stalls, and a spinner alone is not. Steps 5–12 are
 * one server round trip, so they are reported as one step.
 */
export type SaveStep = 'generating-pdf' | 'generating-docx' | 'uploading';

export const SAVE_STEP_LABELS: Record<SaveStep, string> = {
  'generating-pdf': 'Generating the PDF',
  'generating-docx': 'Generating the Word document',
  uploading: 'Uploading to Google Drive',
};

export type SaveToDriveState =
  | { status: 'idle' }
  | { status: 'saving'; step: SaveStep }
  | { status: 'saved'; result: SaveToDriveResult }
  | {
      status: 'error';
      message: string;
      code: string;
      requestId: string | undefined;
      /** Present when some documents did upload; a retry sends only these. */
      partial: SaveToDriveResult | null;
      /** True once documents exist, so Retry Upload need not regenerate them. */
      canRetry: boolean;
    };

export interface SaveToDriveRequest {
  model: DocumentModel;
  /** Resolves server-side to the issued number, and therefore to the folder. */
  draftId: string;
  /** Null only for a draft, which cannot reach this flow. */
  signature: Uint8Array | null;
  token: string;
}

export interface UseSaveToDriveResult {
  state: SaveToDriveState;
  /** PRD §30 steps 1–15. */
  save: (request: SaveToDriveRequest) => Promise<void>;
  /** PRD §37 Retry Upload: same draft, same number, same folder. */
  retry: () => Promise<void>;
  reset: () => void;
}

/**
 * Save the open quotation to Google Drive (PRD §29, §30).
 *
 * The generators are dynamically imported, so a user who never presses this
 * button never downloads `pdf-lib` or `docx`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DOCUMENTS ARE HELD IN A REF
 * ---------------------------------------------------------------------------
 * A retry must upload the SAME bytes that failed, not a fresh render — and the
 * PRD's Retry Upload has to work when the failure was Drive's, not ours. They
 * live in a ref rather than in state because re-rendering on every byte change
 * is pointless, and they are cleared the moment the save succeeds: the PDF
 * contains the signatory's signature image, and it has no business outliving
 * the operation. Nothing is written to `localStorage` or to disk.
 */
export function useSaveToDrive(): UseSaveToDriveResult {
  const [state, setState] = useState<SaveToDriveState>({ status: 'idle' });

  const documents = useRef<DocumentPayload>({});
  const draft = useRef<string>('');
  const token = useRef<string>('');

  const upload = useCallback(async (only: readonly DocumentKind[] | null): Promise<void> => {
    setState({ status: 'saving', step: 'uploading' });

    const payload: DocumentPayload =
      only === null
        ? { ...documents.current }
        : Object.fromEntries(
            only
              .filter((kind) => documents.current[kind] !== undefined)
              .map((kind) => [kind, documents.current[kind]]),
          );

    const result = await saveToDrive({ draftId: draft.current, documents: payload }, token.current);

    if (result.outcome === 'partial') {
      setState({
        status: 'error',
        // PRD §37's wording, plus what is actually missing.
        message: `Quotation was generated, but saving to Google Drive failed. ${describeMissing(result.missing)}`,
        code: 'DRIVE_PARTIAL',
        requestId: undefined,
        partial: result,
        canRetry: true,
      });
      return;
    }

    // The signature-bearing bytes are released as soon as they are filed.
    documents.current = {};
    setState({ status: 'saved', result });
  }, []);

  const save = useCallback(
    async (request: SaveToDriveRequest): Promise<void> => {
      const { model, draftId, signature } = request;

      draft.current = draftId;
      token.current = request.token;

      try {
        setState({ status: 'saving', step: 'generating-pdf' });

        const [pdfModule, pdfAssetsModule, docxModule, docxAssetsModule] = await Promise.all([
          import('@/services/pdf/pdf-generator'),
          import('@/services/pdf/pdf-assets'),
          import('@/services/docx/docx-generator'),
          import('@/services/docx/docx-assets'),
        ]);

        // PRD §30 step 3.
        const pdf = await pdfModule.generateQuotationPdf(
          model,
          await pdfAssetsModule.loadPdfAssets(signature),
        );

        setState({ status: 'saving', step: 'generating-docx' });

        // PRD §30 step 4.
        const docx = await docxModule.generateQuotationDocx(
          model,
          await docxAssetsModule.loadDocxAssets(signature),
        );

        documents.current = {
          pdf: encodeDocument(pdf.bytes),
          docx: encodeDocument(docx.bytes),
        };

        await upload(null);
      } catch (error: unknown) {
        setState({
          status: 'error',
          message: messageOf(error),
          code: error instanceof AppError ? error.code : codeOf(error),
          requestId: error instanceof AppError ? error.requestId : undefined,
          partial: null,
          // Only if the documents were produced; otherwise the whole flow reruns.
          canRetry: DOCUMENT_KINDS.some((kind) => documents.current[kind] !== undefined),
        });
      }
    },
    [upload],
  );

  const retry = useCallback(async (): Promise<void> => {
    if (state.status !== 'error') return;

    try {
      // Only what is missing. Anything already in the archive is left alone,
      // and replace-in-place means even a redundant re-upload cannot duplicate.
      await upload(state.partial === null ? null : state.partial.missing);
    } catch (error: unknown) {
      setState({
        status: 'error',
        message: messageOf(error),
        code: error instanceof AppError ? error.code : codeOf(error),
        requestId: error instanceof AppError ? error.requestId : undefined,
        partial: state.partial,
        canRetry: true,
      });
    }
  }, [state, upload]);

  const reset = useCallback(() => {
    documents.current = {};
    setState({ status: 'idle' });
  }, []);

  return { state, save, retry, reset };
}

function codeOf(error: unknown): string {
  // A generation failure carries its own typed code; anything else is unknown.
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

function describeMissing(missing: readonly DocumentKind[]): string {
  if (missing.length === 0) return '';

  const names = missing.map((kind) => (kind === 'pdf' ? 'PDF' : 'Word document'));
  return `The ${names.join(' and the ')} did not upload.`;
}
