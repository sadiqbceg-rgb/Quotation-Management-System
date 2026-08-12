import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { AppLayout } from '@/components/common/AppLayout';
import { ToastProvider } from '@/components/common/Toast';
import { NAV_ITEMS } from '@/config/navigation';

import DashboardPage from '@/pages/dashboard';
import QuotationsPage from '@/pages/quotations';
import NewQuotationPage from '@/pages/quotations/new';
import CustomersPage from '@/pages/customers';
import ItemsPage from '@/pages/items';
import TermsPage from '@/pages/terms';
import SignatoriesPage from '@/pages/signatories';
import SettingsPage from '@/pages/settings';
import LoginPage from '@/pages/login';

function renderAt(path: string, element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route path={path.replace(/^\//, '')} element={element} />
              <Route index element={element} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('application shell', () => {
  it('renders every PRD §7 navigation destination', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );

    renderAt('/', <DashboardPage />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: item.label })).toBeInTheDocument();
    }
    expect(NAV_ITEMS).toHaveLength(8);
  });

  it('shows the company name in the top bar', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );

    renderAt('/', <DashboardPage />);
    expect(screen.getByText('Speed Falcon Company')).toBeInTheDocument();
  });
});

describe('placeholder pages', () => {
  it.each([
    ['/quotations', <QuotationsPage key="q" />, 'Quotations'],
    ['/quotations/new', <NewQuotationPage key="n" />, 'New Quotation'],
    ['/customers', <CustomersPage key="c" />, 'Customers'],
    ['/items', <ItemsPage key="i" />, 'Items / Services'],
    ['/terms', <TermsPage key="t" />, 'Terms & Conditions'],
    ['/signatories', <SignatoriesPage key="s" />, 'Authorized Persons'],
    ['/settings', <SettingsPage key="g" />, 'Company Settings'],
  ])('renders %s without crashing', (path, element, heading) => {
    renderAt(path, element);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('states honestly that a section is not implemented instead of showing sample data', () => {
    renderAt('/customers', <CustomersPage />);
    expect(screen.getByText(/is not implemented yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No sample or demo data is shown here by design/i)).toBeInTheDocument();
  });

  it('does not reserve a quotation number when the New Quotation page opens', async () => {
    // PRD §35: opening the application must not create a quotation.
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchSpy);

    renderAt('/quotations/new', <NewQuotationPage />);
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('login page', () => {
  it('renders no credentials, demo account or test-login hint', () => {
    render(<LoginPage />);
    expect(screen.getByText(/Sign-in is implemented in Phase 02/i)).toBeInTheDocument();
    expect(screen.queryByText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/@example\./i)).not.toBeInTheDocument();
  });
});
