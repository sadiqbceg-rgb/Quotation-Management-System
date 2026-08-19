import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The FORM, not the settings-loading page wrapper: these tests are about the
// quotation editor, and gating them on a company-defaults round trip would
// couple them to an unrelated concern. The form defaults to the shipped
// constants, which is exactly what it used before Company Settings existed.
import { NewQuotationForm as NewQuotationPage } from '@/pages/quotations/new';
import * as quotationService from '@/services/quotation/quotation-service';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';

const SAVE_RESULT = {
  draftId: 'draft-1',
  quotationNumber: '',
  status: 'Pending' as const,
  createdAt: '2026-08-11T00:00:00Z',
  updatedAt: '2026-08-11T00:00:00Z',
};

function renderPage() {
  return renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
}

async function addCategory(
  user: ReturnType<typeof userEvent.setup>,
  category: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: `+ ${category}` }));
}

/** Fill the first row of a table: quantity then price. */
async function fillFirstRow(
  user: ReturnType<typeof userEvent.setup>,
  quantity: string,
  price: string,
  priceLabel = 'Unit Price 1',
): Promise<void> {
  await user.clear(screen.getByLabelText('Quantity 1'));
  await user.type(screen.getByLabelText('Quantity 1'), quantity);
  await user.clear(screen.getByLabelText(priceLabel));
  await user.type(screen.getByLabelText(priceLabel), price);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);
});

/* -------------------------------------------------------------------------- */

describe('category selection (PRD §13)', () => {
  it('starts with no items and no tables', () => {
    renderPage();
    expect(screen.getByText(/no items yet/i)).toBeInTheDocument();
  });

  it('adds a table per category', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    expect(screen.getByRole('table', { name: /manpower items/i })).toBeInTheDocument();

    await addCategory(user, 'Equipment');
    expect(screen.getByRole('table', { name: /equipment items/i })).toBeInTheDocument();
  });

  it('removes the add button once a category is present', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    expect(screen.queryByRole('button', { name: '+ Manpower' })).not.toBeInTheDocument();
  });

  it('uses the category-specific column headings from PRD §14–§16', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    const manpower = screen.getByRole('table', { name: /manpower items/i });
    expect(within(manpower).getByRole('columnheader', { name: 'Designation' })).toBeInTheDocument();
    expect(within(manpower).getByRole('columnheader', { name: 'Unit Price' })).toBeInTheDocument();

    await addCategory(user, 'Equipment');
    const equipment = screen.getByRole('table', { name: /equipment items/i });
    expect(
      within(equipment).getByRole('columnheader', { name: 'Equipment Description' }),
    ).toBeInTheDocument();
    expect(within(equipment).getByRole('columnheader', { name: 'Rate' })).toBeInTheDocument();
  });

  it('numbers rows from 1 within each category', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    await user.click(screen.getByRole('button', { name: /add row/i }));

    const manpower = screen.getByRole('table', { name: /manpower items/i });
    const rows = within(manpower).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('1')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('2')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('live calculation', () => {
  it('computes quantity × unit price into the Amount cell', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    await fillFirstRow(user, '40', '20');

    await waitFor(() => {
      expect(screen.getByTestId('amount-Manpower-0')).toHaveTextContent('SAR 800.00');
    });
  });

  it('handles a fractional quantity with half-up rounding', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Materials');
    await fillFirstRow(user, '1.5', '33.33');

    // 1.5 × 33.33 = 49.995 → 50.00
    await waitFor(() => {
      expect(screen.getByTestId('amount-Materials-0')).toHaveTextContent('SAR 50.00');
    });
  });

  it('updates the category subtotal and grand total as you type', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    await fillFirstRow(user, '40', '20');

    await waitFor(() => {
      expect(screen.getByTestId('subtotal-Manpower')).toHaveTextContent('SAR 800.00');
    });
    // 800 + 15% VAT = 920
    expect(screen.getByTestId('grand-total')).toHaveTextContent('SAR 920.00');
  });

  it('keeps category subtotals separate', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    await fillFirstRow(user, '40', '20');
    await addCategory(user, 'Equipment');

    await waitFor(() => {
      expect(screen.getByTestId('subtotal-Manpower')).toHaveTextContent('SAR 800.00');
    });
    expect(screen.getByTestId('subtotal-Equipment')).toHaveTextContent('SAR 0.00');
  });

  it('renders the Amount cell as text, never an input', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    const amount = screen.getByTestId('amount-Manpower-0');

    expect(amount.querySelector('input')).toBeNull();
  });

  it('does not destroy a partly typed decimal', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    const quantity = screen.getByLabelText('Quantity 1');

    await user.clear(quantity);
    await user.type(quantity, '1.');

    // Reformatting on each keystroke would erase the separator under the cursor.
    expect(quantity).toHaveValue('1.');
  });
});

/* -------------------------------------------------------------------------- */

describe('headcount summary line', () => {
  it('shows "Total Manpower" once quantities are entered', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    await fillFirstRow(user, '40', '20');

    await waitFor(() => {
      expect(screen.getByTestId('summary-Manpower')).toHaveTextContent('40 Persons');
    });
  });

  it('is not shown for Equipment', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Equipment');
    await fillFirstRow(user, '2', '500', 'Rate 1');

    await waitFor(() => {
      expect(screen.getByTestId('subtotal-Equipment')).toHaveTextContent('SAR 1,000.00');
    });
    expect(screen.queryByTestId('summary-Equipment')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('conditional Remarks column (PRD §17)', () => {
  it('is absent until an item has a remark', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    expect(screen.queryByRole('columnheader', { name: 'Remarks' })).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('rate-only mode (§26 UR-04)', () => {
  it('hides the Amount column and the totals block', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    await user.selectOptions(screen.getByLabelText(/^pricing/i), 'rate-only');

    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('totals-panel')).not.toBeInTheDocument();
    expect(screen.getByText(/no amounts or totals are printed/i)).toBeInTheDocument();
  });

  it('shows both again in amount mode', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByTestId('totals-panel')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('units', () => {
  it('offers the category-specific unit list', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Materials');
    const unit = screen.getByLabelText('Unit');

    expect(within(unit).getByRole('option', { name: 'Kg' })).toBeInTheDocument();
    expect(within(unit).queryByRole('option', { name: 'Trip' })).not.toBeInTheDocument();
  });

  it('reveals a text field for a custom unit', async () => {
    const user = userEvent.setup();
    renderPage();

    await addCategory(user, 'Manpower');
    await user.selectOptions(screen.getByLabelText('Unit'), '__custom__');

    expect(screen.getByLabelText('Custom unit')).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */

describe('submission', () => {
  it('sends line items as integer minor units', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);
    renderPage();

    await addCategory(user, 'Manpower');
    await user.type(screen.getByLabelText('Designation 1'), 'TEST_ONLY General Labour');
    await fillFirstRow(user, '40', '20');

    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });

    const lines = save.mock.calls[0]?.[0].lines ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      category: 'Manpower',
      quantity: 40_000,
      unitPrice: 2000,
      description: 'TEST_ONLY General Labour',
    });
  });

  it('sends no lines when no category was added', async () => {
    const user = userEvent.setup();
    const save = vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);
    renderPage();

    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    expect(save.mock.calls[0]?.[0].lines).toEqual([]);
  });
});
