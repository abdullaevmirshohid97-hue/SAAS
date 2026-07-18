import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// C1 — env himoyasi: kalitlar yo'q bo'lsa tushunarsiz crash o'rniga aniq xato.
// EXPO_PUBLIC_* qiymatlar build vaqtida bundle'ga kiradi (eas.json env / .env.local).
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Clary mobil: EXPO_PUBLIC_SUPABASE_URL va EXPO_PUBLIC_SUPABASE_ANON_KEY ' +
      "env o'zgaruvchilari topilmadi. Lokal: apps/mobile/.env.local; " +
      'EAS build: eas.json env yoki EAS Secrets orqali bering.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
