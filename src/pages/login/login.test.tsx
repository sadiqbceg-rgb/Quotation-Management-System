import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import LoginPage from '@/pages/login';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';

describe('login form', () => {
  it('renders email and password fields', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('never renders a demo account, a default password or a test-login hint', () => {
    renderWithProviders(<LoginPage />);

    expect(screen.queryByText(/@example\.com/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no self-registration/i)).toBeInTheDocument();
  });

  it('does not disclose the password policy', () => {
    // Stating "at least 12 characters" here would hand an attacker the policy
    // before they ever submit.
    renderWithProviders(<LoginPage />);
    expect(screen.queryByText(/12 characters/i)).not.toBeInTheDocument();
  });

  it('validates that both fields are filled in', async () => {
    const user = userEvent.setup();
    const login = vi.fn(() => Promise.resolve());
    renderWithProviders(<LoginPage />, { login });

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/enter your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('submits the credentials', async () => {
    const user = userEvent.setup();
    const login = vi.fn(() => Promise.resolve());
    renderWithProviders(<LoginPage />, { login });

    await user.type(screen.getByLabelText(/email/i), 'someone@speedxksa.com');
    await user.type(screen.getByLabelText(/password/i), 'a-very-long-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('someone@speedxksa.com', 'a-very-long-password');
    });
  });

  it('shows one generic message for invalid credentials', async () => {
    const user = userEvent.setup();
    const login = vi.fn(() => Promise.reject(new AppError('AUTH_INVALID', 'Invalid')));
    renderWithProviders(<LoginPage />, { login });

    await user.type(screen.getByLabelText(/email/i), 'someone@speedxksa.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password.');
    // It must not say whether the account exists.
    expect(alert).not.toHaveTextContent(/not found|no such|unknown/i);
  });

  it('shows a distinct message when the account is locked out', async () => {
    const user = userEvent.setup();
    const login = vi.fn(() => Promise.reject(new AppError('RATE_LIMITED', 'Locked')));
    renderWithProviders(<LoginPage />, { login });

    await user.type(screen.getByLabelText(/email/i), 'someone@speedxksa.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('shows a recoverable message when the network fails', async () => {
    const user = userEvent.setup();
    const login = vi.fn(() => Promise.reject(new AppError('NETWORK_ERROR', 'offline')));
    renderWithProviders(<LoginPage />, { login });

    await user.type(screen.getByLabelText(/email/i), 'someone@speedxksa.com');
    await user.type(screen.getByLabelText(/password/i), 'a-very-long-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
    // The button must not stay stuck in a loading state after a failure.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
    });
  });

  it('redirects an already-authenticated user away from the login page', () => {
    renderWithProviders(<LoginPage />, { user: TEST_ONLY_USER });
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('shows a spinner while the session is still being resolved', () => {
    renderWithProviders(<LoginPage />, { loading: true });
    expect(screen.getByRole('status', { name: /checking your session/i })).toBeInTheDocument();
  });
});
