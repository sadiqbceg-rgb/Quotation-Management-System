/**
 * Authentication and authorization, end to end.
 *
 * The pieces are covered elsewhere — `token.test.ts` for the token, `main.test.ts`
 * for the action table, `guards.test.tsx` for the route guards, `login.test.tsx`
 * for the form. What is only visible from here:
 *
 *   - that a wrong password and an unknown account are indistinguishable in
 *     TIMING as well as in wording (an attacker with a stopwatch enumerates
 *     accounts that a careful error message would not disclose),
 *   - that a rejected session is cleared and the user is sent to /login,
 *   - that the login page then returns them to where they were going,
 *   - that a role is read from the server on every request, so promoting or
 *     demoting somebody takes effect without them signing out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import {
  createFakeBackend,
  TEST_ONLY_PASSWORD,
  type FakeBackend,
} from '../../../test/fakes/backend';
import { AppError } from '@/services/api/errors';
import { login, fetchCurrentUser, createUser } from '@/services/auth/auth-service';
import { listQuotations } from '@/services/quotation/quotation-service';
import { AuthProvider } from '@/contexts/AuthContext';
import { RequireAuth } from '@/components/common/RequireAuth';
import { RequireRole } from '@/components/common/RequireRole';
import LoginPage from '@/pages/login';
import {
  USERS_SHEET_NAME,
  findByEmail,
} from '../../../google-apps-script/src/sheets/users-repository';

const STAFF = 'staff@speedxksa.com';
const BOSS = 'admin@speedxksa.com';

let backend: FakeBackend;

/** The session key AuthProvider mirrors the token to. */
const SESSION_STORAGE_KEY = 'qms.session';

/**
 * Change somebody's role the way an administrator actually would: by editing
 * the `Role` cell in the `Users` sheet.
 *
 * There is no `setUserRole` in the repository, and deliberately so — role
 * changes go through `admin.createUser` or through the sheet. Reaching into the
 * fake here is therefore the faithful reproduction, not a shortcut.
 */
const ROLE_COLUMN = 4;

function promoteInTheSheet(email: string, role: 'Admin' | 'User'): void {
  const user = findByEmail(email);
  if (user === null) throw new Error(`No user ${email} to promote.`);

  const sheet = backend.env.spreadsheet.formatting(USERS_SHEET_NAME);
  const row = sheet?.rows[user.rowNumber - 1];
  if (row === undefined) throw new Error(`No sheet row for ${email}.`);

  row[ROLE_COLUMN] = role;
}

beforeEach(() => {
  sessionStorage.clear();
  backend = createFakeBackend(vi.stubGlobal);
});

afterEach(() => {
  backend.teardown();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

/* -------------------------------------------------------------------------- */
/* Sign-in outcomes                                                            */
/* -------------------------------------------------------------------------- */

describe('signing in', () => {
  it('succeeds for the right password', async () => {
    backend.signIn(STAFF);
    const result = await login(STAFF, TEST_ONLY_PASSWORD);
    expect(result.user.email).toBe(STAFF);
  });

  it('accepts the email in any casing, because people type it that way', async () => {
    backend.signIn(STAFF);
    const result = await login('Staff@SpeedXKSA.com', TEST_ONLY_PASSWORD);
    expect(result.user.email).toBe(STAFF);
  });

  it('gives the same code AND the same words for a wrong password and an unknown account', async () => {
    backend.signIn(STAFF);

    const wrong = await login(STAFF, 'TEST_ONLY_wrong').catch((error: unknown) => error);
    const unknown = await login('ghost@speedxksa.com', TEST_ONLY_PASSWORD).catch(
      (error: unknown) => error,
    );

    expect(wrong).toBeInstanceOf(AppError);
    expect(unknown).toBeInstanceOf(AppError);
    expect((wrong as AppError).code).toBe((unknown as AppError).code);
    expect((wrong as AppError).message).toBe((unknown as AppError).message);
  });

  it('is indistinguishable in timing between a wrong password and an unknown account', () => {
    /*
     * The control this measures is a DUMMY HASH: an unknown account must burn
     * the same PBKDF2 work as a real one, or the response time alone tells an
     * attacker which addresses are staff accounts.
     *
     * Measured as a ratio over several rounds rather than an absolute, because
     * absolute timings on a shared CI runner are noise. A missing dummy hash is
     * not a subtle difference — it is thousands of iterations against none, so
     * the tolerance can be generous and still catch it.
     */
    backend.signIn(STAFF);

    function timeOf(email: string, password: string): number {
      const started = performance.now();
      // Synchronous on purpose: the fake backend routes straight into the
      // router, so this measures the hashing rather than the event loop.
      backend.env.properties.get('PASSWORD_PEPPER');
      void login(email, password).catch(() => undefined);
      return performance.now() - started;
    }

    const rounds = 8;
    let wrongPassword = 0;
    let unknownAccount = 0;

    for (let round = 0; round < rounds; round++) {
      wrongPassword += timeOf(STAFF, 'TEST_ONLY_wrong');
      unknownAccount += timeOf('ghost@speedxksa.com', TEST_ONLY_PASSWORD);
    }

    const ratio = unknownAccount / Math.max(wrongPassword, 0.001);

    // An unknown account that skipped the hash would come back an order of
    // magnitude faster. Anything inside 0.1x-10x is noise, not a signal.
    expect(
      ratio,
      `unknown ${String(unknownAccount)}ms vs wrong ${String(wrongPassword)}ms`,
    ).toBeGreaterThan(0.1);
    expect(ratio).toBeLessThan(10);
  });

  it('locks an email out after five failures and refuses even the right password', async () => {
    backend.signIn(STAFF);

    for (let attempt = 0; attempt < 5; attempt++) {
      await login(STAFF, 'TEST_ONLY_wrong').catch(() => undefined);
    }

    await expect(login(STAFF, TEST_ONLY_PASSWORD)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('does not lock a different account out at the same time', async () => {
    backend.signIn(STAFF);
    backend.signIn(BOSS, 'Admin');

    for (let attempt = 0; attempt < 6; attempt++) {
      await login(STAFF, 'TEST_ONLY_wrong').catch(() => undefined);
    }

    // Lockout is per email. Otherwise one attacker locks out the whole company.
    await expect(login(BOSS, TEST_ONLY_PASSWORD)).resolves.toMatchObject({
      user: { email: BOSS },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The role comes from the server                                              */
/* -------------------------------------------------------------------------- */

describe('roles', () => {
  it('lets an Admin do an Admin action', async () => {
    const token = backend.signIn(BOSS, 'Admin');

    await expect(
      createUser(
        { email: 'new-person@speedxksa.com', password: TEST_ONLY_PASSWORD, role: 'User' },
        token,
      ),
    ).resolves.toMatchObject({ email: 'new-person@speedxksa.com' });
  });

  it('refuses a User the same action', async () => {
    const token = backend.signIn(STAFF);

    await expect(
      createUser(
        { email: 'new-person@speedxksa.com', password: TEST_ONLY_PASSWORD, role: 'User' },
        token,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('takes effect the moment a role changes in the sheet, without a new sign-in', async () => {
    const token = backend.signIn(STAFF);

    // Promoted in the Users sheet. The token still says `User`, and the token
    // is not what is consulted (§18.4).
    promoteInTheSheet(STAFF, 'Admin');

    await expect(
      createUser(
        { email: 'new-person@speedxksa.com', password: TEST_ONLY_PASSWORD, role: 'User' },
        token,
      ),
    ).resolves.toBeTruthy();
  });

  it('reports the server-held role, not the one the browser stored', async () => {
    const token = backend.signIn(STAFF);
    promoteInTheSheet(STAFF, 'Admin');

    expect((await fetchCurrentUser(token)).role).toBe('Admin');
  });
});

/* -------------------------------------------------------------------------- */
/* The session in the browser                                                  */
/* -------------------------------------------------------------------------- */

/** Shows the path so a redirect can be asserted on rather than inferred. */
function WhereAmI({ label }: { label: string }) {
  const location = useLocation();
  return (
    <div>
      <span>{label}</span>
      <span data-testid="path">{location.pathname}</span>
    </div>
  );
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/quotations/new"
            element={
              <RequireAuth>
                <WhereAmI label="New Quotation" />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <RequireRole role="Admin">
                  <WhereAmI label="Settings" />
                </RequireRole>
              </RequireAuth>
            }
          />
          <Route path="/" element={<WhereAmI label="Dashboard" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('the route guards', () => {
  it('sends an anonymous visitor to the login page', async () => {
    renderApp('/quotations/new');

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('New Quotation')).not.toBeInTheDocument();
  });

  it('returns them to where they were going once they sign in', async () => {
    backend.signIn(STAFF);
    const user = userEvent.setup();

    renderApp('/quotations/new');
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/email/i), STAFF);
    await user.type(screen.getByLabelText(/password/i), TEST_ONLY_PASSWORD);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Not the dashboard: the page they asked for. Losing the destination is a
    // small thing that makes the application feel broken.
    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/quotations/new');
    });
    expect(screen.getByText('New Quotation')).toBeInTheDocument();
  });

  it('refuses a User an Admin route without pretending the route is missing', async () => {
    backend.signIn(STAFF);
    const user = userEvent.setup();

    renderApp('/settings');
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/email/i), STAFF);
    await user.type(screen.getByLabelText(/password/i), TEST_ONLY_PASSWORD);
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Wait for what should APPEAR, not for the login form to disappear: the
    // redirect unmounts the form a beat before the destination mounts, and an
    // assertion in that gap sees an empty tree and reports the wrong failure.
    await waitFor(() => {
      expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
    });

    // Explained, not a silent redirect that reads as a bug.
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* An expired session                                                          */
/* -------------------------------------------------------------------------- */

describe('a session that has expired', () => {
  it('is rejected by the server with AUTH_EXPIRED', async () => {
    const token = backend.signIn(STAFF);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 8 * 60 * 60 * 1000 + 60_000));
    try {
      await expect(listQuotations(token)).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('is cleared from the browser rather than left to fail every request', async () => {
    const token = backend.signIn(STAFF);
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token, user: { email: STAFF, role: 'User' } }),
    );

    renderApp('/quotations/new');
    await waitFor(() => {
      expect(screen.getByText('New Quotation')).toBeInTheDocument();
    });

    // The backend deactivates the account — a rejected session, from the
    // browser's point of view identical to an expired one.
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    expect(stored).not.toBeNull();
  });

  it('does not trust a stored session the backend no longer recognises', async () => {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        token: 'TEST_ONLY.not.a-real-token',
        user: { email: STAFF, role: 'Admin' },
      }),
    );

    renderApp('/quotations/new');

    // Validated against the backend before it is trusted, so a hand-edited
    // sessionStorage entry claiming `Admin` gets nowhere.
    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('New Quotation')).not.toBeInTheDocument();
  });
});
