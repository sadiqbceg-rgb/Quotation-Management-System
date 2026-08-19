import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The FORM, not the settings-loading page wrapper: these tests are about the
// quotation editor, and gating them on a company-defaults round trip would
// couple them to an unrelated concern. The form defaults to the shipped
// constants, which is exactly what it used before Company Settings existed.
import { NewQuotationForm as NewQuotationPage } from '@/pages/quotations/new';
import * as quotationService from '@/services/quotation/quotation-service';
import * as signatoryService from '@/services/signatories/signatory-service';
import { AppError } from '@/services/api/errors';
import { base64Png } from '@shared/signature';
import { renderWithProviders, TEST_ONLY_ADMIN, TEST_ONLY_USER } from '@/__fixtures__/test-render';

const SAVE_RESULT = {
  draftId: 'draft-1',
  quotationNumber: 'SFC/RUH/QTN/2026/003',
  status: 'Pending' as const,
  createdAt: '2026-08-11T00:00:00Z',
  updatedAt: '2026-08-11T00:00:00Z',
};

/** Obviously synthetic, and the only signatory these tests know about. */
const TEST_ONLY_PERSON = {
  id: 'person-1',
  name: 'TEST_ONLY_Signatory',
  designation: 'TEST_ONLY Designation',
  companyName: 'TEST_ONLY Company',
  country: 'TEST_ONLY Country',
  email: 'test-only.signatory@example.invalid',
  phone: '+966 50 000 0000',
  hasSignature: true,
  selectable: true,
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/** A 1x1 transparent PNG. Not a signature, and not a picture of anything. */
const TEST_ONLY_TINY_PNG = base64Png(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
);

/**
 * Everything finalizing requires.
 *
 * Phase 06 added the signatory to that list (PRD §36): a quotation cannot be
 * issued without one, so it belongs here rather than in each test.
 */
async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/quotation for/i), 'TEST_ONLY manpower supply');
  await user.type(screen.getByLabelText(/client name/i), 'TEST_ONLY Contact');
  await user.type(screen.getByLabelText(/^company name/i), 'TEST_ONLY Client Co.');
  await user.type(screen.getByLabelText(/address/i), 'TEST_ONLY Address');

  await user.selectOptions(
    await screen.findByRole('combobox', { name: /authorized person/i }),
    'person-1',
  );
  await screen.findByAltText(/signature of/i);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([TEST_ONLY_PERSON]);
  vi.spyOn(signatoryService, 'fetchSignature').mockResolvedValue(TEST_ONLY_TINY_PNG);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

type FetchSpy = ReturnType<typeof spyOnFetch>;

function spyOnFetch() {
  return vi.fn((_url: string, _init?: { body?: string }) =>
    Promise.reject(new TypeError('offline')),
  );
}

/** Every backend action a set of fetch calls attempted. */
function actionsCalled(fetchSpy: FetchSpy): string[] {
  return fetchSpy.mock.calls.map(
    (call) => (JSON.parse(call[1]?.body ?? '{}') as { action?: string }).action ?? '',
  );
}

describe('PRD §35 — opening the form creates nothing', () => {
  it('attempts no writing action on mount', async () => {
    const fetchSpy = spyOnFetch();
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await Promise.resolve();

    // Reading the Terms & Conditions library to render the checkboxes is fine.
    // What must never happen on mount is a quotation being created or a number
    // being burned — those are irreversible.
    expect(actionsCalled(fetchSpy)).not.toContain('quotation.save');
    expect(actionsCalled(fetchSpy)).not.toContain('quotation.reserveNumber');
  });

  it('does not reserve a quotation number on mount', () => {
    const save = vi.spyOn(quotationService, 'saveQuotation');
    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });

    expect(save).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */

describe('quotation number field', () => {
  it('shows that the number is assigned on save', () => {
    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });

    expect(screen.getByTestId('quotation-number')).toHaveTextContent(
      /will be assigned when you save/i,
    );
  });

  it('renders no editable control for the quotation number', () => {
    // The number is server-issued (§7.3). There must be no input at all —
    // not even a disabled one, which could be re-enabled from devtools.
    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });

    const field = screen.getByTestId('quotation-number');
    expect(field.querySelector('input')).toBeNull();
    expect(field.querySelector('textarea')).toBeNull();
    expect(field.tagName.toLowerCase()).toBe('output');
  });

  it('shows the issued number after finalizing', async () => {
    const user = userEvent.setup();
    vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /create quotation/i }));

    await waitFor(() => {
      expect(screen.getByTestId('quotation-number')).toHaveTextContent('SFC/RUH/QTN/2026/003');
    });
  });
});

/* -------------------------------------------------------------------------- */

describe('saving', () => {
  it('finalizes with finalize=true', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /create quotation/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0]?.[1]).toBe(true);
  });

  it('saves a draft with finalize=false, even when incomplete', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue({
      ...SAVE_RESULT,
      quotationNumber: '',
    });

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0]?.[1]).toBe(false);
  });

  it('blocks finalizing while required fields are empty', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await user.click(screen.getByRole('button', { name: /create quotation/i }));

    expect(await screen.findByText(/quotation for is required/i)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('sends the same draft id on every save, so a retry cannot burn a number', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue({
      ...SAVE_RESULT,
      quotationNumber: '',
    });

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });

    const first = save.mock.calls[0]?.[0].draftId;
    const second = save.mock.calls[1]?.[0].draftId;

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('echoes an issued number back so the server can detect a mismatch', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /create quotation/i }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });

    // The first save had no number yet.
    expect(save.mock.calls[0]?.[0].quotationNumber).toBeUndefined();

    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(save.mock.calls[1]?.[0].quotationNumber).toBe('SFC/RUH/QTN/2026/003');
  });

  it('surfaces a server error with its reference id', async () => {
    const user = userEvent.setup();
    vi.spyOn(quotationService, 'saveQuotation').mockRejectedValue(
      new AppError('NUMBERING_LOCKED', 'busy', { requestId: 'req-99' }),
    );

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /create quotation/i }));

    expect(
      await screen.findByText(/system is busy issuing a quotation number/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/req-99/)).toBeInTheDocument();
  });

  it('re-enables the buttons after a failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(quotationService, 'saveQuotation').mockRejectedValue(
      new AppError('NETWORK_ERROR', 'offline'),
    );

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save draft/i })).toBeEnabled();
    });
  });
});

/* -------------------------------------------------------------------------- */

describe('pricing model', () => {
  it('defaults to 15% VAT, the KSA rate in both reference documents', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(save.mock.calls[0]?.[0].vatRateBasisPoints).toBe(1500);
  });

  it('sends no discount unless one is enabled', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(save.mock.calls[0]?.[0].discountRateBasisPoints).toBeUndefined();
  });

  it('sends VAT as zero when it is switched off', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);

    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await user.click(screen.getByRole('checkbox', { name: /apply vat/i }));
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(save.mock.calls[0]?.[0].vatRateBasisPoints).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('client information', () => {
  it('distinguishes required from optional fields', () => {
    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });

    // PRD §12 requires the distinction to be visible, not implied by position.
    expect(screen.getAllByText('(optional)').length).toBeGreaterThan(0);

    // Required fields carry a marker; optional ones carry the "(optional)" text.
    const requiredLabel = screen.getByText('Client Name').closest('label');
    expect(requiredLabel?.textContent).toContain('*');
    expect(requiredLabel?.textContent).not.toContain('(optional)');

    const optionalLabel = screen.getByText('Project Name').closest('label');
    expect(optionalLabel?.textContent).toContain('(optional)');
  });

  it('validates the optional email format only when filled in', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });

    await user.type(screen.getByLabelText(/^email/i), 'not-an-email');
    await user.tab();

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('backdating', () => {
  it('warns a User who dates a quotation into a previous year', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });

    await user.clear(screen.getByLabelText(/quotation date/i));
    await user.type(screen.getByLabelText(/quotation date/i), '2020-01-01');

    expect(
      await screen.findByText(/only an administrator can date a quotation into a previous year/i),
    ).toBeInTheDocument();
  });

  it('does not warn an Admin', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_ADMIN });

    await user.clear(screen.getByLabelText(/quotation date/i));
    await user.type(screen.getByLabelText(/quotation date/i), '2020-01-01');

    await waitFor(() => {
      expect(
        screen.queryByText(/only an administrator can date a quotation/i),
      ).not.toBeInTheDocument();
    });
  });
});
