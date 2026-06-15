import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';

import { AppShell } from './components/app-shell';
import { RequireAuth } from './components/require-auth';
import { RoleHome, RequirePermission } from './components/role-gate';
import { LoginPage } from './pages/login';
import { OnboardingPage } from './pages/onboarding';
import { DashboardPage } from './pages/dashboard';
import { ReceptionPage } from './pages/reception';
import { QueuePage } from './pages/queue';
import { DiagnosticsPage } from './pages/diagnostics';
import { LabPage } from './pages/lab';
import { LabWorkstationPage } from './pages/lab-workstation';
import { PatientProfilePage } from './pages/patient-profile';
import { PharmacyPage, PharmacySalePage } from './pages/pharmacy';
import { InpatientPage } from './pages/inpatient';
import { InpatientStayPage } from './pages/inpatient-stay';
import { DentalPage } from './pages/dental';
import { CashierPage } from './pages/cashier';
import { CashierDebtorsPage } from './pages/cashier-debtors';
import { JournalPage, JournalEntryPage } from './pages/journal';
import { AnalyticsPage } from './pages/analytics';
import { AnalyticsDoctorsPage } from './pages/analytics-doctors';
import { AnalyticsServicesPage } from './pages/analytics-services';
import { MarketingPage } from './pages/marketing';
import { SettingsLayout } from './pages/settings/layout';
import { SettingsClinicPage } from './pages/settings/clinic';
import { SettingsCatalogPage } from './pages/settings/catalog';
import { SettingsPrinterPage } from './pages/settings/printer';
import { SettingsPharmacyPrinterPage } from './pages/settings/pharmacy-printer';
import { SettingsThermalPrintersPage } from './pages/settings/thermal-printers';
import { SettingsIntegrationsPage } from './pages/settings/integrations';
import { SettingsStaffPage } from './pages/settings/staff';
import { StaffProfilesPage } from './pages/settings/staff-profiles';
import { SettingsSubscriptionPage } from './pages/settings/subscription';
import { ShiftOperatorsPage } from './pages/settings/shift-operators';
import { ShiftSchedulesPage } from './pages/settings/shift-schedules';
import { NurseSchedulesPage } from './pages/settings/nurse-schedules';
import { KioskPage } from './pages/kiosk';
import { DoctorConsolePage } from './pages/doctor-console';
import { DoctorWorkspacePage } from './pages/doctor-workspace';
import { PayrollPage } from './pages/payroll';
import { PayrollEmployeePage } from './pages/payroll-employee';
import { NursePage } from './pages/nurse';
import { NurseRequestsPage } from './pages/nurse-requests';
import { AppointmentRequestsPage } from './pages/appointment-requests';
import { ReviewsPage } from './pages/reviews';
import { WebProfilePage } from './pages/settings/web-profile';
import { JournalLayoutSettingsPage } from './pages/settings/journal-layout';
import { SettingsAppearancePage } from './pages/settings/appearance';
import { DataAdminPage } from './pages/settings/data-admin';
import { SettingsTrashPage } from './pages/settings/trash';
import { PatientLoginPage } from './pages/patient-login';

const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/kiosk', element: <KioskPage /> },
  { path: '/patient-login', element: <PatientLoginPage /> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    children: [
      { index: true, element: <RoleHome /> },
      { path: 'onboarding', element: <OnboardingPage /> },
      {
        path: 'dashboard',
        element: (
          <RequirePermission permission="analytics.view_self">
            <DashboardPage />
          </RequirePermission>
        ),
      },
      { path: 'reception', element: <ReceptionPage /> },
      { path: 'doctor', element: <DoctorWorkspacePage /> },
      { path: 'doctor-console', element: <DoctorConsolePage /> },
      { path: 'queue', element: <QueuePage /> },
      { path: 'diagnostics', element: <DiagnosticsPage /> },
      { path: 'lab', element: <LabPage /> },
      { path: 'lab-workstation', element: <LabWorkstationPage /> },
      { path: 'patient/:id', element: <PatientProfilePage /> },
      { path: 'pharmacy', element: <PharmacyPage /> },
      { path: 'pharmacy/sale/:saleId', element: <PharmacySalePage /> },
      { path: 'inpatient', element: <InpatientPage /> },
      { path: 'inpatient/stays/:id', element: <InpatientStayPage /> },
      { path: 'dental', element: <DentalPage /> },
      { path: 'nurse', element: <NursePage /> },
      { path: 'nurse-requests', element: <NurseRequestsPage /> },
      { path: 'appointment-requests', element: <AppointmentRequestsPage /> },
      { path: 'cashier', element: <CashierPage /> },
      { path: 'cashier/debtors', element: <CashierDebtorsPage /> },
      { path: 'journal', element: <JournalPage /> },
      { path: 'journal/entry/:refId', element: <JournalEntryPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'analytics/doctors', element: <AnalyticsDoctorsPage /> },
      { path: 'analytics/services', element: <AnalyticsServicesPage /> },
      { path: 'marketing', element: <MarketingPage /> },
      { path: 'payroll', element: <PayrollPage /> },
      { path: 'payroll/employee/:doctorId', element: <PayrollEmployeePage /> },
      { path: 'reviews', element: <ReviewsPage /> },
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
          { path: 'nurse-schedules', element: <NurseSchedulesPage /> },
          { path: 'integrations', element: <SettingsIntegrationsPage /> },
          { path: 'subscription', element: <SettingsSubscriptionPage /> },
          { path: 'journal-layout', element: <JournalLayoutSettingsPage /> },
          { path: 'appearance', element: <SettingsAppearancePage /> },
          { path: 'trash', element: <SettingsTrashPage /> },
          { path: 'data-admin', element: <DataAdminPage /> },
          { path: 'catalog/:entity', element: <SettingsCatalogPage /> },
          { path: 'web-profile', element: <WebProfilePage /> },
          { path: 'printer', element: <SettingsPrinterPage /> },
          { path: 'pharmacy-printer', element: <SettingsPharmacyPrinterPage /> },
          { path: 'thermal-printers', element: <SettingsThermalPrintersPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/dashboard" replace /> },
];

export const router = createBrowserRouter(routes);
