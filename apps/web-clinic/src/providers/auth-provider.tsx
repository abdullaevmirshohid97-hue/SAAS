import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import {
  ROLE_DEFAULT_PERMISSIONS,
  hasAnyPermission,
  type PermissionKey,
} from '@clary/schemas';

import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  clinicId: string | null;
  role: string;
  permissions: ReadonlySet<PermissionKey>;
  can: (...required: PermissionKey[]) => boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const clinicId = (session?.user?.app_metadata as { clinic_id?: string } | undefined)?.clinic_id ?? null;
  const role = (session?.user?.app_metadata as { role?: string } | undefined)?.role ?? 'staff';

  // Build permission set from role defaults. Custom roles + per-user
  // overrides come from /staff and are applied via `effective_permissions`
  // when the staff editor surfaces them; sidebar gating uses base role,
  // which is what JWT carries today.
  const permissions = useMemo(() => {
    const list = ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.staff ?? [];
    return new Set<PermissionKey>(list);
  }, [role]);

  const can = useMemo(
    () => (...required: PermissionKey[]) => hasAnyPermission(
      Array.from(permissions).reduce((acc, p) => ({ ...acc, [p]: true }), {} as Record<string, boolean>),
      required,
    ),
    [permissions],
  );

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null, loading,
      clinicId, role, permissions, can,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
