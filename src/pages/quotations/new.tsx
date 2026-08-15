import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { QuotationInfoSection } from '@/components/quotation/QuotationInfoSection';
import { ClientInfoSection } from '@/components/client/ClientInfoSection';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { useQuotationForm } from '@/hooks/useQuotationForm';
import { useLineItems } from '@/hooks/useLineItems';
import { useQuotationTerms } from '@/hooks/useQuotationTerms';
import { useQuotationTotals } from '@/hooks/useQuotationTotals';
import { useAuthorizedPersons } from '@/hooks/useAuthorizedPersons';
import { QuotationItemsSection } from '@/components/items/QuotationItemsSection';
import { QuotationTermsSection } from '@/components/terms/QuotationTermsSection';
import { AuthorizedPersonSection } from '@/components/signatories/AuthorizedPersonSection';
import { saveQuotation } from '@/services/quotation/quotation-service';
import { AppError, messageOf } from '@/services/api/errors';
import { formatDisplayDate } from '@/utils/format-date';
import { getEnv } from '@/config/env';
import { DEFAULT_CLOSING_PARAGRAPH, DEFAULT_COMPANY_NAME } from '@shared/company-defaults';
import type { TermTokenContext } from '@shared/term-tokens';
import type { QuotationFormValues } from '@/schemas/quotation-schema';

/**
 * New Quotation.
 *
 * PRD §35: opening this page must NOT create a quotation or reserve a number.
 * Nothing here runs on mount — the draft id is minted locally, and the backend
 * is contacted only when the user presses Save or Finalize.
 */
export default function NewQuotationPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const { form, quotationNumber, setQuotationNumber, toPayload } = useQuotationForm();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = form;

  const lineItems = useLineItems();
  const terms = useQuotationTerms();
  const signatories = useAuthorizedPersons();

  const vatEnabled = watch('vatEnabled');
  const vatRatePercent = watch('vatRatePercent');

  const totals = useQuotationTotals({
    items: lineItems.items,
    vatEnabled,
    vatRatePercent,
    discountEnabled: watch('discountEnabled'),
    discountRatePercent: watch('discountRatePercent'),
  });

  const quotationDate = watch('quotationDate');
  const clientName = watch('client.clientName');
  const clientCompanyName = watch('client.companyName');

  /**
   * What the whitelisted term tokens resolve to (§10.2).
   *
   * A field the user has not filled in yet stays EMPTY rather than being
   * guessed. The resolver leaves an empty-valued token visible and reports it,
   * so an unresolved placeholder is something the user can see and fix instead
   * of a blank in a document nobody caught.
   */
  const tokenContext = useMemo<TermTokenContext>(
    () => ({
      companyName: DEFAULT_COMPANY_NAME,
      // Configuration, never a literal here — see src/config/env.ts.
      companyVatNumber: getEnv().companyVatNumber,
      clientCompanyName,
      clientName,
      quotationNumber: quotationNumber ?? '',
      quotationDate: formatDisplayDate(quotationDate),
      validityDays: '',
      vatRate: vatEnabled ? `${String(vatRatePercent)}%` : '',
    }),
    [clientCompanyName, clientName, quotationNumber, quotationDate, vatEnabled, vatRatePercent],
  );

  const [busy, setBusy] = useState<'draft' | 'finalize' | null>(null);

  const token = state.status === 'authenticated' ? state.token : null;
  const isAdmin = state.status === 'authenticated' && state.user.role === 'Admin';

  const [personError, setPersonError] = useState<string | null>(null);
  /**
   * Preview reads the SAVED quotation, so it is offered only once one exists.
   * Previewing unsaved form state would show a document that cannot be produced.
   */
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);

  const submit = async (values: QuotationFormValues, finalize: boolean): Promise<void> => {
    if (token === null) return;

    /*
     * A signature that will not load blocks issuing the quotation.
     *
     * The server enforces the same rule, but stopping here keeps the message
     * next to the field. Silently producing a document with no signature is the
     * one outcome that must not be possible.
     */
    if (finalize && signatories.blocksDocument) {
      const message =
        signatories.selected === null
          ? 'Select an authorized person before creating the quotation.'
          : 'The signature image for this person could not be loaded, so the quotation cannot be issued yet.';

      setPersonError(message);
      show({ variant: 'error', message });
      return;
    }

    setPersonError(null);
    setBusy(finalize ? 'finalize' : 'draft');
    try {
      const result = await saveQuotation(
        toPayload(values, lineItems.items, terms.terms, tokenContext, signatories.snapshot),
        finalize,
        token,
      );

      if (result.quotationNumber.length > 0) {
        setQuotationNumber(result.quotationNumber);
      }
      setSavedDraftId(result.draftId);

      show({
        variant: 'success',
        message: finalize
          ? `Quotation ${result.quotationNumber} created.`
          : 'Draft saved. No quotation number has been issued yet.',
      });

      if (finalize) {
        /*
         * Straight to the new quotation's own preview, which is where PRD §45
         * goes next: preview (19) → PDF (20) → Word (21) → Save to Drive (22).
         *
         * It used to go to `/quotations`, the register — and the register is
         * populated from the tracking sheet, which is only written once the
         * documents are IN Drive. So a quotation that had just been created was
         * not on the screen the user was sent to, and there was no link back to
         * it from anywhere: the preview was reachable only by typing the URL.
         */
        void navigate(`/quotations/${result.draftId}/preview`);
      }
    } catch (error: unknown) {
      show({
        variant: 'error',
        message: messageOf(error),
        ...(error instanceof AppError && error.requestId !== undefined
          ? { requestId: error.requestId }
          : {}),
      });
    } finally {
      setBusy(null);
    }
  };

  /**
   * A draft save skips the completeness rules, so it must bypass the resolver
   * rather than run through handleSubmit — a half-filled form is a legitimate
   * draft, and blocking it would lose the user's work.
   */
  const saveDraft = (): void => {
    void submit(form.getValues(), false);
  };

  return (
    <>
      <PageHeader
        title="New Quotation"
        description="Enter the details. A quotation number is issued only when you finalize."
        actions={
          <>
            <Button variant="secondary" onClick={saveDraft} isLoading={busy === 'draft'}>
              Save draft
            </Button>
            {savedDraftId === null ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  void navigate(`/quotations/${savedDraftId}/preview`);
                }}
              >
                Preview
              </Button>
            )}
            <Button
              isLoading={busy === 'finalize'}
              onClick={() => {
                void handleSubmit((values) => submit(values, true))();
              }}
            >
              Create quotation
            </Button>
          </>
        }
      />

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit((values) => submit(values, true))();
        }}
      >
        <QuotationInfoSection
          register={register}
          errors={errors}
          watch={watch}
          quotationNumber={quotationNumber}
          canBackdateAcrossYears={isAdmin}
        />

        <ClientInfoSection register={register} errors={errors} />

        <QuotationItemsSection
          lineItems={lineItems}
          totals={totals}
          pricingMode={watch('pricingMode')}
        />

        <QuotationTermsSection
          terms={terms}
          tokenContext={tokenContext}
          closingParagraph={watch('closingParagraph')}
          closingParagraphDefault={DEFAULT_CLOSING_PARAGRAPH}
          closingParagraphError={errors.closingParagraph?.message}
          onClosingParagraphChange={(value) => {
            form.setValue('closingParagraph', value, { shouldValidate: false });
          }}
        />

        <AuthorizedPersonSection
          signatories={signatories}
          error={personError ?? undefined}
        />
      </form>
    </>
  );
}
