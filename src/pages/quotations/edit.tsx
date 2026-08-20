import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Card } from '@/components/common/Card';
import { PageHeader } from '@/components/common/PageHeader';
import { Spinner } from '@/components/common/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { messageOf } from '@/services/api/errors';
import { getQuotationByDraftId } from '@/services/quotation/quotation-service';
import { emptyQuotationForm } from '@/hooks/useQuotationForm';
import { getSettings } from '@/services/settings/settings-service';
import { halalas, milli } from '@shared/money';
import { FALLBACK_SETTINGS, NewQuotationForm, type ExistingQuotation } from './new';
import type { EditorLineItem } from '@/hooks/useLineItems';
import type { EditorTerm } from '@/hooks/useQuotationTerms';
import type { QuotationFormValues } from '@/schemas/quotation-schema';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * A stored whole number, or `null` when the record simply does not carry one.
 *
 * Distinct from `integer` above, which folds a missing value into 0. For
 * `validityDays` the difference is the whole point: 0 is not a validity period,
 * and "absent" has to stay tellable from "present" so a legacy quotation can be
 * recognised as legacy instead of being treated as one issued for zero days.
 */
function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/**
 * The saved line rows, as the editor holds them.
 *
 * `amount` is derived rather than read: the stored payload carries quantity and
 * unit price, and the editor recomputes the amount from them. Reading a stored
 * amount would let a stale figure survive an edit.
 */
function toEditorLines(raw: unknown): EditorLineItem[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((entry, index) => {
    const line = entry as Record<string, unknown>;
    const quantity = integer(line['quantity']);
    const unitPrice = integer(line['unitPrice']);
    const category = text(line['category']);

    return {
      id: `saved-${String(index)}`,
      category:
        category === 'Manpower' || category === 'Equipment' || category === 'Materials'
          ? category
          : 'Materials',
      description: text(line['description']),
      quantity: milli(quantity),
      unit: text(line['unit']),
      unitPrice: halalas(unitPrice),
      amount: halalas(Math.round((quantity * unitPrice) / 1_000)),
      remarks: text(line['remarks']),
    };
  });
}

/**
 * The saved terms, as the editor holds them.
 *
 * `bodyTemplate` is seeded from the stored template when the quotation kept
 * one, and otherwise from the resolved body. The template is what the user
 * edits; the resolved body is what was printed, and it is re-resolved on save.
 */
function toEditorTerms(raw: unknown): EditorTerm[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((entry, index) => {
    const term = entry as Record<string, unknown>;
    const template = text(term['bodyTemplate']);

    return {
      id: text(term['id']).length > 0 ? text(term['id']) : `local:saved-${String(index)}`,
      title: text(term['title']),
      bodyTemplate: template.length > 0 ? template : text(term['body']),
      source: 'library',
      libraryTitle: null,
      libraryBody: null,
    };
  });
}

function toFormValues(stored: Record<string, unknown>): QuotationFormValues {
  const empty = emptyQuotationForm();
  const client = (stored['client'] ?? {}) as Record<string, unknown>;
  const vatBasisPoints = integer(stored['vatRateBasisPoints']);
  const discountBasisPoints = integer(stored['discountRateBasisPoints']);

  return {
    ...empty,
    quotationDate: text(stored['quotationDate']).length > 0
      ? text(stored['quotationDate'])
      : empty.quotationDate,
    quotationFor: text(stored['quotationFor']),
    scopeOfWork: text(stored['scopeOfWork']),
    pricingMode: stored['pricingMode'] === 'rate-only' ? 'rate-only' : 'amount',
    // The rate this quotation was SAVED with, never today's default.
    vatEnabled: vatBasisPoints > 0,
    vatRatePercent: vatBasisPoints / 100,
    discountEnabled: discountBasisPoints > 0,
    discountRatePercent: discountBasisPoints / 100,
    closingParagraph: text(stored['closingParagraph']),
    client: {
      clientName: text(client['clientName']),
      companyName: text(client['companyName']),
      address: text(client['address']),
      contactPerson: text(client['contactPerson']),
      email: text(client['email']),
      phone: text(client['phone']),
      projectName: text(client['projectName']),
      projectLocation: text(client['projectLocation']),
      clientReference: text(client['clientReference']),
    },
  };
}

/**
 * Edit a saved quotation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE SAME FORM
 * ---------------------------------------------------------------------------
 * Editing and creating differ in exactly one thing: whether the draft id
 * already exists. `quotation.save` finds the record by that id, keeps the
 * number already issued, refuses a submitted number that disagrees with the
 * stored one (§7.7), and reserves a new number only when finalizing something
 * that has none. So editing needs no new action and no new validation — it
 * needed a way in, which is this page.
 *
 * Nothing here recomputes money. The server revalidates every field and
 * recomputes the totals from the lines it was sent, rejecting a client figure
 * that disagrees, exactly as it does for a new quotation.
 *
 * ---------------------------------------------------------------------------
 * WHAT COMPANY SETTINGS MAY AND MAY NOT TOUCH HERE
 * ---------------------------------------------------------------------------
 * They may not decide a single thing this quotation already recorded. The VAT
 * rate, the closing paragraph and the validity period are all read from the
 * STORED RECORD: `existing.values` beats `settings` for every form field, and
 * `existing.validityDays` is what `{{quotation.validityDays}}` resolves to.
 *
 * The settings read that remains feeds exactly one control: the "Restore the
 * company default" button beside the closing paragraph. That button's entire
 * job is to fetch today's company default on request, so reading it is the
 * behaviour, not a leak — and it happens only when a user presses it.
 *
 * Because nothing on load depends on the read, the form is not gated on it. An
 * outage costs the restore button its accuracy and nothing else.
 */
export default function EditQuotationPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;

  const quotation = useQuery({
    queryKey: ['quotation', draftId],
    queryFn: () => getQuotationByDraftId(draftId ?? '', token ?? ''),
    enabled: token !== null && draftId !== undefined,
  });

  // Same key as the New Quotation page, so the two share one cached read.
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => getSettings(token ?? ''),
    enabled: token !== null,
    retry: 1,
    retryDelay: 250,
  });

  const stored = quotation.data?.quotation as Record<string, unknown> | undefined;

  const existing = useMemo<ExistingQuotation | undefined>(() => {
    if (stored === undefined || draftId === undefined) return undefined;

    return {
      draftId,
      quotationNumber: text(stored['quotationNumber']),
      values: toFormValues(stored),
      lines: toEditorLines(stored['lines']),
      terms: toEditorTerms(stored['terms']),
      personId: (() => {
        const id = text((stored['authorizedPerson'] as Record<string, unknown> | undefined)?.['id']);
        return id.length > 0 ? id : null;
      })(),
      // The validity this quotation was ISSUED with. Company Settings are not
      // consulted for it — that is what stops a later change reaching back.
      validityDays: optionalInteger(stored['validityDays']),
    };
  }, [stored, draftId]);

  // Only the quotation is waited for. The settings read feeds one button, and
  // holding the whole form for it would trade a real delay for nothing.
  if (quotation.isPending) {
    return (
      <>
        <PageHeader title="Edit Quotation" description="Loading the saved quotation." />
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="Loading the quotation" />
        </div>
      </>
    );
  }

  if (quotation.isError || existing === undefined) {
    return (
      <>
        <PageHeader title="Edit Quotation" />
        <Card>
          <p role="alert" className="text-brand-red text-sm">
            {quotation.isError
              ? messageOf(quotation.error)
              : 'That quotation could not be found.'}
          </p>
        </Card>
      </>
    );
  }

  return (
    <NewQuotationForm
      existing={existing}
      settings={settings.data?.business ?? FALLBACK_SETTINGS}
    />
  );
}
