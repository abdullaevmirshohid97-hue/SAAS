import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { createClient } from '@supabase/supabase-js';

import { ThemeProvider } from '@clary/ui-web';

import './styles.css';
import { AdminShell } from './components/admin-shell';
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { TenantsPage } from './pages/tenants';
import { TenantDetailPage } from './pages/tenant-detail';
import { AuditPage } from './pages/audit';
import { RevenuePage } from './pages/revenue';
import { SupportPage } from './pages/support';
import { FeatureFlagsPage } from './pages/feature-flags';
import { DoctorsPage } from './pages/doctors';
import { PharmaciesPage } from './pages/pharmacies';
import { AnalyticsPage } from './pages/analytics';
import { WebsitePage } from './pages/website';
import { PatientsPage } from './pages/patients';
import { MedicationsPage } from './pages/medications';
import { DiagnosticsPage } from './pages/diagnostics';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AdminShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard',     element: <DashboardPage /> },
      { path: 'tenants',       element: <TenantsPage /> },
      { path: 'tenants/:id',   element: <TenantDetailPage /> },
      { path: 'doctors',       element: <DoctorsPage /> },
      { path: 'patients',      element: <PatientsPage /> },
      { path: 'pharmacies',    element: <PharmaciesPage /> },
      { path: 'medications',   element: <MedicationsPage /> },
      { path: 'diagnostics',   element: <DiagnosticsPage /> },
      { path: 'analytics',     element: <AnalyticsPage /> },
      { path: 'audit',         element: <AuditPage /> },
      { path: 'revenue',       element: <RevenuePage /> },
      { path: 'payments',      element: <RevenuePage /> },
      { path: 'debts',         element: <RevenuePage /> },
      { path: 'support',       element: <SupportPage /> },
      { path: 'feature-flags', element: <FeatureFlagsPage /> },
      { path: 'website',       element: <WebsitePage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="clary-admin-theme">
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[sw] register failed', err);
    });
  });
}
