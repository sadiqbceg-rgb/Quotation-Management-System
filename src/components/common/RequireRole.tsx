import type { ReactNode } from 'react';
import type { UserRole } from '@shared/types';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from './Spinner';
import { NotAuthorized } from './NotAuthorized';

export interface RequireRoleProps {
  role: UserRole;
  children: ReactNode;
}

/**
 * Gate a route on a role.
 *
 * Like RequireAuth, this is UX only — the backend re-checks the role on every
 * action from its central table (§19.2). Rendering "Not authorized" rather than
 * redirecting keeps the reason visible instead of silently bouncing the user.
 */
export function RequireRole({ role, children }: RequireRoleProps) {
  const { isLoading, role: currentRole } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" label="Checking your permissions" />
      </div>
    );
  }

  if (currentRole !== role) {
    return <NotAuthorized />;
  }

  return <>{children}</>;
}
