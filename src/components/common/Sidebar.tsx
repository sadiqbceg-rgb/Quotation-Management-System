import { NavLink } from 'react-router-dom';
import { NAV_ITEMS, COMPANY_IDENTITY } from '@/config/navigation';
import { cn } from '@/utils/cn';

export interface SidebarProps {
  /** Mobile drawer state. On desktop the sidebar is always visible. */
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ open, onNavigate }: SidebarProps) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'w-64 shrink-0 border-r border-slate-200 bg-white',
        'fixed inset-y-0 left-0 z-30 transition-transform lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="flex h-14 items-center border-b border-slate-200 px-5">
        <span className="text-brand-navy text-sm font-semibold tracking-tight">
          {COMPANY_IDENTITY.shortName}
        </span>
      </div>

      <ul className="flex flex-col gap-0.5 p-3">
        {NAV_ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === '/' || item.path === '/quotations'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'block rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-brand-navy/5 text-brand-navy font-medium'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
