import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useAuth } from '@/providers/auth-provider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, clinicId, workspace } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="text-muted-foreground flex h-screen items-center justify-center">
        Yuklanmoqda…
      </div>
    );
  if (!session) {
    const entry = location.pathname.startsWith('/dorixona') ? '?entry=pharmacy' : '';
    return <Navigate to={`/login${entry}`} replace />;
  }
  // Alohida "Dorixona" akkaunti klinika bo'limlariga kirmaydi — faqat /dorixona
  if (workspace === 'pharmacy' && !location.pathname.startsWith('/dorixona'))
    return <Navigate to="/dorixona" replace />;
  // Allow /onboarding without clinic_id — user just signed up
  if (!clinicId && location.pathname !== '/onboarding')
    return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
