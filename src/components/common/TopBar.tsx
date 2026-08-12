import { COMPANY_IDENTITY } from '@/config/navigation';
import { Button } from './Button';

export interface TopBarProps {
  onToggleSidebar: () => void;
}

export function TopBar({ onToggleSidebar }: TopBarProps) {
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

      {/*
        The signed-in user and the sign-out control are added in Phase 02,
        which owns sessions. This slot is deliberately empty until then.
      */}
      <div data-testid="topbar-user-slot" />
    </header>
  );
}
