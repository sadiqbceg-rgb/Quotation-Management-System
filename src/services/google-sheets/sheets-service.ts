/**
 * The quotation register, over the shared API client.
 *
 * ---------------------------------------------------------------------------
 * THE BROWSER NEVER TOUCHES SHEETS
 * ---------------------------------------------------------------------------
 * No `googleapis`, no `gapi`, no Google credential. Apps Script owns the
 * spreadsheet, and the spreadsheet id never leaves it — a browser that knew the
 * id could be pointed at the `Users` sheet by anyone who read the bundle.
 *
 * What comes back is the register (PRD §31): what staff see, including a Status
 * they may have changed in the Sheet by hand, and the Drive links recorded when
 * the documents were filed.
 */

import { callAction } from '@/services/api/client';
import { isDriveUrl } from '@shared/drive-links';
import type { QuotationStatus } from '@shared/types';

/** One row of the register, or a draft that has not reached it yet. */
export interface TrackedQuotation {
  draftId: string;
  quotationNumber: string;
  /** ISO `YYYY-MM-DD`. The sheet stores `DD-MM-YYYY`; the server converts. */
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
  driveFolderUrl: string;
  pdfUrl: string;
  docxUrl: string;
  /** False for a draft with no register row. */
  tracked: boolean;
}

/** Whether the register row was written (PRD §30 step 13). */
export interface TrackingOutcome {
  status: 'recorded' | 'failed' | 'skipped';
  disposition?: 'appended' | 'updated';
  message?: string;
  code?: string;
}

/**
 * Only render a link the server actually recorded.
 *
 * A Drive link is validated on the way out of Apps Script, but the list is the
 * one place a URL reaches an `href`, so it is checked again here. A blank or
 * malformed value becomes no link rather than a dead one (PRD §34).
 */
export function driveLinkOf(value: string): string | null {
  return value.length > 0 && isDriveUrl(value) ? value : null;
}

export async function listTrackedQuotations(token: string): Promise<TrackedQuotation[]> {
  return callAction<Record<string, never>, TrackedQuotation[]>('quotation.list', {}, { token });
}

export interface StatusChangeResult {
  quotationNumber: string;
  status: QuotationStatus;
  /** False when the quotation has no register row — it is not in Drive yet. */
  tracked: boolean;
}

export async function setQuotationStatus(
  quotationNumber: string,
  status: QuotationStatus,
  token: string,
): Promise<StatusChangeResult> {
  return callAction<{ quotationNumber: string; status: QuotationStatus }, StatusChangeResult>(
    'quotation.updateStatus',
    { quotationNumber, status },
    { token },
  );
}

export interface RecordTrackingResult {
  draftId: string;
  quotationNumber: string;
  tracking: TrackingOutcome;
}

/**
 * Retry the register write for a quotation already in Drive (PRD §37).
 *
 * Sends nothing but the draft id: the server re-reads the archive for the URLs
 * rather than trusting the client, and re-uploading the documents to fix a
 * spreadsheet row would cost two megabytes for nothing.
 */
export async function retryTracking(
  draftId: string,
  token: string,
): Promise<RecordTrackingResult> {
  return callAction<{ draftId: string }, RecordTrackingResult>(
    'quotation.recordTracking',
    { draftId },
    { token },
  );
}
