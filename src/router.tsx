import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/common/AppLayout';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { RequireAuth } from '@/components/common/RequireAuth';
import { RequireRole } from '@/components/common/RequireRole';

import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import QuotationsPage from '@/pages/quotations';
import NewQuotationPage from '@/pages/quotations/new';
import QuotationPreviewPage from '@/pages/quotations/preview';
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
 * Everything except /login sits behind <RequireAuth>. Authorized Persons and
 * Company Settings additionally require the Admin role, matching the
 * requiredRole declared in src/config/navigation.ts and the permission matrix
 * in IMPLEMENTATION_PLAN.md §18.4.
 *
 * These guards are UX only. The Apps Script endpoint is publicly reachable, so
 * authorization is enforced server-side on every action (§15.1, §19.2).
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'quotations', element: <QuotationsPage /> },
      { path: 'quotations/new', element: <NewQuotationPage /> },
      { path: 'quotations/:draftId/preview', element: <QuotationPreviewPage /> },
      { path: 'customers', element: <CustomersPage /> },
      { path: 'items', element: <ItemsPage /> },
      { path: 'terms', element: <TermsPage /> },
      {
        path: 'signatories',
        element: (
          <RequireRole role="Admin">
            <SignatoriesPage />
          </RequireRole>
        ),
      },
      {
        path: 'settings',
        element: (
          <RequireRole role="Admin">
            <SettingsPage />
          </RequireRole>
        ),
      },
      { path: '404', element: <NotFoundPage /> },
      { path: '*', element: <Navigate to="/404" replace /> },
    ],
  },
]);
