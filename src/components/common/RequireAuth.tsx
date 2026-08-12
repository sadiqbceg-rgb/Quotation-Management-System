import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from './Spinner';

/**
 * Gate a route on an authenticated session.
 *
 * This is a USER-EXPERIENCE control, not a security control. The Apps Script
 * endpoint is publicly reachable, so anything that actually matters is enforced
 * server-side on every action (IMPLEMENTATION_PLAN.md §15.1, §18.4). Removing
 * this component would make the app confusing, not insecure.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" label="Checking your session" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Remember where the user was headed so login can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
