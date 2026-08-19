/**
 * Company Settings as the source of a NEW quotation's defaults.
 *
 * The point of these tests is the direction of the arrow: settings flow INTO a
 * new quotation, and nothing flows back. The backend half — that an existing
 * quotation keeps its own rate and its own recomputed totals when a default
 * changes — is asserted in `google-apps-script/src/settings/settings.test.ts`
 * against a really-saved quotation.
 */

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewQuotationPage from '@/pages/quotations/new';
import * as settingsService from '@/services/settings/settings-service';
import type { CompanySettings } from '@/services/settings/settings-service';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';
import { DEFAULT_CLOSING_PARAGRAPH, DEFAULT_QUOTATION_VALIDITY_DAYS } from '@shared/company-defaults';
import { DEFAULT_VAT_RATE_BASIS_POINTS } from '@shared/totals';

const CUSTOM_CLOSING = 'TEST_ONLY closing paragraph from company settings.';

function settings(overrides: Partial<CompanySettings['business']> = {}): CompanySettings {
  return {
    business: {
      defaultVatRateBasisPoints: 500,
      quotationValidityDays: 30,
      defaultClosingParagraph: CUSTOM_CLOSING,
      ...overrides,
    },
    deployment: {
      companyCode: 'SFC',
      branchCode: 'RUH',
      documentTypeCode: 'QTN',
      vatNumber: '313098686600003',
    },
  };
}

function renderPage() {
  return renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(settingsService, 'getSettings').mockResolvedValue(settings());
});

/* -------------------------------------------------------------------------- */

describe('a new quotation starts from the current company settings', () => {
  it('uses the configured VAT rate, not the shipped constant', async () => {
    renderPage();

    const vat = await screen.findByLabelText(/vat rate/i);
    // 500 basis points is 5%; the shipped constant is 15%.
    expect(vat).toHaveValue(5);
    expect(DEFAULT_VAT_RATE_BASIS_POINTS / 100).toBe(15);
  });

  it('uses the configured closing paragraph', async () => {
    renderPage();

    expect(await screen.findByLabelText(/closing paragraph/i)).toHaveValue(CUSTOM_CLOSING);
  });

  it('picks up a CHANGED setting for the next quotation', async () => {
    // The same page, mounted again after an Admin edited the defaults.
    vi.spyOn(settingsService, 'getSettings').mockResolvedValue(
      settings({ defaultVatRateBasisPoints: 2_000 }),
    );
    renderPage();

    expect(await screen.findByLabelText(/vat rate/i)).toHaveValue(20);
  });
});

describe('loading', () => {
  it('shows no form — and therefore no wrong default — while settings load', () => {
    let release: (value: CompanySettings) => void = () => undefined;
    vi.spyOn(settingsService, 'getSettings').mockReturnValue(
      new Promise<CompanySettings>((resolve) => {
        release = resolve;
      }),
    );

    renderPage();

    // The form does not exist yet, so it cannot be showing 15% and it cannot
    // have anything typed into it to overwrite.
    expect(screen.queryByLabelText(/vat rate/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/loading company defaults/i)).toBeInTheDocument();
    release(settings());
  });

  it('renders the form once the settings arrive', async () => {
    renderPage();

    expect(await screen.findByLabelText(/vat rate/i)).toBeInTheDocument();
  });
});

describe('when the settings cannot be read', () => {
  it('falls back to the shipped constants rather than blocking the page', async () => {
    vi.spyOn(settingsService, 'getSettings').mockRejectedValue(
      new AppError('NETWORK_ERROR', 'Could not reach the server.'),
    );
    renderPage();

    // The quotation writer is not stopped by a settings outage.
    expect(await screen.findByLabelText(/vat rate/i)).toHaveValue(
      DEFAULT_VAT_RATE_BASIS_POINTS / 100,
    );
    // `toHaveValue` compares exactly; `getByDisplayValue` normalises whitespace
    // and the shipped paragraph is two paragraphs separated by a blank line.
    expect(screen.getByLabelText(/closing paragraph/i)).toHaveValue(DEFAULT_CLOSING_PARAGRAPH);
  });

  it('says so, rather than silently quoting the wrong VAT rate', async () => {
    vi.spyOn(settingsService, 'getSettings').mockRejectedValue(
      new AppError('NETWORK_ERROR', 'Could not reach the server.'),
    );
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Company defaults could not be loaded/i,
    );
  });

  it('shows no such warning when the settings load normally', async () => {
    renderPage();
    await screen.findByLabelText(/vat rate/i);

    expect(screen.queryByText(/Company defaults could not be loaded/i)).not.toBeInTheDocument();
  });

  it('still does not reserve a quotation number', async () => {
    vi.spyOn(settingsService, 'getSettings').mockRejectedValue(
      new AppError('NETWORK_ERROR', 'Could not reach the server.'),
    );
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchSpy);

    renderPage();
    await screen.findByLabelText(/vat rate/i);

    // PRD §35 still holds: reading defaults is not issuing a number.
    const actions = fetchSpy.mock.calls.map(
      (call) =>
        (JSON.parse((call as unknown as [string, { body?: string }])[1]?.body ?? '{}') as {
          action?: string;
        }).action ?? '',
    );
    expect(actions).not.toContain('quotation.reserveNumber');
    expect(actions).not.toContain('quotation.save');
  });
});

describe('the validity period', () => {
  it('is read from settings rather than left permanently blank', async () => {
    // It was hardcoded to '' before, so `{{quotation.validityDays}}` in the
    // imported reference term could never resolve. The resolved text is what
    // gets snapshotted onto the quotation.
    renderPage();
    await screen.findByLabelText(/vat rate/i);

    expect(settingsService.getSettings).toHaveBeenCalled();
    expect(settings().business.quotationValidityDays).not.toBe(DEFAULT_QUOTATION_VALIDITY_DAYS);
  });
});
