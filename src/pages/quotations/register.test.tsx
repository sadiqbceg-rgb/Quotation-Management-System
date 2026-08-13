/**
 * The quotation register in the browser (PRD §31).
 *
 * The service layer is stubbed, so no request leaves the machine and no
 * spreadsheet — real or otherwise — is touched. What is asserted is what a
 * person sees: the columns, the Drive link, the filters, and the status
 * control that only appears where a status can actually be changed.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import QuotationsPage from '@/pages/quotations/index';
import { SheetsSyncWarning } from '@/components/quotation/SheetsSyncWarning';
import * as sheetsService from '@/services/google-sheets/sheets-service';
import { driveLinkOf, type TrackedQuotation } from '@/services/google-sheets/sheets-service';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';

const FOLDER_URL = 'https://drive.google.com/drive/folders/test-only-folder-1';

function tracked(overrides: Partial<TrackedQuotation> = {}): TrackedQuotation {
  return {
    draftId: 'draft-0001',
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY manpower supply',
    clientName: 'TEST_ONLY Contact',
    companyName: 'TEST_ONLY Client Co.',
    grandTotal: 92_000,
    status: 'Pending',
    createdBy: 'test-only.user@example.invalid',
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    driveFolderUrl: FOLDER_URL,
    pdfUrl: 'https://drive.google.com/file/d/test-only-file-1/view',
    docxUrl: 'https://drive.google.com/file/d/test-only-file-2/view',
    tracked: true,
    ...overrides,
  };
}

let listSpy: MockInstance<typeof sheetsService.listTrackedQuotations>;
let statusSpy: MockInstance<typeof sheetsService.setQuotationStatus>;

function renderRegister(rows: TrackedQuotation[]) {
  listSpy.mockResolvedValue(rows);
  return renderWithProviders(<QuotationsPage />, { user: TEST_ONLY_USER });
}

beforeEach(() => {
  listSpy = vi.spyOn(sheetsService, 'listTrackedQuotations');
  statusSpy = vi.spyOn(sheetsService, 'setQuotationStatus').mockResolvedValue({
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    status: 'Approved',
    tracked: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('the register', () => {
  it('shows the PRD §31 columns', async () => {
    renderRegister([tracked()]);

    for (const header of [
      'Quotation No.',
      'Date',
      'Client Name',
      'Company Name',
      'Quotation For',
      'Total Amount',
      'Status',
      'Drive Folder',
    ]) {
      expect(await screen.findByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('shows the quotation number, the client and the server-computed total', async () => {
    renderRegister([tracked()]);

    expect(await screen.findByText('SFC/RUH/QTN/2026/004')).toBeInTheDocument();
    expect(screen.getByText('TEST_ONLY Client Co.')).toBeInTheDocument();
    // 92,000 halalas → SAR 920.00.
    expect(screen.getByText(/920\.00/)).toBeInTheDocument();
  });

  it('links the Drive folder', async () => {
    renderRegister([tracked()]);

    const link = await screen.findByRole('link', { name: /open/i });
    expect(link).toHaveAttribute('href', FOLDER_URL);
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('shows a dash rather than a dead link when there is no folder', async () => {
    renderRegister([tracked({ driveFolderUrl: '', tracked: false })]);

    await screen.findByText('SFC/RUH/QTN/2026/004');
    expect(screen.queryByRole('link', { name: /open/i })).toBeNull();
    expect(screen.getByLabelText('Not saved to Drive')).toBeInTheDocument();
  });

  it('refuses to render a link that is not a Drive URL', () => {
    // The list is the one place a stored URL reaches an href (PRD §34).
    expect(driveLinkOf(FOLDER_URL)).toBe(FOLDER_URL);
    expect(driveLinkOf('https://attacker.example/x')).toBeNull();
    expect(driveLinkOf('')).toBeNull();
  });

  it('says so when the register is empty, rather than showing an error', async () => {
    renderRegister([]);

    expect(await screen.findByText(/no quotations yet/i)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('search and filter', () => {
  const rows = [
    tracked(),
    tracked({
      draftId: 'draft-0002',
      quotationNumber: 'SFC/RUH/QTN/2026/005',
      clientName: 'TEST_ONLY Other',
      companyName: 'TEST_ONLY Other Co.',
      status: 'Approved',
    }),
  ];

  it('filters by search term', async () => {
    const user = userEvent.setup();
    renderRegister(rows);

    await screen.findByText('SFC/RUH/QTN/2026/004');
    await user.type(screen.getByLabelText(/search quotations/i), 'Other');

    await waitFor(() => {
      expect(screen.queryByText('SFC/RUH/QTN/2026/004')).toBeNull();
    });
    expect(screen.getByText('SFC/RUH/QTN/2026/005')).toBeInTheDocument();
  });

  it('searches the quotation number too', async () => {
    const user = userEvent.setup();
    renderRegister(rows);

    await screen.findByText('SFC/RUH/QTN/2026/004');
    await user.type(screen.getByLabelText(/search quotations/i), '2026/005');

    await waitFor(() => {
      expect(screen.queryByText('SFC/RUH/QTN/2026/004')).toBeNull();
    });
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderRegister(rows);

    await screen.findByText('SFC/RUH/QTN/2026/004');
    await user.selectOptions(screen.getByLabelText(/filter by status/i), 'Approved');

    await waitFor(() => {
      expect(screen.queryByText('SFC/RUH/QTN/2026/004')).toBeNull();
    });
    expect(screen.getByText('SFC/RUH/QTN/2026/005')).toBeInTheDocument();
  });

  it('explains an empty result differently from an empty register', async () => {
    const user = userEvent.setup();
    renderRegister(rows);

    await screen.findByText('SFC/RUH/QTN/2026/004');
    await user.type(screen.getByLabelText(/search quotations/i), 'no such client');

    expect(await screen.findByText(/no quotations match your filters/i)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('the status control', () => {
  it('changes the status through the backend', async () => {
    const user = userEvent.setup();
    renderRegister([tracked()]);

    const select = await screen.findByLabelText('Status for SFC/RUH/QTN/2026/004');
    await user.selectOptions(select, 'Approved');

    await waitFor(() => {
      expect(statusSpy).toHaveBeenCalledWith(
        'SFC/RUH/QTN/2026/004',
        'Approved',
        expect.any(String),
      );
    });
  });

  it('offers exactly the three statuses', async () => {
    renderRegister([tracked()]);

    const select = await screen.findByLabelText('Status for SFC/RUH/QTN/2026/004');
    const options = within(select).getAllByRole('option').map((option) => option.textContent);

    expect(options).toEqual(['Pending', 'Approved', 'Rejected']);
  });

  it('shows a badge, not a dropdown, for a draft with no number', async () => {
    renderRegister([tracked({ quotationNumber: '', driveFolderUrl: '', tracked: false })]);

    await screen.findByText(/draft/i);
    // Status belongs to the register, and a draft has no row in it.
    expect(screen.queryByRole('combobox', { name: /^status for/i })).toBeNull();
  });

  it('shows a status a colleague set in the spreadsheet', async () => {
    renderRegister([tracked({ status: 'Approved' })]);

    const select = await screen.findByLabelText('Status for SFC/RUH/QTN/2026/004');
    expect(select).toHaveValue('Approved');
  });
});

/* -------------------------------------------------------------------------- */

describe('the tracking warning (PRD §37)', () => {
  it('is silent when the row was written', () => {
    render(
      <SheetsSyncWarning
        tracking={{ status: 'recorded', disposition: 'appended' }}
        requestId={undefined}
        isRetrying={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is silent when the upload itself was incomplete', () => {
    // The Drive retry is the action then; two contradictory instructions on one
    // screen is worse than one.
    render(
      <SheetsSyncWarning
        tracking={{ status: 'skipped' }}
        requestId={undefined}
        isRetrying={false}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says the documents are safe and offers a retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <SheetsSyncWarning
        tracking={{
          status: 'failed',
          code: 'SHEETS_WRITE_FAILED',
          message:
            'The documents were saved to Google Drive, but quotation tracking was not updated.',
        }}
        requestId="test-request"
        isRetrying={false}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/saved to Google Drive, but/i);
    expect(screen.getByRole('status')).toHaveTextContent(/test-request/);
    expect(screen.getByText(/already in Drive/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry tracking/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
