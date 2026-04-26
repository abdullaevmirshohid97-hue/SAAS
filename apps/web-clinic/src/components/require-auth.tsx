import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useAuth } from '@/providers/auth-provider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, clinicId } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Yuklanmoqda…</div>;
  if (!session) return <Navigate to="/login" replace />;
  // Allow /onboarding without clinic_id — user just signed up
  if (!clinicId && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
