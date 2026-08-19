import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CustomersPage from '@/pages/customers/index';
import { CustomerPicker } from '@/components/client/CustomerPicker';
import * as clientService from '@/services/clients/client-service';
import type { Customer } from '@/services/clients/client-service';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_ADMIN, TEST_ONLY_USER } from '@/__fixtures__/test-render';

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    clientName: 'TEST_ONLY Contact',
    companyName: 'TEST_ONLY Client Co.',
    address: 'TEST_ONLY Address, Riyadh',
    contactPerson: 'TEST_ONLY Person',
    email: 'test-only.client@example.invalid',
    phone: '+966 50 000 0000',
    active: true,
    ...overrides,
  };
}

function renderPage(role: 'Admin' | 'User' = 'Admin') {
  return renderWithProviders(<CustomersPage />, {
    user: role === 'Admin' ? TEST_ONLY_ADMIN : TEST_ONLY_USER,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(clientService, 'listCustomers').mockResolvedValue([customer()]);
});

/* -------------------------------------------------------------------------- */

describe('the library', () => {
  it('lists customers', async () => {
    renderPage();

    expect(await screen.findByText('TEST_ONLY Client Co.')).toBeInTheDocument();
    expect(screen.getByText('TEST_ONLY Contact')).toBeInTheDocument();
  });

  it('shows an honest empty state rather than sample data', async () => {
    vi.spyOn(clientService, 'listCustomers').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/No customers yet/i)).toBeInTheDocument();
    expect(screen.getByText(/ships empty by design/i)).toBeInTheDocument();
  });

  it('is open to a normal User', async () => {
    renderPage('User');

    expect(await screen.findByText('TEST_ONLY Client Co.')).toBeInTheDocument();
  });
});

describe('search', () => {
  beforeEach(() => {
    vi.spyOn(clientService, 'listCustomers').mockResolvedValue([
      customer(),
      customer({ id: 'customer-2', companyName: 'TEST_ONLY Other Co.', clientName: 'Someone Else' }),
    ]);
  });

  it('filters by company name', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('TEST_ONLY Client Co.');

    await user.type(screen.getByLabelText(/search customers/i), 'Other');

    expect(screen.getByText('TEST_ONLY Other Co.')).toBeInTheDocument();
    expect(screen.queryByText('TEST_ONLY Client Co.')).not.toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('TEST_ONLY Client Co.');

    await user.type(screen.getByLabelText(/search customers/i), 'zzzznomatch');

    expect(screen.getByText(/No customer matches/i)).toBeInTheDocument();
  });
});

describe('creating and editing', () => {
  it('sends the entered details', async () => {
    const create = vi.spyOn(clientService, 'createCustomer').mockResolvedValue(customer());
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /add customer/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/client name/i), 'New Contact');
    await user.type(within(dialog).getByLabelText(/company name/i), 'New Co.');
    await user.type(within(dialog).getByLabelText(/address/i), 'New Address');
    await user.click(within(dialog).getByRole('button', { name: /add customer/i }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientName: 'New Contact',
          companyName: 'New Co.',
          address: 'New Address',
        }),
        expect.any(String),
      );
    });
  });

  it('prefills the form when editing and sends the id', async () => {
    const update = vi.spyOn(clientService, 'updateCustomer').mockResolvedValue(customer());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('TEST_ONLY Client Co.');

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/company name/i)).toHaveValue('TEST_ONLY Client Co.');

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'customer-1' }),
        expect.any(String),
      );
    });
  });

  it("shows the server's duplicate refusal on the field", async () => {
    vi.spyOn(clientService, 'createCustomer').mockRejectedValue(
      new AppError('VALIDATION_FAILED', 'That customer already exists.', {
        fields: { clientName: 'That customer already exists.' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /add customer/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/client name/i), 'TEST_ONLY Contact');
    await user.type(within(dialog).getByLabelText(/company name/i), 'TEST_ONLY Client Co.');
    await user.type(within(dialog).getByLabelText(/address/i), 'TEST_ONLY Address');
    await user.click(within(dialog).getByRole('button', { name: /add customer/i }));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();
  });
});

describe('deactivation', () => {
  it('is offered to an Admin', async () => {
    const setActive = vi
      .spyOn(clientService, 'setCustomerActive')
      .mockResolvedValue(customer({ active: false }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('TEST_ONLY Client Co.');

    await user.click(screen.getByRole('button', { name: /deactivate/i }));

    await waitFor(() => {
      expect(setActive).toHaveBeenCalledWith('customer-1', false, expect.any(String));
    });
  });

  it('is not offered to a normal User', async () => {
    renderPage('User');
    await screen.findByText('TEST_ONLY Client Co.');

    // Hiding the control is not the security boundary — the backend refuses a
    // User outright — but offering a button that always fails is worse than not
    // offering it.
    expect(screen.queryByRole('button', { name: /deactivate/i })).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* The picker                                                                 */
/* -------------------------------------------------------------------------- */

describe('CustomerPicker', () => {
  it('fetches nothing until it is opened', () => {
    const list = vi.spyOn(clientService, 'listCustomers').mockResolvedValue([customer()]);
    renderWithProviders(<CustomerPicker onSelect={() => undefined} />, {
      user: TEST_ONLY_USER,
    });

    // PRD §35: opening New Quotation must not do work of its own.
    expect(list).not.toHaveBeenCalled();
  });

  it('hands back the customer values when one is chosen', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CustomerPicker onSelect={onSelect} />, { user: TEST_ONLY_USER });

    await user.click(screen.getByRole('button', { name: /choose from customers/i }));
    await screen.findByText('TEST_ONLY Client Co.');
    await user.click(screen.getByRole('button', { name: /TEST_ONLY Client Co/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        clientName: 'TEST_ONLY Contact',
        companyName: 'TEST_ONLY Client Co.',
        address: 'TEST_ONLY Address, Riyadh',
      }),
    );
  });

  it('asks the backend for ACTIVE customers only', async () => {
    const list = vi.spyOn(clientService, 'listCustomers').mockResolvedValue([customer()]);
    const user = userEvent.setup();
    renderWithProviders(<CustomerPicker onSelect={() => undefined} />, { user: TEST_ONLY_USER });

    await user.click(screen.getByRole('button', { name: /choose from customers/i }));
    await screen.findByText('TEST_ONLY Client Co.');

    // No includeInactive argument: a deactivated customer is never offered.
    expect(list).toHaveBeenCalledWith(expect.any(String));
  });

  it('tells the user what will happen to the quotation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomerPicker onSelect={() => undefined} />, { user: TEST_ONLY_USER });

    await user.click(screen.getByRole('button', { name: /choose from customers/i }));

    expect(
      screen.getByText(/later changes to this customer will not affect it/i),
    ).toBeInTheDocument();
  });

  it('offers a way through when the library is empty', async () => {
    vi.spyOn(clientService, 'listCustomers').mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<CustomerPicker onSelect={() => undefined} />, { user: TEST_ONLY_USER });

    await user.click(screen.getByRole('button', { name: /choose from customers/i }));

    expect(await screen.findByText(/just type the details below/i)).toBeInTheDocument();
  });
});
