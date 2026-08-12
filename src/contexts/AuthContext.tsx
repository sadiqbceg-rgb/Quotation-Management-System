import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthContext, type AuthContextValue, type AuthState } from '@/hooks/useAuth';
import { setSessionHooks } from '@/services/api/client';
import * as authService from '@/services/auth/auth-service';
import type { AuthenticatedUser } from '@/services/auth/auth-service';

/**
 * Session storage key.
 *
 * `sessionStorage`, not `localStorage`: the token dies with the browser tab.
 *
 * Apps Script cannot set an HttpOnly cookie for a cross-origin SPA, so a
 * JavaScript-readable store is the only option available. The mitigations are
 * the 8-hour TTL, server-side revocation on logout, the strict CSP, and the
 * lint-enforced absence of `dangerouslySetInnerHTML`. This trade-off is
 * documented in IMPLEMENTATION_PLAN.md §18.3.
 */
const STORAGE_KEY = 'qms.session';

interface StoredSession {
  token: string;
  user: AuthenticatedUser;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as Record<string, unknown>;
    const token = candidate['token'];
    const user = candidate['user'];

    if (typeof token !== 'string' || typeof user !== 'object' || user === null) return null;

    const userRecord = user as Record<string, unknown>;
    const email = userRecord['email'];
    const role = userRecord['role'];

    if (typeof email !== 'string') return null;
    if (role !== 'Admin' && role !== 'User') return null;

    return { token, user: { email, role } };
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession | null): void {
  try {
    if (session === null) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // A blocked storage quota must not break sign-in; the session simply will
    // not survive a refresh.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  // Read by the session hooks without making them depend on render state.
  const stateRef = useRef<AuthState>(state);
  stateRef.current = state;

  const clearSession = useCallback(() => {
    writeStoredSession(null);
    setState({ status: 'anonymous' });
  }, []);

  /**
   * Rehydrate on mount.
   *
   * A stored token is never trusted on its own — it is confirmed with
   * `auth.me`, which also re-reads the authoritative role. A token for a
   * deactivated account, a revoked token, or one signed with a rotated secret
   * is rejected here rather than at the user's first action.
   */
  useEffect(() => {
    const stored = readStoredSession();

    if (stored === null) {
      setState({ status: 'anonymous' });
      return;
    }

    let cancelled = false;

    authService
      .fetchCurrentUser(stored.token)
      .then((user) => {
        if (cancelled) return;
        writeStoredSession({ token: stored.token, user });
        setState({ status: 'authenticated', user, token: stored.token });
      })
      .catch(() => {
        if (cancelled) return;
        writeStoredSession(null);
        setState({ status: 'anonymous' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Register the client-wide session hooks exactly once. */
  useEffect(() => {
    setSessionHooks({
      onAuthFailure: () => {
        clearSession();
      },
      onTokenRenewed: (token: string) => {
        const current = stateRef.current;
        if (current.status !== 'authenticated') return;
        writeStoredSession({ token, user: current.user });
        setState({ status: 'authenticated', user: current.user, token });
      },
    });

    return () => {
      setSessionHooks(null);
    };
  }, [clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authService.login(email, password);
    writeStoredSession({ token: result.token, user: result.user });
    setState({ status: 'authenticated', user: result.user, token: result.token });
  }, []);

  const logout = useCallback(async () => {
    const current = stateRef.current;

    // Clear locally first: the user is signed out even if the revocation call
    // fails, and the backend token still expires on its own.
    clearSession();

    if (current.status === 'authenticated') {
      try {
        await authService.logout(current.token);
      } catch {
        // Best effort — nothing useful to show the user here.
      }
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user: state.status === 'authenticated' ? state.user : null,
      role: state.status === 'authenticated' ? state.user.role : null,
      isAuthenticated: state.status === 'authenticated',
      isLoading: state.status === 'loading',
      login,
      logout,
    }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
