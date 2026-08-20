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

/* -------------------------------------------------------------------------- */
/* Clearing a numeric field (R-2)                                             */
/* -------------------------------------------------------------------------- */

/**
 * An empty box is empty, not zero.
 *
 * The numeric fields used to hold parsed NUMBERS, with anything unparseable
 * folded to 0. Backspacing a field to retype it put a `0` in it, and 0 is a
 * legal VAT rate — so a cleared box plus a Save set the company default to 0%
 * and every quotation written afterwards started there.
 */
describe('clearing a numeric field', () => {
  it('leaves the VAT box empty rather than showing 0', async () => {
    const user = userEvent.setup();
    renderPage();

    const vat = await screen.findByLabelText(/default vat rate/i);
    await user.clear(vat);

    expect(vat).toHaveValue(null);
  });

  it('leaves the validity box empty rather than showing 0', async () => {
    const user = userEvent.setup();
    renderPage();

    const days = await screen.findByLabelText(/quotation validity/i);
    await user.clear(days);

    expect(days).toHaveValue(null);
  });

  it('refuses to save a cleared VAT rate', async () => {
    const update = vi.spyOn(settingsService, 'updateSettings').mockResolvedValue(settings());
    const user = userEvent.setup();
    renderPage();

    await user.clear(await screen.findByLabelText(/default vat rate/i));
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    // Nothing reaches the server, so nothing can be stored as 0%.
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByText(/not the same as 0%/i)).toBeInTheDocument();
  });

  it('refuses to save a cleared validity period', async () => {
    const update = vi.spyOn(settingsService, 'updateSettings').mockResolvedValue(settings());
    const user = userEvent.setup();
    renderPage();

    await user.clear(await screen.findByLabelText(/quotation validity/i));
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByText(/number of days a quotation stays valid/i)).toBeInTheDocument();
  });

  it('still allows a DELIBERATE zero VAT rate', async () => {
    const update = vi.spyOn(settingsService, 'updateSettings').mockResolvedValue(settings());
    const user = userEvent.setup();
    renderPage();

    const vat = await screen.findByLabelText(/default vat rate/i);
    await user.clear(vat);
    await user.type(vat, '0');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    // 0% is a legal rate. The fix distinguishes "cleared" from "typed 0";
    // it does not forbid zero.
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ defaultVatRateBasisPoints: 0 }),
        expect.any(String),
      );
    });
  });

  it('lets a field be cleared and retyped without fighting the caret', async () => {
    const update = vi.spyOn(settingsService, 'updateSettings').mockResolvedValue(settings());
    const user = userEvent.setup();
    renderPage();

    const days = await screen.findByLabelText(/quotation validity/i);
    await user.clear(days);
    await user.type(days, '45');

    // Asserted BEFORE saving: a successful save resyncs the form to whatever
    // the server echoes back, which here is the 7 in the fixture.
    // Previously the box refilled with 0 the moment it was cleared, so this
    // same sequence produced "045".
    expect(days).toHaveValue(45);

    await user.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ quotationValidityDays: 45 }),
        expect.any(String),
      );
    });
  });

  it('clears the refusal once the field is filled in again', async () => {
    const update = vi.spyOn(settingsService, 'updateSettings').mockResolvedValue(settings());
    const user = userEvent.setup();
    renderPage();

    const vat = await screen.findByLabelText(/default vat rate/i);
    await user.clear(vat);
    await user.click(screen.getByRole('button', { name: /save settings/i }));
    await screen.findByText(/not the same as 0%/i);

    await user.type(vat, '5');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ defaultVatRateBasisPoints: 500 }),
        expect.any(String),
      );
    });
  });

  it('adds no client-side rule beyond "not empty"', async () => {
    const update = vi.spyOn(settingsService, 'updateSettings').mockResolvedValue(settings());
    const user = userEvent.setup();
    renderPage();

    const vat = await screen.findByLabelText(/default vat rate/i);
    await user.clear(vat);
    await user.type(vat, '12.5');
    await user.click(screen.getByRole('button', { name: /save settings/i }));

    /*
     * A fraction, passed straight through as 1250 basis points — not rounded,
     * clamped or second-guessed on the way. R-2 introduced exactly one
     * client-side rule, that a box may not be EMPTY, because an empty box is
     * the one thing the server can never report back: it would arrive as a
     * number nobody typed. Every other rule stays the server's (§19.3), and
     * the endpoint is public, so a browser-side check would secure nothing.
     *
     * That the server's own refusal still reaches the right field is covered
     * by "shows the server's field error" above.
     */
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ defaultVatRateBasisPoints: 1250 }),
        expect.any(String),
      );
    });
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
