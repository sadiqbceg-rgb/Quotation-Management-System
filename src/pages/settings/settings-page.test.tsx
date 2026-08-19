import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsPage from '@/pages/settings/index';
import * as settingsService from '@/services/settings/settings-service';
import type { CompanySettings } from '@/services/settings/settings-service';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_ADMIN, TEST_ONLY_USER } from '@/__fixtures__/test-render';

function settings(overrides: Partial<CompanySettings['business']> = {}): CompanySettings {
  return {
    business: {
      defaultVatRateBasisPoints: 1500,
      quotationValidityDays: 7,
      defaultClosingParagraph: 'TEST_ONLY closing paragraph.',
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

function renderPage(role: 'Admin' | 'User' = 'Admin') {
  return renderWithProviders(<SettingsPage />, {
    user: role === 'Admin' ? TEST_ONLY_ADMIN : TEST_ONLY_USER,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(settingsService, 'getSettings').mockResolvedValue(settings());
});

/* -------------------------------------------------------------------------- */

describe('access', () => {
  it('is refused to a non-Admin', () => {
    renderPage('User');

    expect(screen.getByText(/do not have permission|not authorized/i)).toBeInTheDocument();
    // Not merely hidden: the page does not even ask the backend.
    expect(settingsService.getSettings).not.toHaveBeenCalled();
  });

  it('is available to an Admin', async () => {
    renderPage();

    expect(await screen.findByLabelText(/default vat rate/i)).toBeInTheDocument();
  });
});

describe('the editable defaults', () => {
  it('shows the VAT rate as a percentage, not basis points', async () => {
    renderPage();

    // 1500 basis points is 15%, and 15 is what an administrator types.
    expect(await screen.findByLabelText(/default vat rate/i)).toHaveValue(15);
  });

  it('shows the stored validity days and closing paragraph', async () => {
    renderPage();

    expect(await screen.findByLabelText(/quotation validity/i)).toHaveValue(7);
    expect(screen.getByLabelText(/default closing paragraph/i)).toHaveValue(
      'TEST_ONLY closing paragraph.',
    );
  });

  it('sends a percentage back as basis points', async () => {
    const update = vi.spyOn(settingsService, 'updateSettings').mockResolvedValue(settings());
    const user = userEvent.setup();
    renderPage();

    const vat = await screen.findByLabelText(/default vat rate/i);
    await user.clear(vat);
    await user.type(vat, '5');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ defaultVatRateBasisPoints: 500 }),
        expect.any(String),
      );
    });
  });

  it("shows the server's field error", async () => {
    vi.spyOn(settingsService, 'updateSettings').mockRejectedValue(
      new AppError('VALIDATION_FAILED', 'Please correct the highlighted fields.', {
        fields: { quotationValidityDays: 'Enter a number of days between 1 and 365.' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText(/quotation validity/i);
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByText(/between 1 and 365/i)).toBeInTheDocument();
  });

  it('says the defaults apply to new quotations only', async () => {
    renderPage();
    await screen.findByLabelText(/default vat rate/i);

    expect(
      screen.getByText(/Quotations that already exist keep the values they were created with/i),
    ).toBeInTheDocument();
  });
});

describe('the deployment configuration block', () => {
  it('reports the quotation number format', async () => {
    renderPage();

    expect(await screen.findByText('SFC/RUH/QTN/YYYY/###')).toBeInTheDocument();
  });

  it('reports the VAT registration number', async () => {
    renderPage();

    expect(await screen.findByText('313098686600003')).toBeInTheDocument();
  });

  it('offers no way to edit any of it', async () => {
    renderPage();
    await screen.findByText('SFC/RUH/QTN/YYYY/###');

    // The three editable fields plus nothing else: the codes and the VAT
    // number are reported, never bound to an input.
    const inputs = screen.getAllByRole('textbox').concat(screen.getAllByRole('spinbutton'));
    expect(inputs).toHaveLength(3);
  });

  it('explains why the branding is not editable here', async () => {
    renderPage();
    await screen.findByText('SFC/RUH/QTN/YYYY/###');

    expect(screen.getByText(/letterhead artwork, which the PDF embeds directly/i)).toBeInTheDocument();
  });

  it('displays no secret', async () => {
    const { container } = renderPage();
    await screen.findByText('SFC/RUH/QTN/YYYY/###');

    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('pepper');
    expect(text).not.toContain('hmac');
    expect(text).not.toContain('folder id');
    expect(text).not.toContain('spreadsheet id');
  });
});
