import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';

import { AppLayout } from '@/components/common/AppLayout';
import { NAV_ITEMS } from '@/config/navigation';
import {
  renderWithProviders,
  TEST_ONLY_ADMIN,
  TEST_ONLY_USER,
  type RenderOptions,
} from '@/__fixtures__/test-render';

import DashboardPage from '@/pages/dashboard';
import QuotationsPage from '@/pages/quotations';
import NewQuotationPage from '@/pages/quotations/new';
import CustomersPage from '@/pages/customers';
import ItemsPage from '@/pages/items';
import TermsPage from '@/pages/terms';
import SignatoriesPage from '@/pages/signatories';
import SettingsPage from '@/pages/settings';

function renderInShell(path: string, element: ReactElement, options: RenderOptions = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={element} />
        <Route path={path.replace(/^\//, '')} element={element} />
      </Route>
    </Routes>,
    { route: path, user: TEST_ONLY_ADMIN, ...options },
  );
}

function offline() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('offline'))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('application shell', () => {
  it('renders every PRD §7 navigation destination for an Admin', () => {
    offline();
    renderInShell('/', <DashboardPage />);

    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: item.label })).toBeInTheDocument();
    }
    expect(NAV_ITEMS).toHaveLength(8);
  });

  it('hides Admin-only destinations from a User', () => {
    offline();
    renderInShell('/', <DashboardPage />, { user: TEST_ONLY_USER });

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Authorized Persons' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Company Settings' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'New Quotation' })).toBeInTheDocument();
  });

  it('shows the company name, the signed-in user and a sign-out control', () => {
    offline();
    renderInShell('/', <DashboardPage />, { user: TEST_ONLY_USER });

    expect(screen.getByText('Speed Falcon Company')).toBeInTheDocument();
    expect(screen.getByText(TEST_ONLY_USER.email)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
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
    renderInShell(path, element);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('states honestly that a section is not implemented instead of showing sample data', () => {
    renderInShell('/customers', <CustomersPage />);
    expect(screen.getByText(/is not implemented yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No sample or demo data is shown here by design/i)).toBeInTheDocument();
  });

  it('does not reserve a quotation number when the New Quotation page opens', async () => {
    // PRD §35: opening the application must not create a quotation.
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetchSpy);

    renderInShell('/quotations/new', <NewQuotationPage />);
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
