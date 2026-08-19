import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UsersPage from '@/pages/users/index';
import * as authService from '@/services/auth/auth-service';
import type { ManagedUser } from '@/services/auth/auth-service';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_ADMIN, TEST_ONLY_USER } from '@/__fixtures__/test-render';

const VALID_SECRET = 'TEST_ONLY_replacement-horse';

function managed(overrides: Partial<ManagedUser> = {}): ManagedUser {
  return {
    email: 'test-only.staff@example.invalid',
    role: 'User',
    active: true,
    createdAt: '2026-01-15T09:30:00Z',
    lastLoginAt: '2026-02-20T11:00:00Z',
    ...overrides,
  };
}

function renderPage(role: 'Admin' | 'User' = 'Admin') {
  return renderWithProviders(<UsersPage />, {
    user: role === 'Admin' ? TEST_ONLY_ADMIN : TEST_ONLY_USER,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(authService, 'listUsers').mockResolvedValue([managed()]);
});

/* -------------------------------------------------------------------------- */

describe('access', () => {
  it('is refused to a non-Admin', () => {
    renderPage('User');

    expect(screen.getByText(/do not have permission|not authorized/i)).toBeInTheDocument();
    // Not merely hidden: the page does not even ask the backend for the list.
    expect(authService.listUsers).not.toHaveBeenCalled();
  });

  it('is available to an Admin', async () => {
    renderPage();

    expect(await screen.findByText('test-only.staff@example.invalid')).toBeInTheDocument();
  });
});

describe('the account table', () => {
  it('shows the columns an administrator needs', async () => {
    renderPage();
    await screen.findByText('test-only.staff@example.invalid');

    for (const header of ['Email', 'Role', 'Status', 'Created At', 'Last Login At', 'Actions']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
  });

  it('formats the stored timestamps as dates', async () => {
    renderPage();

    expect(await screen.findByText('15-01-2026')).toBeInTheDocument();
    expect(screen.getByText('20-02-2026')).toBeInTheDocument();
  });

  it('says "Never" rather than showing an empty cell for an account that has not signed in', async () => {
    vi.spyOn(authService, 'listUsers').mockResolvedValue([managed({ lastLoginAt: '' })]);
    renderPage();

    expect(await screen.findByText('Never')).toBeInTheDocument();
  });

  it('shows the status as words, not a raw boolean', async () => {
    vi.spyOn(authService, 'listUsers').mockResolvedValue([
      managed({ email: 'a@example.invalid' }),
      managed({ email: 'b@example.invalid', active: false }),
    ]);
    renderPage();

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('marks which row is the signed-in Admin', async () => {
    vi.spyOn(authService, 'listUsers').mockResolvedValue([
      managed({ email: TEST_ONLY_ADMIN.email, role: 'Admin' }),
    ]);
    renderPage();

    expect(await screen.findByText('(you)')).toBeInTheDocument();
  });

  it('never renders password material, because the type carries none', async () => {
    const { container } = renderPage();
    await screen.findByText('test-only.staff@example.invalid');

    const text = container.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('hash');
    expect(text.toLowerCase()).not.toContain('salt');
  });
});

describe('adding a user', () => {
  it('sends the entered details', async () => {
    const create = vi
      .spyOn(authService, 'createUser')
      .mockResolvedValue({ email: 'new@example.invalid', role: 'User' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^email/i), 'new@example.invalid');
    await user.type(within(dialog).getByLabelText(/^password/i), VALID_SECRET);
    await user.type(within(dialog).getByLabelText(/confirm password/i), VALID_SECRET);
    await user.click(within(dialog).getByRole('button', { name: /create user/i }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        { email: 'new@example.invalid', password: VALID_SECRET, role: 'User' },
        expect.any(String),
      );
    });
  });

  it('refuses to submit when the confirmation does not match', async () => {
    const create = vi.spyOn(authService, 'createUser');
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^email/i), 'new@example.invalid');
    await user.type(within(dialog).getByLabelText(/^password/i), VALID_SECRET);
    await user.type(within(dialog).getByLabelText(/confirm password/i), 'something-else-entirely');
    await user.click(within(dialog).getByRole('button', { name: /create user/i }));

    expect(await within(dialog).findByText(/do not match/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses to submit a credential shorter than the existing policy', async () => {
    const create = vi.spyOn(authService, 'createUser');
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^email/i), 'new@example.invalid');
    await user.type(within(dialog).getByLabelText(/^password/i), 'short');
    await user.type(within(dialog).getByLabelText(/confirm password/i), 'short');
    await user.click(within(dialog).getByRole('button', { name: /create user/i }));

    // The hint carries the same wording and is always rendered, so this asserts
    // on the error element specifically — Field gives it role="alert".
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/12-128 characters/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("shows the server's duplicate-email refusal on the email field", async () => {
    vi.spyOn(authService, 'createUser').mockRejectedValue(
      new AppError('VALIDATION_FAILED', 'Please correct the highlighted fields.', {
        fields: { email: 'An account with that email already exists.' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^email/i), 'test-only.staff@example.invalid');
    await user.type(within(dialog).getByLabelText(/^password/i), VALID_SECRET);
    await user.type(within(dialog).getByLabelText(/confirm password/i), VALID_SECRET);
    await user.click(within(dialog).getByRole('button', { name: /create user/i }));

    expect(await within(dialog).findByText(/already exists/i)).toBeInTheDocument();
  });

  it('offers only the two roles the system has', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    const options = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toEqual(['Admin', 'User']);
  });
});

describe('resetting a credential', () => {
  it('sends the new value for the chosen account', async () => {
    const reset = vi.spyOn(authService, 'resetUserCredential').mockResolvedValue(managed());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('test-only.staff@example.invalid');

    await user.click(screen.getByRole('button', { name: /set password/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^new password/i), VALID_SECRET);
    await user.type(within(dialog).getByLabelText(/confirm new password/i), VALID_SECRET);
    await user.click(within(dialog).getByRole('button', { name: /^set password$/i }));

    await waitFor(() => {
      expect(reset).toHaveBeenCalledWith(
        'test-only.staff@example.invalid',
        VALID_SECRET,
        expect.any(String),
      );
    });
  });

  it('never offers to show the existing credential', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('test-only.staff@example.invalid');

    await user.click(screen.getByRole('button', { name: /set password/i }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByText(/current password is/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /show/i })).not.toBeInTheDocument();
    // Both inputs are masked.
    for (const label of [/^new password/i, /confirm new password/i]) {
      expect(within(dialog).getByLabelText(label)).toHaveAttribute('type', 'password');
    }
  });

  it('requires the confirmation to match', async () => {
    const reset = vi.spyOn(authService, 'resetUserCredential');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('test-only.staff@example.invalid');

    await user.click(screen.getByRole('button', { name: /set password/i }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^new password/i), VALID_SECRET);
    await user.type(within(dialog).getByLabelText(/confirm new password/i), 'not-the-same-value');
    await user.click(within(dialog).getByRole('button', { name: /^set password$/i }));

    expect(await within(dialog).findByText(/do not match/i)).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('activation and roles', () => {
  it('deactivates an active account', async () => {
    const setActive = vi
      .spyOn(authService, 'setUserActive')
      .mockResolvedValue(managed({ active: false }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('test-only.staff@example.invalid');

    await user.click(screen.getByRole('button', { name: /deactivate/i }));

    await waitFor(() => {
      expect(setActive).toHaveBeenCalledWith(
        'test-only.staff@example.invalid',
        false,
        expect.any(String),
      );
    });
  });

  it('offers Activate for an inactive account', async () => {
    vi.spyOn(authService, 'listUsers').mockResolvedValue([managed({ active: false })]);
    const setActive = vi.spyOn(authService, 'setUserActive').mockResolvedValue(managed());
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('test-only.staff@example.invalid');

    await user.click(screen.getByRole('button', { name: /activate/i }));

    await waitFor(() => {
      expect(setActive).toHaveBeenCalledWith(
        'test-only.staff@example.invalid',
        true,
        expect.any(String),
      );
    });
  });

  it('changes a role', async () => {
    const setRole = vi
      .spyOn(authService, 'setUserRole')
      .mockResolvedValue(managed({ role: 'Admin' }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('test-only.staff@example.invalid');

    await user.selectOptions(
      screen.getByLabelText(/role for test-only.staff@example.invalid/i),
      'Admin',
    );

    await waitFor(() => {
      expect(setRole).toHaveBeenCalledWith(
        'test-only.staff@example.invalid',
        'Admin',
        expect.any(String),
      );
    });
  });

  it("surfaces the server's last-Admin refusal in full", async () => {
    vi.spyOn(authService, 'listUsers').mockResolvedValue([
      managed({ email: TEST_ONLY_ADMIN.email, role: 'Admin' }),
    ]);
    vi.spyOn(authService, 'setUserActive').mockRejectedValue(
      // VALIDATION_FAILED, matching what the handler actually throws: the caller
      // IS an Admin, so FORBIDDEN would be both untrue and unhelpful here.
      new AppError(
        'VALIDATION_FAILED',
        'Deactivating this account would leave the system with no active administrator.',
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(TEST_ONLY_ADMIN.email);

    await user.click(screen.getByRole('button', { name: /deactivate/i }));

    // The reason has to reach the user verbatim: there is no field on this page
    // to correct, so a generic message would leave them with no next step.
    expect(await screen.findByText(/no active administrator/i)).toBeInTheDocument();
  });
});
