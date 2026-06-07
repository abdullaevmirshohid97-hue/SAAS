import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { patientApi, PATIENT_TOKEN_KEY } from '../lib/api';

const PATIENT_USER_KEY = 'clary.patient.user';

export interface PatientUser {
  id: string;
  phone: string;
  full_name: string;
  is_verified: boolean;
}

interface PatientAuthContextValue {
  user: PatientUser | null;
  loading: boolean;
  /** OTP so'rash — dev rejimda dev_code qaytaradi. */
  requestOtp: (phone: string) => Promise<{ expires_in_sec: number; dev_code?: string }>;
  /** Kodni tasdiqlash — muvaffaqiyatda token saqlanadi. */
  verifyOtp: (phone: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const PatientAuthContext = createContext<PatientAuthContextValue | undefined>(undefined);

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PatientUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [token, raw] = await Promise.all([
          AsyncStorage.getItem(PATIENT_TOKEN_KEY),
          AsyncStorage.getItem(PATIENT_USER_KEY),
        ]);
        if (token && raw) setUser(JSON.parse(raw) as PatientUser);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function requestOtp(phone: string) {
    const res = await patientApi.patient.requestOtp(phone);
    return { expires_in_sec: res.expires_in_sec, dev_code: res.dev_code };
  }

  async function verifyOtp(phone: string, code: string) {
    const res = await patientApi.patient.verifyOtp(phone, code);
    await AsyncStorage.multiSet([
      [PATIENT_TOKEN_KEY, res.access_token],
      [PATIENT_USER_KEY, JSON.stringify(res.user)],
    ]);
    setUser(res.user);
  }

  async function signOut() {
    await AsyncStorage.multiRemove([PATIENT_TOKEN_KEY, PATIENT_USER_KEY]);
    setUser(null);
  }

  return (
    <PatientAuthContext.Provider value={{ user, loading, requestOtp, verifyOtp, signOut }}>
      {children}
    </PatientAuthContext.Provider>
  );
}

export function usePatientAuth() {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth used outside PatientAuthProvider');
  return ctx;
}
