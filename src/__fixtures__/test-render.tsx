/**
 * TEST ONLY — shared render helpers.
 *
 * Importable from `*.test.tsx` only; an ESLint rule blocks application code
 * from reaching into `__fixtures__` (IMPLEMENTATION_PLAN.md §20.4).
 *
 * Nothing here is production data: the accounts are obviously synthetic and
 * exist purely to drive the auth state machine.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

import { ToastProvider } from '@/components/common/Toast';
import { AuthContext, type AuthContextValue, type AuthState } from '@/hooks/useAuth';
import type { AuthenticatedUser } from '@/services/auth/auth-service';

export const TEST_ONLY_USER: AuthenticatedUser = {
  email: 'test-only.user@example.invalid',
  role: 'User',
};

export const TEST_ONLY_ADMIN: AuthenticatedUser = {
  email: 'test-only.admin@example.invalid',
  role: 'Admin',
};

export const TEST_ONLY_TOKEN = 'test-only.token.value';

export function authState(user: AuthenticatedUser | null, loading = false): AuthState {
  if (loading) return { status: 'loading' };
  if (user === null) return { status: 'anonymous' };
  return { status: 'authenticated', user, token: TEST_ONLY_TOKEN };
}

export interface StubAuthOptions {
  user?: AuthenticatedUser | null;
  loading?: boolean;
  login?: AuthContextValue['login'];
  logout?: AuthContextValue['logout'];
}

export function stubAuthValue(options: StubAuthOptions = {}): AuthContextValue {
  const state = authState(options.user ?? null, options.loading ?? false);

  return {
    state,
    user: state.status === 'authenticated' ? state.user : null,
    role: state.status === 'authenticated' ? state.user.role : null,
    isAuthenticated: state.status === 'authenticated',
    isLoading: state.status === 'loading',
    login: options.login ?? (() => Promise.resolve()),
    logout: options.logout ?? (() => Promise.resolve()),
  };
}

export interface RenderOptions extends StubAuthOptions {
  route?: string;
}

/** Render a tree with the query client, toasts, a router and a stubbed session. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthContext.Provider value={stubAuthValue(options)}>
          <MemoryRouter initialEntries={[options.route ?? '/']}>{children}</MemoryRouter>
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>
  );

  return render(ui, { wrapper });
}
