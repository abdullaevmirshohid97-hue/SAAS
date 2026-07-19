import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as LocalAuthentication from 'expo-local-authentication';

import { supabase } from '../lib/supabase';
import { setStaffAccessToken } from '../lib/api';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  /** Supabase app_metadata.role (doctor/nurse/receptionist/...) */
  role: string | null;
  /** Supabase app_metadata.clinic_id (klinika xodimlari uchun) */
  clinicId: string | null;
  biometricUnlocked: boolean;
  requireBiometric: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [biometricUnlocked, setBiometricUnlocked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setStaffAccessToken(data.session?.access_token ?? null);
      setLoading(false);
    });
    // Token keshi shu yerdan boqiladi — TOKEN_REFRESHED/SIGNED_OUT ham keladi,
    // staffApi so'rovlari getSession() chaqirmaydi (RN deadlock oldini olish).
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => {
      setSession(s);
      setStaffAccessToken(s?.access_token ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function requireBiometric() {
    const supported = await LocalAuthentication.hasHardwareAsync();
    if (!supported) { setBiometricUnlocked(true); return true; }
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Clary uchun autentifikatsiya' });
    setBiometricUnlocked(res.success);
    return res.success;
  }

  const role = (session?.user?.app_metadata?.role as string | undefined) ?? null;
  const clinicId = (session?.user?.app_metadata?.clinic_id as string | undefined) ?? null;

  return (
    <AuthContext.Provider value={{ session, loading, role, clinicId, biometricUnlocked, requireBiometric }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
}
