import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';

import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import QuotationsPage from '@/pages/quotations';
import NewQuotationPage from '@/pages/quotations/new';
import CustomersPage from '@/pages/customers';
import ItemsPage from '@/pages/items';
import TermsPage from '@/pages/terms';
import SignatoriesPage from '@/pages/signatories';
import SettingsPage from '@/pages/settings';

function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="That page does not exist"
        description="Check the address, or use the navigation to find what you need."
      />
    </>
  );
}

/**
 * Application routes.
 *
 * Phase 02 wraps the application branch in <RequireAuth> and puts
 * /signatories and /settings behind <RequireRole role="Admin">, matching the
 * requiredRole already declared in src/config/navigation.ts. Those guards are
 * UX only — authorization is enforced server-side on every action, because the
 * Apps Script endpoint is publicly reachable (IMPLEMENTATION_PLAN.md §15.1).
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'quotations', element: <QuotationsPage /> },
      { path: 'quotations/new', element: <NewQuotationPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'items', element: <ItemsPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: 'signatories', element: <SignatoriesPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '404', element: <NotFoundPage /> },
      { path: '*', element: <Navigate to="/404" replace /> },
    ],
  },
]);
