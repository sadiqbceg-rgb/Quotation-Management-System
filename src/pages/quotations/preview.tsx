import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/common/Card';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Spinner } from '@/components/common/Spinner';
import { QuotationPreview } from '@/components/quotation/preview/QuotationPreview';
import { PreviewToolbar } from '@/components/quotation/preview/PreviewToolbar';
import { useAuth } from '@/hooks/useAuth';
import { useGenerateDocx } from '@/hooks/useGenerateDocx';
import { useGeneratePdf } from '@/hooks/useGeneratePdf';
import { useSaveToDrive } from '@/hooks/useSaveToDrive';
import { useToast } from '@/hooks/useToast';
import { RetryUpload } from '@/components/quotation/RetryUpload';
import { SaveProgress } from '@/components/quotation/SaveProgress';
import { SaveResult } from '@/components/quotation/SaveResult';
import { SheetsSyncWarning } from '@/components/quotation/SheetsSyncWarning';
import { AppError, businessMessageOf, messageOf } from '@/services/api/errors';
import { discardDraft, getQuotationByDraftId } from '@/services/quotation/quotation-service';
import { fetchSignature } from '@/services/signatories/signatory-service';
import {
  EMPTY_IMAGE_REF,
  loadDocumentAssets,
  sealImageRef,
  signatureImageRef,
} from '@/services/document/asset-loader';
import { buildDocumentModel } from '@/services/document/build-document-model';
import { paginate } from '@/services/document/pagination-rules';
import { canExport, validateForExport } from '@/services/document/export-validation';
import { DEFAULT_COMPANY_NAME } from '@shared/company-defaults';
import { base64PngToBytes, toDataUri } from '@shared/signature';
import { emptyTokenContext } from '@shared/term-tokens';
import { calculateTotals } from '@shared/totals';
import { halalas, milli } from '@shared/money';
import { getEnv } from '@/config/env';
import { formatDisplayDate } from '@/utils/format-date';
import { PAGE } from '@/config/document-layout';
import type { ItemCategory } from '@shared/types';
import type { DocumentLine } from '@/services/document/section-builders';

/** Fit an A4 page into the available width, never enlarging past 100%. */
function useFitScale(): number {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const measure = (): void => {
      // 96 CSS px per inch, 72 pt per inch.
      const pageWidthPx = (PAGE.widthPt / 72) * 96;
      const available = Math.min(window.innerWidth - 96, 1100);
      setScale(Math.min(1, available / pageWidthPx));
    };

    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, []);

  return scale;
}

interface StoredLine {
  category?: unknown;
  description?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  remarks?: unknown;
}

const CATEGORIES: readonly string[] = ['Manpower', 'Equipment', 'Materials'];

function toDocumentLines(raw: unknown): DocumentLine[] {
  if (!Array.isArray(raw)) return [];

  const lines: DocumentLine[] = [];

  for (const entry of raw as StoredLine[]) {
    const category = typeof entry.category === 'string' ? entry.category : '';
    if (!CATEGORIES.includes(category)) continue;

    const quantity = typeof entry.quantity === 'number' ? entry.quantity : 0;
    const unitPrice = typeof entry.unitPrice === 'number' ? entry.unitPrice : 0;

    lines.push({
      category: category as ItemCategory,
      description: typeof entry.description === 'string' ? entry.description : '',
      quantity: milli(quantity),
      unit: typeof entry.unit === 'string' ? entry.unit : '',
      unitPrice: halalas(unitPrice),
      // Recomputed rather than read: the amount is derived, and a stored one
      // could disagree with the totals block on the same page (PRD §18).
      amount: halalas(Math.round((quantity / 1000) * unitPrice)),
      remarks: typeof entry.remarks === 'string' ? entry.remarks : '',
    });
  }

  return lines;
}

/**
 * Quotation preview (PRD §29).
 *
 * Renders a SAVED quotation. The model is built from what the server stored, not
 * from unsaved form state, so what is previewed is what exists — a preview of
 * text the backend has never seen would be a preview of a document that cannot
 * be produced.
 */
export default function QuotationPreviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { state } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const scale = useFitScale();
  const pdf = useGeneratePdf();
  const docx = useGenerateDocx();
  const drive = useSaveToDrive();
  const queryClient = useQueryClient();

  const token = state.status === 'authenticated' ? state.token : null;

  const quotation = useQuery({
    queryKey: ['quotation', draftId],
    queryFn: () => getQuotationByDraftId(draftId ?? '', token ?? ''),
    enabled: token !== null && draftId !== undefined,
  });

  const assets = useQuery({
    queryKey: ['document-assets'],
    queryFn: loadDocumentAssets,
    staleTime: Infinity,
  });

  const stored = quotation.data?.quotation;
  const personId = stored?.authorizedPerson?.id ?? '';

  const signature = useQuery({
    queryKey: ['signature', personId],
    queryFn: () => fetchSignature(personId, token ?? ''),
    enabled: token !== null && personId.length > 0,
  });

  const built = useMemo(() => {
    if (stored === undefined || assets.data === undefined) return null;

    const lines = toDocumentLines(stored.lines);
    const person = stored.authorizedPerson ?? null;

    const totals = calculateTotals({
      lines: lines.map((line) => ({
        category: line.category,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
      ...(stored.discountRateBasisPoints === undefined
        ? {}
        : { discountRateBasisPoints: stored.discountRateBasisPoints }),
      ...(stored.vatRateBasisPoints === undefined
        ? {}
        : { vatRateBasisPoints: stored.vatRateBasisPoints }),
    });

    const model = buildDocumentModel({
      quotationNumber: stored.quotationNumber ?? '',
      quotationDate: stored.quotationDate,
      quotationFor: stored.quotationFor,
      pricingMode: stored.pricingMode === 'rate-only' ? 'rate-only' : 'amount',
      scopeOfWork: typeof stored.scopeOfWork === 'string' ? stored.scopeOfWork : '',
      client: {
        clientName: stored.client['clientName'] ?? '',
        companyName: stored.client['companyName'] ?? '',
        address: stored.client['address'] ?? '',
        contactPerson: stored.client['contactPerson'] ?? '',
      },
      lines,
      totals,
      terms: (stored.terms ?? []).map((term) => ({ title: term.title, body: term.body })),
      closingParagraph: stored.closingParagraph ?? '',
      signatory:
        person === null
          ? null
          : {
              name: person.name,
              designation: person.designation,
              companyName: person.companyName,
              country: person.country,
              phone: person.phone,
              email: person.email,
            },
      assets: {
        seal: sealImageRef(assets.data.seal),
        signature:
          signature.data === undefined
            ? EMPTY_IMAGE_REF
            : signatureImageRef(toDataUri(signature.data), person?.name ?? ''),
      },
    });

    const blockers = validateForExport({
      quotationFor: stored.quotationFor,
      client: {
        clientName: stored.client['clientName'] ?? '',
        companyName: stored.client['companyName'] ?? '',
        address: stored.client['address'] ?? '',
      },
      lines,
      terms: model.blocks.flatMap((block) => (block.kind === 'termsList' ? block.items : [])),
      closingParagraph: stored.closingParagraph ?? '',
      signatory: person === null ? null : { name: person.name },
      signatureLoaded: signature.data !== undefined,
      sealLoaded: assets.data.seal.length > 0,
      /*
       * DELIBERATELY NOT read from Company Settings.
       *
       * This context is used for ONE thing — `hasUnresolvedTokens`, which asks
       * whether a stored term still contains a placeholder that was never
       * filled in. It does not render anything: the terms on screen are
       * `stored.terms`, the resolved snapshot saved with the quotation.
       *
       * Feeding today's settings in would make an OLD quotation's export
       * blockers depend on a value an administrator changed last week, which is
       * precisely the coupling the snapshot design exists to prevent. Every
       * field below therefore comes from the quotation itself, or from
       * deployment configuration that is not per-quotation at all.
       */
      tokenContext: {
        ...emptyTokenContext(),
        companyName: DEFAULT_COMPANY_NAME,
        companyVatNumber: getEnv().companyVatNumber,
        clientCompanyName: stored.client['companyName'] ?? '',
        clientName: stored.client['clientName'] ?? '',
        quotationNumber: stored.quotationNumber ?? '',
        quotationDate: formatDisplayDate(stored.quotationDate),
        /*
         * `validityDays` stays EMPTY here even though the quotation now stores
         * one, and that is deliberate.
         *
         * This asks whether the SAVED TEXT still contains a placeholder. The
         * generators print `term.body` verbatim, so a body that still reads
         * "{{quotation.validityDays}}" prints those braces to the client no
         * matter what the record knows. Supplying the stored number here would
         * resolve the token in this check only, clearing the blocker for a
         * document that would still go out with a placeholder in it.
         */
        vatRate: `${String((stored.vatRateBasisPoints ?? 0) / 100)}%`,
      },
    });

    return { model, blockers, pageCount: paginate(model).length };
  }, [stored, assets.data, signature.data]);

  const isLoading = quotation.isPending || assets.isPending;
  const isDraft = (stored?.quotationNumber ?? '').length === 0;

  /**
   * Discard the open draft.
   *
   * A mutation rather than a bare async function, for two reasons the previous
   * version got wrong:
   *
   *   - `isPending` drives a real busy state, so the button disables itself and
   *     a second click cannot send a second discard. It was hardcoded `false`;
   *   - on success the register query is invalidated. Without that, the global
   *     30-second `staleTime` meant the discarded draft was still listed when
   *     the user arrived back at /quotations, and they would discard it again.
   */
  const discardMutation = useMutation({
    mutationFn: (id: string) => discardDraft(id, token ?? ''),
    onSuccess: () => {
      /*
       * Both keys. `['quotations']` is the register list; `['quotation', id]`
       * is this page's own copy, which must not survive as a cached view of a
       * record that no longer exists.
       */
      void queryClient.invalidateQueries({ queryKey: ['quotations'] });
      void queryClient.removeQueries({ queryKey: ['quotation', draftId] });

      show({ variant: 'success', message: 'Draft discarded.' });
      void navigate('/quotations');
    },
    onError: (error: unknown) => {
      // The creator-only and already-numbered refusals explain themselves, so
      // they are shown in full rather than collapsed to a generic sentence.
      show({ variant: 'error', message: businessMessageOf(error) });
    },
  });

  const handleDiscardDraft = (): void => {
    if (token === null || draftId === undefined) return;
    if (discardMutation.isPending) return;

    const confirmed = window.confirm('Discard this draft? This action cannot be undone.');
    if (!confirmed) return;

    discardMutation.mutate(draftId);
  };

  return (
    <>
      <div className="print-hide">
        <PageHeader
          title="Quotation Preview"
          description="Exactly what the client will receive. Printing produces the same pages."
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="Preparing the preview" />
        </div>
      ) : quotation.isError || assets.isError ? (
        <Card>
          <p role="alert" className="text-brand-red text-sm">
            The quotation could not be prepared for preview.{' '}
            {messageOf(quotation.error ?? assets.error)}
            {quotation.error instanceof AppError && quotation.error.requestId !== undefined
              ? ` (Reference: ${quotation.error.requestId})`
              : ''}
          </p>
        </Card>
      ) : built === null ? null : (
        <div className="flex flex-col gap-4">
          <div className="print-hide">
            <PreviewToolbar
              quotationNumber={
                built.model.quotationNumber.length > 0
                  ? built.model.quotationNumber
                  : 'Draft — no number issued'
              }
              pageCount={built.pageCount}
              canExport={canExport(built.blockers)}
              onBack={() => {
                void navigate(-1);
              }}
              onPrint={() => {
                window.print();
              }}
              isSavingPdf={pdf.state.status === 'generating'}
              onSavePdf={() => {
                void pdf.save(
                  built.model,
                  signature.data === undefined ? null : base64PngToBytes(signature.data),
                );
              }}
              isSavingWord={docx.state.status === 'generating'}
              onSaveWord={() => {
                void docx.save(
                  built.model,
                  signature.data === undefined ? null : base64PngToBytes(signature.data),
                );
              }}
              isSavingToDrive={drive.state.status === 'saving'}
              isSavedToDrive={drive.state.status === 'saved'}
              onSaveToDrive={() => {
                void drive.save({
                  model: built.model,
                  draftId: draftId ?? '',
                  signature:
                    signature.data === undefined ? null : base64PngToBytes(signature.data),
                  token: token ?? '',
                });
              }}
              showDiscardDraft={isDraft}
              onDiscardDraft={handleDiscardDraft}
              isDiscardingDraft={discardMutation.isPending}
            />
          </div>

          {drive.state.status === 'saving' ? (
            <div className="print-hide">
              <SaveProgress step={drive.state.step} />
            </div>
          ) : null}

          {drive.state.status === 'saved' ? (
            <div className="print-hide flex flex-col gap-4">
              <SaveResult result={drive.state.result} />
              {/* The documents are filed; only the register write failed. */}
              <SheetsSyncWarning
                tracking={drive.state.result.tracking}
                requestId={undefined}
                isRetrying={drive.isRetryingTracking}
                onRetry={() => {
                  void drive.retryTracking();
                }}
              />
            </div>
          ) : null}

          {drive.state.status === 'error' ? (
            <div className="print-hide">
              <RetryUpload
                message={drive.state.message}
                requestId={drive.state.requestId}
                partial={drive.state.partial}
                canRetry={drive.state.canRetry}
                isRetrying={false}
                onRetry={() => {
                  void drive.retry();
                }}
              />
            </div>
          ) : null}

          {pdf.state.status === 'error' || docx.state.status === 'error' ? (
            <div className="print-hide">
              <Card>
                <p role="alert" className="text-brand-red text-sm">
                  {pdf.state.status === 'error' ? pdf.state.message : ''}
                  {docx.state.status === 'error' ? docx.state.message : ''}
                </p>
              </Card>
            </div>
          ) : null}

          {built.blockers.length > 0 ? (
            <div className="print-hide">
              <Card title="This quotation cannot be exported yet">
                <ul className="flex flex-col gap-1 text-sm">
                  {built.blockers.map((blocker) => (
                    <li key={blocker.code} className="text-slate-700">
                      <span className="font-medium text-slate-900">{blocker.section}:</span>{' '}
                      {blocker.message}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          ) : null}

          <div className="print-root flex justify-center overflow-x-auto">
            <ErrorBoundary>
              <QuotationPreview
                model={built.model}
                letterheadUrl={assets.data?.letterheadPreview ?? ''}
                scale={scale}
              />
            </ErrorBoundary>
          </div>
        </div>
      )}
    </>
  );
}
