import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';

import { AppShell } from './components/app-shell';
import { RequireAuth } from './components/require-auth';
import { HomePage } from './pages/home';
import { LoginPage } from './pages/auth/login';
import { RegisterPage } from './pages/auth/register';
import { ClinicsPage } from './pages/clinics/index';
import { ClinicDetailPage } from './pages/clinics/detail';
import { NursesPage } from './pages/nurses/index';
import { AppointmentsPage } from './pages/appointments/index';
import { QueueStatusPage } from './pages/queue/status';
import { ProfilePage } from './pages/profile/index';

const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'auth/login', element: <LoginPage /> },
      { path: 'auth/register', element: <RegisterPage /> },
      { path: 'clinics', element: <ClinicsPage /> },
      { path: 'clinics/:slug', element: <ClinicDetailPage /> },
      { path: 'nurses', element: <NursesPage /> },
      // Queue status is public — no auth required (share link)
      { path: 'queue/:id', element: <QueueStatusPage /> },
      // Auth-protected routes
      {
        path: 'appointments',
        element: <RequireAuth><AppointmentsPage /></RequireAuth>,
      },
      {
        path: 'profile',
        element: <RequireAuth><ProfilePage /></RequireAuth>,
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);
