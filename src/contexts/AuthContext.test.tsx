import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { AuthProvider } from './AuthContext';
import { useAuth } from '@/hooks/useAuth';
import * as authService from '@/services/auth/auth-service';
import { AppError } from '@/services/api/errors';

const TOKEN = 'test-only.session.token';
const USER = { email: 'test-only.user@example.invalid', role: 'User' as const };

function Probe() {
  const { state, user, role, isAuthenticated, isLoading, login, logout } = useAuth();

  return (
    <div>
      <p data-testid="status">{state.status}</p>
      <p data-testid="email">{user?.email ?? '-'}</p>
      <p data-testid="role">{role ?? '-'}</p>
      <p data-testid="flags">{`${String(isAuthenticated)}/${String(isLoading)}`}</p>
      <button
        type="button"
        onClick={() => {
          void login('someone@speedxksa.com', 'a-very-long-password');
        }}
      >
        sign in
      </button>
      <button
        type="button"
        onClick={() => {
          void logout();
        }}
      >
        sign out
      </button>
    </div>
  );
}

function renderProvider(children: ReactNode = <Probe />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  sessionStorage.clear();
});

describe('startup', () => {
  it('settles to anonymous when there is no stored session', async () => {
    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
  });

  it('validates a stored token with the backend before trusting it', async () => {
    sessionStorage.setItem('qms.session', JSON.stringify({ token: TOKEN, user: USER }));
    const fetchCurrentUser = vi.spyOn(authService, 'fetchCurrentUser').mockResolvedValue(USER);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(fetchCurrentUser).toHaveBeenCalledWith(TOKEN);
  });

  it('discards a stored token the backend rejects', async () => {
    sessionStorage.setItem('qms.session', JSON.stringify({ token: TOKEN, user: USER }));
    vi.spyOn(authService, 'fetchCurrentUser').mockRejectedValue(
      new AppError('AUTH_EXPIRED', 'expired'),
    );

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
    expect(sessionStorage.getItem('qms.session')).toBeNull();
  });

  it('takes the role from the backend, not from what was stored', async () => {
    // A tampered sessionStorage entry claiming Admin must not grant Admin.
    sessionStorage.setItem(
      'qms.session',
      JSON.stringify({ token: TOKEN, user: { email: USER.email, role: 'Admin' } }),
    );
    vi.spyOn(authService, 'fetchCurrentUser').mockResolvedValue(USER);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('User');
    });
  });

  it('ignores a corrupt stored session', async () => {
    sessionStorage.setItem('qms.session', '{not valid json');
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
  });

  it('ignores a stored session with an unknown role', async () => {
    sessionStorage.setItem(
      'qms.session',
      JSON.stringify({ token: TOKEN, user: { email: USER.email, role: 'SuperAdmin' } }),
    );
    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
  });
});

describe('sign in and out', () => {
  it('stores the session on a successful sign-in', async () => {
    const user = userEvent.setup();
    vi.spyOn(authService, 'login').mockResolvedValue({ token: TOKEN, user: USER });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });

    await user.click(screen.getByRole('button', { name: 'sign in' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(screen.getByTestId('email')).toHaveTextContent(USER.email);
    expect(sessionStorage.getItem('qms.session')).toContain(TOKEN);
  });

  it('uses sessionStorage rather than localStorage', async () => {
    const user = userEvent.setup();
    vi.spyOn(authService, 'login').mockResolvedValue({ token: TOKEN, user: USER });

    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
    await user.click(screen.getByRole('button', { name: 'sign in' }));

    await waitFor(() => {
      expect(sessionStorage.getItem('qms.session')).not.toBeNull();
    });
    expect(localStorage.getItem('qms.session')).toBeNull();
  });

  it('clears the session on sign-out and revokes the token server-side', async () => {
    const user = userEvent.setup();
    vi.spyOn(authService, 'login').mockResolvedValue({ token: TOKEN, user: USER });
    const logoutSpy = vi.spyOn(authService, 'logout').mockResolvedValue();

    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
    await user.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    await user.click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
    expect(logoutSpy).toHaveBeenCalledWith(TOKEN);
    expect(sessionStorage.getItem('qms.session')).toBeNull();
  });

  it('still signs the user out locally when revocation fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(authService, 'login').mockResolvedValue({ token: TOKEN, user: USER });
    vi.spyOn(authService, 'logout').mockRejectedValue(new AppError('NETWORK_ERROR', 'offline'));

    renderProvider();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
    await user.click(screen.getByRole('button', { name: 'sign in' }));
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    await user.click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => {
      expect(sessionStorage.getItem('qms.session')).toBeNull();
    });
  });

  it('surfaces a login failure to the caller', async () => {
    vi.spyOn(authService, 'login').mockRejectedValue(new AppError('AUTH_INVALID', 'bad'));

    let captured: unknown = null;
    function FailingProbe() {
      const { login } = useAuth();
      return (
        <button
          type="button"
          onClick={() => {
            login('a@b.com', 'x').catch((error: unknown) => {
              captured = error;
            });
          }}
        >
          try
        </button>
      );
    }

    const user = userEvent.setup();
    renderProvider(<FailingProbe />);
    await user.click(screen.getByRole('button', { name: 'try' }));

    await waitFor(() => {
      expect(captured).toBeInstanceOf(AppError);
    });
  });
});

describe('useAuth outside a provider', () => {
  it('throws a clear error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/must be used inside an <AuthProvider>/);
    consoleError.mockRestore();
  });
});
