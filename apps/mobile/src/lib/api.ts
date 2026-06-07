import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@clary/api-client';

import { supabase } from './supabase';

export const PATIENT_TOKEN_KEY = 'clary.patient.token';

/**
 * Base URL'ni emulyator uchun moslaymiz: Android emulyatorda `localhost`
 * telefonning o'zini bildiradi, kompyuter esa `10.0.2.2` orqali ochiladi.
 */
function resolveBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
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
