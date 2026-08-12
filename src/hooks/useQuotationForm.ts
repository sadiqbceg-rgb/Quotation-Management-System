import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { quotationFormSchema, type QuotationFormValues } from '@/schemas/quotation-schema';
import { newDraftId } from '@/utils/uuid';
import { todayIso } from '@/utils/format-date';
import { DEFAULT_VAT_RATE_BASIS_POINTS } from '@shared/totals';
import { DEFAULT_CLOSING_PARAGRAPH } from '@shared/company-defaults';
import { resolveTermTokens } from '@shared/term-tokens';
import type { TermTokenContext } from '@shared/term-tokens';
import type { QuotationPayload } from '@/services/quotation/quotation-service';
import type { EditorLineItem } from './useLineItems';
import type { EditorTerm } from './useQuotationTerms';

export const DEFAULT_VAT_RATE_PERCENT = DEFAULT_VAT_RATE_BASIS_POINTS / 100;

export function emptyQuotationForm(): QuotationFormValues {
  return {
    quotationDate: todayIso(),
    quotationFor: '',
    pricingMode: 'amount',
    status: 'Pending',
    vatEnabled: true,
    vatRatePercent: DEFAULT_VAT_RATE_PERCENT,
    discountEnabled: false,
    discountRatePercent: 0,
    // Configuration, not a literal in a component — PRD §23 says the company
    // will supply the final wording later.
    closingParagraph: DEFAULT_CLOSING_PARAGRAPH,
    client: {
      clientName: '',
      companyName: '',
      address: '',
      contactPerson: '',
      email: '',
      phone: '',
      projectName: '',
      projectLocation: '',
      clientReference: '',
    },
  };
}

export interface UseQuotationFormOptions {
  /** Editing an existing quotation: its draft id and issued number. */
  existingDraftId?: string;
  existingQuotationNumber?: string;
  defaultValues?: QuotationFormValues;
}

/**
 * Quotation form state.
 *
 * The draft id is minted ONCE, in a ref, when the hook first runs. It is the
 * idempotency key for number reservation (IMPLEMENTATION_PLAN.md §7.5b): if a
 * save is retried — double click, timeout, network blip — the backend returns
 * the number already reserved for this draft instead of burning a new one.
 *
 * Minting an id reserves NOTHING. Opening this form makes no request at all
 * (PRD §35), and a test asserts that.
 */
export function useQuotationForm(options: UseQuotationFormOptions = {}) {
  const draftIdRef = useRef<string>(options.existingDraftId ?? newDraftId());

  const [quotationNumber, setQuotationNumber] = useState<string | null>(
    options.existingQuotationNumber ?? null,
  );

  const form = useForm<QuotationFormValues>({
    resolver: zodResolver(quotationFormSchema),
    defaultValues: options.defaultValues ?? emptyQuotationForm(),
    mode: 'onBlur',
  });

  /**
   * Build the wire payload.
   *
   * Money and quantities are already integer minor units — the conversion
   * happened at the input boundary — so nothing is re-parsed here.
   */
  const toPayload = useCallback(
    (
      values: QuotationFormValues,
      lines: readonly EditorLineItem[] = [],
      terms: readonly EditorTerm[] = [],
      tokenContext?: TermTokenContext,
    ): QuotationPayload => {
      const payload: QuotationPayload = {
        draftId: draftIdRef.current,
        quotationDate: values.quotationDate,
        quotationFor: values.quotationFor,
        pricingMode: values.pricingMode,
        status: values.status,
        client: {
          clientName: values.client.clientName,
          companyName: values.client.companyName,
          address: values.client.address,
          contactPerson: values.client.contactPerson ?? '',
          email: values.client.email ?? '',
          phone: values.client.phone ?? '',
          projectName: values.client.projectName ?? '',
          projectLocation: values.client.projectLocation ?? '',
          clientReference: values.client.clientReference ?? '',
        },
        lines: lines.map((line) => ({
          category: line.category,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          description: line.description,
          unit: line.unit,
          remarks: line.remarks,
        })),
        /*
         * `body` is the SNAPSHOT — the resolved text this quotation was saved
         * with (§6.3, §10.4). `bodyTemplate` travels alongside it purely so
         * reopening the quotation gives the user their template back to edit;
         * the document renders `body`.
         */
        terms: terms.map((term, index) => ({
          id: term.id,
          title: term.title,
          body:
            tokenContext === undefined
              ? term.bodyTemplate
              : resolveTermTokens(term.bodyTemplate, tokenContext).text,
          bodyTemplate: term.bodyTemplate,
          sortOrder: index,
          source: term.source,
        })),
        closingParagraph: values.closingParagraph,
        vatRateBasisPoints: values.vatEnabled ? Math.round(values.vatRatePercent * 100) : 0,
      };

      if (values.discountEnabled) {
        payload.discountRateBasisPoints = Math.round(values.discountRatePercent * 100);
      }

      if (quotationNumber !== null && quotationNumber.length > 0) {
        payload.quotationNumber = quotationNumber;
      }

      return payload;
    },
    [quotationNumber],
  );

  return {
    form,
    draftId: draftIdRef.current,
    quotationNumber,
    setQuotationNumber,
    toPayload,
  };
}
