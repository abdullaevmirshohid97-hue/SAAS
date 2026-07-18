import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@clary/api-client';

import { supabase } from './supabase';

export const PATIENT_TOKEN_KEY = 'clary.patient.token';

/**
 * Base URL: production build'da default — jonli API (env berilmasa ham ishlaydi).
 * Dev'da localhost; Android emulyatorda `localhost` telefonning o'zi bo'lgani
 * uchun `10.0.2.2` ga almashtiriladi.
 */
function resolveBaseUrl(): string {
  // C1 — XAVFSIZ DEFAULT: ilgari default http://localhost:4000 edi — env'siz
  // production APK server topolmay qolardi.
  const fallback = __DEV__ ? 'http://localhost:4000' : 'https://api.clary.uz';
  const raw = process.env.EXPO_PUBLIC_API_URL ?? fallback;
  if (__DEV__ && Platform.OS === 'android') {
    return raw.replace('localhost', '10.0.2.2').replace('127.0.0.1', '10.0.2.2');
  }
  return raw;
}

/**
 * Bemor portali uchun API client — OTP JWT'ni AsyncStorage'dan o'qib,
 * har so'rovga Bearer sifatida qo'shadi.
 */
export const patientApi = createClient({
  baseUrl: resolveBaseUrl(),
  getAccessToken: () => AsyncStorage.getItem(PATIENT_TOKEN_KEY),
  locale: 'uz-Latn',
});

/**
 * Xodim (shifokor/hamshira/...) uchun API client — Supabase session
 * access_token'ini ishlatadi (auto-refresh Supabase tomonidan).
 */
export const staffApi = createClient({
  baseUrl: resolveBaseUrl(),
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  locale: 'uz-Latn',
});
