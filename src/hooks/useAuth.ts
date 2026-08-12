import { createContext, useContext } from 'react';
import type { UserRole } from '@shared/types';
import type { AuthenticatedUser } from '@/services/auth/auth-service';

/**
 * The session, as a discriminated union.
 *
 * `loading` is a distinct state on purpose: on a page refresh the app has a
 * token in sessionStorage but has not yet confirmed it with the backend. Without
 * this state a guard would briefly see "not authenticated" and bounce the user
 * to /login on every reload.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: AuthenticatedUser; token: string };

export interface AuthContextValue {
  state: AuthState;
  /** Convenience readers, derived from `state`. */
  user: AuthenticatedUser | null;
  role: UserRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }
  return context;
}
