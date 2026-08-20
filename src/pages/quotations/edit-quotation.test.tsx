/**
 * Editing a saved quotation (W-4), from the page.
 *
 * The backend already supported this — `quotation.save` finds the record by
 * draft id, keeps any issued number and reserves none. What was missing was a
 * way in. These cover the page that provides it, and specifically the two
 * things that would be dangerous to get wrong: reopening must not lose the
 * saved values, and it must not apply today's Company Settings over them.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EditQuotationPage from '@/pages/quotations/edit';
import * as quotationService from '@/services/quotation/quotation-service';
import * as settingsService from '@/services/settings/settings-service';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';
import { DEFAULT_QUOTATION_VALIDITY_DAYS } from '@shared/company-defaults';

const SAVED_CLOSING = 'TEST_ONLY the paragraph this quotation was saved with.';

function savedQuotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draftId: 'draft-1',
    quotationNumber: 'SFC/RUH/QTN/2026/001',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY manpower supply',
    scopeOfWork: 'TEST_ONLY scope',
    pricingMode: 'amount',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
      contactPerson: '',
      email: '',
      phone: '',
    },
    lines: [
      {
        category: 'Manpower',
        description: 'TEST_ONLY General Labour',
        quantity: 40_000,
        unit: 'Hour',
        unitPrice: 2_000,
        remarks: '',
      },
    ],
    terms: [{ id: 'term-1', title: 'TEST_ONLY Payment', body: 'TEST_ONLY resolved body.' }],
    closingParagraph: SAVED_CLOSING,
    authorizedPerson: null,
    discountRateBasisPoints: 0,
    // Saved at 15%, whatever today's default happens to be.
    vatRateBasisPoints: 1_500,
    // Issued for 30 days, whatever today's default happens to be.
    validityDays: 30,
    ...overrides,
  };
}

function stubLoad(quotation: Record<string, unknown> = savedQuotation()): void {
  vi.spyOn(quotationService, 'getQuotationByDraftId').mockResolvedValue({
    quotation,
    status: 'Pending',
    createdBy: TEST_ONLY_USER.email,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    driveFolderUrl: '',
    pdfUrl: '',
    docxUrl: '',
    tracked: false,
  } as never);
}

function renderEdit() {
  return renderWithProviders(
    <Routes>
      <Route path="/quotations/:draftId/edit" element={<EditQuotationPage />} />
    </Routes>,
    { user: TEST_ONLY_USER, route: '/quotations/draft-1/edit' },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Today's defaults differ from what the quotation was saved with, which is
  // the whole point of the isolation assertions below.
  vi.spyOn(settingsService, 'getSettings').mockResolvedValue({
    business: {
      defaultVatRateBasisPoints: 500,
      // 45, while the saved quotation below holds 30 and the shipped constant
      // is 7 — three distinguishable numbers, so an assertion naming one of
      // them says something.
      quotationValidityDays: 45,
      defaultClosingParagraph: 'TEST_ONLY a completely different default.',
    },
    deployment: {
      companyCode: 'SFC',
      branchCode: 'RUH',
      documentTypeCode: 'QTN',
      vatNumber: '313098686600003',
    },
  });
});

/* -------------------------------------------------------------------------- */

describe('loading', () => {
  it('shows a spinner rather than an empty form while the quotation loads', () => {
    vi.spyOn(quotationService, 'getQuotationByDraftId').mockReturnValue(
      new Promise(() => undefined) as never,
    );
    renderEdit();

    expect(screen.getByLabelText(/loading the quotation/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/quotation for/i)).not.toBeInTheDocument();
  });

  it('reports a quotation that cannot be loaded', async () => {
    vi.spyOn(quotationService, 'getQuotationByDraftId').mockRejectedValue(
      new AppError('VALIDATION_FAILED', 'That quotation could not be found.'),
    );
    renderEdit();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('the reopened quotation', () => {
  it('restores the saved header fields', async () => {
    stubLoad();
    renderEdit();

    expect(await screen.findByLabelText(/quotation for/i)).toHaveValue(
      'TEST_ONLY manpower supply',
    );
    expect(screen.getByLabelText(/^quotation date/i)).toHaveValue('2026-08-11');
  });

  it('restores the saved client', async () => {
    stubLoad();
    renderEdit();

    expect(await screen.findByLabelText(/client name/i)).toHaveValue('TEST_ONLY Contact');
    expect(screen.getByLabelText(/company name/i)).toHaveValue('TEST_ONLY Client Co.');
  });

  it('restores the saved line rows', async () => {
    stubLoad();
    renderEdit();

    expect(await screen.findByDisplayValue('TEST_ONLY General Labour')).toBeInTheDocument();
  });
});

describe('isolation from current Company Settings', () => {
  it('keeps the VAT rate the quotation was SAVED with', async () => {
    stubLoad();
    renderEdit();

    // 15%, not today's 5% default. Applying the current default over a saved
    // quotation is exactly the retroactive change the snapshot design prevents.
    expect(await screen.findByLabelText(/vat rate/i)).toHaveValue(15);
  });

  it('keeps the closing paragraph the quotation was SAVED with', async () => {
    stubLoad();
    renderEdit();

    expect(await screen.findByLabelText(/closing paragraph/i)).toHaveValue(SAVED_CLOSING);
  });

  /**
   * The settings ARE read — see the validity-period block below, which is why —
   * but they are never applied over what the quotation already holds.
   *
   * "Never asks for them" used to stand here as a proxy for this. It was the
   * weaker statement: it passed while the page was silently resolving
   * {{quotation.validityDays}} against the shipped constant.
   */
  it('reads the company settings without applying them over the saved values', async () => {
    const getSettings = vi.spyOn(settingsService, 'getSettings');
    stubLoad();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    await waitFor(() => {
      expect(getSettings).toHaveBeenCalled();
    });

    // Today's defaults are 5% and a different paragraph. Neither reached the form.
    expect(screen.getByLabelText(/vat rate/i)).toHaveValue(15);
    expect(screen.getByLabelText(/closing paragraph/i)).toHaveValue(SAVED_CLOSING);
  });
});

/**
 * The validity period, on reopening (R-4).
 *
 * `{{quotation.validityDays}}` used to resolve from whatever Company Settings
 * said at the moment you reopened the quotation, so the imported reference term
 * "This quotation shall remain valid for {{quotation.validityDays}} days from
 * the date of issue" — which is on every quotation — was rewritten whenever the
 * company default differed from what the quotation was issued with.
 *
 * It is now snapshotted onto the record, beside the VAT rate, and read from
 * there. Company Settings decide it once: when the quotation is created.
 */
describe('the validity period in a term', () => {
  function withValidityTerm(overrides: Record<string, unknown> = {}) {
    return savedQuotation({
      terms: [
        {
          id: 'term-1',
          title: 'TEST_ONLY Validity',
          body: 'TEST_ONLY valid for 30 days.',
          bodyTemplate: 'TEST_ONLY valid for {{quotation.validityDays}} days.',
        },
      ],
      ...overrides,
    });
  }

  it("resolves from the quotation's own stored value, not Company Settings", async () => {
    stubLoad(withValidityTerm());
    renderEdit();

    // The record says 30. Company Settings, mocked above, say 45.
    expect(await screen.findByText('TEST_ONLY valid for 30 days.')).toBeInTheDocument();
    expect(screen.queryByText('TEST_ONLY valid for 45 days.')).not.toBeInTheDocument();
  });

  /** What the server is actually asked to store. The rest is presentation. */
  it('re-saves the clause AND the field with the stored validity', async () => {
    const save = vi
      .spyOn(quotationService, 'saveQuotation')
      .mockResolvedValue({ draftId: 'draft-1', quotationNumber: '' } as never);
    stubLoad(withValidityTerm());
    const user = userEvent.setup();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });

    const payload = save.mock.calls[0]?.[0];
    // The stored field survives the round trip...
    expect(payload?.validityDays).toBe(30);
    // ...and so does the printed clause, character for character.
    expect(payload?.terms?.[0]?.body).toBe('TEST_ONLY valid for 30 days.');
  });

  it('falls back to the shipped constant for a quotation stored without one', async () => {
    stubLoad(withValidityTerm({ validityDays: undefined }));
    renderEdit();

    /*
     * A legacy record. The fallback is the value this system used for every
     * quotation before validity was snapshotted (UR-11), NOT today's company
     * default — borrowing the current setting is the coupling being removed,
     * and on a record that cannot contradict it, it would be invisible.
     */
    expect(DEFAULT_QUOTATION_VALIDITY_DAYS).toBe(7);
    expect(await screen.findByText('TEST_ONLY valid for 7 days.')).toBeInTheDocument();
    expect(screen.queryByText('TEST_ONLY valid for 45 days.')).not.toBeInTheDocument();
  });

  it('adopts the fallback on save, so the record and the clause agree', async () => {
    const save = vi
      .spyOn(quotationService, 'saveQuotation')
      .mockResolvedValue({ draftId: 'draft-1', quotationNumber: '' } as never);
    stubLoad(withValidityTerm({ validityDays: undefined }));
    const user = userEvent.setup();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });

    /*
     * Both, and the same number in both.
     *
     * Saving a legacy quotation re-resolves its terms — that is what saving has
     * always done — so the clause becomes "7 days" whatever else happens here.
     * Writing 7 onto the record alongside it is what keeps the stored field and
     * the printed text from disagreeing, and it retires the record's legacy
     * status: every save after this one is governed by the snapshot.
     */
    const payload = save.mock.calls[0]?.[0];
    expect(payload?.validityDays).toBe(DEFAULT_QUOTATION_VALIDITY_DAYS);
    expect(payload?.terms?.[0]?.body).toBe('TEST_ONLY valid for 7 days.');
  });

  it('still opens for editing when the settings cannot be read', async () => {
    vi.spyOn(settingsService, 'getSettings').mockRejectedValue(
      new AppError('NETWORK_ERROR', 'Could not reach the server.'),
    );
    stubLoad(withValidityTerm());
    renderEdit();

    // Nothing on load depends on the settings read, so an outage costs nothing.
    expect(await screen.findByLabelText(/quotation for/i)).toHaveValue(
      'TEST_ONLY manpower supply',
    );
    expect(await screen.findByText('TEST_ONLY valid for 30 days.')).toBeInTheDocument();
  });
});

describe('the issued number', () => {
  it('is shown and is not editable', async () => {
    stubLoad();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    // §7.7: immutable once issued. The server refuses a mismatch too.
    expect(screen.getByText('SFC/RUH/QTN/2026/001')).toBeInTheDocument();
  });

  it('is absent for a draft that has none', async () => {
    stubLoad(savedQuotation({ quotationNumber: '' }));
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    expect(screen.queryByText('SFC/RUH/QTN/2026/001')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* What the page says it is doing (R-3)                                       */
/* -------------------------------------------------------------------------- */

/**
 * The page used to announce "New Quotation" and offer "Create quotation" while
 * showing a quotation issued weeks earlier, and to warn that "a quotation
 * number is issued only when you finalize" — which reads as a threat to burn a
 * second number. It does not: the server finds the record by draft id and keeps
 * the number already on it (§7.7).
 */
describe('the wording when editing', () => {
  it('is headed "Edit Quotation", not "New Quotation"', async () => {
    stubLoad();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    expect(screen.getByRole('heading', { name: /edit quotation/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /new quotation/i })).not.toBeInTheDocument();
  });

  it('offers "Save changes" rather than "Create quotation"', async () => {
    stubLoad();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create quotation/i })).not.toBeInTheDocument();
  });

  it('does not call an issued quotation a draft', async () => {
    stubLoad();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument();
  });

  it('says the number will not change', async () => {
    stubLoad();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    expect(screen.getByText(/quotation number does not change/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/a quotation number is issued only when you finalize/i),
    ).not.toBeInTheDocument();
  });

  it('still says "Create quotation" when editing a draft with no number', async () => {
    stubLoad(savedQuotation({ quotationNumber: '' }));
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    /*
     * Editing, so the title still says so — but the primary action genuinely
     * does create the quotation and issue its number. Labelling that "Save
     * changes" would understate it in the one direction that matters.
     */
    expect(screen.getByRole('heading', { name: /edit quotation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create quotation/i })).toBeInTheDocument();
    expect(screen.getByText(/no quotation number yet/i)).toBeInTheDocument();
  });

  it('reports a re-save as an update, not a creation', async () => {
    vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue({
      draftId: 'draft-1',
      quotationNumber: 'SFC/RUH/QTN/2026/001',
    } as never);
    const user = userEvent.setup();
    stubLoad();
    renderEdit();
    await screen.findByLabelText(/quotation for/i);

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/changes saved/i)).toBeInTheDocument();
  });
});
