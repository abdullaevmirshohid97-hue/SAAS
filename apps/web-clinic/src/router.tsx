import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';

import { AppShell } from './components/app-shell';
import { RequireAuth } from './components/require-auth';
import { LoginPage } from './pages/login';
import { OnboardingPage } from './pages/onboarding';
import { DashboardPage } from './pages/dashboard';
import { ReceptionPage } from './pages/reception';
import { QueuePage } from './pages/queue';
import { DiagnosticsPage } from './pages/diagnostics';
import { LabPage } from './pages/lab';
import { PharmacyPage } from './pages/pharmacy';
import { InpatientPage } from './pages/inpatient';
import { CashierPage } from './pages/cashier';
import { JournalPage } from './pages/journal';
import { AnalyticsPage } from './pages/analytics';
import { MarketingPage } from './pages/marketing';
import { SettingsLayout } from './pages/settings/layout';
import { SettingsClinicPage } from './pages/settings/clinic';
import { SettingsCatalogPage } from './pages/settings/catalog';
import { SettingsIntegrationsPage } from './pages/settings/integrations';
import { SettingsAuditPage } from './pages/settings/audit';
import { SettingsStaffPage } from './pages/settings/staff';
import { StaffProfilesPage } from './pages/settings/staff-profiles';
import { SettingsSubscriptionPage } from './pages/settings/subscription';
import { ShiftOperatorsPage } from './pages/settings/shift-operators';
import { ShiftSchedulesPage } from './pages/settings/shift-schedules';
import { KioskPage } from './pages/kiosk';
import { DoctorConsolePage } from './pages/doctor-console';
import { PayrollPage } from './pages/payroll';
import { NursePage } from './pages/nurse';

const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/kiosk', element: <KioskPage /> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'onboarding', element: <OnboardingPage /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'reception', element: <ReceptionPage /> },
      { path: 'doctor', element: <DoctorConsolePage /> },
      { path: 'queue', element: <QueuePage /> },
      { path: 'diagnostics', element: <DiagnosticsPage /> },
      { path: 'lab', element: <LabPage /> },
      { path: 'pharmacy', element: <PharmacyPage /> },
      { path: 'inpatient', element: <InpatientPage /> },
      { path: 'nurse', element: <NursePage /> },
      { path: 'cashier', element: <CashierPage /> },
      { path: 'journal', element: <JournalPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'marketing', element: <MarketingPage /> },
      { path: 'payroll', element: <PayrollPage /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="clinic" replace /> },
          { path: 'clinic', element: <SettingsClinicPage /> },
          { path: 'staff', element: <SettingsStaffPage /> },
          { path: 'staff-profiles', element: <StaffProfilesPage /> },
          { path: 'shift-operators', element: <ShiftOperatorsPage /> },
          { path: 'shift-schedules', element: <ShiftSchedulesPage /> },
          { path: 'integrations', element: <SettingsIntegrationsPage /> },
          { path: 'subscription', element: <SettingsSubscriptionPage /> },
          { path: 'audit', element: <SettingsAuditPage /> },
          { path: 'catalog/:entity', element: <SettingsCatalogPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
];

export const router = createBrowserRouter(routes);
