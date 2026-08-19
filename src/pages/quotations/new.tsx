import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Spinner } from '@/components/common/Spinner';
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
import { emptyQuotationForm } from '@/hooks/useQuotationForm';
import { getSettings, type BusinessSettings } from '@/services/settings/settings-service';
import {
  DEFAULT_CLOSING_PARAGRAPH,
  DEFAULT_COMPANY_NAME,
  DEFAULT_QUOTATION_VALIDITY_DAYS,
} from '@shared/company-defaults';
import { DEFAULT_VAT_RATE_BASIS_POINTS } from '@shared/totals';
import type { TermTokenContext } from '@shared/term-tokens';
import type { QuotationFormValues } from '@/schemas/quotation-schema';

/**
 * What a quotation starts from when Company Settings cannot be read.
 *
 * Exactly the constants this system shipped with, so a backend that is down
 * degrades to the previous behaviour rather than to a blank or a guess.
 */
const FALLBACK_SETTINGS: BusinessSettings = {
  defaultVatRateBasisPoints: DEFAULT_VAT_RATE_BASIS_POINTS,
  quotationValidityDays: DEFAULT_QUOTATION_VALIDITY_DAYS,
  defaultClosingParagraph: DEFAULT_CLOSING_PARAGRAPH,
};

/**
 * New Quotation.
 *
 * PRD §35: opening this page must NOT create a quotation or reserve a number.
 * Reading the company defaults is not that — no number is issued and no record
 * is written until the user presses Save or Finalize, and a test asserts it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FORM MOUNTS ONLY AFTER THE SETTINGS RESOLVE
 * ---------------------------------------------------------------------------
 * `useForm` captures its `defaultValues` on the FIRST render and never re-reads
 * them. Mounting the form before the settings arrive would therefore mean
 * either showing the old constants and then overwriting whatever the user had
 * begun typing, or leaving the wrong VAT rate on screen. Waiting is the only
 * option that does neither.
 *
 * The wait is bounded: one retry, then the shipped constants. A backend that is
 * down must not stop somebody writing a quotation.
 */
export default function NewQuotationPage() {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => getSettings(token ?? ''),
    enabled: token !== null,
    /*
     * One quick retry, not the global three.
     *
     * The global 2s/4s/8s backoff would hold this page for fourteen seconds
     * before falling back. But no retry at all is worse: a single transient
     * blip would silently start the quotation at the shipped 15% when the
     * company has configured something else, and nobody would know. One fast
     * attempt covers the blip; anything longer is an outage, and the fallback
     * below is announced rather than silent.
     */
    retry: 1,
    retryDelay: 250,
  });

  if (settings.isPending && token !== null) {
    return (
      <>
        <PageHeader
          title="New Quotation"
          description="Enter the details. A quotation number is issued only when you finalize."
        />
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="Loading company defaults" />
        </div>
      </>
    );
  }

  /*
   * A failed read is not a blocked page. `settings.data` is undefined on error,
   * and the shipped constants are exactly what this form used before Company
   * Settings existed.
   */
  return (
    <NewQuotationForm
      settings={settings.data?.business ?? FALLBACK_SETTINGS}
      usingFallback={settings.data === undefined}
    />
  );
}

export interface NewQuotationFormProps {
  /**
   * Resolved before this component mounts — see the note above.
   *
   * Defaulted so the form can be rendered directly, without a settings round
   * trip, by the component tests that mount it as a harness for the items,
   * terms and signatory sections. Those tests are about those sections; making
   * them wait on company defaults would couple them to an unrelated concern.
   */
  settings?: BusinessSettings;
  /** True when the company defaults could not be read and the constants are in use. */
  usingFallback?: boolean;
}

export function NewQuotationForm({
  settings = FALLBACK_SETTINGS,
  usingFallback = false,
}: NewQuotationFormProps) {
  const { state } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  /*
   * The company defaults, applied to THIS new quotation only.
   *
   * The values are copied into the form now and saved onto the quotation, which
   * stores its own VAT rate and its own closing paragraph. Editing the defaults
   * later cannot reach a quotation that already exists — the server recomputes
   * every quotation from the rate held ON that quotation.
   */
  const defaultValues = useMemo<QuotationFormValues>(
    () => ({
      ...emptyQuotationForm(),
      vatRatePercent: settings.defaultVatRateBasisPoints / 100,
      closingParagraph: settings.defaultClosingParagraph,
    }),
    [settings],
  );

  const { form, quotationNumber, setQuotationNumber, toPayload } = useQuotationForm({
    defaultValues,
  });
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
      /*
       * From Company Settings. This was hardcoded empty, which left the
       * imported term "valid for {{quotation.validityDays}} days" permanently
       * unresolved. The resolved text is what gets SNAPSHOTTED onto the
       * quotation, so the validity a quotation was issued with stays with it.
       */
      validityDays: String(settings.quotationValidityDays),
      vatRate: vatEnabled ? `${String(vatRatePercent)}%` : '',
    }),
    [
      clientCompanyName,
      clientName,
      quotationNumber,
      quotationDate,
      settings.quotationValidityDays,
      vatEnabled,
      vatRatePercent,
    ],
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

      {usingFallback ? (
        /*
         * Said out loud rather than swallowed.
         *
         * The quotation is still perfectly usable — these are the values the
         * system shipped with — but if the company has configured a different
         * VAT rate or closing paragraph, this one will not have them, and that
         * is something the person writing it must be able to see BEFORE they
         * send it to a client.
         */
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Company defaults could not be loaded, so this quotation starts from the system defaults.
          Check the VAT rate and the closing paragraph before you finalize it.
        </p>
      ) : null}

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

        <ClientInfoSection
          register={register}
          errors={errors}
          /*
           * Prefill only. The chosen customer's id is deliberately NOT captured
           * — the quotation carries client values, never a reference — so
           * editing that customer later cannot change this quotation (§10.4,
           * the same rule terms and the authorized person already follow).
           */
          onPickCustomer={(customer) => {
            form.setValue('client.clientName', customer.clientName, { shouldValidate: true });
            form.setValue('client.companyName', customer.companyName, { shouldValidate: true });
            form.setValue('client.address', customer.address, { shouldValidate: true });
            form.setValue('client.contactPerson', customer.contactPerson);
            form.setValue('client.email', customer.email);
            form.setValue('client.phone', customer.phone);
          }}
        />

        <QuotationItemsSection
          lineItems={lineItems}
          totals={totals}
          pricingMode={watch('pricingMode')}
        />

        <QuotationTermsSection
          terms={terms}
          tokenContext={tokenContext}
          closingParagraph={watch('closingParagraph')}
          closingParagraphDefault={settings.defaultClosingParagraph}
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
