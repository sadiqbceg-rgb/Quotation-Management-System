import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { describeError } from '@/services/api/errors';
import {
  listTrackedQuotations,
  setQuotationStatus,
  type TrackedQuotation,
} from '@/services/google-sheets/sheets-service';
import type { QuotationStatus } from '@shared/types';

export type StatusFilter = 'all' | QuotationStatus;

export interface QuotationFilterState {
  search: string;
  status: StatusFilter;
}

export interface UseQuotationTrackingResult {
  /** Everything the register holds, plus untracked drafts. */
  all: TrackedQuotation[];
  /** What the current search and status filter leave. */
  rows: TrackedQuotation[];
  filters: QuotationFilterState;
  setSearch: (value: string) => void;
  setStatus: (value: StatusFilter) => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  changeStatus: (quotationNumber: string, status: QuotationStatus) => void;
  isChangingStatus: boolean;
}

/** Case-insensitive match across the fields a person would search by. */
function matches(row: TrackedQuotation, term: string): boolean {
  if (term.length === 0) return true;

  return [row.quotationNumber, row.clientName, row.companyName, row.quotationFor].some((field) =>
    field.toLowerCase().includes(term),
  );
}

/**
 * The quotation register (PRD §31).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REFETCHES ON FOCUS
 * ---------------------------------------------------------------------------
 * The Sheet is the tracking system, and staff change Status IN the Sheet
 * (§17.5). So the list can go stale without this application doing anything —
 * someone approves a quotation in another tab and the register here still says
 * Pending. Refetching when the window regains focus is what makes the app agree
 * with the spreadsheet a person was just looking at.
 *
 * Filtering is client-side: the register is a few hundred rows in V1, and a
 * round trip per keystroke would be slower and would burn the Apps Script
 * execution budget for nothing.
 */
export function useQuotationTracking(): UseQuotationTrackingResult {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const token = state.status === 'authenticated' ? state.token : null;

  const quotations = useQuery({
    queryKey: ['quotations'],
    queryFn: () => listTrackedQuotations(token ?? ''),
    enabled: token !== null,
    refetchOnWindowFocus: true,
  });

  const statusMutation = useMutation({
    mutationFn: (input: { quotationNumber: string; status: QuotationStatus }) =>
      setQuotationStatus(input.quotationNumber, input.status, token ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['quotations'] });
      show({ variant: 'success', message: 'Status updated.' });
    },
    onError: (error: unknown) => {
      show({ variant: 'error', message: describeError(error) });
    },
  });

  const all = useMemo(() => quotations.data ?? [], [quotations.data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();

    return all.filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      return matches(row, term);
    });
  }, [all, search, status]);

  return {
    all,
    rows,
    filters: { search, status },
    setSearch,
    setStatus,
    isLoading: quotations.isPending,
    isError: quotations.isError,
    error: quotations.error,
    changeStatus: (quotationNumber, nextStatus) => {
      statusMutation.mutate({ quotationNumber, status: nextStatus });
    },
    isChangingStatus: statusMutation.isPending,
  };
}
