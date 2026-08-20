/**
 * Discarding a draft, from the preview page (W-7, W-8).
 *
 * Two defects these guard:
 *
 *   W-7 the register was not invalidated, so the global 30-second staleTime
 *       left the discarded draft on screen and the user discarded it twice;
 *   W-8 `isDiscardingDraft` was hardcoded false, so the button never disabled
 *       and a double click sent two requests.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryClient } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';

import { PreviewToolbar } from '@/components/quotation/preview/PreviewToolbar';
import QuotationPreviewPage from '@/pages/quotations/preview';
import * as quotationService from '@/services/quotation/quotation-service';
import * as assetLoader from '@/services/document/asset-loader';
import * as signatoryService from '@/services/signatories/signatory-service';
import * as settingsService from '@/services/settings/settings-service';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';

/** The smallest saved draft the preview will build a document model from. */
function TEST_ONLY_storedDraft(): Record<string, unknown> {
  return {
    draftId: 'draft-1',
    quotationNumber: '',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY manpower supply',
    pricingMode: 'amount',
    scopeOfWork: '',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
    },
    lines: [
      {
        category: 'Manpower',
        description: 'TEST_ONLY General Labour',
        quantity: 1_000,
        unit: 'Hour',
        unitPrice: 2_000,
        remarks: '',
      },
    ],
    terms: [],
    closingParagraph: 'TEST_ONLY closing paragraph.',
    authorizedPerson: null,
    discountRateBasisPoints: 0,
    vatRateBasisPoints: 1_500,
  };
}

/** Three URLs; the real loader imports generated PNGs this test does not need. */
function TEST_ONLY_assets(): Record<string, string> {
  return { letterheadPreview: 'blob:letterhead', seal: 'blob:seal', logo: 'blob:logo' };
}

/* -------------------------------------------------------------------------- */
/* The toolbar's busy contract                                                */
/* -------------------------------------------------------------------------- */

function renderToolbar(overrides: Record<string, unknown> = {}) {
  return renderWithProviders(
    <PreviewToolbar
      quotationNumber="Draft — no number issued"
      pageCount={1}
      canExport={false}
      onBack={() => undefined}
      onPrint={() => undefined}
      isSavingPdf={false}
      onSavePdf={() => undefined}
      isSavingWord={false}
      onSaveWord={() => undefined}
      onSaveToDrive={() => undefined}
      isSavingToDrive={false}
      isSavedToDrive={false}
      showDiscardDraft
      onDiscardDraft={() => undefined}
      isDiscardingDraft={false}
      {...overrides}
    />,
    { user: TEST_ONLY_USER },
  );
}

describe('the discard button', () => {
  it('is offered for a draft', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: /discard draft/i })).toBeInTheDocument();
  });

  it('is not offered once a number has been issued', () => {
    renderToolbar({ showDiscardDraft: false });

    expect(screen.queryByRole('button', { name: /discard draft/i })).not.toBeInTheDocument();
  });

  it('is DISABLED while the request is in flight', () => {
    renderToolbar({ isDiscardingDraft: true });

    // This is the W-8 regression: the prop existed and was wired to a literal
    // `false`, so the button stayed live for the whole request.
    expect(screen.getByRole('button', { name: /discard draft/i })).toBeDisabled();
  });

  it('is enabled again when the request is not in flight', () => {
    renderToolbar({ isDiscardingDraft: false });

    expect(screen.getByRole('button', { name: /discard draft/i })).toBeEnabled();
  });

  it('does not fire its handler while disabled', async () => {
    const onDiscardDraft = vi.fn();
    const user = userEvent.setup();
    renderToolbar({ isDiscardingDraft: true, onDiscardDraft });

    await user.click(screen.getByRole('button', { name: /discard draft/i }));

    expect(onDiscardDraft).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* The page's discard flow                                                    */
/* -------------------------------------------------------------------------- */

const confirmSpy = vi.fn(() => true);

beforeEach(() => {
  vi.restoreAllMocks();
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal('confirm', confirmSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The real page, driven end to end.
 *
 * The preview needs a saved quotation, the generated document assets and a
 * signature before it renders a toolbar, so all three are stubbed. Everything
 * after that — the mutation, the busy state, the cache invalidation — is the
 * page's own code.
 */
describe('discarding from the preview page', () => {
  function stubPage(): void {
    vi.spyOn(quotationService, 'getQuotationByDraftId').mockResolvedValue({
      quotation: TEST_ONLY_storedDraft(),
      status: 'Pending',
      createdBy: TEST_ONLY_USER.email,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:00:00Z',
      driveFolderUrl: '',
      pdfUrl: '',
      docxUrl: '',
      tracked: false,
    } as never);
    vi.spyOn(assetLoader, 'loadDocumentAssets').mockResolvedValue(TEST_ONLY_assets() as never);
    // No signatory on this draft, so no signature fetch happens at all.
    vi.spyOn(signatoryService, 'fetchSignature').mockResolvedValue('' as never);
  }

  async function renderPreview() {
    stubPage();
    const view = renderWithProviders(
      <Routes>
        <Route path="/quotations/:draftId/preview" element={<QuotationPreviewPage />} />
        <Route path="/quotations" element={<div>Register</div>} />
      </Routes>,
      { user: TEST_ONLY_USER, route: '/quotations/draft-1/preview' },
    );
    await screen.findByRole('button', { name: /discard draft/i });
    return view;
  }

  it('sends exactly one request when the button is clicked twice', async () => {
    let resolveDiscard: (value: unknown) => void = () => undefined;
    const discard = vi.spyOn(quotationService, 'discardDraft').mockReturnValue(
      new Promise((resolve) => {
        resolveDiscard = resolve;
      }) as never,
    );
    const user = userEvent.setup();
    await renderPreview();

    const button = screen.getByRole('button', { name: /discard draft/i });
    await user.click(button);
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    await user.click(button);

    // W-8: the second click must not reach the backend.
    expect(discard).toHaveBeenCalledTimes(1);
    resolveDiscard({ success: true, deletedDraftId: 'draft-1' });
  });

  it('asks for confirmation, and sends nothing when it is declined', async () => {
    const discard = vi.spyOn(quotationService, 'discardDraft');
    confirmSpy.mockReturnValue(false);
    const user = userEvent.setup();
    await renderPreview();

    await user.click(screen.getByRole('button', { name: /discard draft/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it('invalidates the register so the draft does not linger for 30 seconds', async () => {
    vi.spyOn(quotationService, 'discardDraft').mockResolvedValue({
      success: true,
      deletedDraftId: 'draft-1',
    } as never);
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const user = userEvent.setup();
    await renderPreview();

    await user.click(screen.getByRole('button', { name: /discard draft/i }));

    // W-7: without this the global 30s staleTime left the discarded draft on
    // the register and the user discarded it again.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['quotations'] });
    });
  });

  it('navigates back to the register on success', async () => {
    vi.spyOn(quotationService, 'discardDraft').mockResolvedValue({
      success: true,
      deletedDraftId: 'draft-1',
    } as never);
    const user = userEvent.setup();
    await renderPreview();

    await user.click(screen.getByRole('button', { name: /discard draft/i }));

    expect(await screen.findByText('Register')).toBeInTheDocument();
  });

  it('re-enables the button and surfaces the reason when the discard fails', async () => {
    vi.spyOn(quotationService, 'discardDraft').mockRejectedValue(
      new AppError('VALIDATION_FAILED', 'Only the creator of this draft can discard it.'),
    );
    const user = userEvent.setup();
    await renderPreview();

    const button = screen.getByRole('button', { name: /discard draft/i });
    await user.click(button);

    expect(await screen.findByText(/only the creator/i)).toBeInTheDocument();
    // Restored, so the user can correct course rather than being stuck.
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The preview shows the SNAPSHOT, not current settings (W-12)                */
/* -------------------------------------------------------------------------- */

describe('the preview is isolated from current Company Settings', () => {
  it('never asks the backend for company settings', async () => {
    const getSettings = vi.spyOn(settingsService, 'getSettings');
    vi.spyOn(quotationService, 'getQuotationByDraftId').mockResolvedValue({
      quotation: TEST_ONLY_storedDraft(),
      status: 'Pending',
      createdBy: TEST_ONLY_USER.email,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:00:00Z',
      driveFolderUrl: '',
      pdfUrl: '',
      docxUrl: '',
      tracked: false,
    } as never);
    vi.spyOn(assetLoader, 'loadDocumentAssets').mockResolvedValue(TEST_ONLY_assets() as never);

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:draftId/preview" element={<QuotationPreviewPage />} />
      </Routes>,
      { user: TEST_ONLY_USER, route: '/quotations/draft-1/preview' },
    );
    await screen.findByRole('button', { name: /discard draft/i });

    /*
     * Reading settings here would make an OLD quotation's export blockers
     * depend on a default an administrator changed afterwards. The preview
     * renders `stored.terms` — the resolved snapshot — and nothing it shows
     * comes from today's configuration.
     */
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('renders the VAT rate the quotation was saved with', async () => {
    vi.spyOn(quotationService, 'getQuotationByDraftId').mockResolvedValue({
      // Saved at 15%, whatever the current default happens to be.
      quotation: { ...TEST_ONLY_storedDraft(), vatRateBasisPoints: 1_500 },
      status: 'Pending',
      createdBy: TEST_ONLY_USER.email,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:00:00Z',
      driveFolderUrl: '',
      pdfUrl: '',
      docxUrl: '',
      tracked: false,
    } as never);
    vi.spyOn(assetLoader, 'loadDocumentAssets').mockResolvedValue(TEST_ONLY_assets() as never);

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:draftId/preview" element={<QuotationPreviewPage />} />
      </Routes>,
      { user: TEST_ONLY_USER, route: '/quotations/draft-1/preview' },
    );
    await screen.findByRole('button', { name: /discard draft/i });

    expect(screen.getByText(/15%/)).toBeInTheDocument();
  });
});
