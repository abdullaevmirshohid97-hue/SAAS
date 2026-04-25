import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as LocalAuthentication from 'expo-local-authentication';

import { supabase } from '../lib/supabase';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  biometricUnlocked: boolean;
  requireBiometric: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [biometricUnlocked, setBiometricUnlocked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function requireBiometric() {
    const supported = await LocalAuthentication.hasHardwareAsync();
    if (!supported) { setBiometricUnlocked(true); return true; }
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Clary uchun autentifikatsiya' });
    setBiometricUnlocked(res.success);
    return res.success;
  }

  return (
    <AuthContext.Provider value={{ session, loading, biometricUnlocked, requireBiometric }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
}
