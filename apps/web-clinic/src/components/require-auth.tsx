import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useAuth } from '@/providers/auth-provider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, clinicId } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Yuklanmoqda…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!clinicId) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
