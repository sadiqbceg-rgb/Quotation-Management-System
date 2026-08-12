/**
 * Quotation actions, over the shared API client.
 *
 * Nothing here computes an official quotation number. The number is issued by
 * the backend and only by the backend (IMPLEMENTATION_PLAN.md §7.3); these
 * functions carry it, they never derive it.
 */

import { callAction } from '@/services/api/client';
import type { QuotationStatus, TermSource } from '@shared/types';

export interface QuotationLinePayload {
  category: string;
  /** Integer thousandths. */
  quantity: number;
  /** Integer halalas. */
  unitPrice: number;
  description: string;
  unit: string;
  remarks: string;
}

export interface QuotationTermPayload {
  /** A library id, or `local:<uuid>` for a term created on this quotation. */
  id: string;
  title: string;
  /** The resolved snapshot text — what the document prints. */
  body: string;
  /** The unresolved template, kept so the quotation can be reopened and edited. */
  bodyTemplate: string;
  sortOrder: number;
  source: TermSource;
}

export interface QuotationPayload {
  draftId: string;
  quotationDate: string;
  quotationFor: string;
  pricingMode: string;
  status: QuotationStatus;
  client: Record<string, string | undefined>;
  lines: QuotationLinePayload[];
  terms?: QuotationTermPayload[];
  closingParagraph?: string;
  discountRateBasisPoints?: number;
  vatRateBasisPoints?: number;
  /** Echoed on an update. The server ignores it and re-reads storage. */
  quotationNumber?: string;
}

export interface SaveResult {
  draftId: string;
  /** Empty while the quotation is still a draft. */
  quotationNumber: string;
  status: QuotationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationSummary {
  draftId: string;
  quotationNumber: string;
  quotationDate: string;
  quotationFor: string;
  clientName: string;
  companyName: string;
  /** Integer halalas. */
  grandTotal: number;
  status: QuotationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredQuotation {
  quotation: QuotationPayload & { totals?: Record<string, number> };
  status: QuotationStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Save a quotation.
 *
 * `finalize` is what issues the official number, so it must be reachable only
 * from an explicit user action — never from a mount effect or an autosave
 * (PRD §35).
 */
export async function saveQuotation(
  quotation: QuotationPayload,
  finalize: boolean,
  token: string,
): Promise<SaveResult> {
  return callAction<{ quotation: QuotationPayload; finalize: boolean }, SaveResult>(
    'quotation.save',
    { quotation, finalize },
    { token },
  );
}

export async function listQuotations(token: string): Promise<QuotationSummary[]> {
  return callAction<Record<string, never>, QuotationSummary[]>('quotation.list', {}, { token });
}

export async function getQuotationByDraftId(
  draftId: string,
  token: string,
): Promise<StoredQuotation> {
  return callAction<{ draftId: string }, StoredQuotation>('quotation.get', { draftId }, { token });
}

export async function updateQuotationStatus(
  quotationNumber: string,
  status: QuotationStatus,
  token: string,
): Promise<{ quotationNumber: string; status: QuotationStatus }> {
  return callAction<
    { quotationNumber: string; status: QuotationStatus },
    { quotationNumber: string; status: QuotationStatus }
  >('quotation.updateStatus', { quotationNumber, status }, { token });
}
