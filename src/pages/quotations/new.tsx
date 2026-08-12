import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { PhasePlaceholder } from '@/components/common/PhasePlaceholder';
import { QuotationInfoSection } from '@/components/quotation/QuotationInfoSection';
import { ClientInfoSection } from '@/components/client/ClientInfoSection';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { useQuotationForm } from '@/hooks/useQuotationForm';
import { useLineItems } from '@/hooks/useLineItems';
import { useQuotationTotals } from '@/hooks/useQuotationTotals';
import { QuotationItemsSection } from '@/components/items/QuotationItemsSection';
import { saveQuotation } from '@/services/quotation/quotation-service';
import { AppError, messageOf } from '@/services/api/errors';
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

  const totals = useQuotationTotals({
    items: lineItems.items,
    vatEnabled: watch('vatEnabled'),
    vatRatePercent: watch('vatRatePercent'),
    discountEnabled: watch('discountEnabled'),
    discountRatePercent: watch('discountRatePercent'),
  });

  const [busy, setBusy] = useState<'draft' | 'finalize' | null>(null);

  const token = state.status === 'authenticated' ? state.token : null;
  const isAdmin = state.status === 'authenticated' && state.user.role === 'Admin';

  const submit = async (values: QuotationFormValues, finalize: boolean): Promise<void> => {
    if (token === null) return;

    setBusy(finalize ? 'finalize' : 'draft');
    try {
      const result = await saveQuotation(toPayload(values, lineItems.items), finalize, token);

      if (result.quotationNumber.length > 0) {
        setQuotationNumber(result.quotationNumber);
      }

      show({
        variant: 'success',
        message: finalize
          ? `Quotation ${result.quotationNumber} created.`
          : 'Draft saved. No quotation number has been issued yet.',
      });

      if (finalize) {
        void navigate('/quotations');
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

        <Card title="Terms &amp; Conditions">
          <PhasePlaceholder phase="05 (Terms &amp; Conditions)" feature="Terms selection" />
        </Card>

        <Card title="Authorized Person">
          <PhasePlaceholder phase="06 (Authorized Persons)" feature="Signatory selection" />
        </Card>

        <Card title="Preview and Documents">
          <PhasePlaceholder
            phase="07-09 (Document, PDF, DOCX)"
            feature="Preview and document generation"
          />
        </Card>
      </form>
    </>
  );
}
