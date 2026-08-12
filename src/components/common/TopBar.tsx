import { useState } from 'react';
import { COMPANY_IDENTITY } from '@/config/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from './Button';

export interface TopBarProps {
  onToggleSidebar: () => void;
}

export function TopBar({ onToggleSidebar }: TopBarProps) {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = (): void => {
    setSigningOut(true);
    void logout().finally(() => {
      setSigningOut(false);
    });
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          onClick={onToggleSidebar}
          aria-label="Toggle navigation"
        >
          ☰
        </Button>
        <span className="text-sm font-medium text-slate-700">{COMPANY_IDENTITY.name}</span>
      </div>

      {user === null ? null : (
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm text-slate-700">{user.email}</p>
            <p className="text-xs text-slate-500">{user.role}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleSignOut} isLoading={signingOut}>
            Sign out
          </Button>
        </div>
      )}
    </header>
  );
}
