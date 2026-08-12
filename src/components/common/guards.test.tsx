import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';

import { RequireAuth } from './RequireAuth';
import { RequireRole } from './RequireRole';
import { renderWithProviders, TEST_ONLY_ADMIN, TEST_ONLY_USER } from '@/__fixtures__/test-render';

function Protected() {
  return <p>Protected content</p>;
}

function LoginStub() {
  return <p>Login page</p>;
}

function renderGuarded(
  element: React.ReactElement,
  options: Parameters<typeof renderWithProviders>[1],
) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginStub />} />
      <Route path="/secret" element={element} />
    </Routes>,
    { route: '/secret', ...options },
  );
}

describe('RequireAuth', () => {
  it('renders a spinner while the session is being resolved', () => {
    renderGuarded(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
      { loading: true },
    );

    expect(screen.getByRole('status', { name: /checking your session/i })).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to the login page', () => {
    renderGuarded(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
      { user: null },
    );

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders the route for an authenticated user', () => {
    renderGuarded(
      <RequireAuth>
        <Protected />
      </RequireAuth>,
      { user: TEST_ONLY_USER },
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});

describe('RequireRole', () => {
  it('renders the route for a matching role', () => {
    renderGuarded(
      <RequireRole role="Admin">
        <Protected />
      </RequireRole>,
      { user: TEST_ONLY_ADMIN },
    );

    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('shows Not authorized for a User hitting an Admin route', () => {
    renderGuarded(
      <RequireRole role="Admin">
        <Protected />
      </RequireRole>,
      { user: TEST_ONLY_USER },
    );

    expect(screen.getByRole('heading', { name: /not authorized/i })).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('explains why access was refused rather than silently redirecting', () => {
    renderGuarded(
      <RequireRole role="Admin">
        <Protected />
      </RequireRole>,
      { user: TEST_ONLY_USER },
    );

    expect(screen.getByText(/restricted to administrators/i)).toBeInTheDocument();
  });
});
